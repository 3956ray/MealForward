import copy
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from server.backend import canonical, digest
from server.contracts import ApiError
from server.manual_business.store import ManualStore
from server.manual_business.runtime import RuntimeGate


def configuration():
    return {'runId': 'synthetic-cp28', 'chainId': 10143, 'genesisHash': '0x'+'11'*32,
            'deploymentId': 'new-synthetic-deployment', 'contractAddress': '0x'+'aa'*20,
            'participants': {k: '0x'+str(i)*40 for i, k in enumerate(
                ('admin', 'supporter', 'merchant', 'issuer', 'operator'), 1)}}


def plan(config):
    return {'version': 1, **{k: config[k] for k in ('runId', 'chainId', 'genesisHash', 'deploymentId', 'participants')},
            'configDigest': digest(canonical(config)), 'expiresAt': 2000,
            'totalValueWei': 10**15, 'totalFeeWei': 300000,
            'actions': {k: {'count': 1, 'gas': 50000, 'maxFeePerGas': 2, 'maxPriorityFeePerGas': 1,
                            'value': 10**15 if k == 'fund' else 0} for k in ('fund', 'issue', 'lock', 'report', 'settle')}}


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'run'/'business.db'
        self.config = configuration()
        self.store = ManualStore(self.path, self.config, create=True)
        self.plan = plan(self.config)
        self.gate = RuntimeGate(self.store, self.config, self.plan, clock=lambda: 1000)
        self.tx = {'from': self.config['participants']['supporter'], 'to': self.config['contractAddress'],
                   'data': '0x12345678', 'chainId': 10143, 'value': 10**15, 'nonce': 0,
                   'gas': 50000, 'maxFeePerGas': 2, 'maxPriorityFeePerGas': 1}

    def start(self, op='operation-1', tx=None):
        with self.store.transaction() as db:
            return self.gate.start(db, op, 'fund', tx or self.tx, {'session': 'synthetic'})

    def test_unknown_and_restart_never_grant_second_signature(self):
        self.assertTrue(self.start())
        self.gate.unknown('operation-1')
        self.store = ManualStore(self.path, self.config)
        self.gate = RuntimeGate(self.store, self.config, self.plan, clock=lambda: 1000)
        self.assertFalse(self.start())
        with self.assertRaises(ApiError): self.start('replacement', {**self.tx, 'nonce': 1})
        row = self.store.one('SELECT * FROM cp28_signing')
        self.assertEqual((row['state'], row['fee_reserved'], row['value_reserved']), ('UNKNOWN', '100000', str(10**15)))

    def test_concurrent_same_operation_exactly_one_start(self):
        with ThreadPoolExecutor(2) as workers:
            results = list(workers.map(lambda _: self.start(), range(2)))
        self.assertEqual(sorted(results), [False, True])

    def test_missing_expired_changed_cap_and_bad_chain_denied(self):
        for mutation in ('missing', 'expired', 'changed', 'cap'):
            altered = copy.deepcopy(self.plan)
            if mutation == 'missing': altered = None
            if mutation == 'expired': altered['expiresAt'] = 999
            if mutation == 'changed': altered['configDigest'] = 'other'
            if mutation == 'cap': del altered['actions']['fund']['gas']
            self.gate.plan = altered
            with self.assertRaises(ApiError): self.start()
        self.gate.plan = self.plan
        with self.assertRaises(ApiError): self.start(tx={**self.tx, 'chainId': 31337})
        self.assertEqual(self.store.all('SELECT * FROM cp28_signing'), [])

    def test_failed_transaction_counts_actual_gas(self):
        self.start()
        with self.store.transaction() as db:
            self.assertTrue(self.gate.account_receipt(db, 'operation-1', self.tx,
                                                     {'gasUsed': 21000, 'effectiveGasPrice': 1, 'status': 0}))
        row = self.store.one('SELECT * FROM cp28_signing')
        self.assertEqual((row['fee_reserved'], row['value_reserved'], row['state']), ('21000', '0', 'FINALIZED_REVERT'))
        with self.assertRaises(ApiError): self.start('second', {**self.tx, 'nonce': 1})

    def test_actual_field_or_fee_change_halts(self):
        self.start()
        with self.store.transaction() as db:
            self.assertFalse(self.gate.account_receipt(db, 'operation-1', {**self.tx, 'nonce': 7},
                                                      {'gasUsed': 21000, 'effectiveGasPrice': 1, 'status': 1}))
        with self.assertRaises(ApiError): self.start()

    def test_missing_anchor_or_rollback_never_auto_initializes(self):
        old = self.store.anchor.read_text()
        self.start()
        self.store.anchor.write_text(old)
        with self.assertRaises(ApiError): ManualStore(self.path, self.config)
        self.store.anchor.unlink()
        with self.assertRaises(ValueError): ManualStore(self.path, self.config)
        with self.assertRaises(ValueError): ManualStore(self.path, self.config, create=True)

    def test_auth_table_tamper_is_covered_by_anchor(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO auth_failures VALUES('tampered',1000)")
        with self.assertRaises(ApiError): self.start()

    def test_domain_and_budget_reservation_rollback_together(self):
        with self.assertRaises(RuntimeError):
            with self.store.transaction() as db:
                self.gate.start(db, 'op', 'fund', self.tx, {})
                db.execute("INSERT INTO metadata VALUES('domain-transition','started')")
                raise RuntimeError('before commit')
        self.assertEqual(self.store.all('SELECT * FROM cp28_signing'), [])
        self.assertIsNone(self.store.one("SELECT * FROM metadata WHERE key='domain-transition'"))
        self.assertTrue(self.start())

    def test_new_plan_cannot_reset_consumed_budget(self):
        self.start()
        self.gate.plan = {**self.plan, 'totalFeeWei': 900000}
        with self.assertRaises(ApiError): self.start()


if __name__ == '__main__': unittest.main()
