"""Bounded new live protocol checks: memory PG/IPC and unsigned codecs only."""
import ast
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from .live_gateway import LiveGateway,IntegrationRejected,core,PROTOCOL
from .onboarding_adapter import ROOT,NODE
from .private_business_host import business_modules

BINDING={'chainId':31337,'escrow':'0x'+'1'*40,'asset':'0x'+'2'*40,'storeId':'0x'+'3'*64,'owner':'0x'+'4'*40,'receiver':'0x'+'4'*40,'quoteAuthority':'0x'+'5'*40,'catalogAuthority':'0x'+'6'*40,'issuerAuthority':'0x'+'7'*40,'operatorAuthority':'0x'+'8'*40}
class Ledger:
    durability_protocol='CP30_DURABLE_ORIGINAL_LEDGER_V1';namespace='offline-live'
    def __init__(self):self.depth=0;self.calls=[];self.responses={};self.database=SimpleNamespace(close=lambda:None)
    @contextmanager
    def transaction(self,*,read_only=False):
        self.depth+=1;outer=self
        class Tx:
            ticket={'readOnly':read_only};dirty=False
            @property
            def fixed(self):return self
            def call(self,method,q):
                outer.calls.append((method,deepcopy(q),read_only))
                result=outer.responses.get(method,{})
                return deepcopy(result(q) if callable(result) else result)
        try:yield Tx()
        finally:self.depth-=1
class Client:
    live_business_protocol='CP30_LIVE_BUSINESS_HOST_V1'
    def __init__(self,ready=True):self.ready=ready;self.calls=[]
    def setup(self,namespace):self.calls.append(('setup',namespace));return self.ready
    def execute(self,namespace,intent_id,*,lookup=False):self.calls.append(('lookup' if lookup else 'execute',intent_id));return {}
class LiveChecks(unittest.TestCase):
    def test_authority_ipc_wait_matches_existing_rpc_budget(self):
        from . import live_gateway as gateway
        seen=[]
        def client(path,cap,timeout):seen.append((path,timeout));return object()
        source={'enabled':True,'controller':{'path':'controller','cap':'inert'},'apiRole':'api','observerRole':'observer','authorities':{role:{'path':role,'cap':'inert'} for role in ('quoteAuthority','issuerAuthority','operatorAuthority')}}
        fake_db=lambda *a,**kw:SimpleNamespace(close=lambda:None)
        with patch.object(gateway,'Client',client),patch.object(gateway,'LiveGateway',lambda **kw:SimpleNamespace(**kw)),patch.object(gateway,'persistence_module',return_value=SimpleNamespace(PgRuntimeLedger=lambda *a:object())),patch('c1.db.Database',fake_db),patch('c1.runtime_ledger_controller.RuntimeLedgerControllerClient',lambda value:value):
            gateway.compose_live({'connection':{'business':source},'run':'inert'},lambda:'inert',None)
        self.assertEqual(dict(seen),{'controller':5,'quoteAuthority':5,'issuerAuthority':25,'operatorAuthority':25})

    def setUp(self):
        self.api,self.worker=Ledger(),Ledger();self.clients={r:Client() for r in ('quoteAuthority','issuerAuthority','operatorAuthority')}
        config={'enabled':True,'asset':{'chainId':31337,'address':BINDING['asset'],'decimals':6,'symbol':'TEST','codeHash':'0x'+'9'*64,'reviewed':True},'maxSnapshotAgeSeconds':120}
        self.gateway=LiveGateway(api_ledger=self.api,worker_ledger=self.worker,config=config,clients=self.clients,activation_gate=SimpleNamespace(allowed=lambda *_:True),clock=lambda:100)
    def wallet(self,attempts=None,action='fund'):
        quote={'quoteId':'0x'+'a'*64,'payer':'0x'+'b'*40,'mealId':'0x'+'c'*64,'currentVersion':'1','termsHash':'0x'+'d'*64,'quantity':'1','unitPrice':'10000','amount':'10000','deadline':'1000'}
        value={'intent':{'id':'00000000-0000-4000-8000-000000000001','action':action,'stage':'WAIT_ACTOR','parameters':quote if action=='fund' else {'opId':'0x'+'a'*64,'voucherId':'0x'+'b'*64,'generation':'1','amount':'10000'},'signed_quote':{'chainId':31337,'escrow':BINDING['escrow'],'quoteAuthority':BINDING['quoteAuthority'],'quote':quote,'signature':'0x'+'1'*130},'signedQuote':None},'store':{'profile':{'binding':BINDING}},'attempts':attempts or {},'now':100}
        self.api.responses['live_api']=lambda q:value if q['op']=='wallet_material' else {'stage':'UNKNOWN','locatorOnly':True}
        return value
    def test_live_routes_and_read_write_fence(self):
        self.api.responses['live_api']={'reviewId':'00000000-0000-4000-8000-000000000001'}
        self.gateway.handle('POST','/v1/support/reviews',{'session_hash':'a'*64,'csrf_hash':'b'*64,'key':'key'*8},{'store':'S1','meal':'M1','quantity':1},{})
        method,q,readonly=self.api.calls[-1];self.assertEqual((method,q['op'],readonly),('live_api','support_review',False));self.assertFalse(q['ticket']['readOnly'])
        self.gateway.handle('GET','/v1/stores',{}, {},{});self.assertTrue(self.api.calls[-1][2])
        self.gateway.handle('GET','/v1/my/claims',{}, {},{})
        self.assertEqual(self.api.calls[-1][1]['op'],'my_claims');self.assertTrue(self.api.calls[-1][2])
        with self.assertRaisesRegex(IntegrationRejected,'NOT_IMPLEMENTED'):self.gateway.handle('POST','/v1/refund-intents',{}, {'reviewId':'x'},{})
        with self.assertRaises(IntegrationRejected):self.gateway.handle('POST','/v1/support/reviews',{}, {'store':'S1','meal':'M1','quantity':1,'approved':True},{})
    def test_approve_and_fund_distinct_original_attempts(self):
        value=self.wallet();id_=value['intent']['id']
        prepared=self.gateway.wallet_preparation({},id_);self.assertEqual(prepared['allowedKinds'],['approve']);self.assertEqual(prepared['material']['signedQuote']['quote']['amount'],'10000')
        with self.assertRaisesRegex(IntegrationRejected,'UNKNOWN'):self.gateway.wallet_attempt({},id_,{'kind':'fund'})
        self.gateway.wallet_attempt({},id_,{'kind':'approve'});_,saved,_=self.api.calls[-1]
        self.assertEqual(saved['deployment']['to'],BINDING['asset']);self.assertEqual(saved['deployment']['value'],'0');self.assertRegex(saved['deployment']['callDataDigest'],'^0x[0-9a-f]{64}$');self.assertIsNone(saved['observerRecord'])
        value['attempts']={'approve':{'hash':'0x'+'f'*64,'confirmed':True}}
        prepared=self.gateway.wallet_preparation({},id_);self.assertEqual(prepared['allowedKinds'],['fund'])
        self.gateway.wallet_attempt({},id_,{'kind':'fund'});_,saved,_=self.api.calls[-1]
        self.assertEqual(saved['observerRecord']['functionName'],'fund');self.assertEqual(saved['observerRecord']['parameters']['quote']['quoteId'],value['intent']['parameters']['quoteId'])
        self.assertEqual(saved['deployment']['to'],BINDING['escrow']);self.assertEqual(saved['observerRecord']['deployment'],saved['deployment'])
    def test_owner_settle_unsigned_payload_matches_actual_observer(self):
        value=self.wallet(action='settle');id_=value['intent']['id'];self.gateway.wallet_attempt({},id_,{'kind':'settle'});record=self.api.calls[-1][1]['observerRecord']
        self.assertEqual(record['deployment']['from'],BINDING['owner']);self.assertEqual(set(record),{'functionName','parameters','deployment','payloadHash'})
        observer=business_modules()['observer'];codec=business_modules()['codec'].BusinessCodec(NODE)
        owner=SimpleNamespace(codec=codec,root=Path(codec.helper).parent,binding=BINDING,budget={'maxCalls':96,'maxTotalMs':20000,'maxCallMs':3000,'maxResponseBytes':1048576,'maxTotalBytes':1048576},transport_factory=lambda:SimpleNamespace(request=lambda *_:(_ for _ in ()).throw(AssertionError('No RPC'))))
        session=observer._Session(owner);proof=session.proof(op='operation',binding=BINDING,record=record)
        self.assertEqual(proof['payloadHash'],record['payloadHash']);self.assertEqual(proof['functionName'],'settle')
    def test_ready_requires_fresh_verified_facts_and_actual_authorities(self):
        store={'snapshot':{'timestamp':'95'},'profile':{}}
        self.worker.responses['live_material']={'registration':{'state':'CONFIRMED'},'store':store}
        self.assertTrue(self.gateway.ready_for_store('original'));self.clients['operatorAuthority'].ready=False;self.assertFalse(self.gateway.ready_for_store('original'))
        self.clients['operatorAuthority'].ready=True;store['snapshot']['timestamp']='0';self.gateway.clock=lambda:500;self.assertFalse(self.gateway.ready_for_store('original'))
    def test_unknown_receipt_never_writes_and_io_outside_transactions(self):
        i={'id':'00000000-0000-4000-8000-000000000001','action':'issue','stage':'UNKNOWN','private_record':{},'signed_quote':None,'observer_record':{'functionName':'issue'},'transaction_hash':'0x'+'1'*64}
        store={'snapshot':{'timestamp':'100'},'profile':{},'revision':1,'meal':'c'*64}
        def material(q):
            if q.get('op')=='registration':return {'registration':{'state':'CONFIRMED'},'store':store}
            if q.get('op')=='tasks':return {'items':[i]}
            return {'intent':i,'store':store,'attempts':{}}
        self.worker.responses['live_material']=material
        outer=self
        class Observer:
            def verify_original_operation(self,record,hash_,*,meal_ids=()):
                outer.assertEqual((outer.api.depth,outer.worker.depth),(0,0));return None
        self.gateway.observer_factory=lambda *_:Observer()
        self.assertEqual(self.gateway.step()['state'],'ORIGINAL_CHAIN_UNKNOWN');self.assertTrue(all(readonly for _,_,readonly in self.worker.calls));self.assertTrue(all(not c.calls for c in self.clients.values()))
    def test_onboarding_three_wallet_methods_forward_live_only(self):
        from .onboarding_adapter import OnboardingGateway
        called=[]
        live=SimpleNamespace(live_business_protocol=PROTOCOL,
            wallet_preparation=lambda *args:called.append(('prepare',args)) or {'ok':True},
            wallet_hash=lambda *args:called.append(('hash',args)) or {'ok':True},
            wallet_attempt=lambda *args:called.append(('attempt',args)) or {'ok':True})
        onboarding=OnboardingGateway(SimpleNamespace(call=lambda *_:(_ for _ in ()).throw(AssertionError('Legacy wallet SQL'))),lambda:'offline-live',business_datasource=live)
        onboarding.mode='CP30_TESTNET_CONNECTION';onboarding.require_configured=lambda:None
        self.assertTrue(onboarding.wallet_preparation({},'id')['ok']);self.assertTrue(onboarding.observe_wallet_transaction({},'id',{'kind':'fund','transactionHash':'hash'})['ok']);self.assertTrue(onboarding.begin_wallet_attempt({},'id',{'kind':'fund'})['ok'])
        self.assertEqual([kind for kind,_ in called],['prepare','hash','attempt']);onboarding.business_datasource=None
        with self.assertRaisesRegex(IntegrationRejected,'NOT_CONFIGURED'):onboarding.wallet_preparation({},'id')
    def test_application_live_call_never_uses_synthetic_verifier(self):
        source=ast.parse((ROOT/'src/c1/application.py').read_text());original=next(x for x in source.body if isinstance(x,ast.ClassDef) and x.name=='Application');methods=[x for x in original.body if isinstance(x,ast.FunctionDef) and x.name in {'call','security'}]
        cls=ast.ClassDef(name='DispatchOnly',bases=[],keywords=[],body=methods,decorator_list=[]);scope={'__package__':'c1','verify_original':lambda *_:(_ for _ in ()).throw(AssertionError('Synthetic verifier'))}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[cls],type_ignores=[])),'dispatch-only','exec'),scope)
        app=scope['DispatchOnly']();app.config={'mode':'CP30_TESTNET_CONNECTION'};app.real_business=self.gateway;app.database=SimpleNamespace(call=lambda *_:(_ for _ in ()).throw(AssertionError('Legacy business SQL')))
        self.api.responses['live_api']={'ok':True};self.assertTrue(app.call('support_review',{})['ok']);self.assertTrue(app.security('display',{})['ok'])
        self.assertEqual(app.call('refund_review',{})['error'],'LIVE_OPERATION_NOT_IMPLEMENTED');app.real_business=None;self.assertEqual(app.call('claim_review',{})['error'],'LIVE_BUSINESS_NOT_CONFIGURED')
if __name__=='__main__':unittest.main()
