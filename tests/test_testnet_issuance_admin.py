"""Offline CP22 single-issue tests; deterministic test key, fake RPC, temporary journal."""
import contextlib
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from eth_abi import encode
from eth_account import Account
from scripts.testnet_issuance_admin import client as m

ISSUANCE_ID = '0x'+'56'*32
HASH = '0x'+'33'*32
ACCOUNT = Account.from_key(bytes.fromhex('01'*32))
PARTNER = 'partner-a'
RECIPIENT = 'test-recipient-01'


def approved(directory, *, issuance_id=ISSUANCE_ID, label=PARTNER, recipient=RECIPIENT):
    path = Path(directory)/('approved-'+issuance_id[2:8]+'.json')
    path.write_text(json.dumps({'version': 1, 'issuanceId': issuance_id, 'batchId': m.BATCH,
                                'operator': m.OPERATOR, 'partnerLabel': label, 'recipientRef': recipient,
                                'approved': True, 'sourceCommit': 'b'*40}))
    path.chmod(0o600)
    return str(path)


class Rpc:
    def __init__(self):
        self.nonce = 3; self.pending = 3; self.balance = 10**18
        self.estimate = 90000; self.base = 10**9; self.sends = 0
        self.fail_send = False; self.receipt = None; self.tx = None; self.finalized = 10
    def call(self, method, params):
        if method == 'eth_getCode': return '0x'
        if method == 'eth_getTransactionCount': return hex(self.nonce if params[1] == 'latest' else self.pending)
        if method == 'eth_getBlockByNumber':
            height = self.finalized if params[0] == 'finalized' else (10 if params[0] == 'latest' else int(params[0], 16))
            return {'number': hex(height), 'hash': HASH, 'baseFeePerGas': hex(self.base)}
        if method == 'eth_getBalance': return hex(self.balance)
        if method == 'eth_estimateGas': return hex(self.estimate)
        if method == 'eth_call': return '0x'
        if method == 'eth_sendRawTransaction':
            self.sends += 1
            if self.fail_send: raise RuntimeError('secret raw credential')
            return '0x'+m.keccak(bytes.fromhex(params[0][2:])).hex()
        if method == 'eth_getTransactionReceipt': return self.receipt
        if method == 'eth_getTransactionByHash': return self.tx
        raise AssertionError(method)
    def send(self, raw): return self.call('eth_sendRawTransaction', [raw])


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.journal = m.Journal(Path(self.temp.name)/'admin')
        self.rpc = Rpc(); self.loads = 0
        self.role = True; self.role_finalized = True; self.paused = False
        self.payload = bytes(32); self.result = bytes(32)
        self.voucher_status = 0; self.voucher_batch = bytes(32)
        self.batch = (m.PRICE, m.PRICE, 0, 0, 0)
        self.config_path = approved(self.temp.name)
        self.expected_payload = m.hex_data(m.payload_hash(m.BATCH, [m.derive(ISSUANCE_ID)[1]]), 32)
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(m, 'OPERATOR', ACCOUNT.address))
        self.guard = self.stack.enter_context(patch.object(m, 'guard'))
        self.stack.enter_context(patch.object(m, 'contract_read', side_effect=self.read))
        self.client = m.Client(self.rpc, self.journal, self.loader)
    def loader(self): self.loads += 1; return ACCOUNT
    def read(self, rpc, name, args, block='latest'):
        if name == 'paused': return (self.paused,)
        if name == 'hasRole': return (self.role if block == 'latest' else self.role_finalized,)
        if name == 'getOperation': return (self.payload, self.result)
        if name == 'getVoucher': return (self.voucher_batch, self.voucher_status, bytes(32))
        if name == 'getBatch': return (*self.batch, 0, 0)
        raise AssertionError(name)
    def plan(self): return self.client.plan(self.config_path)
    def execute(self):
        p = self.plan(); return self.client.execute(p['planHash'], p['planHash'])
    def receipt(self, status=1):
        value = self.execute()
        self.apply_issued()
        self.rpc.tx = m.request(value['plan']['transaction'])
        self.rpc.tx.update(hash=value['txHash'], blockHash=HASH, blockNumber='0xa')
        operation_id, voucher_id = m.derive(ISSUANCE_ID)
        log = {'address': m.ADDRESS, 'topics': [m.ISSUED, operation_id, m.BATCH],
               'data': '0x'+encode(['bytes32[]'], [[m.hex_data(voucher_id, 32)]]).hex(),
               'transactionHash': value['txHash'], 'blockHash': HASH, 'blockNumber': '0xa', 'logIndex': '0x0'}
        self.rpc.receipt = {'transactionHash': value['txHash'], 'blockHash': HASH, 'blockNumber': '0xa',
                            'status': hex(status), 'gasUsed': hex(40000), 'effectiveGasPrice': hex(10**9),
                            'logs': [log] if status else []}
        return value
    def apply_issued(self):
        self.payload = self.expected_payload; self.result = m.hex_data(m.BATCH, 32)
        self.voucher_status = 1; self.voucher_batch = m.hex_data(m.BATCH, 32)
        self.batch = (m.PRICE, 0, m.PRICE, 0, 0)
    def test_plan_public_no_key_fixed_idempotent(self):
        a = self.plan(); self.assertEqual(a, self.plan()); self.assertEqual(self.loads, 0)
        operation_id, voucher_id = m.derive(ISSUANCE_ID)
        plan = a['plan']
        self.assertEqual(plan['operationId'], operation_id); self.assertEqual(plan['voucherId'], voucher_id)
        self.assertEqual(plan['partnerLabel'], PARTNER); self.assertEqual(plan['recipientRef'], RECIPIENT)
        tx = plan['transaction']
        self.assertEqual(tx['data'], m.issue_data(operation_id, m.BATCH, voucher_id))
        self.assertEqual(tx['value'], 0); self.assertEqual(tx['gas'], 96750); self.assertEqual(tx['type'], 2)
        self.assertNotIn('raw', a); self.assertNotIn('sourceCommit', plan)
        with self.assertRaises(m.IssuanceError): self.client.plan(approved(self.temp.name, issuance_id='0x'+'78'*32))
        with self.assertRaises(m.IssuanceError): self.client.plan(approved(self.temp.name, label='partner-b'))
    def test_execute_requires_double_hash_gate(self):
        p = self.plan()
        with self.assertRaises(m.IssuanceError): self.client.execute(p['planHash'], 'wrong')
        with self.assertRaises(m.IssuanceError): self.client.execute('', p['planHash'])
        self.assertEqual(self.loads, 0); self.assertEqual(self.rpc.sends, 0)
    def test_signing_started_persists_before_loader(self):
        def fail(): raise RuntimeError('private key')
        self.client.signer_loader = fail
        value = self.execute()
        self.assertEqual(value['state'], 'SIGNING_STARTED')
        self.assertEqual(self.journal.load()['state'], 'SIGNING_STARTED')
        self.assertEqual(self.rpc.sends, 0)
        with self.assertRaises(m.IssuanceError): self.client.execute(value['planHash'], value['planHash'])
    def test_single_sign_single_send_attempt_one(self):
        value = self.execute()
        self.assertEqual(value['state'], 'BROADCAST'); self.assertEqual(value['attempt'], 1)
        self.assertNotIn('raw', value)
        self.assertEqual(self.rpc.sends, 1); self.assertEqual(self.loads, 1)
        with self.assertRaises(m.IssuanceError): self.client.execute(value['planHash'], value['planHash'])
        self.assertEqual(self.rpc.sends, 1)
        self.assertTrue(self.journal.load()['raw'].startswith('0x02'))
        self.assertEqual(self.journal.path.stat().st_mode & 0o777, 0o600)
    def test_concurrent_execute_only_one_attempt(self):
        value = self.plan()
        def run():
            try: return self.client.execute(value['planHash'], value['planHash'])['state']
            except m.IssuanceError as error: return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertCountEqual(results, ['BROADCAST', 'ORIGINAL_TRANSACTION_ONLY'])
        self.assertEqual(self.loads, 1); self.assertEqual(self.rpc.sends, 1)
    def test_wrong_signer_cannot_send(self):
        self.client.signer_loader = lambda: Account.from_key(bytes.fromhex('02'*32))
        value = self.execute(); self.assertEqual(value['state'], 'SIGNING_STARTED')
        self.assertEqual(self.rpc.sends, 0)
    def test_presend_volatile_change_stops_send(self):
        def loader():
            self.rpc.pending = 4; return ACCOUNT
        self.client.signer_loader = loader
        value = self.execute()
        self.assertEqual(value['state'], 'SIGNED'); self.assertEqual(self.rpc.sends, 0)
        self.assertTrue(self.journal.load()['raw'])
        with self.assertRaises(m.IssuanceError): self.client.execute(value['planHash'], value['planHash'])
    def test_preflight_all_branches(self):
        cases = [('paused', 'CONTRACT_PAUSED'), ('role', 'ISSUER_ROLE_REQUIRED'),
                 ('role_finalized', 'ISSUER_ROLE_NOT_FINALIZED'), ('payload', 'INTENT_CONFLICT'),
                 ('voucher_status', 'DUPLICATE_VOUCHER'), ('batch', 'BATCH_STATE_CONFLICT'),
                 ('pending', 'NONCE_CONFLICT'), ('base', 'FEE_CAP_EXCEEDED'),
                 ('estimate', 'GAS_CAP_EXCEEDED'), ('balance', 'INSUFFICIENT_BALANCE')]
        originals = {field: getattr(self.rpc, field, None) or getattr(self, field) for field, _ in cases}
        mutations = {'paused': True, 'role': False, 'role_finalized': False, 'payload': b'\x01'*32,
                     'voucher_status': 1, 'batch': (m.PRICE, 0, m.PRICE, 0, 0), 'pending': 4,
                     'base': m.MAX_FEE, 'estimate': 300000, 'balance': 0}
        holders = {'pending': self.rpc, 'base': self.rpc, 'estimate': self.rpc, 'balance': self.rpc}
        for field, code in cases:
            with self.subTest(field=field):
                holder = holders.get(field, self)
                setattr(holder, field, mutations[field])
                with self.assertRaises(m.IssuanceError) as caught: self.plan()
                self.assertEqual(code, caught.exception.code)
                setattr(holder, field, originals[field])
                self.assertEqual(self.loads, 0)
                self.assertIsNone(self.journal.load(fresh=True))
    def test_already_issued_converges_readonly_no_send(self):
        self.payload = self.expected_payload
        with self.assertRaises(m.IssuanceError) as caught: self.plan()
        self.assertEqual('ISSUED_ALREADY', caught.exception.code)
        self.assertEqual(self.rpc.sends, 0); self.assertEqual(self.loads, 0)
        self.assertIsNone(self.journal.load(fresh=True))
    def test_send_failure_unknown_no_retry(self):
        self.rpc.fail_send = True; value = self.execute()
        self.assertEqual(value['state'], 'UNKNOWN'); self.assertEqual(value['attempt'], 1)
        self.assertNotIn('secret', json.dumps(value))
        self.assertEqual(self.client.reconcile()['state'], 'UNKNOWN'); self.assertEqual(self.rpc.sends, 1)
        with self.assertRaises(m.IssuanceError): self.client.execute(value['planHash'], value['planHash'])
    def test_reconcile_finalized_success(self):
        self.receipt(); value = self.client.reconcile()
        self.assertEqual(value['state'], 'FINALIZED_SUCCESS')
        self.assertEqual(value['receipt']['gasFeeWei'], str(40000*10**9))
    def test_reconcile_pending_then_finalized(self):
        self.receipt(); self.rpc.finalized = 9
        self.assertEqual(self.client.reconcile()['state'], 'INCLUDED_SUCCESS')
        self.rpc.finalized = 10
        self.assertEqual(self.client.reconcile()['state'], 'FINALIZED_SUCCESS')
    def test_reconcile_revert_terminal(self):
        self.receipt(status=0)
        self.assertEqual(self.client.reconcile()['state'], 'FINALIZED_REVERT')
    def test_reconcile_event_and_transaction_checks(self):
        self.receipt()
        self.rpc.receipt['logs'][0]['data'] = '0x'+encode(['bytes32[]'], [[]]).hex()
        with self.assertRaisesRegex(m.IssuanceError, 'EVENT_CONFLICT'): self.client.reconcile()
        operation_id, voucher_id = m.derive(ISSUANCE_ID)
        self.rpc.receipt['logs'][0]['data'] = '0x'+encode(['bytes32[]'], [[m.hex_data(voucher_id, 32)]]).hex()
        self.rpc.tx['nonce'] = '0x4'
        with self.assertRaisesRegex(m.IssuanceError, 'TRANSACTION_CONFLICT'): self.client.reconcile()
    def test_reconcile_finalized_onchain_recheck(self):
        self.receipt(); self.batch = (m.PRICE, m.PRICE, 0, 0, 0)
        with self.assertRaisesRegex(m.IssuanceError, 'FINALIZED_BATCH_CONFLICT'): self.client.reconcile()
        self.batch = (m.PRICE, 0, m.PRICE, 0, 0); self.voucher_status = 0
        with self.assertRaisesRegex(m.IssuanceError, 'FINALIZED_VOUCHER_MISSING'): self.client.reconcile()
    def test_journal_quarantine_cases(self):
        for target, kind in [('journal', 'mode'), ('anchor', 'mode'), ('journal', 'fifo'),
                             ('anchor', 'symlink'), ('journal', 'oversize'), ('directory', 'mode')]:
            with self.subTest(target=target, kind=kind):
                journal = m.Journal(Path(self.temp.name)/(target+'-'+kind))
                m.Client(self.rpc, journal, self.loader).plan(self.config_path)
                path = {'journal': journal.path, 'anchor': journal.anchor, 'directory': journal.directory}[target]
                if kind == 'mode': path.chmod(0o755 if target == 'directory' else 0o644)
                elif kind == 'fifo': path.unlink(); os.mkfifo(path, 0o600)
                elif kind == 'symlink': path.unlink(); path.symlink_to(journal.path)
                elif kind == 'oversize': path.write_bytes(b'x'*(m.MAX_JOURNAL_BYTES+1))
                with self.assertRaisesRegex(m.IssuanceError, 'RESTORE_QUARANTINE'): journal.load()
    def test_missing_journal_and_anchor_quarantined(self):
        self.plan(); self.journal.anchor.unlink()
        with self.assertRaisesRegex(m.IssuanceError, 'RESTORE_QUARANTINE'): self.plan()
    def test_cli_redacts_untrusted_exception(self):
        out = io.StringIO()
        with patch.object(m, 'AdminRpc', side_effect=RuntimeError('private-key-token')), contextlib.redirect_stdout(out):
            self.assertEqual(m.cli(['reconcile']), 1)
        self.assertEqual(json.loads(out.getvalue()), {'code': 'ADMIN_OPERATION_STOPPED'})
    def test_cli_plan_requires_approved_config(self):
        out = io.StringIO()
        with patch.object(m, 'AdminRpc'), contextlib.redirect_stdout(out):
            self.assertEqual(m.cli(['plan']), 1)
        self.assertEqual(json.loads(out.getvalue()), {'code': 'APPROVED_ISSUANCE_REQUIRED'})


if __name__ == '__main__': unittest.main()
