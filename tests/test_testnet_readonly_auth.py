import json
from pathlib import Path
from tests.test_dynamic_auth import DynamicAuthTests
from server.testnet_scope import register
from server.testnet_readonly.identity import SCOPE_IDENTITY
from server.dynamic_mapping import subject_hash

class ScopeTests(DynamicAuthTests):
    def setUp(self):
        super().setUp()
        self.path=Path(self.tmp.name)/'scope.json'
        row=self.store.one('SELECT * FROM dynamic_identity_mappings')
        self.config=dict(version='test-1',enabled=True,scope='testnet:ledger:read',deployment=SCOPE_IDENTITY,
            binding=dict(mappingId=row['id'],revision=row['revision'],environment=self.identity.environment_id,
            issuer=self.identity.issuer,subjectHash=subject_hash(self.identity.subject),actorId='partner',partnerId='partner-a',authorityVersion=row['authority_source_version']))
        self.write();register(self.app,self.auth,self.store,self.path,reader=lambda:{'amounts':None})
    def write(self):self.path.write_text(json.dumps(self.config));self.path.chmod(0o600)
    def get(self):return self.client.get('/api/v1/work/testnet-context',base_url=self.base,headers=self.headers)
    def test_scope_requires_dynamic_session_and_explicit_current_binding(self):
        self.assertEqual(self.get().status_code,401);self.exchange()
        result=self.get();self.assertEqual(result.status_code,200);self.assertEqual(result.json['capabilities'],['read'])
        self.assertNotIn('subject',result.get_data(as_text=True));self.assertFalse(result.json['transactionsEnabled'])
        self.config['enabled']=False;self.write();self.assertEqual(self.get().status_code,403)
        self.config['enabled']=True;self.config['deployment']={**SCOPE_IDENTITY,'chainId':31337};self.write();self.assertEqual(self.get().status_code,403)
    def test_current_revision_revocation_and_no_parameter_grant(self):
        self.exchange();self.assertEqual(self.client.get('/api/v1/work/testnet-context?role=owner',base_url=self.base,headers=self.headers).status_code,400)
        self.store.execute('UPDATE dynamic_identity_mappings SET enabled=0')
        self.assertEqual(self.get().status_code,401)
    def test_private_scope_file_missing_and_permissions(self):
        self.exchange();self.path.chmod(0o644);self.assertEqual(self.get().status_code,403)
        self.path.unlink();self.assertEqual(self.get().status_code,403)
