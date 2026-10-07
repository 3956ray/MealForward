"""Actual JWT + HTTP preparation; ephemeral RSA fixtures, no external requests."""
import json
import os
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import FixedJwksCache
from server.manual_business.identity_preparation import IdentityPreparation, load_profile, COOKIE
from server.manual_business.web import create_app


class IdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key()))
        cls.public.update(kid='synthetic', alg='RS256', use='sig')

    def setUp(self):
        self.now=1000; self.origin='http://127.0.0.1:15287'
        self.profile=ClaimProfile(ENVIRONMENT_ID,'app.dynamicauth.com/'+ENVIRONMENT_ID,(self.origin,),verified=True)
        self.claims={'iss':self.profile.issuer,'aud':self.origin,'environment_id':ENVIRONMENT_ID,
                     'sub':'synthetic-person','sid':'synthetic-session','iat':900,'exp':1100,'scope':'user:basic'}
        self.cache=FixedJwksCache(clock=lambda:self.now,transport=lambda:json.dumps({'keys':[self.public]}).encode())
        self.service=IdentityPreparation(self.origin,profile=self.profile,jwks=self.cache,clock=lambda:self.now)
        self.app=create_app({'origin':self.origin,'runId':'synthetic-identity'},identity_preparation=self.service)
        self.client=self.app.test_client(); self.token=self.make_token(); self.csrf=''
        self.bootstrap()

    def make_token(self, **changes): return jwt.encode({**self.claims,**changes},self.key,algorithm='RS256',headers={'kid':'synthetic'})
    def bootstrap(self):
        response=self.client.get('/api/cp28/identity/bootstrap',base_url=self.origin)
        self.assertEqual(response.status_code,200); self.csrf=response.json['csrfToken']
        return response
    def request(self,path,body=None,expected=200,headers=None):
        response=self.client.open('/api/cp28/identity/'+path,method='GET' if body is None else 'POST',json=body,base_url=self.origin,
            headers={'Origin':self.origin,'Authorization':'Bearer '+self.token,'X-CSRF-Token':self.csrf,**(headers or {})})
        self.assertEqual(response.status_code,expected,response.get_data(as_text=True)); return response.json
    def login(self): return self.request('exchange',{})
    def confirm(self): return self.request('candidate',{'address':'0x'+'11'*20,'chainId':10143})

    def test_verified_identity_and_same_candidate_never_grant_business_or_proof(self):
        session=self.login(); self.assertEqual(session['expiresAt'],1100)
        result=self.confirm(); c=result['candidate']
        self.assertEqual(c['adminAddress'],c['merchantAddress']); self.assertFalse(c['controlVerified'])
        self.assertFalse(c['chainPermissionsVerified']); self.assertFalse(result['businessAuthorized'])
        self.assertEqual(result['workPermission'],'NOT_CONFIGURED')
        text=json.dumps(result)
        for private in ('synthetic-person','synthetic-session',self.token,'actorId','role'): self.assertNotIn(private,text)
        status=self.client.get('/api/cp28/status',base_url=self.origin).json
        self.assertFalse(status['runtimeAuthorized']); self.assertEqual(status['status'],'BLOCKED')
        for path in ('owner/proof/prepare','support/prepare','partner/issue'):
            response=self.client.post('/api/cp28/'+path,json={},base_url=self.origin,headers={'Origin':self.origin})
            self.assertEqual(response.status_code,503)

    def test_missing_profile_refuses_before_jwks_and_does_not_fake_verified_state(self):
        self.service.profile=None
        with patch.object(self.cache,'get_keys',side_effect=AssertionError('No network')):
            self.assertFalse(self.request('config')['serverVerificationConfigured'])
            self.request('exchange',{},expected=503)
        self.assertTrue(all('identity' not in row for row in self.service.sessions.values()))

    def test_wrong_environment_audience_signature_and_incomplete_scope_rejected(self):
        for changes in ({'aud':'http://127.0.0.1:15207'},{'environment_id':'wrong'},{'exp':999},
                        {'scope':'user:basic requires_mfa'},{'scope':'pending'}):
            with self.subTest(changes=changes):
                self.token=self.make_token(**changes);self.request('exchange',{},expected=401)
        self.token=jwt.encode(self.claims,rsa.generate_private_key(public_exponent=65537,key_size=2048),algorithm='RS256',headers={'kid':'synthetic'})
        self.request('exchange',{},expected=401)

    def test_token_subject_sid_and_expiry_change_revoke_previous_candidate(self):
        for changes in ({'sub':'different'},{'sid':'different'},{'iat':901},{'exp':1200}):
            with self.subTest(changes=changes):
                self.token=self.make_token();self.login();self.confirm()
                self.token=self.make_token(**changes);self.request('session',expected=401)
                self.assertTrue(all('candidate' not in r for r in self.service.sessions.values()))
        self.token=self.make_token();self.login();self.confirm();self.now=1100
        self.request('session',expected=401)

    def test_csrf_and_origin_required_for_every_identity_write(self):
        self.login()
        for path,body in [('exchange',{}),('candidate',{'address':'0x'+'11'*20,'chainId':10143}),('invalidate',{}),('logout',{})]:
            with self.subTest(path=path):
                self.request(path,body,expected=403,headers={'X-CSRF-Token':''})
                self.request(path,body,expected=403,headers={'Origin':'http://evil.invalid'})
        self.request('session',expected=403,headers={'Origin':'http://evil.invalid'})

    def test_invalidate_logout_bootstrap_and_process_restart_drop_confirmation(self):
        self.login();self.confirm();self.request('invalidate',{})
        self.request('session',expected=401)
        self.login();self.confirm();self.bootstrap();self.request('session',expected=401)
        self.login();self.confirm();self.request('logout',{})
        self.request('session',expected=401)
        self.bootstrap();self.login();self.confirm()
        fresh=IdentityPreparation(self.origin,profile=self.profile,jwks=self.cache,clock=lambda:self.now)
        self.assertEqual(fresh.sessions,{})

    def test_candidate_is_exact_address_chain_and_service_signer_is_excluded(self):
        self.login()
        self.service.service_addresses={'0x'+'11'*20}
        self.request('candidate',{'address':'0x'+'11'*20,'chainId':10143},expected=409)
        for body in ({'address':'0x'+'00'*20,'chainId':10143},{'address':'0x'+'22'*20,'chainId':31337},
                     {'address':'0x'+'22'*20,'chainId':10143,'role':'admin'}):
            self.request('candidate',body,expected=422)
        self.request('exchange',{'subject':'self-assigned','role':'owner'},expected=422)

    def test_cookie_bounds_admission_and_changed_profile_fail_closed(self):
        response=self.bootstrap();cookie=response.headers['Set-Cookie']
        self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=Strict',cookie);self.assertIn('Path=/api/cp28/identity',cookie)
        self.login();self.confirm()
        def changed(): raise ValueError('private config must not leak')
        self.service.source_check=changed
        self.request('session',expected=503)
        self.assertTrue(all('candidate' not in r for r in self.service.sessions.values()))
        self.service.source_check=None
        for _ in range(19):self.login()
        self.request('exchange',{},expected=429)

    def test_profile_file_requires_explicit_origin_and_unchanged_private_source(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'reviewed.json'; data={'sourceVersion':'synthetic-reviewed','claimProfile':asdict(self.profile)}
            file.write_text(json.dumps(data));os.chmod(file,0o600)
            profile,check=load_profile(file,self.origin);self.assertEqual(profile,self.profile);check()
            data['claimProfile']['audiences']=['http://127.0.0.1:15207'];file.write_text(json.dumps(data))
            with self.assertRaises(Exception):check()
            with self.assertRaises(ValueError):load_profile(file,self.origin)
            data['claimProfile']['audiences']=[self.origin];data['claimProfile']['allow_absent_sid']=True;file.write_text(json.dumps(data))
            with self.assertRaises(ValueError):load_profile(file,self.origin)
            os.chmod(file,0o644)
            with self.assertRaises(PermissionError):load_profile(file,self.origin)


if __name__=='__main__':unittest.main()
