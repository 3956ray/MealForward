"""CP15 authentication boundary tests using real Flask clients and SQLite."""
import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest

from argon2 import extract_parameters
from argon2.low_level import Type
from flask import Flask, jsonify

from server.auth import hash_password, register_auth
from server.contracts import ApiError, WORK_COOKIE, AUTH_ABSOLUTE_TTL, AUTH_IDLE_TTL
from server.storage import Store

ORIGIN = 'http://127.0.0.1:8875'
PASSWORD = 'fictional-test-password-only'


class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = hash_password(PASSWORD)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'auth.sqlite'
        self.store = Store(self.path)
        self.store.create_user('person-a', 'alice', self.password_hash, 'partner', partner_id='partner-a')
        self.store.create_user('person-b', 'bob', self.password_hash, 'shop', shop_id='shop-b')
        self.now = 100000
        self.app = self.make_app()
        self.client = self.app.test_client()

    def make_app(self, secure=False):
        app = Flask(__name__)
        app.testing = True
        service = register_auth(app, Store(self.path), origin=ORIGIN, clock=lambda: self.now, secure_cookie=secure)

        @app.errorhandler(ApiError)
        def error(exc):
            return jsonify(code=exc.code, message=exc.message), exc.status

        @app.post('/api/v1/partner')
        def partner():
            ctx = service.require('partner', csrf=True)
            return jsonify(actor=ctx.actor_id, partner=ctx.partner_id, shop=ctx.shop_id)

        return app

    def login(self, client=None, username='alice', password=PASSWORD, ip='127.0.0.1', extra_headers=None):
        return (client or self.client).post('/api/v1/auth/login', json={'username': username, 'password': password},
                    headers={'Origin': ORIGIN, **(extra_headers or {})}, environ_overrides={'REMOTE_ADDR': ip})

    def token(self, client=None):
        return (client or self.client).get_cookie(WORK_COOKIE, path='/api/v1').value

    def session_row(self, token=None):
        return self.store.get_session(hashlib.sha256((token or self.token()).encode()).hexdigest())

    def test_argon_parameters_random_salt_and_no_plaintext(self):
        other = hash_password(PASSWORD)
        self.assertNotEqual(other, self.password_hash)
        params = extract_parameters(other)
        self.assertEqual(params.type, Type.ID)
        self.assertGreaterEqual(params.memory_cost, 19 * 1024)
        self.assertGreaterEqual(params.time_cost, 2)
        self.assertEqual(params.parallelism, 1)
        self.assertNotIn(PASSWORD, other)

    def test_login_cookie_session_roundtrip_and_secret_storage(self):
        response = self.login(username=' ALICE ')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(set(data), {'actorId', 'role', 'partnerId', 'shopId', 'expiresAt', 'csrfToken'})
        self.assertEqual(data['actorId'], 'person-a')
        cookie = response.headers['Set-Cookie']
        for flag in ('HttpOnly', 'SameSite=Lax', 'Path=/api/v1'):
            self.assertIn(flag, cookie)
        self.assertNotIn('Domain=', cookie)
        self.assertNotIn('Secure', cookie)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        token = self.token()
        self.assertGreaterEqual(len(token), 43)
        row = self.session_row()
        self.assertNotIn(token, str(row))
        self.assertNotIn(data['csrfToken'], str(row))
        self.assertNotIn(self.password_hash, response.get_data(as_text=True))
        self.assertNotIn(PASSWORD, response.get_data(as_text=True))
        self.assertNotIn(token, response.get_data(as_text=True))
        restored = self.make_app().test_client()
        restored.set_cookie(WORK_COOKIE, token, path='/api/v1')
        self.assertEqual(restored.get('/api/v1/auth/session').get_json(), data)
        self.assertIn('Secure', self.login(client=self.make_app(secure=True).test_client()).headers['Set-Cookie'])

    def test_role_scope_and_disabled_are_current(self):
        data = self.login().get_json()
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': data['csrfToken']}
        self.assertEqual(self.client.post('/api/v1/partner', headers=headers).get_json()['partner'], 'partner-a')
        self.store.execute('UPDATE users SET partner_id=? WHERE id=?', ('partner-changed', 'person-a'))
        self.assertEqual(self.client.post('/api/v1/partner', headers=headers).get_json()['partner'], 'partner-changed')
        self.store.execute('UPDATE users SET role=? WHERE id=?', ('shop', 'person-a'))
        self.assertEqual(self.client.post('/api/v1/partner', headers=headers).status_code, 403)
        self.store.set_user_enabled('person-a', False)
        self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 401)
        self.store.set_user_enabled('person-a', True)
        self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 401)

    def test_csrf_and_origin_required_and_token_bound_to_session(self):
        self.assertEqual(self.client.post('/api/v1/auth/login', json={'username': 'alice', 'password': PASSWORD}).status_code, 403)
        csrf = self.login().get_json()['csrfToken']
        other = self.app.test_client()
        other_csrf = self.login(client=other).get_json()['csrfToken']
        for headers in ({}, {'Origin': ORIGIN}, {'X-CSRF-Token': csrf},
                        {'Origin': 'https://evil.example', 'X-CSRF-Token': csrf},
                        {'Origin': 'null', 'X-CSRF-Token': csrf},
                        {'Origin': ORIGIN, 'X-CSRF-Token': other_csrf}):
            self.assertEqual(self.client.post('/api/v1/partner', headers=headers).status_code, 403)
            self.assertEqual(self.client.post('/api/v1/auth/logout', headers=headers).status_code, 403)
        self.assertEqual(self.client.post('/api/v1/partner', headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf}).status_code, 200)

    def test_logout_revokes_and_replay_fails(self):
        csrf = self.login().get_json()['csrfToken']
        token = self.token()
        response = self.client.post('/api/v1/auth/logout', headers={'Origin': ORIGIN, 'X-CSRF-Token': csrf})
        self.assertEqual(response.status_code, 204)
        self.assertIn('Max-Age=0', response.headers['Set-Cookie'])
        self.client.set_cookie(WORK_COOKIE, token, path='/api/v1')
        self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 401)
        self.assertEqual(self.session_row()['revoked'], 1)

    def test_rotation_missing_forged_and_support_cookie(self):
        for value in ('forged', ''):
            self.client.set_cookie(WORK_COOKIE, value, path='/api/v1')
            self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 401)
        self.login()
        old = self.token()
        self.login()
        self.assertNotEqual(old, self.token())
        self.assertEqual(self.session_row(old)['revoked'], 1)
        other = self.app.test_client()
        other.set_cookie('support_cap', self.token(), path='/api/v1')
        self.assertEqual(other.get('/api/v1/auth/session').status_code, 401)

    def test_idle_boundary_and_absolute_expiry_despite_activity(self):
        self.login()
        self.now += AUTH_IDLE_TTL
        self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 401)
        self.login()
        start = self.now
        while self.now + 1000 < start + AUTH_ABSOLUTE_TTL:
            self.now += 1000
            self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 200)
        self.now = start + AUTH_ABSOLUTE_TTL
        self.assertEqual(self.client.get('/api/v1/auth/session').status_code, 401)

    def test_generic_credentials_and_strict_json(self):
        wrong = self.login(password='wrong').get_json()
        self.assertEqual(self.login(username='absent').get_json(), wrong)
        self.store.set_user_enabled('person-a', False)
        self.assertEqual(self.login().get_json(), wrong)
        for body in ([], {}, {'username': [], 'password': PASSWORD}, {'username': 'alice', 'password': PASSWORD, 'actorId': 'person-b'}):
            response = self.client.post('/api/v1/auth/login', json=body, headers={'Origin': ORIGIN})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.post('/api/v1/auth/login', data='bad', headers={'Origin': ORIGIN, 'Content-Type': 'application/json'}).status_code, 400)

    def test_account_limit_normalization_and_restart(self):
        for n in range(5):
            self.assertEqual(self.login(username=' ALICE ', password='wrong', ip=f'127.0.0.{n+2}').status_code, 401)
        restarted = self.make_app().test_client()
        self.assertEqual(self.login(client=restarted, ip='127.0.0.20').status_code, 429)
        self.now += 900
        self.assertEqual(self.login(client=restarted, ip='127.0.0.20').status_code, 200)

    def test_ip_limit_ignores_forwarding_and_valid_login_does_not_clear_ip(self):
        for n in range(4):
            self.assertEqual(self.login(username=f'unknown{n}', extra_headers={'X-Forwarded-For': f'10.0.0.{n}'}).status_code, 401)
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.login(username='unknown4').status_code, 401)
        self.assertEqual(self.login(username='bob', extra_headers={'X-Forwarded-For': '10.2.3.4'}).status_code, 429)
        self.assertEqual(self.login(username='bob', ip='127.0.0.2').status_code, 200)

    def test_parallel_login_failures_admit_only_five(self):
        def attempt(n):
            return self.login(client=self.app.test_client(), username=f'unknown{n}').status_code
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count(401), 5)
        self.assertEqual(results.count(429), 3)


if __name__ == '__main__':
    unittest.main()
