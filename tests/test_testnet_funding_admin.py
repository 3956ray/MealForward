"""Offline CP21 single-grant tests; deterministic test key, fake RPC, temporary journal."""
import contextlib
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from eth_account import Account
from scripts.testnet_funding_admin import client as m

PAYER = '0x' + '22'*20
HASH = '0x' + '33'*32
ACCOUNT = Account.from_key(bytes.fromhex('01'*32))


class Rpc:
    def __init__(self):
        self.nonce = 3; self.pending = 3; self.balance = 10**18
        self.estimate = 50000; self.base = 10**9; self.sends = 0
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


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.journal = m.Journal(Path(self.temp.name)/'admin')
        self.rpc = Rpc(); self.loads = 0; self.role = False
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(m, 'ADMIN', ACCOUNT.address))
        self.guard = self.stack.enter_context(patch.object(m, 'guard'))
        self.stack.enter_context(patch.object(m, 'contract_read', side_effect=self.read))
        self.client = m.Client(self.rpc, self.journal, self.loader)
    def loader(self): self.loads += 1; return ACCOUNT
    def read(self, rpc, name, args, block='latest'):
        if name == 'paused': return (False,)
        if name == 'hasRole': return (True if args[0] == '0x'+'00'*32 else self.role,)
        raise AssertionError(name)
    def plan(self): return self.client.plan(PAYER)
    def execute(self):
        p = self.plan(); return self.client.execute(p['planHash'], p['planHash'])
    def receipt(self, status=1):
        value = self.execute(); self.role = True
        self.rpc.tx = m.request(value['plan']['transaction'])
        self.rpc.tx.update(hash=value['txHash'], blockHash=HASH, blockNumber='0xa')
        log = {'address': m.ADDRESS, 'topics': [m.ROLE_EVENT, m.SUPPORTER,
               '0x'+PAYER[2:].rjust(64, '0'), '0x'+ACCOUNT.address[2:].lower().rjust(64, '0')],
               'data': '0x', 'transactionHash': value['txHash'], 'blockHash': HASH, 'blockNumber': '0xa'}
        self.rpc.receipt = {'transactionHash': value['txHash'], 'blockHash': HASH, 'blockNumber': '0xa',
                            'status': hex(status), 'gasUsed': hex(40000), 'effectiveGasPrice': hex(10**9),
                            'logs': [log] if status else []}
        return value
    def test_plan_fixed_and_idempotent(self):
        a = self.plan(); self.assertEqual(a, self.plan()); self.assertEqual(self.loads, 0)
        tx = a['plan']['transaction']; self.assertEqual(tx['value'], 0); self.assertEqual(tx['gas'], 53750)
        with self.assertRaises(m.FundingError): self.client.plan('0x'+'44'*20)
    def test_approval_required_before_loader(self):
        p = self.plan()
        with self.assertRaises(m.FundingError): self.client.execute(p['planHash'], 'wrong')
        self.assertEqual(self.loads, 0)
    def test_single_sign_single_send_private_raw(self):
        value = self.execute(); self.assertEqual(value['state'], 'BROADCAST'); self.assertNotIn('raw', value)
        self.assertEqual(self.rpc.sends, 1); self.assertEqual(self.loads, 1)
        with self.assertRaises(m.FundingError): self.client.execute(value['planHash'], value['planHash'])
        self.assertEqual(self.rpc.sends, 1)
        self.assertTrue(self.journal.load()['raw'].startswith('0x02'))
        self.assertEqual(self.journal.path.stat().st_mode & 0o777, 0o600)
    def test_concurrent_execute_only_one_attempt(self):
        value = self.plan()
        def run():
            try: return self.client.execute(value['planHash'], value['planHash'])['state']
            except m.FundingError as error: return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertCountEqual(results, ['BROADCAST', 'ORIGINAL_TRANSACTION_ONLY'])
        self.assertEqual(self.loads, 1); self.assertEqual(self.rpc.sends, 1)
    def test_wrong_signer_cannot_send(self):
        self.client.signer_loader = lambda: Account.from_key(bytes.fromhex('02'*32))
        self.assertEqual(self.execute()['state'], 'SIGNING_STARTED')
        self.assertEqual(self.rpc.sends, 0)
    def test_crash_after_signed_raw_persistence_never_sends_again(self):
        value = self.plan(); original = self.journal.save
        def fail(value):
            if value['state'] == 'UNKNOWN': raise OSError('disk failure')
            original(value)
        with patch.object(self.journal, 'save', side_effect=fail):
            result = self.client.execute(value['planHash'], value['planHash'])
        self.assertEqual(result['state'], 'SIGNED'); self.assertEqual(self.rpc.sends, 0)
        self.assertEqual(self.client.reconcile()['state'], 'SIGNED')
        with self.assertRaises(m.FundingError): self.client.execute(value['planHash'], value['planHash'])
    def test_send_exception_unknown_and_no_retry(self):
        self.rpc.fail_send = True; value = self.execute()
        self.assertEqual(value['state'], 'UNKNOWN'); self.assertEqual(value['attempt'], 1)
        self.assertNotIn('secret', json.dumps(value))
        self.assertEqual(self.client.reconcile()['state'], 'UNKNOWN'); self.assertEqual(self.rpc.sends, 1)
    def test_signing_crash_consumes_eligibility(self):
        def fail(): raise RuntimeError('private key')
        self.client.signer_loader = fail
        value = self.execute(); self.assertEqual(value['state'], 'SIGNING_STARTED')
        with self.assertRaises(m.FundingError): self.client.execute(value['planHash'], value['planHash'])
        self.assertEqual(self.rpc.sends, 0)
    def test_live_preflight_stops_before_loader(self):
        for field, bad in [('pending', 4), ('balance', 0), ('estimate', 200000), ('base', m.MAX_FEE)]:
            with self.subTest(field=field):
                original = getattr(self.rpc, field); setattr(self.rpc, field, bad)
                with self.assertRaises(m.FundingError): self.plan()
                setattr(self.rpc, field, original)
        self.assertEqual(self.loads, 0)
    def test_live_nonce_and_identity_recheck(self):
        p = self.plan(); self.rpc.nonce = self.rpc.pending = 4
        with self.assertRaises(m.FundingError): self.client.execute(p['planHash'], p['planHash'])
        self.assertEqual(self.loads, 0)
        self.rpc.nonce = self.rpc.pending = 3
        self.guard.side_effect = m.FundingError('CODE_CONFLICT')
        with self.assertRaises(m.FundingError): self.client.execute(p['planHash'], p['planHash'])
        self.assertEqual(self.loads, 0)
    def test_existing_role_no_plan(self):
        self.role = True
        with self.assertRaises(m.FundingError): self.plan()
    def test_missing_journal_and_rollback_quarantined(self):
        p = self.plan(); old = self.journal.path.read_text()
        self.client.execute(p['planHash'], p['planHash']); self.journal.path.write_text(old)
        with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): self.journal.load()
        self.journal.path.unlink()
        with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): self.plan()
    def test_missing_anchor_quarantined(self):
        self.plan(); self.journal.anchor.unlink()
        with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): self.plan()
    def test_anchor_first_interruption_quarantined(self):
        self.plan(); value = self.journal.load(); value['state'] = 'SIGNING_STARTED'
        original = m.atomic
        def fail(path, value):
            if path == self.journal.path: raise OSError('interruption')
            original(path, value)
        with patch.object(m, 'atomic', side_effect=fail):
            with self.assertRaises(OSError): self.journal.save(value)
        with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): self.journal.load()
    def test_finalized_success_and_revert(self):
        self.receipt(); value = self.client.reconcile(); self.assertEqual(value['state'], 'FINALIZED_SUCCESS')
        self.assertEqual(value['receipt']['gasFeeWei'], str(40000*10**9))
        self.rpc.receipt['status'] = '0x0'; self.rpc.receipt['logs'] = []
        with self.assertRaisesRegex(m.FundingError, 'FINALITY_CONFLICT'): self.client.reconcile()
    def test_finalized_revert_consumes_attempt(self):
        self.receipt(status=0)
        self.assertEqual(self.client.reconcile()['state'], 'FINALIZED_REVERT')
    def test_pending_finality(self):
        self.receipt(); self.rpc.finalized = 9
        self.assertEqual(self.client.reconcile()['state'], 'INCLUDED_SUCCESS')
    def test_event_and_transaction_conflict(self):
        self.receipt(); self.rpc.tx['nonce'] = '0x4'
        with self.assertRaises(m.FundingError): self.client.reconcile()
        self.rpc.tx['nonce'] = '0x3'; self.rpc.receipt['logs'] = []
        with self.assertRaisesRegex(m.FundingError, 'EVENT_CONFLICT'): self.client.reconcile()
    def test_canonical_and_finalized_role_checks(self):
        self.receipt(); self.rpc.receipt['blockHash'] = '0x'+'44'*32
        with self.assertRaises(m.FundingError): self.client.reconcile()
        self.rpc.receipt['blockHash'] = HASH; self.role = False
        with self.assertRaisesRegex(m.FundingError, 'FINALIZED_ROLE_MISSING'): self.client.reconcile()
    def test_private_modes_and_nonregular_files_quarantined(self):
        for target, kind in [('journal', 'mode'), ('anchor', 'mode'), ('journal', 'fifo'),
                             ('anchor', 'symlink'), ('journal', 'oversize'), ('directory', 'mode')]:
            with self.subTest(target=target, kind=kind):
                journal = m.Journal(Path(self.temp.name)/(target+'-'+kind))
                m.Client(self.rpc, journal, self.loader).plan(PAYER)
                path = {'journal': journal.path, 'anchor': journal.anchor, 'directory': journal.directory}[target]
                if kind == 'mode': path.chmod(0o755 if target == 'directory' else 0o644)
                elif kind == 'fifo': path.unlink(); os.mkfifo(path, 0o600)
                elif kind == 'symlink': path.unlink(); path.symlink_to(journal.path)
                elif kind == 'oversize': path.write_bytes(b'x'*(m.MAX_JOURNAL_BYTES+1))
                with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): journal.load()
    def test_save_does_not_repair_unsafe_directory(self):
        self.plan(); value = self.journal.load(); self.journal.directory.chmod(0o755)
        with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): self.journal.save(value)
        self.assertEqual(self.journal.directory.stat().st_mode & 0o777, 0o755)
    def test_dangling_anchor_cannot_initialize(self):
        self.journal.anchor.symlink_to(Path(self.temp.name)/'missing')
        with self.assertRaisesRegex(m.FundingError, 'RESTORE_QUARANTINE'): self.plan()
    def test_changed_state_after_signing_stops_send_permanently(self):
        for field, bad in [('pending', 4), ('nonce', 4), ('balance', 0), ('base', m.MAX_FEE), ('role', True)]:
            with self.subTest(field=field):
                rpc = Rpc(); journal = m.Journal(Path(self.temp.name)/('change-'+field))
                def loader():
                    if field == 'role': self.role = True
                    else: setattr(rpc, field, bad)
                    return ACCOUNT
                client = m.Client(rpc, journal, loader); p = client.plan(PAYER)
                value = client.execute(p['planHash'], p['planHash'])
                self.assertEqual(value['state'], 'SIGNED'); self.assertEqual(rpc.sends, 0)
                self.assertTrue(journal.load()['raw'])
                with self.assertRaises(m.FundingError): client.execute(p['planHash'], p['planHash'])
                self.role = False
    def test_changed_identity_after_signing_stops_send(self):
        def loader():
            self.guard.side_effect = m.FundingError('CODE_CONFLICT')
            return ACCOUNT
        self.client.signer_loader = loader
        self.assertEqual(self.execute()['state'], 'SIGNED'); self.assertEqual(self.rpc.sends, 0)
    def test_execute_including_presend_fits_rpc_budget(self):
        # Shared guard currently performs chain + genesis + code + 6 ABI reads.
        def guarded(rpc):
            for _ in range(9): rpc.call('eth_getBalance', [m.ADMIN, 'latest'])
        def read(rpc, name, args, block='latest'):
            rpc.call('eth_getBalance', [m.ADMIN, 'latest'])
            return self.read(rpc, name, args, block)
        self.guard.side_effect = guarded
        with patch.object(m, 'contract_read', side_effect=read):
            value = self.plan()
            with patch.object(self.rpc, 'call', wraps=self.rpc.call) as calls:
                result = self.client.execute(value['planHash'], value['planHash'])
                self.assertEqual(result['state'], 'BROADCAST')
                self.assertEqual(calls.call_count, 37)
    def test_cli_redacts_untrusted_exception(self):
        out = io.StringIO()
        with patch.object(m, 'AdminRpc', side_effect=RuntimeError('private-key-token')), contextlib.redirect_stdout(out):
            self.assertEqual(m.cli(['reconcile']), 1)
        self.assertEqual(json.loads(out.getvalue()), {'code': 'ADMIN_OPERATION_STOPPED'})


if __name__ == '__main__': unittest.main()
