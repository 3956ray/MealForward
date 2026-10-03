"""Controlled verifier transport; these tests do not claim real Dynamic login."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from flask import Flask, jsonify

from server.contracts import ApiError
from server.dynamic_auth import register_dynamic_auth
from server.dynamic_contracts import ClaimProfile, VerifiedIdentity, CP17_COOKIES, ENVIRONMENT_ID
from server.dynamic_mapping import activate_mappings, require_current_actor, bind_operation, operation_authorized
from server.recovery import quarantine, relocated_config
from server.storage import Store


class DynamicAuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.store = Store(Path(self.tmp.name)/'test.sqlite3')
        self.store.create_user('partner', 'partner', 'unused', 'partner', 'partner-a', 'shop-local')
        self.entry = dict(environment_id=ENVIRONMENT_ID, issuer='fixture-issuer', subject='fixture-sub', actor_id='partner')
        activate_mappings(self.store, [self.entry], source_version='fixture-v1')
        self.now = 1000
        self.identity = VerifiedIdentity(ENVIRONMENT_ID, 'fixture-issuer', 'fixture-sub', 2200, frozenset({'user:basic'}), None)
        app = Flask(__name__)
        @app.errorhandler(ApiError)
        def error(exc): return jsonify(code=exc.code), exc.status
        def verifier(raw, **kwargs):
            if raw != 'controlled-access': raise ApiError(401, 'DYNAMIC_TOKEN_REJECTED', 'Rejected')
            return self.identity
        self.auth = register_dynamic_auth(app, self.store, profile=ClaimProfile(ENVIRONMENT_ID, 'fixture-issuer'),
                                         jwks=None, clock=lambda: self.now, verifier=verifier)
        @app.post('/private')
        def private():
            actor = self.auth.require('partner', csrf=True)
            with self.store.transaction() as db: require_current_actor(db, actor, self.now)
            return jsonify(actorId=actor.actor_id)
        self.app, self.client = app, app.test_client()
        self.base = 'http://127.0.0.1:15207'
        self.headers = {'Origin': self.base, 'Authorization': 'Bearer controlled-access'}

    def exchange(self):
        response = self.client.post('/api/v1/auth/dynamic/exchange', base_url=self.base, json={}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.headers['X-CSRF-Token'] = response.json['csrfToken']
        return response

    def session(self, headers=None):
        return self.client.get('/api/v1/auth/session', base_url=self.base, headers=self.headers if headers is None else headers)

    def test_cap_cookie_private_bearer_and_csrf(self):
        response = self.exchange()
        self.assertEqual(response.json['expiresAt'], 2200)
        cookie = response.headers['Set-Cookie']
        self.assertIn('cp17_work_session=', cookie); self.assertIn('HttpOnly', cookie)
        self.assertNotIn('controlled-access', cookie)
        self.assertEqual(self.session({}).status_code, 401)
        self.assertEqual(self.session().status_code, 200)
        # Same API path keeps the work cookie; use request context to test protected write directly.
        with self.app.test_request_context('/api/v1/private', base_url=self.base, method='POST', headers={**self.headers, 'Cookie': cookie.split(';')[0]}):
            self.assertEqual(self.auth.require('partner', csrf=True).actor_id, 'partner')
        no_csrf = {**self.headers}; no_csrf.pop('X-CSRF-Token')
        with self.app.test_request_context('/api/v1/private', base_url=self.base, method='POST', headers={**no_csrf, 'Cookie': cookie.split(';')[0]}):
            with self.assertRaises(ApiError): self.auth.require('partner', csrf=True)
        self.now = 2200
        self.assertEqual(self.session().status_code, 401)

    def test_unmapped_and_caller_role_cannot_grant(self):
        response = self.client.post('/api/v1/auth/dynamic/exchange', base_url=self.base, json={'role':'owner'}, headers=self.headers)
        self.assertEqual(response.status_code, 400)
        self.identity = replace(self.identity, subject='unmapped')
        response = self.client.post('/api/v1/auth/dynamic/exchange', base_url=self.base, json={}, headers=self.headers)
        self.assertEqual(response.status_code, 403); self.assertNotIn('Set-Cookie', response.headers)

    def test_mapping_revision_subject_and_current_scope_rechecked(self):
        self.exchange()
        self.identity = replace(self.identity, subject='other')
        self.assertEqual(self.session().status_code, 401)
        self.identity = replace(self.identity, subject='fixture-sub')
        activate_mappings(self.store, [self.entry], source_version='fixture-v2')
        self.assertEqual(self.session().status_code, 401)
        self.exchange()
        self.store.execute("UPDATE users SET partner_id='other' WHERE id='partner'")
        self.assertEqual(self.session().status_code, 401)

    def test_logout_after_token_expiry_keeps_other_cookies_and_old_token_can_reexchange(self):
        self.identity = replace(self.identity, expires_at=5000)
        first = self.exchange()
        self.client.set_cookie(CP17_COOKIES.support, 'support', domain='127.0.0.1', path='/api/v1')
        self.client.set_cookie(CP17_COOKIES.recipient, 'recipient', domain='127.0.0.1', path='/api/v1')
        headers = {k:v for k,v in self.headers.items() if k != 'Authorization'}
        self.identity = replace(self.identity, expires_at=999)
        response = self.client.post('/api/v1/auth/logout', base_url=self.base, json={}, headers=headers)
        self.assertEqual(response.status_code, 204)
        self.assertTrue(all(CP17_COOKIES.work in value for value in response.headers.getlist('Set-Cookie')))
        self.assertIsNotNone(self.client.get_cookie(CP17_COOKIES.support, domain='127.0.0.1', path='/api/v1'))
        self.assertIsNotNone(self.client.get_cookie(CP17_COOKIES.recipient, domain='127.0.0.1', path='/api/v1'))
        self.identity = replace(self.identity, expires_at=5000)
        second = self.exchange()
        self.assertNotEqual(first.json['csrfToken'], second.json['csrfToken'])
        self.assertEqual(self.store.one('SELECT count(*) n FROM work_sessions WHERE revoked=1')['n'], 1)

    def test_idle_expiry_and_refresh_does_not_extend_session(self):
        self.identity = replace(self.identity, expires_at=50000)
        self.assertEqual(self.exchange().json['expiresAt'], 1000+8*3600)
        self.now = 1000+1800
        self.assertEqual(self.session().status_code, 401)

    def test_host_origin_pairs_and_password_denied(self):
        for origin in ('http://localhost:15207', 'http://127.0.0.1:15208'):
            response = self.client.post('/api/v1/auth/dynamic/exchange', base_url=self.base, json={}, headers={**self.headers,'Origin':origin})
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.post('/api/v1/auth/login', base_url=self.base, json={}, headers=self.headers).status_code, 403)
        self.base = 'http://localhost:15207'; self.headers['Origin'] = self.base
        self.exchange(); self.assertEqual(self.session().status_code, 200)

    def test_restore_mapping_is_history_and_explicit_reactivation_required(self):
        self.exchange()
        quarantine(self.store, 'TEST_RESTORE')
        self.assertEqual(self.session().status_code, 401)
        response = self.client.post('/api/v1/auth/dynamic/exchange', base_url=self.base, json={}, headers=self.headers)
        self.assertEqual(response.status_code, 403)
        activate_mappings(self.store, [self.entry], source_version='after-restore')
        self.exchange(); self.assertEqual(self.session().status_code, 200)
        self.assertEqual(self.store.one("SELECT value FROM metadata WHERE key='recovery_state'")['value'],'QUARANTINED')
        config = relocated_config({'dynamicAuthorityFile':'old', 'dynamicClaimProfile':{'verified':True}}, Path(self.tmp.name))
        self.assertNotIn('dynamicAuthorityFile', config); self.assertNotIn('dynamicClaimProfile', config)

    def test_operation_binding_survives_logout_but_not_mapping_revocation(self):
        response = self.exchange()
        with self.app.test_request_context('/api/v1/private', base_url=self.base, headers={**self.headers,'Cookie':response.headers['Set-Cookie'].split(';')[0]}):
            actor = self.auth.require()
        with self.store.transaction() as db:
            db.execute("INSERT INTO operations(id,kind,actor_id,intent_key,request_json,payload_hash,status,created_at,updated_at) VALUES('op','issue','partner','key','{}','hash','QUEUED',1,1)")
            bind_operation(db, actor, 'op', self.now)
            self.auth.revoke(db, actor.session_id)
            self.assertTrue(operation_authorized(db, 'op'))
            with self.assertRaises(ApiError): require_current_actor(db, actor, self.now)
        activate_mappings(self.store, [], source_version='revoked')
        with self.store.transaction() as db: self.assertFalse(operation_authorized(db, 'op'))
