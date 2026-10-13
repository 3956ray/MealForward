"""New bounded memory/source checks; no PG/TLS/RPC/JWT/wallet/signing execution."""
import ast,copy,importlib.util,json,os,subprocess,sys
from pathlib import Path
from types import SimpleNamespace
from contextlib import contextmanager
import tempfile,threading,unittest
from unittest.mock import patch
from .full_configuration import validate_origin
from .first_binding_journal import FirstBindingJournal,BindingClosed
from .automatic_business import AutomaticBusiness
from .onboarding_adapter import ROOT
from .registrar_signer_journal import word_hash
from .journal import Journal,Quarantined,BINDINGS

ROLES=('quoteAuthority','issuerAuthority','operatorAuthority')
class Ledger:
    def __init__(self,material):self.material=material;self.calls=[]
    @contextmanager
    def transaction(self,*,read_only=False):
        owner=self
        class Tx:
            ticket={'readOnly':read_only};dirty=False
            @property
            def fixed(self):return self
            def call(self,method,q):
                owner.calls.append(method)
                if method=='first_binding_material':return copy.deepcopy(owner.material)
                if method=='first_binding_begin':
                    owner.material['binding']={'profiles':q['profiles'],'profile_digest':q['profileDigest'],'state':'PREPARED'};return {'prepared':True}
                if method=='first_binding_finish':owner.material['binding']['state']='BOUND';return {'bound':True}
                raise AssertionError(method)
        yield Tx()
class FakeSignerLeaf:
    def __init__(self):self.created=0
    def approved_profile(self,p,role):return p
    def AuthorityOriginalJournal(self,directory,*,role,profile,initialize=False):
        path=Path(directory)/'business-authority-originals.jsonl'
        if initialize:
            with path.open('x') as f:f.write('INERT_FAKE_HEADER');self.created+=1
            path.chmod(0o600)
        elif not path.exists():raise ValueError('missing')
        return SimpleNamespace(rows={},close=lambda:None)
class FullChecks(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory(dir=Path('/tmp').resolve());self.run=Path(self.temp.name).resolve();self.resources=[]
    def tearDown(self):
        for resource in reversed(self.resources):resource.close()
        self.temp.cleanup()
    def test_isolated_cli_accepts_platform_environment_only(self):
        command=[sys.executable,'-I','-B',str(ROOT/'tools/isolated-entry.py'),'full-app','--help']
        result=subprocess.run(command,env={},capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('prepare',result.stdout)
        rejected=subprocess.run(command,env={'CP30_UNAPPROVED_INPUT':'inert'},capture_output=True,text=True,timeout=10)
        self.assertNotEqual(rejected.returncode,0)
        self.assertIn('EMPTY_ENVIRONMENT_REQUIRED',rejected.stderr)
    def service(self):
        for role in ROLES:(self.run/role).mkdir(mode=0o700)
        template={'roles':{r:{'account':'0x'+str(i+1)*40,'profileCaps':{'registrar':'0x'+'9'*40,'maxGas':'10','maxFeePerGas':'2','maxPriorityFeePerGas':'1','maxTransactionCostWei':'20'}} for i,r in enumerate(ROLES)}}
        config={'namespace':'fresh','template':template,'services':{r:{'runtimeDirectory':str(self.run/r)} for r in ROLES}}
        journal=FirstBindingJournal(self.run,word_hash(template),initialize=True);self.resources.append(journal)
        material={'template':{'template_digest':word_hash(template)},'binding':None,'registration':None};ledger=Ledger(material);leaf=FakeSignerLeaf();probes=[]
        def probe(cfg,registration):
            probes.append(registration['id']);binding={r:template['roles'][r]['account'] for r in ROLES};return binding,'0x'+'a'*64,'0x'+'b'*64
        def compose(cfg):return SimpleNamespace(handle=lambda n,m,q,role=None:{'status':'CONFIGURED','role':cfg['role'] if 'role' in cfg else 'fake'}),[]
        service=AutomaticBusiness(config,ledger,journal,probe=probe,compose_host=compose,signer_leaf=leaf)
        return service,ledger,journal,leaf,probes
    def test_fixed_origin_rejects_before_tls_or_socket(self):
        self.assertEqual(validate_origin('https://localhost:19501',19501),'https://localhost:19501')
        for origin,port in [('https://localhost:19502',19501),('http://localhost:19501',19501),('https://other.test:19501',19501),('https://LOCALHOST:19501',19501),('https://localhost:19501/',19501),('https://localhost:19501',0),('https://localhost:19501',True)]:
            with self.assertRaises(ValueError):validate_origin(origin,port)
        from .http import HTTPSService
        app=SimpleNamespace(config={'mode':'CP30_TESTNET_CONNECTION','origin':'https://localhost:19501','httpPort':19501})
        with patch('ssl.SSLContext',side_effect=AssertionError('No TLS key load')):
            with self.assertRaises(ValueError):HTTPSService(app,'unread-cert','unread-key',port=0,origin=None)
    def test_disabled_full_prepare_only_new_empty_slots(self):
        spec=importlib.util.spec_from_file_location('full_setup_checks',ROOT/'tools/full-app.py');source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
        run=self.run/'new';result=source.prepare(run);self.assertEqual(result['status'],'NOT_CONFIGURED')
        plan=source.setup.private_json(run/'full-app.disabled.json');self.assertFalse(plan['enabled']);self.assertFalse(plan['application']['activation']['identity'])
        self.assertFalse((run/'pg').exists());self.assertFalse((run/'binding/first-binding.jsonl').exists())
        for role in ROLES:self.assertEqual((run/role/'authority.key').stat().st_size,0)
    def test_wait_does_not_probe_or_create_per_store_resources(self):
        service,ledger,journal,leaf,probes=self.service();self.assertEqual(service.tick()['state'],'WAIT_VERIFIED_REGISTRATION')
        self.assertEqual((leaf.created,probes,journal.sequence),(0,[],1));self.assertEqual(ledger.calls,['first_binding_material'])
        reply=service.handle('fresh','setup',{},role='operatorAuthority');self.assertEqual(reply['status'],'NOT_CONFIGURED')
    def test_auto_once_and_restart_reuses_original_profiles_and_journals(self):
        service,ledger,journal,leaf,probes=self.service();ledger.material['registration']={'id':'original-registration','record':{'syntheticVerifiedEvidence':'inert'}}
        self.assertEqual(service.tick()['state'],'BOUND');self.assertEqual(leaf.created,3);self.assertEqual(len(probes),1)
        self.assertEqual(service.tick()['state'],'BOUND');self.assertEqual(leaf.created,3)
        service.close();journal.close();self.resources.remove(journal)
        reopened=FirstBindingJournal(self.run,journal.template_digest);self.resources.append(reopened)
        restart=AutomaticBusiness(service.config,ledger,reopened,probe=lambda *_:(_ for _ in ()).throw(AssertionError('No new profile/probe')),compose_host=service.compose_host,signer_leaf=leaf)
        self.assertEqual(restart.tick()['state'],'BOUND');self.assertEqual(leaf.created,3);self.assertEqual(reopened.original['registrationId'],'original-registration')
    def test_missing_created_journal_closed_without_recreation(self):
        service,ledger,journal,leaf,probes=self.service();ledger.material['registration']={'id':'original-registration','record':{'synthetic':'inert'}}
        self.assertEqual(service.tick()['state'],'BOUND');service.close();service.hosts={};(self.run/'operatorAuthority/business-authority-originals.jsonl').unlink()
        self.assertEqual(service.tick()['state'],'CLOSED');self.assertEqual(leaf.created,3)
    def test_create_intent_missing_after_uncertainty_is_never_recreated(self):
        service,ledger,journal,leaf,probes=self.service();profile={'namespace':'fresh'}
        original={'registrationId':'original','registrationRecord':{'synthetic':'inert'},'profiles':[{'role':'operatorAuthority','profile':profile}],'profileDigest':'a'*64,'templateDigest':journal.template_digest}
        journal.append('PREPARED',original);journal.append('CREATE_INTENT',{'role':'operatorAuthority','directory':str(self.run/'operatorAuthority'),'profileDigest':word_hash(profile)})
        with self.assertRaisesRegex(BindingClosed,'JOURNAL'):service._roles(original)
        self.assertEqual(leaf.created,0)
    def test_identity_security_reuses_real_journal_protocol_without_economics(self):
        # Load only class AST; no psycopg dependency/runtime/server construction.
        import copy as copy_module
        tree=ast.parse((ROOT/'src/c1/controller.py').read_text());base=next(x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=='Controller')
        class_names={'IdentityCheckpoint','IdentitySecurityController'};new=[x for x in ast.parse((ROOT/'src/c1/identity_security_controller.py').read_text()).body if isinstance(x,ast.ClassDef) and x.name in class_names]
        scope={'copy':copy_module,'threading':threading,'Quarantined':Quarantined,'BINDINGS':BINDINGS,'_error':lambda code,status=503:{'error':code,'status':status},'ALLOWLIST':{'api':{'query','security'},'verified_identity':{'query','identity_exchange','wallet_binding'}},'API_KINDS':{'logout'},'hit':lambda *_:None}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[base,*new],type_ignores=[])),'security-classes','exec'),scope)
        journal=Journal(self.run/'security.journal','fresh-run','fresh-cluster',initialize=True,empty_cluster=True);self.resources.append(journal);journal.checkpoint('fresh',{'credential':{'global':1},'restore':{'global':1}})
        outer=self
        class DB:
            def __init__(self):self.anchor=journal.snapshot('fresh');self.calls=[];self.reservation=None;self.reference=None;self.proof=None
            def call(self,method,ns,q):
                self.calls.append(method)
                if method=='identity_security_checkpoint':return {'matched':q['sequence']==self.anchor['sequence'] and q['digest']==self.anchor['digest'],'parent':self.anchor['digest'],'height':self.anchor['sequence']}
                if method=='security_reserve':
                    self.reservation={'mutation_id':q['mutation_id'],'kind':q['kind'],'object_id':'opaque-subject','expected_revision':{'identity_revision':0},'command_digest':word_hash(q['command']),'restore_generation':1,'source_epoch':1,'deployment_generation':1,'credential_epoch':1,'authority_checkpoint':self.anchor['digest'],'authority_highwater':self.anchor['sequence'],'floors':q['retained_floors']};return self.reservation
                if method=='security_prepare':self.reference=q;return {'prepared':True}
                if method=='security_apply':self.proof={**self.reservation,**self.reference,'committed':True};return {'authenticated':True}
                if method=='security_proof':return self.proof
                if method=='security_finish':self.anchor={'sequence':q['journal_sequence'],'digest':q['journal_digest']};return {'finished':True,'result':{'authenticated':True}}
                raise AssertionError('Unexpected economic/source method '+method)
        db=DB();controller=scope['IdentitySecurityController'](journal,db,'fresh');controller.startup();self.assertFalse(controller.quarantined)
        result=controller.handle('fresh','identity_exchange',{'mutation_id':'00000000-0000-4000-8000-000000000001','command':{'synthetic_hash_only':'inert'}},role='verified_identity');self.assertTrue(result['authenticated'])
        self.assertIsNone(journal.snapshot('fresh')['pending']);self.assertIn('security_proof',db.calls);self.assertIn('security_finish',db.calls)
        self.assertEqual(controller.handle('fresh','security',{'kind':'lock','mutation_id':'inert','command':{}},role='api')['status'],403)
        self.assertEqual(controller.handle('fresh','fixture',{'operation':'init'},role='fixture')['status'],403)

if __name__=='__main__':unittest.main()
