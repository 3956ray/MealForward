import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import io
import time

from flask import Flask, jsonify
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt

from server.contracts import ApiError
from server.dynamic_auth import register_dynamic_auth
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import FixedJwksCache
from server.dynamic_profile import ProfileCapture, main
from server.storage import Store


class ProfileCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cls.key=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(cls.private.public_key()))
        cls.key.update(kid='fixture',alg='RS256',use='sig')

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.now=1000;self.directory=Path(self.tmp.name)/'captures'
        self.jwks=FixedJwksCache(clock=lambda:self.now,transport=lambda:json.dumps({'keys':[self.key]}).encode())
        self.capture=ProfileCapture(self.directory,clock=lambda:self.now,jwks=self.jwks)
        self.claims=dict(iss='signed-but-not-trusted-issuer',aud='candidate-api',sub='private-subject',
                         environment_id=ENVIRONMENT_ID,scope='user:basic other',iat=900,exp=3000)

    def token(self, **changes):
        return jwt.encode({**self.claims,**changes},self.private,algorithm='RS256',headers={'kid':'fixture'})

    def test_only_shape_returned_private_capture_expires_and_never_contains_jwt(self):
        raw=self.token();result=self.capture.inspect(raw)
        self.assertFalse(result['grantsWorkAccess']);self.assertFalse(result['candidateProfile']['verified'])
        self.assertNotIn('private-subject',json.dumps(result));self.assertNotIn(raw,json.dumps(result))
        path=self.directory/(result['captureId']+'.json')
        self.assertEqual(path.stat().st_mode & 0o777,0o600)
        self.assertNotIn(raw,path.read_text());self.assertNotIn('sid',json.loads(path.read_text()))
        self.assertEqual(self.capture.read_for_maintenance(result['captureId'])['subject'],'private-subject')
        self.now=result['expiresAt']
        with self.assertRaises(FileNotFoundError):self.capture.read_for_maintenance(result['captureId'])
        self.assertFalse(path.exists())

    def test_wrong_environment_expiry_scope_and_signature_never_capture(self):
        for changes in ({'environment_id':'wrong'},{'exp':1000},{'scope':'user:intermediate'}):
            with self.assertRaises(ApiError):self.capture.inspect(self.token(**changes))
        other=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        with self.assertRaises(ApiError):self.capture.inspect(jwt.encode(self.claims,other,algorithm='RS256',headers={'kid':'fixture'}))
        self.assertEqual(list(self.directory.glob('*.json')),[])

    def test_http_exact_origin_rate_limit_no_cookie_and_exchange_still_closed(self):
        store=Store(Path(self.tmp.name)/'db.sqlite3');app=Flask(__name__)
        @app.errorhandler(ApiError)
        def error(exc):return jsonify(code=exc.code),exc.status
        register_dynamic_auth(app,store,profile=ClaimProfile(ENVIRONMENT_ID,''),jwks=self.jwks,
                              clock=lambda:self.now,capture_directory=self.directory)
        client=app.test_client();base='http://127.0.0.1:15207'
        headers={'Origin':base,'Authorization':'Bearer '+self.token()}
        bad=client.post('/api/v1/auth/dynamic/profile-check',base_url=base,json={},headers={**headers,'Origin':'http://localhost:15207'})
        self.assertEqual(bad.status_code,403)
        for _ in range(5):
            result=client.post('/api/v1/auth/dynamic/profile-check',base_url=base,json={},headers=headers)
            self.assertEqual(result.status_code,200);self.assertNotIn('Set-Cookie',result.headers)
        self.assertEqual(client.post('/api/v1/auth/dynamic/profile-check',base_url=base,json={},headers=headers).status_code,429)
        exchange=client.post('/api/v1/auth/dynamic/exchange',base_url=base,json={},headers=headers)
        self.assertEqual((exchange.status_code,exchange.json['code']),(503,'DYNAMIC_PROFILE_UNVERIFIED'))
        self.assertEqual(store.one('SELECT count(*) n FROM work_sessions')['n'],0)
        self.assertEqual(store.one('SELECT count(*) n FROM dynamic_identity_mappings')['n'],0)

    def test_maintenance_cli_requires_review_and_actor_then_writes_without_activation(self):
        self.now=int(time.time());self.claims.update(iat=self.now-10,exp=self.now+900)
        result=self.capture.inspect(self.token())
        dbpath=Path(self.tmp.name)/'maintenance.sqlite3';store=Store(dbpath)
        store.create_user('partner','partner','unused','partner','partner-a','shop-local')
        reviewed=Path(self.tmp.name)/'reviewed.json';output=Path(self.tmp.name)/'authority.json'
        reviewed.write_text(json.dumps(result['candidateProfile']))
        args=['profile','--directory',str(self.directory),'--capture-id',result['captureId'],'--actor','partner',
              '--database',str(dbpath),'--reviewed-profile',str(reviewed),'--output',str(output)]
        with patch('sys.argv',args), self.assertRaises(ValueError):main()
        self.assertFalse(output.exists())
        reviewed.write_text(json.dumps({**result['candidateProfile'],'verified':True}))
        bad=args.copy();bad[bad.index('--actor')+1]='unknown'
        with patch('sys.argv',bad),self.assertRaises(ValueError):main()
        self.assertFalse(output.exists())
        with patch('sys.argv',args),patch('sys.stdout',new_callable=io.StringIO) as printed:
            main()
            self.assertNotIn('private-subject',printed.getvalue())
        self.assertEqual(output.stat().st_mode & 0o777,0o600)
        self.assertEqual(json.loads(output.read_text())['mappings'][0]['actor_id'],'partner')
        self.assertEqual(store.one('SELECT count(*) n FROM dynamic_identity_mappings')['n'],0)
        self.assertFalse((self.directory/(result['captureId']+'.json')).exists())
