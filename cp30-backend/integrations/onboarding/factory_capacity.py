"""Finalized Factory capacity observation. All calls MUST be outside DB transactions.

Trusted composition supplies the observer profile and a fresh bounded read-only
transport_factory. No endpoints, credentials, database or signer live here.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


class FactoryCapacityError(RuntimeError):
    """Only fixed public failure codes; never echo inputs or transport exceptions."""


ADDRESSES = ('factory', 'registrar', 'asset', 'quoteAuthority', 'catalogAuthority',
             'issuerAuthority', 'operatorAuthority')
GETTERS = ADDRESSES[1:] + ('escrowCreationCodeHash', 'storeCount')
TEMPLATE_PINS = {'factory': '0xcc94e6dd8c3e594ed94ef9221e7b3c55e941321285afcd39966f04c36231fb1a',
                 'escrow': '0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b'}
CREATION_PIN = '0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e'
SOURCE_PINS = {
    'registration-observer.mjs': 'e3ed91083c9d6e6dd8adff396ff1f2c64334ed2378c95544e190a0e294ed4926',
    'observer-artifacts.mjs': '823728c980f74db6e8271b288c708db4d5346a711f0d2862c457f66caeac10bf',
    'index.mjs': '5a5c2c1961e55519829e78824b306308c09657f32712dccbc0dda13ccf44eca0',
    'factory-abi.mjs': 'e32e4605f0333b04464e3cdf55155016c512cb44ed05fdaceeb9af15c9aed838',
    'escrow-abi.mjs': '1f8c6f4e1d1657042ed89f0f76a16dac8ff7d608099d2edfa58dee6be0e69af7',
    'escrow-creation-code.mjs': 'bd1eb01f7cfc4ce219df5e577bea09db63c2f9f20b06af5380264d0fb8908df7',
}
LIMITS = {'maxCalls': 48, 'maxTotalMs': 20000, 'maxCallMs': 3000,
          'maxResponseBytes': 1048576, 'maxTotalBytes': 1048576, 'maxCatalogEntries': 3}
WORD = re.compile(r'0x[0-9a-f]{64}')
QUANTITY = re.compile(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)')


def _encoded(value):
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('ascii')


def _quantity(value):
    if type(value) is not str or not QUANTITY.fullmatch(value) or len(value) > 66:
        raise FactoryCapacityError('FACTORY_CAPACITY_RESPONSE_REJECTED')
    return int(value, 16)


def _block(value):
    if type(value) is not dict or type(value.get('hash')) is not str or not WORD.fullmatch(value['hash']):
        raise FactoryCapacityError('FACTORY_CAPACITY_RESPONSE_REJECTED')
    return _quantity(value.get('number')), value['hash']


def _profile(value):
    fields = set(ADDRESSES) | {'chainId', 'genesisHash', 'escrowCreationCodeHash', 'finality',
                             'eip1898', 'runtimeTemplatePins', 'budget'}
    if type(value) is not dict or set(value) != fields:
        raise FactoryCapacityError('FACTORY_CAPACITY_PROFILE_REJECTED')
    if type(value['chainId']) is not int or not 1 <= value['chainId'] <= 9007199254740991:
        raise FactoryCapacityError('FACTORY_CAPACITY_PROFILE_REJECTED')
    for field in ADDRESSES:
        address = value[field]
        if type(address) is not str or not re.fullmatch(r'0x[0-9a-fA-F]{40}', address) or int(address[2:], 16) == 0:
            raise FactoryCapacityError('FACTORY_CAPACITY_PROFILE_REJECTED')
    if (type(value['genesisHash']) is not str or not WORD.fullmatch(value['genesisHash'])
            or value['escrowCreationCodeHash'] != CREATION_PIN or value['runtimeTemplatePins'] != TEMPLATE_PINS
            or value['eip1898'] is not True or value['finality'] != 'rpc-finalized'):
        raise FactoryCapacityError('FACTORY_CAPACITY_PROFILE_REJECTED')
    budget = value['budget']
    if (type(budget) is not dict or set(budget) != set(LIMITS)
            or any(type(budget[k]) is not int or not 1 <= budget[k] <= cap for k, cap in LIMITS.items())
            or budget['maxCallMs'] > budget['maxTotalMs']):
        raise FactoryCapacityError('FACTORY_CAPACITY_PROFILE_REJECTED')
    return json.loads(_encoded(value))


class FactoryCapacityObserver:
    def __init__(self, *, profile, transport_factory, node_executable):
        if (type(node_executable) is not str or not Path(node_executable).is_absolute()
                or not Path(node_executable).is_file() or not callable(transport_factory)):
            raise FactoryCapacityError('FACTORY_CAPACITY_CONFIGURATION_REQUIRED')
        self.profile = _profile(profile)
        self.transport_factory = transport_factory
        self.node = node_executable
        self.root = Path(__file__).resolve().parent

    def _codec(self, packet, deadline):
        remaining = min(3, deadline - time.monotonic())
        if remaining <= 0: raise FactoryCapacityError('FACTORY_CAPACITY_TIME_LIMIT')
        raw = _encoded(packet)
        if len(raw) > 262144: raise FactoryCapacityError('FACTORY_CAPACITY_CODEC_REJECTED')
        try:
            result = subprocess.run([self.node, str(self.root / 'factory-capacity-codec.mjs')],
                input=raw, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env={}, cwd=str(self.root), timeout=remaining, check=False)
            if result.returncode or len(result.stdout) > 65536:
                raise FactoryCapacityError('FACTORY_CAPACITY_CODEC_REJECTED')
            value = json.loads(result.stdout)
            if type(value) is not dict or value.get('error'):
                raise FactoryCapacityError('FACTORY_CAPACITY_CODEC_REJECTED')
            return value
        except (OSError, subprocess.TimeoutExpired, ValueError):
            raise FactoryCapacityError('FACTORY_CAPACITY_CODEC_REJECTED') from None

    def observe(self):
        try:
            profile = _profile(self.profile)
            budget = profile['budget']
            deadline = time.monotonic() + budget['maxTotalMs'] / 1000
            for name, pin in SOURCE_PINS.items():
                if hashlib.sha256((self.root.parent / 'wallet' / name).read_bytes()).hexdigest() != pin:
                    raise FactoryCapacityError('FACTORY_CAPACITY_SOURCE_PIN_MISMATCH')
            prepared = self._codec({'op': 'prepare'}, deadline)
            calls = prepared.get('calls')
            if (set(prepared) != {'calls'} or type(calls) is not list or len(calls) != 8
                    or [call.get('functionName') for call in calls] != list(GETTERS)
                    or any(set(call) != {'functionName', 'data'} or not re.fullmatch(r'0x[0-9a-f]{8}', call['data']) for call in calls)):
                raise FactoryCapacityError('FACTORY_CAPACITY_CODEC_REJECTED')
            transport = self.transport_factory()
            counter = total_bytes = 0

            def request(method, params):
                nonlocal counter, total_bytes
                counter += 1
                end = min(deadline, time.monotonic() + budget['maxCallMs'] / 1000)
                if counter > budget['maxCalls'] or time.monotonic() >= end:
                    raise FactoryCapacityError('FACTORY_CAPACITY_TIME_LIMIT')
                value = transport.request(method, params, deadline=end)
                size = len(_encoded(value)); total_bytes += size
                if time.monotonic() > end:
                    raise FactoryCapacityError('FACTORY_CAPACITY_TIME_LIMIT')
                if size > budget['maxResponseBytes'] or total_bytes > budget['maxTotalBytes']:
                    raise FactoryCapacityError('FACTORY_CAPACITY_RESPONSE_LIMIT')
                return value

            if _quantity(request('eth_chainId', [])) != profile['chainId']:
                raise FactoryCapacityError('FACTORY_CAPACITY_CHAIN_MISMATCH')
            if _block(request('eth_getBlockByNumber', ['0x0', False])) != (0, profile['genesisHash']):
                raise FactoryCapacityError('FACTORY_CAPACITY_CHAIN_MISMATCH')
            number, block_hash = _block(request('eth_getBlockByNumber', ['finalized', False]))
            tag = hex(number)
            if _block(request('eth_getBlockByNumber', [tag, False])) != (number, block_hash):
                raise FactoryCapacityError('FACTORY_CAPACITY_CANONICAL_MISMATCH')
            snapshot = {'blockHash': block_hash, 'requireCanonical': True}
            code = request('eth_getCode', [profile['factory'].lower(), snapshot])
            results = {call['functionName']: request('eth_call',
                [{'to': profile['factory'].lower(), 'data': call['data']}, snapshot]) for call in calls}
            decoded = self._codec({'op': 'verify', 'code': code, 'results': results,
                                  'templatePin': profile['runtimeTemplatePins']['factory']}, deadline)
            expected = {key: profile[key].lower() for key in GETTERS[:-1]}
            if (set(decoded) != set(expected) | {'count'} or any(decoded[key] != val for key, val in expected.items())
                    or type(decoded['count']) is not int or not 0 <= decoded['count'] <= 3):
                raise FactoryCapacityError('FACTORY_CAPACITY_BINDING_MISMATCH')
            if (_block(request('eth_getBlockByNumber', [tag, False])) != (number, block_hash)
                    or _quantity(request('eth_chainId', [])) != profile['chainId']):
                raise FactoryCapacityError('FACTORY_CAPACITY_CANONICAL_MISMATCH')
            if time.monotonic() >= deadline: raise FactoryCapacityError('FACTORY_CAPACITY_TIME_LIMIT')
            observed_at = int(time.time())
            parameters = {key: profile[key].lower() for key in ADDRESSES}
            parameters.update(chainId=str(profile['chainId']), escrowCreationCodeHash=CREATION_PIN)
            return {'profile': parameters, 'count': decoded['count'],
                    'observedAt': observed_at, 'blockHash': block_hash}
        except FactoryCapacityError:
            raise
        except Exception:
            raise FactoryCapacityError('FACTORY_CAPACITY_UNAVAILABLE') from None
