import copy
import unittest
import asyncio
import time
from unittest.mock import patch
from eth_abi import encode
from eth_utils import keccak
from web3 import Web3
from server.chain.client import ChainRpc, ChainConflict, ChainUnavailable
from server.business_policy import LOCAL_POLICY, BusinessPolicy, validate_policy
from server.manual_business.policy import MANUAL_POLICY
from server.manual_business.identity import (deployment_plan, verify_deployment, expected_runtime, GENESIS, RULE, PRICE)
from server.manual_business.rpc import TestnetRpc, HttpsTransport
from server.manual_business.deployment import register_deployment


def identity():
    p = deployment_plan('new-run', '0x'+'11'*20, '0x'+'22'*20, 4)
    block = {'number': 10, 'hash': '0x'+'33'*32, 'transactions': ['0x'+'44'*32]}
    tx = {'hash': '0x'+'44'*32, 'from': p['sender'], 'to': None, 'nonce': 4,
          'chainId': 10143, 'value': 0, 'input': p['creationInput'],
          'blockNumber': 10, 'blockHash': block['hash'], 'transactionIndex': 0}
    receipt = {'status': 1, 'blockHash': block['hash'], 'blockNumber': 10,
               'transactionHash': tx['hash'], 'contractAddress': p['predictedAddress'], 'transactionIndex': 0}
    return p, tx, receipt, block


class RpcTests(unittest.TestCase):
    def setUp(self):
        self.plan, self.tx, self.receipt, self.block = identity()
        self.code = expected_runtime(self.plan['merchant'])
        self.deployment = verify_deployment(self.plan, self.tx, self.receipt, self.block, self.code, 10)
        self.calls = []
        self.rpc = TestnetRpc(self.deployment, {'merchant': self.plan['merchant']}, self.transport)

    def transport(self, payload, timeout):
        self.calls.append(payload)
        method, params = payload['method'], payload['params']
        result = None
        if method == 'eth_chainId': result = hex(10143)
        if method == 'eth_getBlockByNumber': result = {'number': '0x0' if params[0] == '0x0' else '0xa', 'hash': GENESIS if params[0] == '0x0' else self.block['hash']}
        if method == 'eth_getCode': result = self.code
        if method == 'eth_call':
            fn, args = self.rpc.contract.decode_function_input(params[0]['data'])
            values = {'merchant': self.plan['merchant'], 'priceWei': PRICE, 'ruleVersion': bytes.fromhex(RULE[2:]), 'paused': False}
            a = self.rpc.functions[fn.fn_name]
            result = '0x'+encode([x['type'] for x in a['outputs']], [values[fn.fn_name]]).hex()
        if method == 'eth_getLogs': result = []
        return {'jsonrpc': '2.0', 'id': payload['id'], 'result': result}

    def test_new_deployment_requires_finality_exact_creation_and_immutable_runtime(self):
        with self.assertRaises(ChainConflict): verify_deployment(self.plan, self.tx, self.receipt, self.block, self.code, 9)
        with self.assertRaises(ChainConflict): verify_deployment(self.plan, {**self.tx, 'nonce': 5}, self.receipt, self.block, self.code, 10)
        with self.assertRaises(ChainConflict): verify_deployment(self.plan, self.tx, self.receipt, self.block, expected_runtime('0x'+'55'*20), 10)
        self.assertNotEqual(self.deployment['deploymentId'], self.plan['predictedAddress'])

    def test_guard_uses_exact_network_runtime_and_fixed_block(self):
        with self.rpc.observation(): self.assertEqual(self.rpc.guard()['number'], 10)
        calls = [p for p in self.calls if p['method'] == 'eth_call']
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(p['params'][1] == '0xa' and p['params'][0]['gas'] == '0x186a0' for p in calls))

    def test_original_local_guard_and_policy_not_widened(self):
        with self.assertRaises(ValueError): ChainRpc({**self.deployment, 'rpcUrl': 'http://127.0.0.1:1'})
        with self.assertRaises(ValueError): validate_policy(LOCAL_POLICY, self.deployment)
        with self.assertRaises(ValueError): validate_policy(MANUAL_POLICY, {'chainId': 31337})
        with self.assertRaises(ValueError): validate_policy(BusinessPolicy(10143, RULE, 3, ('metamask',)), self.deployment)
        with self.assertRaises(ValueError): TestnetRpc({**self.deployment, 'chainId': 31337}, {}, self.transport)

    def test_no_arbitrary_hash_selector_or_range(self):
        with self.rpc.observation():
            self.rpc.guard()
            with self.assertRaises(ChainConflict): self.rpc.transaction('0x'+'77'*32)
            with self.assertRaises(ChainConflict): self.rpc.read('grantRole', [], 10)
            with self.assertRaises(ChainConflict): self.rpc.read('getVoucher', ['0x'+'88'*32], 10)
            with self.assertRaises(ChainUnavailable): self.rpc.events(10, 300, 'Funded')
            for _ in range(4): self.rpc.events(10, 10, 'Funded')
            with self.assertRaises(ChainUnavailable): self.rpc.events(10, 10, 'Funded')
        self.assertFalse(any(p['method'].startswith('eth_send') for p in self.calls))

    def test_call_budget_and_no_implicit_network_at_construction(self):
        self.assertEqual(self.calls, [])
        with self.assertRaises(ChainUnavailable): self.rpc.guard()
        with self.rpc.observation():
            for _ in range(48): self.rpc.block(0)
            with self.assertRaises(ChainUnavailable): self.rpc.block(0)
        self.assertEqual(len(self.calls), 48)

    def test_bad_rpc_id_and_oversize_response_stop(self):
        self.rpc.transport = lambda p, t: {'jsonrpc': '2.0', 'id': p['id']+1, 'result': '0x279f'}
        with self.rpc.observation(), self.assertRaises(ChainConflict): self.rpc.guard()
        self.rpc.transport = lambda p, t: {'jsonrpc': '2.0', 'id': p['id'], 'result': 'x'*1048576}
        with self.rpc.observation(), self.assertRaises(ChainUnavailable): self.rpc.guard()

    def test_registration_binds_original_deployment_with_eight_reads(self):
        calls = []
        def transport(p, timeout):
            calls.append(p); method = p['method']
            if method == 'eth_chainId': result = hex(10143)
            elif method == 'eth_getBlockByNumber':
                result = {'number': '0x0' if p['params'][0] == '0x0' else '0xa',
                          'hash': GENESIS if p['params'][0] == '0x0' else self.block['hash'], 'transactions': self.block['transactions']}
            elif method == 'eth_getTransactionByHash':
                result = {**self.tx, **{k: hex(self.tx[k]) for k in ('nonce', 'chainId', 'value', 'blockNumber', 'transactionIndex')}}
            elif method == 'eth_getTransactionReceipt':
                result = {**self.receipt, 'status': '0x1', 'blockNumber': '0xa', 'transactionIndex': '0x0'}
            elif method == 'eth_getCode': result = self.code
            else: self.fail('unapproved registration RPC')
            return {'jsonrpc': '2.0', 'id': p['id'], 'result': result}
        self.assertEqual(register_deployment(self.plan, self.tx['hash'], transport), self.deployment)
        self.assertEqual(len(calls), 8)
        self.assertTrue(all(not p['method'].startswith('eth_send') for p in calls))
        mutations = [('tx', 'blockHash', '0x'+'99'*32), ('tx', 'blockNumber', '0xb'),
                     ('tx', 'transactionIndex', '0x9'), ('receipt', 'transactionIndex', '0x1'),
                     ('block', 'transactions', ['0x'+'99'*32]), ('block', 'transactions', None),
                     ('block', 'transactions', []), ('block', 'transactions', 'missing'), ('block', 'number', '0xb')]
        for target in ('tx', 'receipt'):
            for field in ('blockHash', 'blockNumber', 'transactionIndex'):
                for invalid in (None, 'missing', '', '0x00'):
                    mutations.append((target, field, invalid))
        for target, field, value in mutations:
            def conflicting(p, timeout):
                response = transport(p, timeout)
                method = p['method']
                match = (target == 'tx' and method == 'eth_getTransactionByHash' or
                         target == 'receipt' and method == 'eth_getTransactionReceipt' or
                         target == 'block' and method == 'eth_getBlockByNumber' and p['params'][0] == '0xa')
                if match:
                    if value == 'missing': response['result'].pop(field, None)
                    else: response['result'][field] = value
                return response
            with self.subTest(target=target, field=field, value=value), self.assertRaises((ChainConflict, ChainUnavailable)):
                register_deployment(self.plan, self.tx['hash'], conflicting)

    def test_streaming_transport_has_total_timeout_not_only_chunk_timeout(self):
        class Response:
            status = 200
            content = None
            async def __aenter__(self): self.content = self; return self
            async def __aexit__(self, *_): pass
            async def iter_chunked(self, _):
                yield b'{'  # a peer dribbling bytes must not extend the absolute timeout
                await asyncio.sleep(1)
                yield b'}'
        class Session:
            def __init__(self, **options):
                self.options = options
                if options['trust_env'] or options['auto_decompress']: raise AssertionError('Unsafe transport options')
            async def __aenter__(self): return self
            async def __aexit__(self, *_): pass
            def post(self, *_, **kwargs):
                if kwargs['allow_redirects']: raise AssertionError('Redirects must be disabled')
                return Response()
        started = time.monotonic()
        with patch('server.manual_business.rpc.aiohttp.ClientSession', Session), self.assertRaises(ChainUnavailable):
            HttpsTransport('https://example.invalid')({}, .02)
        self.assertLess(time.monotonic()-started, .5)


if __name__ == '__main__': unittest.main()
