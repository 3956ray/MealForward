"""Bounded 10143 reads. No signing, send method, arbitrary browser proxy or retries."""
import json
import re
import time
import asyncio
from contextlib import contextmanager
from urllib.parse import urlsplit
import aiohttp
from eth_abi import encode, decode
from eth_utils import keccak, event_abi_to_log_topic
from web3 import Web3
from web3._utils.events import get_event_data
from hexbytes import HexBytes
from server.chain.client import ChainConflict, ChainUnavailable, plain
from .identity import CHAIN_ID, GENESIS, PRICE, RULE, ARTIFACT_SHA, HISTORICAL_ADDRESS, artifact, expected_runtime

MAX_BYTES = 1048576
READS = {'merchant', 'ruleVersion', 'priceWei', 'paused', 'hasRole', 'getBatch', 'getVoucher',
         'getOperation', 'liability', 'totalFunded', 'fundingCapWei', 'maxQuantity'}
BUSINESS_EVENTS = {'Funded', 'Issued', 'Locked', 'Reported', 'Settled'}


def number(v):
    if not isinstance(v, str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})', v):
        raise ChainConflict('Invalid RPC quantity')
    return int(v, 16)


def hash32(v):
    if not isinstance(v, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', v):
        raise ChainConflict('Invalid RPC hash')
    return v


class HttpsTransport:
    def __init__(self, url):
        u = urlsplit(url)
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.fragment or u.query:
            raise ValueError('Explicit credential-free HTTPS RPC required')
        self.url = url

    def __call__(self, payload, timeout):
        async def bounded():
            async with asyncio.timeout(timeout):
                async with aiohttp.ClientSession(trust_env=False, auto_decompress=False,
                        timeout=aiohttp.ClientTimeout(total=timeout), headers={'Accept-Encoding': 'identity'}) as session:
                    async with session.post(self.url, json=payload, allow_redirects=False) as r:
                        if r.status != 200: raise ChainUnavailable('RPC HTTP unavailable')
                        data = bytearray()
                        async for chunk in r.content.iter_chunked(16384):
                            data.extend(chunk)
                            if len(data) > MAX_BYTES: raise ChainUnavailable('RPC response too large')
                        return json.loads(data)
        try: return asyncio.run(bounded())
        except (aiohttp.ClientError, TimeoutError, ValueError):
            raise ChainUnavailable('RPC transport unavailable') from None


class TestnetRpc:
    def __init__(self, deployment, participants, transport, clock=time.monotonic):
        if deployment['chainId'] != CHAIN_ID or deployment['genesisHash'].lower() != GENESIS:
            raise ValueError('Exact Monad10143 identity required')
        if deployment['contractAddress'].lower() == HISTORICAL_ADDRESS:
            raise ValueError('Historical CP19 target is read-only, not new business')
        if deployment.get('artifactSha256') != ARTIFACT_SHA:
            raise ValueError('Reviewed deployment artifact required')
        if deployment['codeHash'].lower() != Web3.to_hex(keccak(hexstr=expected_runtime(deployment['merchant']))).lower():
            raise ValueError('Full immutable runtime identity required')
        self.deployment, self.transport, self.clock = deployment, transport, clock
        self.participants = {v.lower() for v in participants.values()}
        self.w3 = Web3()
        self.contract = self.w3.eth.contract(address=Web3.to_checksum_address(deployment['contractAddress']), abi=artifact()['abi'])
        self.functions = {a['name']: a for a in artifact()['abi'] if a['type'] == 'function'}
        self.event_abis = {Web3.to_hex(event_abi_to_log_topic(a)): a for a in artifact()['abi']
                           if a['type'] == 'event' and a['name'] in BUSINESS_EVENTS}
        self.active = False

    @contextmanager
    def observation(self, *, hashes=(), ids=()):
        if self.active: raise ChainUnavailable('Nested observation refused')
        self.active = True; self.calls = 0; self.pages = 0; self.logs_seen = 0
        self.deadline = self.clock()+30; self.hashes = set(hashes); self.ids = set(ids)
        self.final_height = None
        try: yield self
        finally: self.active = False

    def _call(self, method, params):
        if not self.active or self.calls >= 48 or self.clock() >= self.deadline:
            raise ChainUnavailable('Observation budget exhausted')
        self.calls += 1
        result = self.transport({'jsonrpc': '2.0', 'id': self.calls, 'method': method, 'params': params},
                                min(3, self.deadline-self.clock()))
        if self.clock() > self.deadline or len(json.dumps(result).encode()) > MAX_BYTES:
            raise ChainUnavailable('Observation response/time budget exceeded')
        if not isinstance(result, dict) or result.get('jsonrpc') != '2.0' or result.get('id') != self.calls:
            raise ChainConflict('RPC response identity mismatch')
        if 'error' in result or 'result' not in result: raise ChainUnavailable('RPC unavailable')
        return result['result']

    def block(self, height):
        if height not in (0, 'finalized') and (type(height) is not int or self.final_height is None or
                not int(self.deployment['deploymentBlock']) <= height <= self.final_height):
            raise ChainConflict('Block outside approved observation')
        value = self._call('eth_getBlockByNumber', [hex(height) if type(height) is int else height, False])
        if not isinstance(value, dict): raise ChainUnavailable('Block unavailable')
        result = {'number': number(value['number']), 'hash': hash32(value['hash'])}
        if height == 'finalized': self.final_height = result['number']
        elif result['number'] != height: raise ChainConflict('Wrong block height')
        return result

    def read(self, name, args, height):
        if name not in READS or height != self.final_height: raise ChainConflict('Read outside fixed finalized block')
        a = self.functions[name]
        if name == 'hasRole':
            roles = [bytes(32)] + [keccak(text=r+'_ROLE') for r in ('SUPPORTER', 'ISSUER', 'OPERATOR', 'SETTLER')]
            if len(args) != 2 or bytes(HexBytes(args[0])) not in roles or args[1].lower() not in self.participants:
                raise ChainConflict('Unapproved role lookup')
        elif name in ('getBatch', 'getVoucher', 'getOperation'):
            if not args or args[-1] not in self.ids: raise ChainConflict('Unapproved business identity')
        elif args: raise ChainConflict('Unexpected getter arguments')
        data = self.contract.encode_abi(name, args=args)
        result = self._call('eth_call', [{'to': self.contract.address, 'data': data, 'gas': '0x186a0'}, hex(height)])
        try: values = decode([x['type'] for x in a['outputs']], bytes(HexBytes(result)))
        except Exception: raise ChainConflict('Malformed contract response') from None
        return values[0] if len(values) == 1 else values

    def guard(self):
        if number(self._call('eth_chainId', [])) != CHAIN_ID or self.block(0)['hash'].lower() != GENESIS:
            raise ChainConflict('Wrong chain or genesis')
        final = self.block('finalized')
        if final['number'] < self.deployment['deploymentBlock']: raise ChainUnavailable('Deployment not finalized')
        if self.block(self.deployment['deploymentBlock'])['hash'] != self.deployment['deploymentBlockHash']:
            raise ChainConflict('Original deployment block changed')
        code = self._call('eth_getCode', [self.contract.address, hex(final['number'])])
        if not isinstance(code, str) or code.lower() != expected_runtime(self.deployment['merchant']).lower():
            raise ChainConflict('Runtime changed')
        if (self.read('merchant', [], final['number']).lower() != self.deployment['merchant'].lower() or
                Web3.to_hex(self.read('ruleVersion', [], final['number'])) != RULE or
                self.read('priceWei', [], final['number']) != PRICE):
            raise ChainConflict('Immutable business policy changed')
        return final

    def nonce(self, sender):
        if sender.lower() not in self.participants: raise ChainConflict('Unapproved participant')
        return number(self._call('eth_getTransactionCount', [sender, 'pending']))

    def balance(self, sender):
        if sender.lower() not in self.participants | {self.contract.address.lower()} or self.final_height is None: raise ChainConflict('Unapproved balance')
        return number(self._call('eth_getBalance', [sender, hex(self.final_height)]))

    def estimate(self, tx):
        if tx['from'].lower() not in self.participants or tx['to'].lower() != self.contract.address.lower() or tx['chainId'] != CHAIN_ID:
            raise ChainConflict('Estimate outside business deployment')
        function, _ = self.contract.decode_function_input(tx['data'])
        if function.fn_name not in ('fund', 'issue', 'lock', 'report', 'settle'):
            raise ChainConflict('Estimate outside fixed business ABI')
        encoded = {k: hex(v) if type(v) is int else v for k, v in tx.items()}
        return number(self._call('eth_estimateGas', [encoded]))

    def receipt(self, tx_hash):
        if tx_hash not in self.hashes: raise ChainConflict('Only original hashes may be queried')
        return self._call('eth_getTransactionReceipt', [hash32(tx_hash)])

    def transaction(self, tx_hash):
        if tx_hash not in self.hashes: raise ChainConflict('Only original hashes may be queried')
        return self._call('eth_getTransactionByHash', [hash32(tx_hash)])

    def events(self, start, end, name):
        if (type(start) is not int or type(end) is not int or not self.deployment['deploymentBlock'] <= start <= end or
                self.final_height is None or end > self.final_height or end-start >= 256 or self.pages >= 4):
            raise ChainUnavailable('Log range/page budget exhausted')
        topic = next((k for k, a in self.event_abis.items() if a['name'] == name), None)
        if not topic: raise ChainConflict('Unapproved event')
        self.pages += 1
        logs = self._call('eth_getLogs', [{'address': self.contract.address, 'fromBlock': hex(start),
                                        'toBlock': hex(end), 'topics': [topic]}])
        if not isinstance(logs, list): raise ChainConflict('Malformed logs')
        self.logs_seen += len(logs)
        if self.logs_seen > 1024: raise ChainUnavailable('Log response budget exhausted')
        result = []
        for log in logs:
            if log.get('removed') or log['address'].lower() != self.contract.address.lower() or not start <= number(log['blockNumber']) <= end:
                raise ChainConflict('Log outside requested context')
            typed = {**log, 'blockNumber': number(log['blockNumber']), 'transactionIndex': number(log['transactionIndex']),
                     'logIndex': number(log['logIndex']), 'topics': [HexBytes(v) for v in log['topics']]}
            decoded = get_event_data(self.w3.codec, self.event_abis[topic], typed)
            args = plain(decoded['args'])
            if args.get('operationId', args.get('intentId')) not in self.ids: continue
            self.hashes.add(hash32(log['transactionHash']))
            result.append({'deploymentId': self.deployment['deploymentId'], 'chainId': CHAIN_ID,
                           'contract': self.contract.address, 'blockNumber': typed['blockNumber'],
                           'blockHash': hash32(log['blockHash']), 'transactionHash': log['transactionHash'],
                           'transactionIndex': typed['transactionIndex'], 'logIndex': typed['logIndex'],
                           'eventName': name, 'args': args})
        return result
