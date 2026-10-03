"""Controlled RSA fixtures only; these are not real Dynamic login evidence."""
import base64
from dataclasses import replace
import hashlib
import json
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric import rsa
import jwt

from server.contracts import ApiError
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID, JWKS_URL
from server.dynamic_jwt import FixedJwksCache, verify_access_token, _fetch, _NoRedirect


class JwtTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.private.public_key()))
        cls.key.update(kid='fixture-1', alg='RS256', use='sig')

    def setUp(self):
        self.now = 1000
        self.fetches = 0
        self.body = json.dumps({'keys': [self.key]}).encode()
        self.cache = FixedJwksCache(clock=lambda: self.now, transport=self.fetch)
        self.profile = ClaimProfile(ENVIRONMENT_ID, 'fixture-issuer', ('fixture-api',), verified=True)
        self.claims = dict(iss='fixture-issuer', sub='fixture-person', exp=1100, iat=900,
                           aud='fixture-api', environment_id=ENVIRONMENT_ID,
                           scope='user:basic extra', sid='fixture-session')

    def fetch(self):
        self.fetches += 1
        if isinstance(self.body, Exception):
            raise self.body
        return self.body

    def token(self, claims=None, headers=None, private=None):
        return jwt.api_jws.encode(json.dumps(self.claims if claims is None else claims).encode(),
                                  private or self.private, algorithm='RS256',
                                  headers=headers or {'kid': 'fixture-1'})

    def verify(self, raw=None, profile=None):
        return verify_access_token(raw or self.token(), profile=profile or self.profile,
                                   clock=lambda: self.now, jwks=self.cache)

    def reject(self, raw=None, profile=None, code='DYNAMIC_TOKEN_REJECTED'):
        with self.assertRaises(ApiError) as caught:
            self.verify(raw, profile)
        self.assertEqual(caught.exception.code, code)
        self.assertNotIn('fixture-session', str(caught.exception))
        return caught.exception

    def test_valid_result_has_no_token_sid_or_authority(self):
        result = self.verify()
        self.assertEqual(result.subject, 'fixture-person')
        self.assertEqual(result.expires_at, 1100)
        self.assertEqual(result.scopes, frozenset(['user:basic', 'extra']))
        self.assertEqual(result.sid_hash, hashlib.sha256(b'fixture-session').hexdigest())
        self.assertEqual(set(vars(result)), {'subject', 'environment_id', 'issuer', 'expires_at', 'scopes', 'sid_hash'})

    def test_incomplete_profiles_fail_before_parse_clock_or_network(self):
        for profile in (replace(self.profile, verified=False), replace(self.profile, issuer=''),
                        replace(self.profile, audiences=()), replace(self.profile, environment_id='other')):
            with self.subTest(profile=profile), patch('server.dynamic_jwt._json', side_effect=AssertionError):
                self.reject('invalid', profile, 'DYNAMIC_PROFILE_UNVERIFIED')
        self.assertEqual(self.fetches, 0)

    def test_bad_headers_do_not_fetch(self):
        for header in ({'kid': ''}, {'kid': 'x' * 257}, {'kid': 'fixture-1', 'jku': 'https://evil'},
                       {'kid': 'fixture-1', 'x5u': 'https://evil'}, {'kid': 'fixture-1', 'crit': ['x']}):
            self.reject(self.token(headers=header))
        for algorithm, key in [('HS256', 'fixture-secret-32-bytes-long-for-test'), ('none', '')]:
            self.reject(jwt.encode(self.claims, key, algorithm=algorithm, headers={'kid': 'fixture-1'}))
        for raw in ('x' * 16385, 'a.b.c', 'a.b.c.d', 'Bearer a.b.c', 'a=.b.c'):
            self.reject(raw)
        self.assertEqual(self.fetches, 0)

    def test_signature_and_unknown_kid(self):
        self.reject(self.token(private=self.other))
        self.reject(self.token(headers={'kid': 'absent'}))

    def test_claim_rejection_matrix(self):
        variants = {'iss': ['wrong', None], 'sub': ['', None, 123, 'x' * 1025],
                    'environment_id': ['other', None], 'scope': ['', 'user:intermediate', ['user:basic']],
                    'exp': [True, '1100', 1100.0, 1000, 900], 'iat': [False, '900', 900.0, 1031, 1100],
                    'nbf': [True, '900', 900.0, 1031, 1100], 'sid': ['', None, 123, 'x' * 257],
                    'aud': [None, '', [], ['other'], ['fixture-api', 2], 42]}
        for name, values in variants.items():
            for value in values:
                with self.subTest(name=name, value=value):
                    self.reject(self.token({**self.claims, name: value}))
        for name in ('iss', 'sub', 'exp', 'iat', 'environment_id', 'scope', 'sid', 'aud'):
            claims = dict(self.claims)
            del claims[name]
            with self.subTest(missing=name):
                self.reject(self.token(claims))

    def test_exact_expiry_and_future_leeway(self):
        self.now = 1099.999
        self.verify()
        self.now = 1100
        self.reject()
        self.now = 1000
        self.cache = FixedJwksCache(clock=lambda: self.now, transport=self.fetch)
        self.verify(self.token({**self.claims, 'iat': 1030, 'nbf': 1030}))

    def test_audience_array_and_explicit_absence(self):
        self.verify(self.token({**self.claims, 'aud': ['other', 'fixture-api']}))
        claims = dict(self.claims)
        for field in ('aud', 'environment_id', 'sid'):
            del claims[field]
        profile = replace(self.profile, audiences=(), allow_absent_audience=True,
                          allow_absent_environment_id=True, allow_absent_sid=True)
        self.assertIsNone(self.verify(self.token(claims), profile).sid_hash)
        self.reject(self.token({**claims, 'aud': 'anything'}), profile)
        self.reject(self.token({**claims, 'environment_id': 'wrong'}), profile)
        self.reject(self.token({**claims, 'sid': None}), profile)

    def test_duplicate_claim_or_header_rejected(self):
        # Sign raw JSON containing duplicate claims using the controlled RSA key.
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        enc = lambda data: base64.urlsafe_b64encode(data).rstrip(b'=')
        for header, payload in (
            (b'{"alg":"RS256","kid":"fixture-1","kid":"fixture-1"}', json.dumps(self.claims).encode()),
            (b'{"alg":"RS256","kid":"fixture-1"}', json.dumps(self.claims).encode()[:-1] + b',"sub":"other"}'),
        ):
            data = enc(header) + b'.' + enc(payload)
            signature = self.private.sign(data, padding.PKCS1v15(), hashes.SHA256())
            self.reject((data + b'.' + enc(signature)).decode())

    def test_cache_rotation_and_global_miss_cooldown(self):
        self.assertEqual(self.fetches, 0)
        self.cache.get_keys('fixture-1')
        self.assertEqual(self.cache.get_keys('unknown-a'), [])
        self.assertEqual(self.cache.get_keys('unknown-b'), [])
        self.assertEqual(self.fetches, 1)
        self.now += 30
        key2 = {**self.key, 'kid': 'fixture-2'}
        self.body = json.dumps({'keys': [key2]}).encode()
        self.assertEqual(self.cache.get_keys('fixture-2'), [key2])
        self.assertEqual(self.fetches, 2)
        self.assertEqual(self.cache.get_keys('fixture-1'), [])
        self.assertEqual(self.fetches, 2)

    def test_fresh_offline_stale_fail_closed_and_retry_throttled(self):
        self.cache.get_keys('fixture-1')
        self.body = OSError('internal sensitive diagnostic')
        self.now += 299
        self.cache.get_keys('fixture-1')
        self.assertEqual(self.fetches, 1)
        self.now += 1
        for _ in range(2):
            with self.assertRaises(ApiError) as caught:
                self.cache.get_keys('fixture-1')
            self.assertEqual(caught.exception.code, 'DYNAMIC_JWKS_UNAVAILABLE')
            self.assertNotIn('sensitive', str(caught.exception))
        self.assertEqual(self.fetches, 2)
        self.now += 30
        self.body = json.dumps({'keys': [self.key]}).encode()
        self.cache.get_keys('fixture-1')
        self.assertEqual(self.fetches, 3)

    def test_malformed_key_sets_never_become_fresh(self):
        for body in (b'x' * 1048577, b'not json', b'{"keys":[]}',
                     json.dumps({'keys': [self.key] * 33}).encode(),
                     json.dumps({'keys': [self.key, self.key]}).encode(),
                     *(json.dumps({'keys': [{**self.key, **patch}]}).encode() for patch in (
                         {'alg': 'HS256'}, {'use': 'enc'}, {'key_ops': ['sign']}, {'kty': 'EC'},
                         {'kid': ''}, {'n': 'bad'}, {'d': 'private'}))):
            with self.subTest(body_length=len(body)):
                self.body = body
                self.now += 30
                with self.assertRaises(ApiError) as caught:
                    self.cache.get_keys('fixture-1')
                self.assertEqual(caught.exception.code, 'DYNAMIC_JWKS_UNAVAILABLE')

    def test_clock_rollback_cannot_extend_cached_key(self):
        self.cache.get_keys('fixture-1')
        self.now -= 1
        with self.assertRaises(ApiError):
            self.cache.get_keys('fixture-1')

    def test_fixed_fetch_url_timeout_size_and_redirect_denial(self):
        with patch('server.dynamic_jwt.urllib.request.build_opener') as factory:
            response = factory.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.geturl.return_value = JWKS_URL
            response.read.return_value = self.body
            self.assertEqual(_fetch(), self.body)
            args, kwargs = factory.return_value.open.call_args
            self.assertEqual(args[0].full_url, JWKS_URL)
            self.assertEqual(args[0].get_header('Accept'), 'application/json')
            self.assertEqual(args[0].get_header('User-agent'),
                             'mealforward/0.1 (+local-jwks-verifier)')
            self.assertEqual(kwargs, {'timeout': 3})
            response.read.assert_called_once_with(1048577)
            response.geturl.return_value = 'https://evil.invalid'
            with self.assertRaises(ValueError):
                _fetch()
        with self.assertRaises(ValueError):
            _NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.invalid')


if __name__ == '__main__':
    unittest.main()
