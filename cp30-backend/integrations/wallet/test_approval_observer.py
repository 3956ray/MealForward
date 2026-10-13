"""Pure synthetic reconciliation/codec and fake HTTP/source checks; no network."""
import copy
import json
import subprocess
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from approval_observer import ApprovalObserver
from approval_rpc import (ApprovalError, ApprovalRpcTransport, validate_request,
    strict_json, endpoint_config)
import approval_rpc_worker as worker

NODE = '/opt/homebrew/bin/node'
PYTHON = '/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
A, E, P = '0x' + '11' * 20, '0x' + '22' * 20, '0x' + '33' * 20
G, T, R, F = ('0x' + x * 32 for x in ('44', '55', '66', '77'))
PROFILE = {'chainId': 10143, 'genesisHash': G, 'asset': A, 'escrow': E,
    'assetCodeHash': '0x' + '88' * 32, 'finality': 'rpc-finalized', 'eip1898': True,
    'budget': {'maxCalls': 12, 'maxTotalMs': 20000, 'maxCallMs': 3000,
        'maxResponseBytes': 1048576, 'maxTotalBytes': 1048576}}


class MemoryRpc:
    def __init__(self, scope):
        self.scope = scope
        self.calls = []
        self.chain = '0x279f'
        self.genesis = G
        self.amount = 9
        self.receipt_status = '0x1'
        self.finalized_number = 10
        self.conflict = False
        self.receipt_missing = False
        self.code = '0x6000'
    def request(self, method, params, *, deadline):
        self.calls.append((method, copy.deepcopy(params), deadline))
        if method == 'eth_chainId': return self.chain
        if method == 'eth_getTransactionByHash':
            return {'hash': T, 'from': P, 'to': A, 'chainId': '0x279f', 'value': '0x0',
                'input': self.data, 'blockNumber': '0x9', 'blockHash': R, 'transactionIndex': '0x0'}
        if method == 'eth_getTransactionReceipt':
            if self.receipt_missing: return None
            return {'transactionHash': T, 'from': P, 'to': A, 'status': self.receipt_status,
                'blockNumber': '0x9', 'blockHash': R, 'transactionIndex': '0x0'}
        if method == 'eth_getBlockByNumber':
            if params[0] == '0x0': return {'number': '0x0', 'hash': self.genesis}
            if params[0] == 'finalized': return {'number': hex(self.finalized_number), 'hash': F}
            return {'number': params[0], 'hash': ('0x' + '99' * 32 if self.conflict and params[0] == '0xa'
                else F if params[0] == '0xa' else R)}
        if method == 'eth_getCode': return self.code
        if method == 'eth_call': return '0x' + hex(self.amount)[2:].zfill(64)
        raise AssertionError('unexpected method')


class MemoryObserver(ApprovalObserver):
    # Only the reconciliation test replaces crypto verification. The production
    # class has no fake-verifier injection/composition; real prepare/state run.
    def _codec(self, method, p, deadline):
        if method == 'verify':
            t, e = p['transaction'], p['expected']
            if (t['hash'] != e['transactionHash'] or t['from'] != e['from']
                or t['to'] != e['to'] or t['chainId'] != hex(e['chainId'])
                or t['input'] != e['data'] or t['value'] != '0x0'):
                raise ApprovalError('SYNTHETIC_REJECTION')
            return {'hash': t['hash']}
        return super()._codec(method, p, deadline)


class ApprovalTests(unittest.TestCase):
    def test_exact_live_uuid_approve_identity(self):
        self.setup_observer()
        original='a4596099-217e-4018-8cc2-efa1156e9279:approve'
        self.record['attemptId']=original
        proof=self.observer.verify_original_approval(self.record)
        self.assertEqual(proof['attemptId'],original)
        self.assertEqual(proof['status'],'READY_FOR_ORIGINAL_FUND')
        for invalid in ('arbitrary:approve',original.replace(':approve',':fund'),original+':approve',original.upper()):
            self.record['attemptId']=invalid
            count=len(self.pending)
            self.assertIsNone(self.observer.verify_original_approval(self.record))
            self.assertEqual(len(self.pending),count)

    def setup_observer(self):
        pending = []
        def factory(scope):
            rpc = MemoryRpc(scope); rpc.data = self.record['deployment']['data']
            pending.append(rpc)
            if self.configure: self.configure(rpc)
            return rpc
        self.configure = None
        self.observer = MemoryObserver(node_executable=NODE, profile=PROFILE, transport_factory=factory)
        prepared = self.observer._codec('prepare', {'payer': P, 'escrow': E, 'amount': '9'}, time.monotonic() + 3)
        state = self.observer._codec('state', {'code': '0x6000', 'allowance': '0x' + '0' * 63 + '9'}, time.monotonic() + 3)
        self.observer.profile['assetCodeHash'] = state['assetCodeHash']
        self.record = {'attemptId': 'synthetic-original-1', 'quoteId': G, 'payer': P, 'amount': '9',
            'transactionHash': T, 'deployment': {'chainId': 10143, 'from': P, 'to': A,
                'value': '0', 'data': prepared['data'], 'callDataDigest': prepared['callDataDigest']}}
        self.pending = pending
        return prepared

    def test_exact_original_and_same_finalized_block(self):
        prepared = self.setup_observer()
        proof = self.observer.verify_original_approval(self.record)
        self.assertEqual(proof['status'], 'READY_FOR_ORIGINAL_FUND')
        self.assertEqual(proof['verification'], 'VERIFIED_ORIGINAL_APPROVAL')
        self.assertEqual(proof['allowance'], '9')
        calls = self.pending[0].calls
        self.assertEqual(len(calls), 11)
        self.assertEqual(len({deadline for _, _, deadline in calls}), 1)
        reads = [params for method, params, _ in calls if method in ('eth_call', 'eth_getCode')]
        self.assertTrue(all(params[1] == {'blockHash': F, 'requireCanonical': True} for params in reads))
        self.assertEqual(reads[1][0], {'to': A, 'data': prepared['allowanceData'], 'gas': '0x186a0'})
        self.assertFalse({'funded', 'paid', 'role', 'authority'} & set(proof))

    def test_missing_failed_nonfinalized_conflicting_or_insufficient(self):
        self.setup_observer()
        for field, value in [('chain', '0x1'), ('genesis', R), ('receipt_status', '0x0'),
            ('receipt_missing', True), ('finalized_number', 8), ('amount', 8), ('code', '0x6001'), ('conflict', True)]:
            with self.subTest(field=field):
                self.configure = lambda rpc, f=field, v=value: setattr(rpc, f, v)
                self.assertIsNone(self.observer.verify_original_approval(self.record))
        self.configure = lambda rpc: setattr(rpc, 'amount', 10)
        self.assertEqual(self.observer.verify_original_approval(self.record)['allowance'], '10')

    def test_original_record_and_budget_fail_closed(self):
        self.setup_observer()
        for field, value in [('payer', E), ('amount', '10'), ('transactionHash', R)]:
            bad = copy.deepcopy(self.record); bad[field] = value
            self.assertIsNone(self.observer.verify_original_approval(bad))
        for field, value in [('chainId', 1), ('from', E), ('to', E), ('value', '1'), ('data', '0x095ea7b3'), ('callDataDigest', R)]:
            bad = copy.deepcopy(self.record); bad['deployment'][field] = value
            self.assertIsNone(self.observer.verify_original_approval(bad))
        self.observer.profile['budget']['maxCalls'] = 3
        self.assertIsNone(self.observer.verify_original_approval(self.record))
        self.assertLessEqual(len(self.pending[-1].calls), 3)

    def test_real_codec_process_unsigned_transaction_is_rejected(self):
        self.setup_observer()
        real = ApprovalObserver(node_executable=NODE, profile=self.observer.profile,
            transport_factory=self.observer.transport_factory)
        # Memory RPC omits signatures; real viem recovery must fail closed.
        self.assertIsNone(real.verify_original_approval(self.record))
        self.assertEqual(len(self.pending[-1].calls), 3)

    def test_transport_exact_scope_and_empty_environment_process(self):
        prepared = self.setup_observer()
        scope = {'transactionHash': T, 'payer': P, 'allowanceData': prepared['allowanceData']}
        transport = ApprovalRpcTransport(endpoint='https://rpc.example.invalid/fixed',
            allowed_endpoints=['https://rpc.example.invalid/fixed'], allowed_hosts=['rpc.example.invalid'],
            python_executable=PYTHON, profile=self.observer.profile, scope=scope)
        for method, params in [('eth_sendRawTransaction', ['0x00']), ('eth_getTransactionCount', [P, 'latest']),
            ('eth_getTransactionByHash', [R]), ('eth_getCode', [A, {'blockHash': F, 'requireCanonical': True}])]:
            with self.assertRaises(ApprovalError): transport.request(method, params, deadline=time.monotonic() + 1)
        transport.finalized_hash = F
        for params in [[{'to': E, 'data': scope['allowanceData'], 'gas': '0x186a0'}, {'blockHash': F, 'requireCanonical': True}],
            [{'to': A, 'data': scope['allowanceData'], 'gas': '0x186a0'}, {'blockHash': F, 'requireCanonical': 1}]]:
            with self.assertRaises(ApprovalError): validate_request('eth_call', params, transport.profile, scope, F)
        class FakeProcess:
            returncode = 0
            stdin = stdout = None
            def communicate(self, raw, timeout):
                self.packet = strict_json(raw)
                return json.dumps({'jsonrpc': '2.0', 'id': self.packet['id'], 'result': '0x279f'}).encode(), None
            def poll(self): return 0
            def wait(self): pass
        fake = FakeProcess()
        with patch('approval_rpc.subprocess.Popen', return_value=fake) as popen:
            self.assertEqual(transport.request('eth_chainId', [], deadline=time.monotonic() + 1), '0x279f')
            self.assertEqual(popen.call_args.kwargs['env'], {})
            self.assertIn('-I', popen.call_args.args[0]); self.assertIn('-B', popen.call_args.args[0])
            self.assertGreater(fake.packet['deadline'], time.monotonic())
            self.assertNotIn('timeout', fake.packet)
        with self.assertRaises(ApprovalError): endpoint_config('http://rpc.example.invalid/fixed',
            ['http://rpc.example.invalid/fixed'], ['rpc.example.invalid'])
        with self.assertRaises(ApprovalError): strict_json('{"id":1,"id":2}')
        # A real local worker process rejects an invalid packet before any network API.
        result = subprocess.run([PYTHON, '-I', '-B', str(Path(__file__).with_name('approval_rpc_worker.py'))],
            input=b'{}', env={}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'{"error":"APPROVAL_RPC_UNAVAILABLE"}')

    def test_fake_https_worker_bounds_status_and_response(self):
        prepared = self.setup_observer()
        packet = {'endpoint': 'https://rpc.example.invalid/fixed',
            'allowedEndpoints': ['https://rpc.example.invalid/fixed'], 'allowedHosts': ['rpc.example.invalid'],
            'profile': self.observer.profile, 'scope': {'transactionHash': T, 'payer': P,
            'allowanceData': prepared['allowanceData']}, 'finalizedHash': None,
            'method': 'eth_chainId', 'params': [], 'id': 1, 'deadline': time.monotonic() + 2, 'maxBytes': 512}
        class FakeResponse:
            status = 200
            def __init__(self): self.raw = b'{"jsonrpc":"2.0","id":1,"result":"0x279f"}'
            def getheaders(self): return [('Content-Type', 'application/json')]
            def getheader(self, key, default=None): return 'application/json' if key == 'Content-Type' else default
            def read(self, size): chunk, self.raw = self.raw[:size], self.raw[size:]; return chunk
        class FakeConnection:
            def __init__(self): self.sock = self; self.response = FakeResponse(); self.closed = False
            def connect(self): pass
            def settimeout(self, value): pass
            def request(self, *args, **kwargs): self.sent = (args, kwargs)
            def getresponse(self): return self.response
            def close(self): self.closed = True
        for status, raw, success in [(200, None, True), (302, None, False), (200, b'x' * 513, False)]:
            fake = FakeConnection(); fake.response.status = status
            if raw: fake.response.raw = raw
            with patch.object(worker.http.client, 'HTTPSConnection', return_value=fake), \
                patch.object(worker.ssl, 'create_default_context', return_value=object()):
                if success:
                    self.assertEqual(strict_json(worker.perform(packet))['result'], '0x279f')
                    self.assertEqual(fake.sent[0][:2], ('POST', '/fixed'))
                else:
                    with self.assertRaises(ValueError): worker.perform(packet)
            self.assertTrue(fake.closed)


if __name__ == '__main__': unittest.main()
