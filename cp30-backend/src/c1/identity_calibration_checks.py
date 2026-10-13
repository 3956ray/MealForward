"""Memory-only diagnostic boundary checks; crypto/JWKS execution remains unverified."""
import base64
import importlib.util
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('calibration_checks_source', ROOT/'tools/identity-calibration.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
ORIGIN = 'https://localhost:16443'

class Profile:
    def __init__(self, environment, issuer, audiences, **flags):
        self.environment_id, self.issuer, self.audiences = environment, issuer, audiences
        self.__dict__.update(flags)

class Checks(unittest.TestCase):
    def setUp(self):
        self.calls=[]
        contracts=ModuleType('server.dynamic_contracts');contracts.ClaimProfile=Profile
        verifier=ModuleType('server.dynamic_jwt');verifier._json=json.loads
        def verify(raw, **options):
            self.calls.append(options)
            if raw.endswith('.reject'):raise ValueError('Never expose private@example.test or SECRET_TOKEN')
            return SimpleNamespace(scopes=frozenset({'user:basic'}))
        verifier.verify_access_token=verify
        self.modules=patch.dict(sys.modules,{'server.dynamic_contracts':contracts,'server.dynamic_jwt':verifier})
        self.modules.start();self.addCleanup(self.modules.stop)
    def token(self, **extra):
        payload={'iss':'app.dynamicauth.com/'+source.ENVIRONMENT,'aud':ORIGIN,
            'environment_id':source.ENVIRONMENT,'sub':'SECRET_SUBJECT','sid':'SECRET_SID',
            'email':'private@example.test','email_verified':True,'scope':'user:basic',
            'verified_credentials':[{'format':'email','email':'private@example.test','id':'SECRET_ID'}],**extra}
        encoded=base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
        return 'inert.'+encoded+'.memory'
    def test_verified_gate_and_redaction(self):
        result=source.inspect_token(self.token(),origin=ORIGIN,jwks=object())
        self.assertEqual(len(self.calls),1)
        self.assertFalse(result['candidateProfile']['verified'])
        self.assertFalse(result['businessSessionCreated']);self.assertFalse(result['rolesGranted'])
        self.assertEqual(result['signedEmailEvidence']['emailCredentialCount'],1)
        for secret in ('private@example.test','SECRET_SUBJECT','SECRET_SID','SECRET_ID','inert.'):
            self.assertNotIn(secret,json.dumps(result))
    def test_unknown_audience_and_scope_values_not_exported(self):
        result=source.inspect_token(self.token(aud='private@example.test'),origin=ORIGIN,jwks=object())
        self.assertIsNone(result['candidateProfile']['audiences'])
        self.assertTrue(result['candidateProfile']['audiencesRedacted'])
        self.assertNotIn('private@example.test',json.dumps(result))
    def test_unique_email_credential_types_exclude_wallet_fields(self):
        credentials=[{'format':'wallet','address':'SECRET_WALLET','public_identifier':'SECRET_WALLET_ID'},
            {'format':'email','email':'private@example.test'}]
        result=source.inspect_token(self.token(verified_credentials=credentials),origin=ORIGIN,jwks=object())
        self.assertEqual(result['uniqueEmailCredentialStructure'],{'format':'string','email':'string'})
        self.assertIn('address',result['credentialStructure'])
        self.assertNotIn('SECRET_WALLET',json.dumps(result))
        self.assertNotIn('private@example.test',json.dumps(result))
    def test_zero_or_multiple_email_credentials_have_no_selected_schema(self):
        for credentials in ([],[{'format':'wallet','address':'SECRET_WALLET'}],
                [{'format':'email','email':'private@example.test'},{'format':'email','address':'other@example.test'}]):
            result=source.inspect_token(self.token(verified_credentials=credentials),origin=ORIGIN,jwks=object())
            self.assertIsNone(result['uniqueEmailCredentialStructure'])
    def test_absence_report_remains_unapproved(self):
        token=self.token();parts=token.split('.')
        claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*(-len(parts[1])%4)))
        for name in ('aud','sid','environment_id'):claims.pop(name)
        parts[1]=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        result=source.inspect_token('.'.join(parts),origin=ORIGIN,jwks=object())
        self.assertFalse(result['profileApproved'])
        self.assertTrue(result['candidateProfile']['allow_absent_audience'])
    def test_routes_reject_wrong_origin_before_verifier(self):
        route=source.Routes(ORIGIN,jwks=object())
        result=route.handle('POST','/identity-calibration/inspect',{},json.dumps({'accessToken':self.token()}).encode())
        self.assertEqual(result[0],401);self.assertEqual(self.calls,[])
    def test_failed_verification_has_no_private_diagnostic(self):
        route=source.Routes(ORIGIN,jwks=object())
        headers={'origin':ORIGIN,'content-type':'application/json','x-cp30-identity-calibration':'1'}
        token=self.token().removesuffix('memory')+'reject'
        result=route.handle('POST','/identity-calibration/inspect',headers,json.dumps({'accessToken':token}).encode())
        self.assertEqual(result[0],401)
        self.assertEqual(result[1],b'{"status":"CALIBRATION_REJECTED"}')
    def test_only_fixed_get_routes_and_exact_origin(self):
        route=source.Routes(ORIGIN,jwks=object())
        self.assertIsNone(route.handle('POST','/v1/identity/login',{},b''))
        self.assertEqual(route.handle('GET','/identity-calibration',{})[0],200)
        with self.assertRaises(ValueError):source.Routes(ORIGIN+'/',jwks=object())

if __name__=='__main__':unittest.main()
