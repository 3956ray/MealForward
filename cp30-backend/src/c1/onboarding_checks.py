"""Small offline adapter contract checks; never initializes PG/HTTP/chain/browser."""
from contextlib import contextmanager
from copy import deepcopy
import json
from pathlib import Path
import unittest
from .onboarding_adapter import (OnboardingGateway,IntegrationRejected,PostgresStorage,
    IdentityAuthority,CatalogBuilder,domain_modules,ROOT,NODE,PIN)
from .identity_adapter import IdentityGateway
from .connection_composition import compose_services,ActivationGate,RegistrationWorker

class Fixed:
    def __init__(self,database,read_only):
        self.database,self.read_only,self.namespace=database,read_only,'offline-adapter'
    def call(self,method,q):
        self.database.calls.append((method,deepcopy(q),self.read_only))
        if method=='onboarding_authorize':return {'subject':'synthetic-owner','owner':'0x'+'a'*40,'bindingRevision':1,'ownerKind':'EOA'}
        if method=='onboarding_image_get':return {'imageDigest':'0x'+'b'*64}
        if method in {'onboarding_get_by_key','onboarding_get_by_id'}:return {'record':deepcopy(self.database.record)}
        if self.read_only:raise AssertionError('Mutation during read-only preflight')
        if method in {'onboarding_insert','onboarding_save'}:self.database.record=deepcopy(q['record'])
        return {'saved':True}

class FakeDatabase:
    database='business'
    def __init__(self):self.calls=[];self.record=None;self.depth=0
    @contextmanager
    def transaction(self,namespace,*,read_only=False):
        original=deepcopy(self.record);self.depth+=1
        try:yield Fixed(self,read_only)
        except Exception:self.record=original;raise
        finally:self.depth-=1

class AdapterChecks(unittest.TestCase):
    def test_no_profile_no_db_or_domain_fallback(self):
        database=FakeDatabase();gateway=OnboardingGateway(database,lambda:'offline-adapter')
        self.assertEqual(gateway.setup()['status'],'NOT_CONFIGURED')
        self.assertFalse(gateway.setup()['walletActionsEnabled'])
        with self.assertRaisesRegex(IntegrationRejected,'NOT_CONFIGURED'):gateway.register({},'x'*16,{})
        self.assertEqual(database.calls,[])
        identity=IdentityGateway();self.assertFalse(identity.setup()['sdkLoginEnabled'])
        with self.assertRaisesRegex(IntegrationRejected,'EMAIL_PROFILE_NOT_CONFIGURED'):identity.login({'accessToken':'synthetic-unverified-token'}, {})
    def test_durable_adapter_detached_rows_and_context(self):
        service,_=domain_modules();context=service.SessionContext('offline-adapter','1'*64,'2'*64)
        database=FakeDatabase();database.record={'subject':'synthetic-owner','value':1}
        storage=PostgresStorage(database,context.namespace,context)
        with storage.transaction(read_only=True) as tx:
            record=tx.by_key(context.namespace,'synthetic-owner','k'*16);record['value']=2
            self.assertEqual(database.record['value'],1)
            with self.assertRaises(IntegrationRejected):tx.publish_confirmed({'registrationId':'x'})
        self.assertTrue(database.calls[0][2]);self.assertEqual(database.calls[0][1]['session_hash'],context.session_hash)
        self.assertTrue(database.calls[0][1]['readOnly'])
    def test_real_codec_and_stable_catalog_outside_lock(self):
        service,codec_module=domain_modules();fixture=json.loads((ROOT/'integrations/onboarding/codec-fixture.json').read_text())
        original=fixture['original'];database=FakeDatabase();context=service.SessionContext('offline-adapter','1'*64,'2'*64)
        identity=IdentityAuthority(service.OwnerIdentity);storage=PostgresStorage(database,context.namespace,context)
        draft={'name':'Real-owner supplied fixture meal','description':'Synthetic test material only','unitPrice':'1000000','imageRef':'0x'+'c'*64,'windows':[[0,1440]]}
        catalog=CatalogBuilder(draft)
        with storage.transaction(read_only=True) as tx:
            owner=identity.authorize(tx,context,'register');one=catalog.build(tx,owner,draft);two=catalog.build(tx,owner,draft)
        self.assertEqual(one,two);self.assertEqual(one[0]['terms']['version'],'1')
        self.assertEqual(database.depth,0)
        node_codec=codec_module.NodeRegistrationCodec(NODE,lambda:int(fixture['now']),lambda o:'EOA')
        prepared=node_codec.prepare(original)
        self.assertEqual(prepared['typedData']['message']['configHash'],prepared['configHash'])
        self.assertEqual(original['escrowCreationCodeHash'],PIN)
        self.assertFalse(node_codec.verify_owner_signature(original,'0x'+'00'*65))
        smart=codec_module.NodeRegistrationCodec(NODE,lambda:int(fixture['now']),lambda o:'SMART_WALLET')
        with self.assertRaisesRegex(service.Rejected,'OWNER_SIGNATURE_CHECKER_REQUIRED'):smart.verify_owner_signature(original,'0x01')
    def test_fixed_functions_and_accepted_object_bindings(self):
        migration=(ROOT/'migrations/016-onboarding-identity.sql').read_text()
        binding=(ROOT/'migrations/017-onboarding-review-binding.sql').read_text()
        self.assertIn('CREATE SCHEMA c1_onboarding_internal',migration)
        self.assertIn('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_onboarding_internal FROM PUBLIC',migration)
        self.assertIn("IF coalesce((q->>'readOnly')::boolean,false)",migration)
        self.assertIn('pg_advisory_xact_lock',migration)
        for function in ['review_material','intent_retry','draft_publish','settle_confirm']:
            self.assertIn('CREATE OR REPLACE FUNCTION c1_api.'+function,binding)
        self.assertIn("r.payload->>'store' IS DISTINCT FROM q->>'store'",binding)
        self.assertIn("original_payload->>'store' IS DISTINCT FROM q->>'store'",binding)
        self.assertIn("r.payload->>'meal' IS DISTINCT FROM q->>'meal'",binding)
    def test_concrete_composition_default_and_activation(self):
        database=FakeDatabase();services=compose_services({},database,lambda:'offline-adapter')
        self.assertEqual(services['onboarding'].setup()['status'],'NOT_CONFIGURED')
        self.assertFalse(services['identity'].setup()['sdkLoginEnabled'])
        self.assertIsNone(services['dispatcher'])
        import time
        gate=ActivationGate({'storeDeployment':True,'expiresAt':int(time.time())+60},lambda:'offline-adapter')
        self.assertTrue(gate.allowed('offline-adapter','register','0x'+'a'*64))
        self.assertFalse(gate.allowed('other-namespace','register','0x'+'a'*64))
        self.assertFalse(gate.allowed('offline-adapter','fund','id'))
        class UnavailableObserver:
            def step(self):raise RuntimeError('fixed observer error')
        result=RegistrationWorker(UnavailableObserver()).step()
        self.assertEqual(result['state'],'UNKNOWN');self.assertFalse(result['ready'])
    def test_private_identity_nonce_consumption_is_atomic_source(self):
        migration=(ROOT/'migrations/018-verified-identity-security.sql').read_text()
        controller=(ROOT/'src/c1/controller.py').read_text()
        self.assertIn("'verified_identity': frozenset({'identity_exchange','wallet_binding','query'})",controller)
        self.assertIn("role!='verified_identity'",controller)
        self.assertIn("payload=p->'expected_challenge'",migration)
        self.assertIn('UPDATE c1_private.owner_wallet_challenges SET consumed=true',migration)
        self.assertIn('INSERT INTO c1_private.verified_owner_bindings',migration)
        self.assertIn('s=c1_private.auth(n,p,true)',migration)
    def test_live_mode_cannot_fall_back_to_synthetic_business(self):
        import ast,re
        from types import SimpleNamespace
        from urllib.parse import urlsplit
        path=ROOT/'src/c1/application.py';tree=ast.parse(path.read_text())
        cls=next(item for item in tree.body if isinstance(item,ast.ClassDef) and item.name=='Application')
        handle=next(item for item in cls.body if isinstance(item,ast.FunctionDef) and item.name=='handle')
        scope={'urlsplit':urlsplit,'re':re,'__file__':str(path),'Path':Path}
        exec(compile(ast.Module(body=[handle],type_ignores=[]),str(path),'exec'),scope)
        app=SimpleNamespace(config={'mode':'CP30_TESTNET_CONNECTION'},real_business=None)
        for route in ['/v1/stores','/v1/support/reviews','/v1/claims/intents','/v1/my/vouchers']:
            status,body,_=scope['handle'](app,'GET',route,{}, {},b'',None)
            self.assertEqual(status,503);self.assertEqual(body['error'],'LIVE_BUSINESS_NOT_CONFIGURED')

if __name__=='__main__':unittest.main()
