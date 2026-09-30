"""Recipient service tests: real v2 SQLite/Backend/WorkCore, no simulated HTTP or chain claim."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from server.backend import Backend, digest
from server.contracts import ApiError, AuthContext
from server.recipient import RecipientService
from server.storage import Store


class RecipientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = 100000
        self.store = Store(Path(self.temp.name) / 'recipient.sqlite3')
        self.key = Fernet.generate_key()
        self.rpc = SimpleNamespace(deployment={'merchant': '0x' + '3' * 40, 'priceWei': '1000000000000000'})
        self.b = Backend(self.store, self.rpc, self.key, '0x' + '1' * 40, clock=lambda: self.now)
        self.service = RecipientService(self.b)
        for user, role, partner, shop in [('p1', 'partner', 'org-a', None), ('p2', 'partner', 'org-a', None),
                                        ('p3', 'partner', 'org-b', None), ('staff', 'staff', None, 'shop-local')]:
            self.store.create_user(user, user, 'unused-fixture-hash', role, partner, shop)
        self.secrets = {'a': 'fictional-secret-a', 'b': 'fictional-secret-b', 'c': 'fictional-secret-c'}
        with self.store.transaction() as db:
            for v, secret in self.secrets.items():
                db.execute('''INSERT INTO operations(id,kind,actor_id,partner_id,intent_key,request_json,payload_hash,
                              status,target,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                           ('issue-' + v, 'issue', 'p1', 'org-a' if v != 'c' else 'org-b', 'issue-' + v,
                            '{"recipientRef":"PRIVATE-REF"}', 'fixture', 'FINALIZED_SUCCESS', 'batch', self.now, self.now))
                db.execute('INSERT INTO private_vouchers(id,operation_id,batch_id,secret_hash,secret_cipher,confirmed) VALUES(?,?,?,?,?,1)',
                           (v, 'issue-' + v, 'batch', digest(secret), self.b.encrypt(secret)))
                db.execute('INSERT INTO public_vouchers(id,batch_id,status,lock_id) VALUES(?,?,1,NULL)', (v, 'batch'))

    def actor(self, name='p1'):
        u = self.store.get_user(name)
        return AuthContext(u['id'], u['role'], u['partner_id'], u['shop_id'], 'work-session')

    def exchange(self, voucher='a', **kwargs):
        return self.service.exchange({'secret': self.secrets[voucher]}, '127.0.0.1', **kwargs)

    def present(self, session, token, key='show'):
        return self.service.present(token, session['csrfToken'], {'intentKey': key}, '127.0.0.1')

    def error(self, status, fn, *args, **kwargs):
        with self.assertRaises(ApiError) as caught:
            fn(*args, **kwargs)
        self.assertEqual(caught.exception.status, status)
        return caught.exception.code

    def test_same_institution_disclosure_audit_idempotency_and_scope(self):
        first = self.service.invitation(self.actor(), 'a', {'intentKey': 'get'})
        self.assertEqual(first, {'voucherId': 'a', 'secret': self.secrets['a']})
        self.assertEqual(self.service.invitation(self.actor(), 'a', {'intentKey': 'get'}), first)
        self.assertEqual(self.service.invitation(self.actor('p2'), 'a', {'intentKey': 'get'}), first)
        self.assertEqual([r['actor_id'] for r in self.store.all('SELECT actor_id FROM invitation_audits ORDER BY rowid')], ['p1', 'p2'])
        self.error(409, self.service.invitation, self.actor(), 'b', {'intentKey': 'get'})
        for name in ('p3', 'staff'):
            self.error(403, self.service.invitation, self.actor(name), 'a', {'intentKey': 'get'})
        old_actor = self.actor()
        self.store.execute("UPDATE users SET partner_id='org-b' WHERE id='p1'")
        self.error(403, self.service.invitation, old_actor, 'a', {'intentKey': 'get'})
        self.error(403, self.service.invitation, self.actor(), 'a', {'intentKey': 'get'})

    def test_delivery_records_immutable_and_no_secret_in_default_dtos(self):
        body = {'intentKey': 'send', 'channel': 'private_message', 'result': 'failed'}
        record = self.service.deliver(self.actor(), 'a', body)
        self.assertEqual(self.service.deliver(self.actor(), 'a', body), record)
        self.error(409, self.service.deliver, self.actor(), 'a', {**body, 'result': 'sent'})
        self.service.deliver(self.actor('p2'), 'a', {**body, 'result': 'sent'})
        result = self.service.list_vouchers(self.actor())
        self.assertEqual([v['voucherId'] for v in result['vouchers']], ['a', 'b'])
        self.assertEqual(result['vouchers'][0]['delivery']['actorId'], 'p2')
        self.assertEqual(len(self.service.deliveries(self.actor(), 'a')['deliveries']), 2)
        self.error(403, self.service.deliveries, self.actor('p3'), 'a')
        text = json.dumps(result) + json.dumps(self.service.deliveries(self.actor(), 'a'))
        for forbidden in ('PRIVATE-REF', 'secret', 'issue-a', 'batch', 'code', 'csrf'):
            self.assertNotIn(forbidden, text)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.execute("UPDATE delivery_attempts SET result='sent'")
        self.store.execute("UPDATE public_vouchers SET status=2 WHERE id='a'")
        self.assertEqual(len(self.service.deliveries(self.actor(), 'a')['deliveries']), 2)
        self.error(409, self.service.invitation, self.actor(), 'a', {'intentKey': 'after-lock'})
        self.error(409, self.service.deliver, self.actor(), 'a', {**body, 'intentKey': 'new-send'})

    def test_finalized_material_required_and_invalid_invitation_generic(self):
        missing = self.error(401, self.service.exchange, {'secret': 'missing'}, 'one')
        self.store.execute("UPDATE operations SET status='INCLUDED_SUCCESS' WHERE id='issue-a'")
        self.assertEqual(self.error(401, self.service.exchange, {'secret': self.secrets['a']}, 'two'), missing)
        self.error(409, self.service.invitation, self.actor(), 'a', {'intentKey': 'get'})
        self.store.execute("UPDATE operations SET status='FINALIZED_SUCCESS' WHERE id='issue-a'")
        self.store.execute("UPDATE private_vouchers SET secret_cipher='broken' WHERE id='a'")
        self.error(503, self.service.invitation, self.actor(), 'a', {'intentKey': 'get'})
        self.assertEqual(self.store.one('SELECT count(*) AS n FROM invitation_audits')['n'], 0)

    def test_exact_body_and_current_account_checks(self):
        for body in (None, [], {}, {'secret': self.secrets['a'], 'voucherId': 'b'}, {'secret': []}):
            self.error(422, self.service.exchange, body, 'ip')
        self.error(422, self.service.invitation, self.actor(), 'a', {'intentKey': 'x', 'secret': 'inject'})
        self.error(422, self.service.deliver, self.actor(), 'a', {'intentKey': 'x', 'channel': 'email-address', 'result': 'sent'})
        self.store.set_user_enabled('p1', False)
        self.error(401, self.service.list_vouchers, self.actor())

    def test_session_hash_csrf_and_get_never_returns_code_or_siblings(self):
        dto, token = self.exchange()
        self.assertEqual(set(dto), {'sessionId', 'expiresAt', 'csrfToken', 'voucher'})
        self.assertEqual(dto['expiresAt'], self.now + 1800)
        row = self.store.one('SELECT * FROM recipient_sessions')
        self.assertEqual(row['token_hash'], digest(token))
        for secret in (token, dto['csrfToken'], self.secrets['a']):
            self.assertNotIn(secret, json.dumps(row))
        view = self.service.voucher(token)
        self.assertEqual(view['voucher']['voucherId'], 'a')
        self.assertEqual(set(view), {'sessionId', 'voucher'})
        self.assertEqual(self.store.one('SELECT count(*) AS n FROM presentation_codes')['n'], 0)
        for csrf in (None, '', 'work-csrf'):
            self.error(403, self.service.present, token, csrf, {'intentKey': 'show'}, 'ip')
            self.error(403, self.service.logout, token, csrf)
        self.error(401, self.service.voucher, dto['sessionId'])
        self.error(401, self.service.voucher, self.secrets['a'])

    def test_single_active_session_switch_and_forged_previous_token(self):
        old, old_token = self.exchange()
        self.present(old, old_token)
        current, current_token = self.exchange()
        self.error(401, self.service.voucher, old_token)
        self.assertEqual(self.store.one('SELECT active,code_cipher FROM presentation_codes'), {'active': 0, 'code_cipher': None})
        b, b_token = self.exchange('b', previous_token=current['sessionId'])
        self.assertEqual(self.service.voucher(current_token)['sessionId'], current['sessionId'])
        self.exchange('c', previous_token=b_token)
        self.error(401, self.service.voucher, b_token)
        self.assertEqual(self.service.voucher(current_token)['sessionId'], current['sessionId'])
        self.error(401, self.service.logout, old_token, old['csrfToken'])
        self.assertEqual(self.service.voucher(current_token)['sessionId'], current['sessionId'])

    def test_idle_and_absolute_ttl_boundaries(self):
        dto, token = self.exchange()
        self.present(dto, token)
        self.now += 900
        self.error(401, self.service.voucher, token)
        self.assertIsNone(self.store.one('SELECT code_cipher FROM presentation_codes')['code_cipher'])
        dto, token = self.exchange()
        start = self.now
        for _ in range(3):
            self.now += 500
            self.service.voucher(token)
        self.now = start + 1800
        self.error(401, self.service.voucher, token)

    def test_original_code_replay_no_renewal_expiry_and_cipher_erasure(self):
        dto, token = self.exchange()
        with patch('server.recipient.secrets.randbelow', return_value=123):
            first = self.present(dto, token)
        self.assertEqual(first['code'], '00000123')
        self.now += 119
        self.assertEqual(self.present(dto, token), first)
        self.assertNotIn('code', self.service.voucher(token)['voucher'])
        row = self.store.one('SELECT * FROM presentation_codes')
        self.assertEqual(row['code_hash'], self.b.work.code_hash(first['code']))
        self.assertNotEqual(row['code_hash'], digest(first['code']))
        self.assertNotIn(first['code'], row['code_cipher'])
        self.now += 1
        self.error(409, self.present, dto, token)
        self.assertEqual(self.store.one('SELECT active,code_cipher FROM presentation_codes'), {'active': 0, 'code_cipher': None})
        self.present(dto, token, 'new-show')
        self.error(409, self.present, dto, token)

    def test_rotation_consumption_and_collision_retry_are_global(self):
        a, at = self.exchange()
        b, bt = self.exchange('b')
        with patch('server.recipient.secrets.randbelow', return_value=100):
            first = self.present(a, at)
        with patch('server.recipient.secrets.randbelow', side_effect=[100, 101]) as random:
            second = self.present(b, bt)
        self.assertEqual(random.call_count, 2)
        self.assertEqual(second['code'], '00000101')
        with patch('server.recipient.secrets.randbelow', return_value=100):
            self.error(503, self.present, b, bt, 'collision')
        self.assertEqual(self.present(b, bt), second)
        rotated = self.present(a, at, 'rotate')
        self.error(409, self.present, a, at)
        old = self.store.one('SELECT active,code_cipher FROM presentation_codes WHERE intent_key=? AND session_hash=?', ('show', digest(at)))
        self.assertEqual(old, {'active': 0, 'code_cipher': None})
        with self.store.transaction() as db:
            self.b.work.validate_and_consume_code(db, self.actor('staff'), rotated['code'], 'test-lock')
        self.error(409, self.present, a, at, 'rotate')
        self.assertEqual(self.store.one('SELECT code_cipher FROM presentation_codes WHERE consumed_by=?', ('test-lock',))['code_cipher'], None)

    def test_pending_claim_blocks_exchange_present_but_allows_old_status(self):
        dto, token = self.exchange()
        self.present(dto, token)
        with self.store.transaction() as db:
            db.execute("INSERT INTO redemptions(id,voucher_id,actor_id,shop_id,lock_id,lock_operation_id,created_at) VALUES('claim','a','staff','shop-local','lock','issue-a',?)", (self.now,))
            db.execute("INSERT INTO voucher_claims(voucher_id,redemption_id) VALUES('a','claim')")
        self.error(401, self.exchange)
        self.error(409, self.present, dto, token, 'new')
        self.assertTrue(self.service.voucher(token)['voucher']['processing'])
        self.store.execute("UPDATE public_vouchers SET status=3 WHERE id='a'")
        self.assertEqual(self.service.voucher(token)['voucher']['status'], 3)
        self.service.logout(token, dto['csrfToken'])
        self.error(401, self.service.voucher, token)
        self.assertIsNotNone(self.store.one("SELECT * FROM voucher_claims WHERE voucher_id='a'"))
        self.assertIsNone(self.store.one('SELECT code_cipher FROM presentation_codes')['code_cipher'])

    def test_failed_exchange_and_presentation_roll_back_revocation(self):
        dto, token = self.exchange()
        code = self.present(dto, token)
        with patch.object(self.b, 'encrypt', side_effect=RuntimeError('injected persistence failure')):
            with self.assertRaises(RuntimeError):
                self.present(dto, token, 'failed-new-code')
        self.assertEqual(self.present(dto, token), code)
        with patch.object(self.service, '_voucher_dto', side_effect=RuntimeError('injected response failure')):
            with self.assertRaises(RuntimeError):
                self.exchange()
        self.assertEqual(self.service.voucher(token)['sessionId'], dto['sessionId'])
        self.assertEqual(self.present(dto, token), code)
        self.assertEqual(self.store.one('SELECT count(*) AS n FROM recipient_sessions')['n'], 1)

    def test_presentation_expiry_capped_to_session_and_corrupt_cipher_fails_closed(self):
        dto, token = self.exchange()
        for _ in range(3):
            self.now += 500
            self.service.voucher(token)
        self.now += 250
        code = self.present(dto, token)
        self.assertEqual(code['expiresAt'], dto['expiresAt'])
        self.store.execute("UPDATE presentation_codes SET code_cipher='corrupt'")
        self.error(503, self.present, dto, token)
        self.now += 50
        self.error(401, self.present, dto, token)
        self.assertIsNone(self.store.one('SELECT code_cipher FROM presentation_codes')['code_cipher'])

    def test_bootstrap_persistent_account_and_ip_limits(self):
        for n in range(5):
            self.error(401, self.service.exchange, {'secret': 'invalid'}, f'ip{n}')
        restarted = RecipientService(Backend(Store(self.store.path), self.rpc, self.key, '0x' + '1' * 40, clock=lambda: self.now))
        self.error(429, restarted.exchange, {'secret': 'invalid'}, 'fresh-ip')
        for n in range(5):
            self.error(401, self.service.exchange, {'secret': f'unknown{n}'}, 'shared-ip')
        self.error(429, self.service.exchange, {'secret': self.secrets['a']}, 'shared-ip')
        self.now += 900
        self.service.exchange({'secret': self.secrets['a']}, 'shared-ip')

    def test_presentation_rate_persisted_replays_do_not_count_and_concurrency(self):
        dto, token = self.exchange()
        def attempt(n):
            try:
                return self.present(dto, token, 'concurrent-' + str(n))
            except ApiError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(sum(isinstance(r, dict) for r in results), 5)
        self.assertEqual(results.count(429), 3)
        row = self.store.one('SELECT intent_key FROM presentation_codes WHERE active=1')
        self.present(dto, token, row['intent_key'])
        self.assertEqual(self.store.one('SELECT count(*) AS n FROM auth_failures WHERE key LIKE ?', ('recipient:present:%',))['n'], 5)
        self.service = RecipientService(Backend(Store(self.store.path), self.rpc, self.key, '0x' + '1' * 40, clock=lambda: self.now))
        self.error(429, self.present, dto, token, 'blocked')
        self.now += 60
        self.present(dto, token, 'after-window')
        self.assertEqual(self.store.one('SELECT count(*) AS n FROM presentation_codes WHERE active=1')['n'], 1)

    def test_bootstrap_parallel_failures_limit_and_quarantine_gates(self):
        def attempt(n):
            try:
                self.service.exchange({'secret': 'absent-' + str(n)}, 'shared')
            except ApiError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count(401), 5)
        self.assertEqual(results.count(429), 3)
        dto, token = self.exchange()
        self.store.execute("UPDATE metadata SET value='QUARANTINED' WHERE key='recovery_state'")
        for fn, args in [(self.exchange, ()), (self.present, (dto, token)),
                         (self.service.voucher, (token,)), (self.service.logout, (token, dto['csrfToken'])),
                         (self.service.invitation, (self.actor(), 'a', {'intentKey': 'x'})),
                         (self.service.deliver, (self.actor(), 'a', {'intentKey': 'x', 'channel': 'in_person', 'result': 'sent'}))]:
            self.error(503, fn, *args)
        self.service.list_vouchers(self.actor())
        self.service.deliveries(self.actor(), 'a')


if __name__ == '__main__':
    unittest.main()
