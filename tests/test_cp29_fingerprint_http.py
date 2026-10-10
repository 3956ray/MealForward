"""Synthetic JWT + HTTP fingerprint enrollment, must not authorize business."""
import json
import unittest
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import FixedJwksCache
from server.manual_business.cp29_identity import fingerprint
from server.manual_business.identity_preparation import IdentityPreparation
from server.manual_business.web import create_app


class CP29FingerprintHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.key.public_key()))
        cls.jwk.update(kid='synthetic',alg='RS256',use='sig')

    def setUp(self):
        self.origin='http://127.0.0.1:15287';self.now=1000
        profile=ClaimProfile(ENVIRONMENT_ID,'app.dynamicauth.com/'+ENVIRONMENT_ID,(self.origin,),verified=True)
        jwks=FixedJwksCache(clock=lambda:self.now,transport=lambda:json.dumps({'keys':[self.jwk]}).encode())
        self.keybytes=bytes(range(32))
        self.service=IdentityPreparation(self.origin,profile=profile,jwks=jwks,clock=lambda:self.now,
                              cp29_fingerprint_key=self.keybytes)
        app=create_app({'origin':self.origin,'runId':'synthetic-enrollment'},identity_preparation=self.service)
        self.client=app.test_client()
        claims={'iss':profile.issuer,'aud':self.origin,'environment_id':ENVIRONMENT_ID,
                'sub':'partner-synthetic','sid':'session-synthetic','iat':900,'exp':1100,'scope':'user:basic'}
        self.token=jwt.encode(claims,self.key,algorithm='RS256',headers={'kid':'synthetic'})
        self.csrf=self.client.get('/api/cp28/identity/bootstrap',base_url=self.origin).json['csrfToken']

    def call(self,path,headers=None,body=None):
        return self.client.post('/api/cp28/identity/'+path,json={} if body is None else body,
             base_url=self.origin,headers={'Origin':self.origin,'X-CSRF-Token':self.csrf,
                    'Authorization':'Bearer '+self.token,**(headers or {})})

    def test_disabled_by_default(self):
        self.service.cp29_fingerprint_key=None
        self.assertEqual(self.call('fingerprint').status_code,404)

    def test_requires_verified_exchange_csrf_and_exact_subject(self):
        self.assertEqual(self.call('fingerprint').status_code,401)
        self.assertEqual(self.call('exchange').status_code,200)
        result=self.call('fingerprint')
        self.assertEqual(result.status_code,200)
        data=result.json
        self.assertEqual(data['subjectFingerprint'],fingerprint(self.keybytes,ENVIRONMENT_ID,'partner-synthetic'))
        self.assertFalse(data['actorMapped']);self.assertFalse(data['businessAuthorized'])
        self.assertFalse(data['profileCreated'])
        serialized=json.dumps(data)
        for sensitive in ('partner-synthetic','session-synthetic',self.token,'actorId','role'):
            self.assertNotIn(sensitive,serialized)
        self.assertEqual(self.call('fingerprint',headers={'X-CSRF-Token':''}).status_code,403)
        self.assertEqual(self.call('fingerprint',headers={'Origin':'http://evil.invalid'}).status_code,403)
        self.assertEqual(self.call('fingerprint',headers={'X-Forwarded-For':'127.0.0.1'}).status_code,403)
        self.assertEqual(self.call('fingerprint',headers={'Forwarded':'for=127.0.0.1'}).status_code,403)
        self.assertEqual(self.call('fingerprint',headers={'Authorization':'Bearer '+'X'*17000}).status_code,403)
        self.assertEqual(self.call('fingerprint',body={'role':'owner'}).status_code,403)
        self.assertEqual(self.client.get('/api/cp28/status',base_url=self.origin).json['runtimeAuthorized'],False)

    def test_token_change_cannot_collect_stale_fingerprint(self):
        self.assertEqual(self.call('exchange').status_code,200)
        self.token=self.token[:-5]+'aaaaa'
        self.assertEqual(self.call('fingerprint').status_code,401)


if __name__=='__main__':unittest.main()
