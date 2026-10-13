"""Bounded offline checks: private files and fake DB/RPC only, no signer worker."""
from copy import deepcopy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from .registrar_signer_journal import OriginalSignerJournal,DedicatedRegistrarSigner,SignerClosed,word_hash
from .runtime_ledger_controller import RuntimeLedgerJournal,RuntimeLedgerController,RuntimeLedgerClosed
from .registration_runtime_host import compose,RegistrationRuntimeHost,ROOT
from .registrar_rpc import RegistrarRpc,RegistrarRpcClosed,validate

def checkpoint():
    return {'ledgerRevision':0,'ledgerHead':'1'*64,'materialHash':'2'*64,'epochs':{'source_epoch':1,'credential_epoch':1,'restore_generation':1},
        'floors':{k:{} for k in ('runtime_attempt','runtime_reservation','runtime_budget','runtime_authorization','runtime_nonce')},'globalFloors':{'runtime_nonce':{}}}
class FakeDB:
    def __init__(self,journals):self.states={ns:deepcopy(j.checkpoint) for ns,j in journals.items()};self.proofs={};self.global_floors={'runtime_nonce':{}};self.calls=[]
    def seal(self,ns,ticket,*,aborted=False,nonce=None):
        cp=ticket['checkpoint'];mutation=ticket['mutation'];p={k:deepcopy(cp[k]) for k in ('materialHash','epochs','floors','globalFloors')}
        if nonce:
            p['floors']['runtime_nonce'][nonce]=1;self.global_floors['runtime_nonce'][nonce]=1
        p.update(namespace=ns,mutation_id=mutation['id'],sequence=mutation['sequence'],digest=mutation['digest'],priorRevision=cp['ledgerRevision'],priorHead=cp['ledgerHead'],ledgerRevision=cp['ledgerRevision']+1,ledgerHead=word_hash(mutation))
        p['globalFloors']=deepcopy(self.global_floors);p['aborted' if aborted else 'committed']=True
        self.proofs[(ns,mutation['id'])]={'ticket':deepcopy(ticket),**deepcopy(p)}
        self.states[ns].update({k:deepcopy(p[k]) for k in ('ledgerRevision','ledgerHead','materialHash','epochs','floors','globalFloors')},pending=mutation['id'])
        return p
    def call(self,method,ns,q):
        self.calls.append((method,ns,deepcopy(q)));state=self.states[ns]
        if method=='ledger_status':return {**deepcopy(state),'globalFloors':deepcopy(self.global_floors),'configured':True,'materialMatches':True,'pending':state.get('pending')}
        if method=='ledger_proof':return deepcopy(self.proofs.get((ns,q['mutation_id']),{'absent':True}))
        if method=='ledger_abort':return self.seal(ns,q['ticket'],aborted=True)
        if method in {'ledger_finish','ledger_abort_finish'}:
            self.assert_proof(ns,q);state.update(journalSequence=q['journal_sequence'],journalDigest=q['journal_digest'],pending=None);return {'finished':True}
        if method=='runtime_clock':return {'updated':True}
        raise AssertionError(method)
    def assert_proof(self,ns,q):
        actual={k:v for k,v in self.proofs[(ns,q['mutation_id'])].items() if k!='ticket'}
        if actual!=q['proof']:raise AssertionError('Wrong independently sealed proof')
class RegistrarChecks(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory(dir=Path('/tmp').resolve());self.directory=Path(self.temp.name).resolve();os.chmod(self.directory,0o700);self.resources=[]
    def tearDown(self):
        for resource in reversed(self.resources):resource.close()
        self.temp.cleanup()
    def journal(self,ns='one'):
        directory=self.directory/ns;directory.mkdir(mode=0o700);j=RuntimeLedgerJournal(directory,ns,initialize=checkpoint());self.resources.append(j);return j
    def test_signing_marker_survives_restart_no_recreation(self):
        j=OriginalSignerJournal(self.directory,initialize=True);record={'synthetic':'original'};self.assertTrue(j.begin('original',record));j.close()
        j=OriginalSignerJournal(self.directory);self.assertFalse(j.begin('original',record));self.assertNotIn('raw',j.lookup('original',record))
        with self.assertRaisesRegex(SignerClosed,'CONFLICT'):j.begin('original',{'other':'record'})
        j.close()
        with self.assertRaises(FileExistsError):OriginalSignerJournal(self.directory,initialize=True)
    def test_retained_original_detached_and_torn_frame_closed(self):
        j=OriginalSignerJournal(self.directory,initialize=True);record={'synthetic':True};j.begin('one',record);j.retain('one',record,'INERT_NOT_A_SIGNED_TRANSACTION','3'*64)
        row=j.lookup('one',record);row['raw']='changed';self.assertEqual(j.lookup('one',record)['raw'],'INERT_NOT_A_SIGNED_TRANSACTION');j.close()
        with (self.directory/'registrar-originals.jsonl').open('ab') as f:f.write(b'{')
        with self.assertRaisesRegex(SignerClosed,'DAMAGED'):OriginalSignerJournal(self.directory)
    def test_missing_and_symlink_journal_closed(self):
        with self.assertRaises(FileNotFoundError):OriginalSignerJournal(self.directory)
        (self.directory/'registrar-originals.jsonl').symlink_to(self.directory/'absent')
        with self.assertRaises(OSError):OriginalSignerJournal(self.directory)
    def test_finish_reads_proof_and_full_ack(self):
        j=self.journal();db=FakeDB({'one':j});controller=RuntimeLedgerController(db,j);ticket=controller.begin('one');proof=db.seal('one',ticket,nonce='nonce')
        ack=controller.finish('one',ticket,proof);self.assertEqual(ack['mutation_id'],ticket['mutation']['id']);self.assertEqual(ack['ledgerHead'],proof['ledgerHead']);self.assertGreater(ack['journalSequence'],ticket['mutation']['sequence'])
        self.assertIn(('ledger_proof','one'),[(method,ns) for method,ns,_ in db.calls]);self.assertEqual(j.checkpoint['globalFloors'],db.global_floors)
        path=j.directory;j.close();self.resources.remove(j);reopened=RuntimeLedgerJournal(path,'one');self.resources.append(reopened);self.assertEqual(reopened.checkpoint['ledgerHead'],proof['ledgerHead'])
    def test_forged_proposed_proof_rejected_before_terminal(self):
        j=self.journal();db=FakeDB({'one':j});controller=RuntimeLedgerController(db,j);ticket=controller.begin('one');proof=db.seal('one',ticket);proof['ledgerHead']='9'*64
        with self.assertRaisesRegex(RuntimeLedgerClosed,'PROOF'):controller.finish('one',ticket,proof)
        self.assertEqual(j.pending,ticket)
    def test_absence_resolve_is_sealed_not_caller_rollback(self):
        j=self.journal();db=FakeDB({'one':j});controller=RuntimeLedgerController(db,j);ticket=controller.begin('one');ack=controller.resolve('one',ticket)
        self.assertTrue(ack['finished']);self.assertEqual(j.terminal['kind'],'ABORTED');self.assertEqual(j.checkpoint['ledgerRevision'],1)
        self.assertIn('ledger_abort',[method for method,_,_ in db.calls])
    def test_foreign_pending_recovered_before_global_compare(self):
        one,two=self.journal('one'),self.journal('two');db=FakeDB({'one':one,'two':two});controller=RuntimeLedgerController(db,{'one':one,'two':two})
        ticket=controller.begin('two');db.seal('two',ticket,nonce='foreign-retained-nonce')
        read=controller.begin('one',read_only=True)
        self.assertEqual(read['checkpoint']['globalFloors'],{'runtime_nonce':{'foreign-retained-nonce':1}});self.assertIsNone(two.pending)
        db.global_floors={'runtime_nonce':{}}
        with self.assertRaisesRegex(RuntimeLedgerClosed,'GLOBAL_NONCE'):controller.begin('one',read_only=True)
    def test_restored_higher_revision_or_epoch_is_not_adopted(self):
        j=self.journal();db=FakeDB({'one':j});controller=RuntimeLedgerController(db,j);db.states['one']['ledgerRevision']=50
        with self.assertRaisesRegex(RuntimeLedgerClosed,'MISMATCH'):controller.begin('one',read_only=True)
        self.assertEqual(j.sequence,1);self.assertEqual(j.checkpoint['ledgerRevision'],0)
    def test_default_host_no_io_or_signer(self):
        with patch('subprocess.run',side_effect=AssertionError('No process')):
            host,resources=compose({'namespace':'one','enabled':False});self.assertEqual(resources,[]);self.assertEqual(host.handle('one','setup',{},role='registrar_client')['status'],'NOT_CONFIGURED')
            self.assertEqual(host.handle('one','registration_send_original',{'record':{}},role='registrar_client')['status'],503)
            self.assertEqual(host.handle('one','setup',{},role='other')['status'],403)
    def test_rpc_scope_defaults_and_budget_fake_only(self):
        settings={'endpoint':'https://rpc.invalid/test','allowedEndpoints':['https://rpc.invalid/test'],'allowedHosts':['rpc.invalid'],'registrar':'0x'+'a'*40,'factory':'0x'+'b'*40,'factorySelectors':['0x12345678'],'maxCalls':1,'maxTotalSeconds':20,'broadcastEnabled':False}
        rpc=RegistrarRpc(settings)
        with self.assertRaises(RegistrarRpcClosed):validate('eth_sendRawTransaction',['0x01'],settings)
        with self.assertRaises(RegistrarRpcClosed):validate('eth_getTransactionCount',['0x'+'c'*40,'pending'],settings)
        with self.assertRaises(RegistrarRpcClosed):validate('eth_call',[{'to':settings['factory'],'data':'0x12345678dead'},{'blockHash':'0x'+'1'*64,'requireCanonical':True}],{**settings,'factorySelectors':[]})
        class Child:
            returncode=0
            def communicate(self,packet,timeout):return b'{"result":"0x279f"}',b''
            def poll(self):return 0
            def wait(self):return 0
        with patch('subprocess.Popen',return_value=Child()) as spawn:
            self.assertEqual(rpc.request('eth_chainId',[]),'0x279f');self.assertEqual(spawn.call_args.kwargs['env'],{})
            with self.assertRaisesRegex(RegistrarRpcClosed,'EXHAUSTED'):rpc.request('eth_chainId',[])
            self.assertEqual(spawn.call_count,1)
    def test_private_config_pin_rejects_edits(self):
        from .private_connection_config import load
        import hashlib
        run=self.directory;raw=b'{"enabled":false}\n'
        def file(name,value):
            path=run/name;path.write_bytes(json.dumps(value).encode());path.chmod(0o600)
        file('CONNECTION-OWNED.json',{'protocol':'CP30_CONNECTION_BOOTSTRAP_V1','owner':os.getuid(),'run':str(run),'id':'fresh'})
        path=run/'registrar.json';path.write_bytes(raw);path.chmod(0o600)
        file('INSTALLED.json',{'id':'fresh','configs':{'registrar.json':hashlib.sha256(raw).hexdigest()}})
        self.assertFalse(load(path)['enabled']);path.write_bytes(b'{"enabled":true}\n')
        with self.assertRaisesRegex(ValueError,'PIN'):load(path)
    def test_dedicated_scope_rejects_before_handle_open(self):
        j=OriginalSignerJournal(self.directory,initialize=True);self.resources.append(j)
        path=self.directory/'registrar.key';path.write_bytes(b'x'*66);path.chmod(0o600)
        registrar,factory='0x'+'a'*40,'0x'+'b'*40
        signer=DedicatedRegistrarSigner(journal=j,key_handle=path,registrar=registrar,crypto=None,factory=factory,chain_id=10143)
        record={'deployment':{'from':registrar,'to':'0x'+'c'*40,'chainId':10143,'value':'0','data':'0xed89c3b2'}}
        with patch('os.open',side_effect=AssertionError('Key may not be opened')):
            with self.assertRaisesRegex(SignerClosed,'SCOPE'):signer.sign_original_transaction(record)
        self.assertEqual(j.sequence,1)
    def test_bootstrap_disabled_prepare_and_fresh_only_no_key_reads(self):
        spec=importlib.util.spec_from_file_location('connection_bootstrap_checks',ROOT/'tools/connection-bootstrap.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        run=self.directory/'fresh';result=module.prepare(run);self.assertEqual(result['status'],'NOT_CONFIGURED');self.assertEqual((run/'registrar/registrar.key').stat().st_size,0)
        with self.assertRaises(ValueError):module.prepare(run)
        with self.assertRaisesRegex(ValueError,'ACTIVATION'):module.validate_plan(module.private_json(run/'plan.disabled.json'),run)
        self.assertFalse((run/'pg').exists());self.assertFalse((run/'ledger/runtime-ledger.jsonl').exists())
if __name__=='__main__':unittest.main()
