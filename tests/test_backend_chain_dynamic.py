"""Real isolated Anvil, controlled identity verifier, real HTTP/session/dispatch policy."""
from pathlib import Path
import unittest
from unittest.mock import patch

import tests.test_backend_chain as chain_tests
from server.backend import random_id
from server.chain.client import PRICE, RULE
from server.dynamic_contracts import ClaimProfile, VerifiedIdentity, ENVIRONMENT_ID
from server.dynamic_mapping import activate_mappings
from server.local import load_backend
from server.outbox import Worker
from server.recovery import backup_bundle, restore_bundle
from server.web import create_app


class DynamicChainTests(unittest.TestCase):
    setUpClass = classmethod(chain_tests.BackendChainTests.setUpClass.__func__)
    tearDownClass = classmethod(chain_tests.BackendChainTests.tearDownClass.__func__)

    def setUp(self):
        self.h = chain_tests.BackendChainTests('test_http_end_to_end_and_finality_secrets')
        self.h.rpc_url = self.rpc_url; self.h.setUp(); self.addCleanup(self.h.tearDown)
        self.b = self.h.backend
        self.entry = dict(environment_id=ENVIRONMENT_ID, issuer='fixture', subject='partner-sub', actor_id='partner-a')
        activate_mappings(self.b.store, [self.entry], source_version='current-fixture')
        self.auth_config = dict(profile=ClaimProfile(ENVIRONMENT_ID, 'fixture'), jwks=None,
                               verifier=lambda *args, **kwargs: VerifiedIdentity(ENVIRONMENT_ID, 'fixture', 'partner-sub', self.b.now()+3600, frozenset({'user:basic'}), None))
        self.base = 'http://127.0.0.1:15207'
        self.headers = {'Origin':self.base,'Authorization':'Bearer controlled'}
        self.client = create_app(self.b, dynamic_auth_config=self.auth_config).test_client()
        self.login()

    def login(self):
        response = self.client.post('/api/v1/auth/dynamic/exchange', base_url=self.base, headers=self.headers, json={})
        self.assertEqual(response.status_code, 200, response.json)
        self.headers['X-CSRF-Token'] = response.json['csrfToken']

    def accept(self):
        _, _, funded = self.h.funded()
        body = dict(intentKey=random_id(), recipientRef='REF-A', batchId=funded['intent']['batchId'], quantity=3,
                    quotePriceWei=str(PRICE), ruleVersion=RULE)
        response = self.client.post('/api/v1/work/issuances', base_url=self.base, headers=self.headers, json=body)
        self.assertEqual(response.status_code, 202, response.json)
        op_id = response.json['operation']['id']
        self.assertIsNotNone(self.b.store.one('SELECT * FROM operation_auth_bindings WHERE operation_id=?',(op_id,)))
        return op_id, body

    def test_revocation_before_signing_blocks_without_nonce_or_raw(self):
        op_id, _ = self.accept()
        activate_mappings(self.b.store, [], source_version='revoked')
        with patch.object(self.h.worker.account, 'sign_transaction', side_effect=AssertionError('Must not sign')):
            self.h.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'], 'NOT_SUBMITTED')
        row = self.b.store.one('SELECT nonce,raw_cipher,broadcast_count FROM outbox WHERE operation_id=?',(op_id,))
        self.assertEqual(row, dict(nonce=None, raw_cipher=None, broadcast_count=0))

    def test_revocation_in_signing_boundary_prevents_signature(self):
        op_id, _ = self.accept()
        def fault(phase):
            if phase == 'signing_started': activate_mappings(self.b.store, [], source_version='revoked-in-boundary')
        worker = Worker(self.b, Path(self.h.config['issuerKeyFile']).read_bytes(), fault)
        with patch.object(worker.account, 'sign_transaction', side_effect=AssertionError('Must not sign')): worker.tick()
        self.assertEqual(self.h.op(op_id)['status'], 'SUBMISSION_UNKNOWN')
        self.assertIsNone(self.b.store.one('SELECT raw_cipher FROM outbox WHERE operation_id=?',(op_id,))['raw_cipher'])

    def test_logout_does_not_cancel_accepted_operation_and_restore_quarantines(self):
        op_id, body = self.accept()
        result = self.client.post('/api/v1/auth/logout', base_url=self.base, headers=self.headers, json={})
        self.assertEqual(result.status_code, 204)
        self.h.worker.tick(); self.h.mine(); self.h.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'], 'FINALIZED_SUCCESS')
        bundle = backup_bundle(self.h.config, Path(self.h.tmp.name)/'dynamic-backup')
        restored = load_backend(restore_bundle(bundle, Path(self.h.tmp.name)/'dynamic-restore'))
        self.assertEqual(restored.store.one('PRAGMA user_version')['user_version'],4)
        self.assertEqual(restored.store.one('SELECT enabled FROM dynamic_identity_mappings')['enabled'],0)
        activate_mappings(restored.store, [self.entry], source_version='new-explicit-authority')
        self.client = create_app(restored, dynamic_auth_config=self.auth_config).test_client(); self.login()
        read = self.client.get('/api/v1/operations/'+op_id, base_url=self.base, headers=self.headers)
        self.assertEqual(read.status_code,200)
        before = restored.store.one('SELECT count(*) n FROM operations')['n']
        response = self.client.post('/api/v1/work/issuances', base_url=self.base, headers=self.headers, json={**body,'intentKey':random_id()})
        self.assertEqual((response.status_code,response.json['code']),(503,'RESTORE_QUARANTINED'))
        self.assertEqual(restored.store.one('SELECT count(*) n FROM operations')['n'],before)
