"""Trusted Python ReceiptVerifier bridge. Call only outside a DB transaction."""
import hashlib
import os
from pathlib import Path
import re
import select
import subprocess
import time

if __package__:
    from .rpc_transport import ObserverTransportError, json_bytes, strict_json, validate_budget, validate_readonly_request
else:
    from rpc_transport import ObserverTransportError, json_bytes, strict_json, validate_budget, validate_readonly_request


class ObserverBridgeError(RuntimeError):
    """Fixed error codes; input, endpoints, signatures and child stderr are never exposed."""


EXPECTED_COMPILER_PINS = {
    'registration-observer.mjs': 'e3ed91083c9d6e6dd8adff396ff1f2c64334ed2378c95544e190a0e294ed4926',
    'registration-observer-runner.mjs': 'b7dbcf680875979643dedfa187838ecdd6693b55ab4cdacd41d6ab975f64dc4d',
    'observer-artifacts.mjs': '823728c980f74db6e8271b288c708db4d5346a711f0d2862c457f66caeac10bf',
    'index.mjs': '5a5c2c1961e55519829e78824b306308c09657f32712dccbc0dda13ccf44eca0',
    'factory-abi.mjs': 'e32e4605f0333b04464e3cdf55155016c512cb44ed05fdaceeb9af15c9aed838',
    'escrow-abi.mjs': '1f8c6f4e1d1657042ed89f0f76a16dac8ff7d608099d2edfa58dee6be0e69af7',
    'escrow-creation-code.mjs': 'bd1eb01f7cfc4ce219df5e577bea09db63c2f9f20b06af5380264d0fb8908df7',
}
TEMPLATE_PINS = {
    'factory': '0xcc94e6dd8c3e594ed94ef9221e7b3c55e941321285afcd39966f04c36231fb1a',
    'escrow': '0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b',
}
CREATION_PIN = '0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e'
PROFILE_FIELDS = frozenset(('chainId', 'genesisHash', 'factory', 'registrar', 'asset', 'quoteAuthority',
                           'catalogAuthority', 'issuerAuthority', 'operatorAuthority', 'escrowCreationCodeHash',
                           'finality', 'eip1898', 'runtimeTemplatePins', 'budget'))
WORD = re.compile(r'0x[0-9a-f]{64}')
ADDRESS = re.compile(r'0x[0-9a-fA-F]{40}')


def _profile(value):
    if type(value) is not dict or set(value) != PROFILE_FIELDS:
        raise ObserverBridgeError('OBSERVER_CONFIGURATION_REQUIRED')
    if type(value['chainId']) is not int or not 1 <= value['chainId'] <= 9007199254740991:
        raise ObserverBridgeError('OBSERVER_CONFIGURATION_REJECTED')
    for field in ('factory', 'registrar', 'asset', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority'):
        if type(value[field]) is not str or not ADDRESS.fullmatch(value[field]) or int(value[field][2:], 16) == 0:
            raise ObserverBridgeError('OBSERVER_CONFIGURATION_REJECTED')
    if (not WORD.fullmatch(str(value['genesisHash'])) or value['escrowCreationCodeHash'] != CREATION_PIN
            or value['runtimeTemplatePins'] != TEMPLATE_PINS or value['eip1898'] is not True
            or value['finality'] != 'rpc-finalized'):
        raise ObserverBridgeError('OBSERVER_CONFIGURATION_REJECTED')
    validate_budget(value['budget'],registration_receipt=True)
    return strict_json(json_bytes(value))


class NodeReceiptVerifier:
    def __init__(self, *, node_executable, profile, transport_factory, compiler_pins):
        if type(node_executable) is not str or not Path(node_executable).is_absolute() or not Path(node_executable).is_file() or not callable(transport_factory):
            raise ObserverBridgeError('OBSERVER_CONFIGURATION_REQUIRED')
        self.node = node_executable
        self.profile = _profile(profile)
        self.budget = self.profile['budget']
        if compiler_pins != EXPECTED_COMPILER_PINS:
            raise ObserverBridgeError('OBSERVER_COMPILER_PINS_REQUIRED')
        self.pins = dict(compiler_pins)
        self.root = Path(__file__).resolve().parent
        self.helper = self.root / 'registration-observer-runner.mjs'
        self.transport_factory = transport_factory
        self._check_sources()

    def _check_sources(self):
        try:
            for name, digest in self.pins.items():
                if hashlib.sha256((self.root / name).read_bytes()).hexdigest() != digest:
                    raise ObserverBridgeError('OBSERVER_SOURCE_PIN_MISMATCH')
        except OSError:
            raise ObserverBridgeError('OBSERVER_SOURCE_UNAVAILABLE') from None

    def verify_original(self, original, transaction_hash, deployment):
        if transaction_hash is None: return None
        if type(transaction_hash) is not str or not WORD.fullmatch(transaction_hash):
            raise ObserverBridgeError('OBSERVER_ORIGINAL_REJECTED')
        self._check_sources()
        profile = _profile(self.profile)
        budget = profile['budget']
        packet = {'op': 'observe', 'profile': profile, 'original': original,
                  'deployment': deployment, 'transactionHash': transaction_hash}
        raw = json_bytes(packet) + b'\n'
        if len(raw) > 262144: raise ObserverBridgeError('OBSERVER_INPUT_LIMIT')
        deadline = time.monotonic() + budget['maxTotalMs'] / 1000
        proc = None
        try:
            try: transport = self.transport_factory()
            except Exception: raise ObserverBridgeError('OBSERVER_TRANSPORT_REJECTED') from None
            if not callable(getattr(transport, 'request', None)):
                raise ObserverBridgeError('OBSERVER_TRANSPORT_REQUIRED')
            proc = subprocess.Popen([self.node, str(self.helper)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, cwd=str(self.root), env={})
            os.set_blocking(proc.stdin.fileno(), False)
            os.set_blocking(proc.stdout.fileno(), False)
            buffer, output_bytes, response_bytes, calls = bytearray(), 0, 0, 0

            def remaining():
                value = deadline - time.monotonic()
                if value <= 0: raise ObserverBridgeError('OBSERVER_TIME_LIMIT')
                return value

            def write(data):
                if len(data) > 1048576: raise ObserverBridgeError('OBSERVER_FRAME_LIMIT')
                view = memoryview(data)
                while view:
                    if not select.select([], [proc.stdin.fileno()], [], remaining())[1]:
                        raise ObserverBridgeError('OBSERVER_TIME_LIMIT')
                    try: amount = os.write(proc.stdin.fileno(), view)
                    except BlockingIOError: continue
                    if amount <= 0: raise ObserverBridgeError('OBSERVER_CHILD_UNAVAILABLE')
                    view = view[amount:]

            def read():
                nonlocal output_bytes
                while b'\n' not in buffer:
                    if not select.select([proc.stdout.fileno()], [], [], remaining())[0]:
                        raise ObserverBridgeError('OBSERVER_TIME_LIMIT')
                    try: data = os.read(proc.stdout.fileno(), 65536)
                    except BlockingIOError: continue
                    if not data: raise ObserverBridgeError('OBSERVER_CHILD_UNAVAILABLE')
                    output_bytes += len(data)
                    buffer.extend(data)
                    if output_bytes > 2097152 or len(buffer) > 1048576:
                        raise ObserverBridgeError('OBSERVER_OUTPUT_LIMIT')
                line, _, tail = buffer.partition(b'\n')
                buffer[:] = tail
                return strict_json(line)

            write(raw)
            while True:
                message = read()
                if type(message) is not dict: raise ObserverBridgeError('OBSERVER_PROTOCOL_REJECTED')
                if message.get('type') == 'result':
                    if set(message) != {'type', 'result'}: raise ObserverBridgeError('OBSERVER_PROTOCOL_REJECTED')
                    result = message['result']
                    if (type(result) is not dict or set(result) != {'status', 'reason', 'evidence'}
                            or result['status'] not in ('VERIFIED', 'UNKNOWN', 'PENDING', 'UNVERIFIED')
                            or type(result['reason']) is not str or not re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}', result['reason'])):
                        raise ObserverBridgeError('OBSERVER_PROTOCOL_REJECTED')
                    try: proc.wait(timeout=min(remaining(), 0.2))
                    except subprocess.TimeoutExpired: raise ObserverBridgeError('OBSERVER_CHILD_UNAVAILABLE') from None
                    if proc.returncode or buffer: raise ObserverBridgeError('OBSERVER_CHILD_UNAVAILABLE')
                    if result['status'] != 'VERIFIED':
                        if result['evidence'] is not None: raise ObserverBridgeError('OBSERVER_PROTOCOL_REJECTED')
                        return None
                    evidence = result['evidence']
                    if (type(evidence) is not dict or any(evidence.get(k) != v for k, v in original.items())
                            or evidence.get('deployment') != deployment or evidence.get('transactionHash') != transaction_hash
                            or evidence.get('receiver') != str(original.get('owner')).lower()
                            or any(type(evidence.get(k)) is not str or not WORD.fullmatch(evidence[k]) for k in ('configHash', 'parametersDigest', 'transactionHash', 'blockHash'))
                            or type(evidence.get('escrow')) is not str or not ADDRESS.fullmatch(evidence['escrow'])
                            or any(type(evidence.get(k)) is not int or not 0 <= evidence[k] <= 9007199254740991 for k in ('blockNumber', 'logIndex'))):
                        raise ObserverBridgeError('OBSERVER_EVIDENCE_REJECTED')
                    return strict_json(json_bytes(evidence))
                if set(message) != {'type', 'id', 'method', 'params'} or message['type'] != 'rpc':
                    raise ObserverBridgeError('OBSERVER_PROTOCOL_REJECTED')
                calls += 1
                if type(message['id']) is not int or message['id'] != calls or calls > budget['maxCalls']:
                    raise ObserverBridgeError('OBSERVER_CALL_LIMIT')
                validate_readonly_request(message['method'], message['params'], profile['factory'])
                per_call = min(deadline, time.monotonic() + budget['maxCallMs'] / 1000)
                try: value = transport.request(message['method'], message['params'], deadline=per_call)
                except Exception: raise ObserverBridgeError('OBSERVER_TRANSPORT_REJECTED') from None
                if time.monotonic() > per_call: raise ObserverBridgeError('OBSERVER_CALL_TIME_LIMIT')
                response = json_bytes({'type': 'rpc-result', 'id': calls, 'result': value}) + b'\n'
                value_bytes = len(json_bytes(value))
                response_bytes += value_bytes
                if value_bytes > budget['maxResponseBytes'] or response_bytes > budget['maxTotalBytes']:
                    raise ObserverBridgeError('OBSERVER_RESPONSE_LIMIT')
                write(response)
        except ObserverBridgeError:
            raise
        except ObserverTransportError:
            raise ObserverBridgeError('OBSERVER_TRANSPORT_REJECTED') from None
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            raise ObserverBridgeError('OBSERVER_UNAVAILABLE') from None
        finally:
            if proc is not None:
                if proc.poll() is None: proc.kill()
                try: proc.wait(timeout=0.2)
                except subprocess.TimeoutExpired: raise ObserverBridgeError('OBSERVER_CLEANUP_FAILED') from None
                for pipe in (proc.stdin, proc.stdout):
                    if pipe: pipe.close()
