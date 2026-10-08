"""P3 fixed-expectation diagnostics: actual crypto/HTTP, synthetic memory only."""
import copy
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from server.dynamic_contracts import ENVIRONMENT_ID, ClaimProfile
from server.dynamic_jwt import FixedJwksCache
from server.manual_business.identity_preparation import IdentityPreparation, PREFIX
from server.manual_business.web import create_app


class CalibrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key()))
        cls.public.update(kid='synthetic', alg='RS256', use='sig')

    def setUp(self):
        self.now=1000; self.origin='http://127.0.0.1:15289'; self.fetches=0
        def transport():
            self.fetches+=1
            return json.dumps({'keys':[self.public]}).encode()
        self.cache=FixedJwksCache(clock=lambda:self.now,transport=transport)
        self.service=IdentityPreparation(self.origin,jwks=self.cache,clock=lambda:self.now,development_calibration=True)
        self.app=create_app({'origin':self.origin,'runId':'synthetic-p3'},identity_preparation=self.service)
        self.client=self.app.test_client()
        self.claims={'iss':'app.dynamicauth.com/'+ENVIRONMENT_ID,'aud':self.origin,'environment_id':ENVIRONMENT_ID,
            'sub':'synthetic-private-sub','sid':'synthetic-private-sid','scope':'user:basic','iat':900,'nbf':900,'exp':1100}
        self.token=self.sign(); self.csrf=self.bootstrap()

    def sign(self, changes=None, omit=None, key=None, algorithm='RS256'):
        claims={**self.claims,**(changes or {})}
        if omit: claims.pop(omit)
        return jwt.encode(claims,key or self.key,algorithm=algorithm,headers={'kid':'synthetic'})

    def bootstrap(self):
        return self.client.get(PREFIX+'/bootstrap',base_url=self.origin).json['csrfToken']

    def request(self, *, headers=None, body=None, peer='127.0.0.1', url=None, client=None):
        return (client or self.client).post(PREFIX+'/calibrate',base_url=url or self.origin,
            json={} if body is None else body,environ_overrides={'REMOTE_ADDR':peer},
            headers={'Origin':self.origin,'Authorization':'Bearer '+self.token,'X-CSRF-Token':self.csrf,**(headers or {})})

    def test_verified_summary_is_non_authorizing_and_does_not_store_or_log_claims(self):
        before=copy.deepcopy(self.service.sessions); output=io.StringIO()
        with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output): result=self.request()
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json,dict(status='VERIFIED_EXPECTATIONS_ONLY',audience=self.origin,
            issuer=self.claims['iss'],environmentId=ENVIRONMENT_ID,sid={'present':True,'type':'string'},scopes=['user:basic'],
            tokenExpiresAt=1100,remainingTokenSeconds=100,validUntil=1100,serverIdentityVerified=False,businessAuthorized=False,profileCreated=False))
        self.assertEqual(self.service.sessions,before);self.assertIsNone(self.service.profile)
        self.assertNotIn('Set-Cookie',result.headers);self.assertEqual(result.headers['Cache-Control'],'no-store')
        for secret in (self.token,self.claims['sub'],self.claims['sid'],self.csrf):
            self.assertNotIn(secret,result.get_data(as_text=True)+output.getvalue())
        for path in ('exchange','candidate'):
            r=self.client.post(PREFIX+'/'+path,json={},base_url=self.origin,headers={'Origin':self.origin,'Authorization':'Bearer '+self.token,'X-CSRF-Token':self.csrf})
            self.assertNotEqual(r.status_code,200)
        status=self.client.get('/api/cp28/status',base_url=self.origin).json
        self.assertFalse(status['runtimeAuthorized']);self.assertEqual(status['status'],'BLOCKED')
        self.assertEqual(self.client.post('/api/cp28/partner/issue',base_url=self.origin,json={},headers={'Origin':self.origin}).status_code,503)

    def test_exact_audience_not_list_intersection_and_all_missing_or_unknown_claims_fail(self):
        cases=[{'aud':v} for v in ('http://127.0.0.1:15207',[self.origin],[self.origin,'other'],[],None)]
        cases += [{'iss':'other'},{'environment_id':'other'},{'sid':None},{'sid':12},{'sub':''}]
        cases += [{'scope':v} for v in ('','user:basic extra','user:basic requires_mfa',['user:basic'])]
        cases += [{name:value} for name,value in [('iat',1001),('exp',1000),('exp',True),('nbf',1001),('nbf',True),('iat',900.0)]]
        for changes in cases:
            with self.subTest(changes=changes):
                self.service.calibration_attempts.clear();self.token=self.sign(changes)
                r=self.request();self.assertEqual(r.status_code,401);self.assertEqual(r.json['code'],'CALIBRATION_PENDING')
                self.assertNotIn('audience',r.json)
        for name in self.claims:
            if name=='nbf':continue
            with self.subTest(missing=name):
                self.service.calibration_attempts.clear();self.token=self.sign(omit=name)
                self.assertEqual(self.request().status_code,401)

    def test_optional_nbf_and_token_expiry_distinct_from_session_lifetime(self):
        self.token=self.sign({'exp':10000},omit='nbf')
        result=self.request();self.assertEqual(result.status_code,200)
        self.assertEqual(result.json['tokenExpiresAt'],10000);self.assertEqual(result.json['remainingTokenSeconds'],9000)
        self.assertEqual(result.json['validUntil'],4600)

    def test_session_expiring_during_key_fetch_fails_closed(self):
        self.token=self.sign({'exp':10000})
        original=self.cache.get_keys
        def delayed(kid):
            self.now=4600
            return original(kid)
        with patch.object(self.cache,'get_keys',side_effect=delayed):self.assertEqual(self.request().status_code,401)

    def test_bad_signature_algorithm_and_malformed_token_are_sanitized(self):
        for token in (self.sign(key=self.other),self.sign(key='synthetic-hmac-key-for-test-only-123456',algorithm='HS256'),'not.jwt.valid'):
            self.token=token;r=self.request();self.assertEqual(r.status_code,401)
            self.assertNotIn(token,r.get_data(as_text=True))

    def test_origin_host_peer_and_forwarded_headers_fail_before_jwks(self):
        with patch.object(self.cache,'get_keys',side_effect=AssertionError('No JWKS for rejected admission')):
            for kwargs in ({'headers':{'Origin':''}},{'headers':{'Origin':'http://evil.invalid'}},
                           {'url':'http://localhost:15289'},{'peer':'192.0.2.1'},{'peer':''},
                           *({'headers':{h:'127.0.0.1'}} for h in ('Forwarded','X-Forwarded-For','X-Forwarded-Host','X-Forwarded-Proto','X-Real-IP'))):
                with self.subTest(kwargs=kwargs):self.assertEqual(self.request(**kwargs).status_code,403)

    def test_session_csrf_body_and_header_limits_cannot_enable_or_bypass(self):
        with patch.object(self.cache,'get_keys',side_effect=AssertionError('No JWKS for rejected admission')):
            self.assertEqual(self.request(client=self.app.test_client()).status_code,401)
            self.assertEqual(self.request(headers={'X-CSRF-Token':''}).status_code,403)
            for kwargs in ({'body':{'enable':True}},{'body':{'environmentId':ENVIRONMENT_ID}},{'body':{'x':'x'*300}},
                           {'headers':{'Authorization':'Bearer '+'x'*16400}},{'headers':{'X-CSRF-Token':'x'*257}}):
                self.assertEqual(self.request(**kwargs).status_code,422)
            self.now+=3601;self.assertEqual(self.request().status_code,401)

    def test_rate_and_fixed_jwks_cache_bound_requests(self):
        for _ in range(5):self.assertEqual(self.request().status_code,200)
        self.assertEqual(self.fetches,1);self.assertEqual(self.request().status_code,429)
        self.now+=61;self.assertEqual(self.request().status_code,200);self.assertEqual(self.fetches,1)
        self.cache._keys=[];self.now+=301
        with patch.object(self.cache,'_transport',side_effect=OSError('synthetic-secret-error')):
            for _ in range(2):
                r=self.request();self.assertEqual(r.status_code,503)
                self.assertEqual(r.json['code'],'CALIBRATION_KEYS_UNAVAILABLE');self.assertNotIn('synthetic-secret',r.get_data(as_text=True))

    def test_default_and_business_composition_cannot_enable_diagnostics(self):
        disabled=IdentityPreparation(self.origin,clock=lambda:self.now,jwks=self.cache)
        app=create_app({'origin':self.origin,'runId':'disabled','developmentCalibrationEnabled':True},identity_preparation=disabled)
        with patch.object(self.cache,'get_keys',side_effect=AssertionError('Disabled')):
            self.assertEqual(app.test_client().post(PREFIX+'/calibrate',base_url=self.origin,json={'enable':True},headers={'Origin':self.origin}).status_code,404)
        self.assertFalse(disabled.config()['developmentCalibrationEnabled'])
        with self.assertRaises(ValueError): IdentityPreparation('https://public.invalid',development_calibration=True)
        with self.assertRaises(ValueError): IdentityPreparation(self.origin,development_calibration='true')
        with self.assertRaises(ValueError): IdentityPreparation(self.origin,development_calibration=True,profile=ClaimProfile(ENVIRONMENT_ID,'issuer'))
        with patch('server.manual_business.web.BusinessService'),patch('server.manual_business.web.Credentials'),patch('server.manual_business.web.LocalRedemption'):
            with self.assertRaises(ValueError):create_app({'origin':self.origin},backend=object(),identity_preparation=self.service)

    def test_logout_and_session_replacement_do_not_leave_diagnostic_authority(self):
        self.assertEqual(self.request().status_code,200)
        self.client.post(PREFIX+'/logout',base_url=self.origin,json={},headers={'Origin':self.origin,'X-CSRF-Token':self.csrf})
        self.assertEqual(self.request().status_code,401);self.bootstrap()
        self.assertEqual(self.request().status_code,403)
        self.assertTrue(all(set(row)=={'csrf','until'} for row in self.service.sessions.values()))

    def test_cli_flag_is_ephemeral_resume_does_not_persist_enablement(self):
        from server.manual_business import __main__ as launcher
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)/'new-preparation';output=io.StringIO();enabled=[]
            def serve(app,port):
                enabled.append(app.test_client().get(PREFIX+'/config',base_url=self.origin).json['developmentCalibrationEnabled'])
            with patch.object(launcher,'serve',side_effect=serve),contextlib.redirect_stdout(output):
                with patch('sys.argv',['launcher','prepare','--directory',str(directory),'--port','15289','--development-identity-calibration']):launcher.main()
                before={p.name:p.read_bytes() for p in Path(tmp).rglob('*') if p.is_file()}
                with patch('sys.argv',['launcher','resume','--directory',str(directory),'--port','15289']):launcher.main()
                after={p.name:p.read_bytes() for p in Path(tmp).rglob('*') if p.is_file()}
            self.assertEqual(enabled,[True,False]);self.assertEqual(before,after)
            self.assertEqual(set(before),{'preparation.json','new-preparation.preparation-anchor'})


if __name__=='__main__':unittest.main()
