"""CP15 integration: actual HTTP + actual isolated Anvil; no simulated ledger/auth."""
import concurrent.futures
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import requests
from werkzeug.serving import make_server, WSGIRequestHandler
from server.local import fixture, load_backend
from server.recovery import backup_bundle, restore_bundle
from server.outbox import Worker
from server.projection import Projector
from server.web import create_app
from server.backend import random_id
from server.chain.client import ChainConflict, ChainUnavailable, PRICE, RULE, hx

ROOT=Path(__file__).resolve().parents[1]
class QuietHandler(WSGIRequestHandler):
    def log(self, *args, **kwargs): pass

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); return sock.getsockname()[1]

class BackendChainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rpc_port=free_port()
        cls.node=subprocess.Popen([str(ROOT/'node_modules/.bin/anvil'),'--host','127.0.0.1','--port',str(cls.rpc_port),'--chain-id','31337','--silent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.rpc_url=f'http://127.0.0.1:{cls.rpc_port}'
        for _ in range(100):
            if cls.node.poll() is not None: raise RuntimeError('Owned Anvil failed')
            try:
                response=requests.post(cls.rpc_url,json={'jsonrpc':'2.0','id':1,'method':'eth_chainId','params':[]},timeout=.2)
                if response.json().get('result')=='0x7a69': break
            except requests.RequestException: time.sleep(.05)
        else: cls.node.terminate(); raise RuntimeError('Anvil not ready')
    @classmethod
    def tearDownClass(cls):
        cls.node.terminate(); cls.node.wait(timeout=10)
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='cp15-backend-')
        self.origin=f'http://127.0.0.1:{free_port()}'
        self.config=fixture(Path(self.tmp.name)/'fixture',self.rpc_url,self.origin)
        self.backend=load_backend(self.config)
        self.rpc=self.backend.rpc; self.w3=self.rpc.w3
        self.worker=Worker(self.backend,Path(self.config['issuerKeyFile']).read_bytes())
        self.app=create_app(self.backend,origin=self.origin)
        self.http=make_server('127.0.0.1',int(self.origin.rsplit(':',1)[1]),self.app,threaded=True,request_handler=QuietHandler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.partner=self.login('partner-a')
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join(timeout=5);self.tmp.cleanup()
    def session(self):
        s=requests.Session();s.headers['Origin']=self.origin; return s
    def post(self,session,path,body): return session.post(self.origin+'/api/v1'+path,json=body,timeout=10)
    def get(self,session,path): return session.get(self.origin+'/api/v1'+path,timeout=10)
    def login(self,name):
        s=self.session(); r=self.post(s,'/auth/login',{'username':name,'password':'local-only-password'})
        self.assertEqual(r.status_code,200,r.text);s.headers['X-CSRF-Token']=r.json()['csrfToken']; return s
    def prepare(self,n=3,key=None,session=None):
        s=session or self.session();self.assertEqual(self.post(s,'/support-session',{}).status_code,200)
        body={'clientRequestId':key or random_id(),'account':self.config['deployment']['supporter'],'chainId':31337,'quantity':n,'ruleVersion':RULE,'walletKind':'local-test'}
        r=self.post(s,'/support-intents',body);self.assertEqual(r.status_code,201,r.text)
        return s,body,r.json()
    def fund(self,result):
        i=result['intent'];tx=self.w3.eth.send_transaction({'from':i['account'],'to':i['to'],'data':i['data'],'value':int(i['valueWei'])})
        return self.w3.eth.wait_for_transaction_receipt(tx)
    def mine(self): self.w3.provider.make_request('anvil_mine',['0x80'])
    def funded(self,n=3):
        s,body,result=self.prepare(n);self.fund(result);self.mine();self.worker.tick();return s,body,result
    def issue(self,batch,n=3,key=None,session=None):
        body={'intentKey':key or random_id(),'recipientRef':'REF-A','batchId':batch,'quantity':n,'quotePriceWei':str(PRICE),'ruleVersion':RULE}
        return self.post(session or self.partner,'/work/issuances',body),body
    def op(self,op_id): return self.backend.store.one('SELECT * FROM operations WHERE id=?',(op_id,))
    def test_http_end_to_end_and_finality_secrets(self):
        supporter,body,result=self.prepare();self.fund(result);self.worker.tick()
        seen=self.get(supporter,'/support-intents/'+result['operation']['id']).json()
        self.assertEqual(seen['operation']['status'],'INCLUDED_SUCCESS')
        r,_=self.issue(result['intent']['batchId']);self.assertEqual(r.status_code,409)
        self.mine();self.worker.tick()
        r,request_body=self.issue(result['intent']['batchId']);self.assertEqual(r.status_code,202,r.text)
        op_id=r.json()['operation']['id'];self.assertEqual(r.json()['vouchers'],[])
        self.worker.tick(); self.worker.tick()
        observed=self.get(self.partner,'/operations/'+op_id).json()
        self.assertEqual(observed['operation']['status'],'INCLUDED_SUCCESS');self.assertEqual(observed['vouchers'],[])
        self.mine(); self.worker.tick()
        confirmed=self.get(self.partner,'/operations/'+op_id).json()
        self.assertEqual(confirmed['operation']['status'],'FINALIZED_SUCCESS');self.assertEqual(len(confirmed['vouchers']),3)
        batch=self.get(supporter,'/batches/'+result['intent']['batchId']).json()['batch']
        self.assertEqual(batch,{'F':str(3*PRICE),'A':'0','R':str(3*PRICE),'H':'0','S':'0','X':'0','L':'0'})
        self.assertEqual(self.post(self.partner,'/work/issuances',request_body).json()['operation']['id'],op_id)
        recovered=self.get(self.partner,'/work/issuances/by-intent/'+request_body['intentKey'])
        self.assertEqual(recovered.json()['operation']['id'],op_id)
        self.assertEqual(self.post(self.partner,'/work/issuances',{**request_body,'quantity':2}).status_code,409)
        public=self.get(supporter,'/config').text + self.get(supporter,'/batches/'+result['intent']['batchId']).text
        for forbidden in ('REF-A','secret','raw_cipher','password','csrf','support_cap'): self.assertNotIn(forbidden,public)
        for v in self.backend.store.all('SELECT * FROM private_vouchers'):
            secret=self.backend.decrypt(v['secret_cipher'])
            self.assertNotIn(secret,json.dumps(confirmed));self.assertNotIn(secret,v['secret_cipher'])
        self.assertNotIn('outcome',public)
    def test_capability_binding_expiry_and_public_only_recovery(self):
        a,body,result=self.prepare()
        same=self.post(a,'/support-intents',body);self.assertEqual(same.json()['operation']['id'],result['operation']['id'])
        changed={**body,'quantity':2};self.assertEqual(self.post(a,'/support-intents',changed).status_code,409)
        other,_,other_result=self.prepare(1)
        self.assertEqual(self.get(other,'/support-intents/'+result['operation']['id']).status_code,403)
        self.assertEqual(self.get(self.partner,'/support-intents/'+result['operation']['id']).status_code,401)
        self.assertEqual(self.get(a,'/operations/'+result['operation']['id']).status_code,401)
        self.fund(result);self.mine();self.worker.tick()
        self.backend.store.execute('UPDATE support_caps SET expires_at=0 WHERE operation_id=?',(result['operation']['id'],))
        self.assertEqual(self.get(a,'/support-intents/'+result['operation']['id']).status_code,401)
        i=result['intent'];r=self.get(a,'/public/fund-status?payer='+i['account']+'&intent='+i['intentId'])
        self.assertEqual(r.status_code,200);self.assertEqual(r.json()['batchId'],i['batchId']);self.assertNotIn('operation',r.json())
        self.assertEqual(self.op(result['operation']['id'])['status'],'FINALIZED_SUCCESS')
    def test_concurrent_qualification_and_budget_reservations(self):
        _,_,funded=self.funded(3);bid=funded['intent']['batchId']
        def request_issue(index): return self.issue(bid,2,key='parallel-'+str(index),session=self.login('partner-a'))[0].status_code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: codes=list(pool.map(request_issue,[1,2]))
        self.assertEqual(sorted(codes),[202,409])
        q=self.backend.store.one("SELECT * FROM qualifications WHERE partner_id='partner-a'")
        self.assertEqual((q['reserved'],q['used']),(2,0))
        # A different partner has separate quota but cannot reserve the same batch's remaining funds twice.
        other=self.login('partner-b');r,_=self.issue(bid,2,session=other);self.assertEqual(r.status_code,409)
    def test_scope_logout_csrf_and_no_fake_routes(self):
        _,_,funded=self.funded();r,body=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        other=self.login('partner-b');self.assertEqual(self.get(other,'/operations/'+op_id).status_code,403)
        self.partner.headers.pop('X-CSRF-Token');self.assertEqual(self.post(self.partner,'/work/issuances',body).status_code,403)
        session=self.get(self.partner,'/auth/session').json();self.partner.headers['X-CSRF-Token']=session['csrfToken']
        self.assertEqual(self.post(self.partner,'/auth/logout',{}).status_code,204)
        self.assertEqual(self.get(self.partner,'/operations/'+op_id).status_code,401)
        anonymous=self.session()
        for path in ('/session','/reset','/work/locks','/work/payables/x/settle'):
            self.assertEqual(self.post(anonymous,path,{'actor':'partner','outcome':'success'}).status_code,404)
    def test_disable_and_reenable_revokes_unvisited_sessions(self):
        second=self.login('partner-a')
        self.backend.store.set_user_enabled('partner-a',False)
        self.backend.store.set_user_enabled('partner-a',True)
        for old in (self.partner,second):
            self.assertEqual(self.get(old,'/auth/session').status_code,401)
        self.assertEqual(self.get(self.login('partner-a'),'/auth/session').status_code,200)
    def test_backup_restore_replays_same_signed_operation(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        def stop(phase):
            if phase=='after_sign': raise RuntimeError('Signed backup boundary')
        with self.assertRaises(RuntimeError): Worker(self.backend,Path(self.config['issuerKeyFile']).read_bytes(),stop).tick()
        saved=self.backend.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        backup_path=Path(self.tmp.name)/'backup.sqlite3'
        source=self.backend.store.connect();backup=sqlite3.connect(backup_path)
        source.backup(backup);source.close();backup.close()
        self.worker.tick();self.mine();self.worker.tick()
        restored=load_backend({**self.config,'databasePath':str(backup_path)})
        replay=Worker(restored,Path(self.config['issuerKeyFile']).read_bytes());replay.tick()
        row=restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.assertEqual((row['nonce'],row['tx_hash'],row['state']),(saved['nonce'],saved['tx_hash'],'DONE'))
        q=restored.store.one("SELECT reserved,used FROM qualifications WHERE partner_id='partner-a'")
        self.assertEqual((q['reserved'],q['used']),(0,3))
        self.assertEqual(restored.store.one('SELECT count(*) AS n FROM private_vouchers WHERE confirmed=1')['n'],3)
        self.assertEqual(row['broadcast_count'],0) # Recovered from chain without a second submission.
    def test_backup_older_than_acceptance_halts_for_private_recovery(self):
        _,_,funded=self.funded()
        backup_path=Path(self.tmp.name)/'old-backup.sqlite3'
        source=self.backend.store.connect();backup=sqlite3.connect(backup_path)
        source.backup(backup);source.close();backup.close()
        r,_=self.issue(funded['intent']['batchId']);self.worker.tick();self.mine();self.worker.tick()
        restored=load_backend({**self.config,'databasePath':str(backup_path)})
        with self.assertRaises(ChainConflict): Projector(restored).sync()
        self.assertTrue(restored.store.one("SELECT value FROM metadata WHERE key='halted'")['value'])
    def test_controlled_restore_after_dropped_transaction_stays_quarantined(self):
        supporter,body,funded=self.funded();r,issue_body=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        bundle=Path(self.tmp.name)/'controlled-backup';target=Path(self.tmp.name)/'controlled-restore'
        for args in (['backup','--directory',str(Path(self.tmp.name)/'fixture'),'--destination',str(bundle)],
                     ['restore','--backup',str(bundle),'--directory',str(target)]):
            proc=subprocess.run([sys.executable,'-m','server.local',*args],cwd=ROOT,capture_output=True,timeout=20)
            self.assertEqual(proc.returncode,0,proc.stderr.decode())
        self.w3.provider.make_request('evm_setAutomine',[False])
        try:
            self.worker.tick()
            old=self.backend.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
            self.assertEqual(self.w3.provider.make_request('anvil_dropTransaction',[old['tx_hash']])['result'],old['tx_hash'])
            self.w3.provider.make_request('anvil_setNextBlockBaseFeePerGas',[hex(10**9)])
            self.w3.provider.make_request('anvil_mine',['0x1'])
            restored_config=json.loads((target/'config.json').read_text());restored=load_backend(restored_config)
            for _ in range(2):
                worker=Worker(restored,Path(restored_config['issuerKeyFile']).read_bytes())
                with patch.object(worker.account,'sign_transaction',side_effect=AssertionError('Must never sign in restore')): worker.tick()
                restored=load_backend(restored_config) # Quarantine survives process-equivalent reopen.
            row=restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
            self.assertIsNone(row['raw_cipher']);self.assertIsNone(row['nonce']);self.assertIsNone(row['tx_hash'])
            self.assertEqual(row['broadcast_count'],0)
            self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(op_id,))['status'],'SUBMISSION_UNKNOWN')
            self.assertEqual(restored.store.one('SELECT state FROM reservations WHERE operation_id=?',(op_id,))['state'],'PENDING')
            q=restored.store.one("SELECT reserved,used FROM qualifications WHERE partner_id='partner-a'")
            self.assertEqual((q['reserved'],q['used']),(3,0))
            self.assertEqual(self.w3.eth.get_transaction_count(self.config['deployment']['issuer'],'pending'),old['nonce'])
        finally: self.w3.provider.make_request('evm_setAutomine',[True])
        origin=f'http://127.0.0.1:{free_port()}'
        server=make_server('127.0.0.1',int(origin.rsplit(':',1)[1]),create_app(restored,origin=origin),threaded=True,request_handler=QuietHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            session=requests.Session();session.headers['Origin']=origin
            stale=requests.Session();stale.cookies.update(self.partner.cookies)
            self.assertEqual(stale.get(origin+'/api/v1/operations/'+op_id,timeout=10).status_code,401)
            self.assertEqual(self.get(self.partner,'/auth/session').status_code,200) # Backup did not revoke the live source session.
            self.assertEqual(session.get(origin+'/api/v1/support-intents/'+funded['operation']['id'],timeout=10).status_code,401)
            login=session.post(origin+'/api/v1/auth/login',json={'username':'partner-a','password':'local-only-password'},timeout=10)
            self.assertEqual(login.status_code,200);session.headers['X-CSRF-Token']=login.json()['csrfToken']
            config=session.get(origin+'/api/v1/config',timeout=10).json()
            self.assertEqual(config['capabilities'],[]);self.assertEqual(config['recovery']['state'],'RESTORE_QUARANTINE')
            self.assertFalse(session.get(origin+'/healthz',timeout=10).json()['recovery']['writeAvailable'])
            for request_body in (issue_body,{**issue_body,'intentKey':random_id()}):
                response=session.post(origin+'/api/v1/work/issuances',json=request_body,timeout=10)
                self.assertEqual(response.status_code,503);self.assertEqual(response.json()['code'],'RESTORE_QUARANTINED')
            read=session.get(origin+'/api/v1/operations/'+op_id,timeout=10)
            self.assertEqual(read.status_code,200);self.assertEqual(read.json()['operation']['recovery']['policy'],'READ_ORIGINAL_ONLY')
            response=session.post(origin+'/api/v1/support-session',json={},timeout=10)
            self.assertEqual(response.status_code,503)
            session.cookies.update(supporter.cookies)
            response=session.post(origin+'/api/v1/support-intents',json=body,timeout=10)
            self.assertEqual(response.status_code,503)
            self.assertEqual(session.get(origin+'/api/v1/support-intents/'+funded['operation']['id'],timeout=10).status_code,401)
            self.assertEqual(session.post(origin+'/api/v1/support-session',json={},timeout=10).status_code,503)
            public=session.get(origin+'/api/v1/public/fund-status',params={'payer':funded['intent']['account'],'intent':funded['intent']['intentId']},timeout=10)
            self.assertEqual(public.status_code,200);self.assertEqual(public.json()['batchId'],funded['intent']['batchId'])
            self.assertNotIn('operation',public.json());self.assertNotIn('request',public.json())
            other=requests.Session();other.headers['Origin']=origin
            self.assertEqual(other.post(origin+'/api/v1/auth/login',json={'username':'partner-b','password':'local-only-password'},timeout=10).status_code,200)
            self.assertEqual(other.get(origin+'/api/v1/operations/'+op_id,timeout=10).status_code,403)
        finally: server.shutdown();server.server_close();thread.join(timeout=5)
    def test_controlled_signed_restore_replays_only_original_raw(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        def stop(phase):
            if phase=='after_sign': raise RuntimeError('Signed backup')
        with self.assertRaises(RuntimeError): Worker(self.backend,Path(self.config['issuerKeyFile']).read_bytes(),stop).tick()
        original=self.backend.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        bundle=backup_bundle(self.config,Path(self.tmp.name)/'signed-bundle')
        config=restore_bundle(bundle,Path(self.tmp.name)/'signed-restore');restored=load_backend(config)
        for key in ('databasePath','secretKeyFile','issuerKeyFile'):
            self.assertEqual(Path(config[key]).stat().st_mode & 0o777,0o600)
        worker=Worker(restored,Path(config['issuerKeyFile']).read_bytes())
        with patch.object(worker.account,'sign_transaction',side_effect=AssertionError('Must reuse raw')):worker.tick()
        row=restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.assertEqual((row['nonce'],row['tx_hash'],row['raw_cipher']),(original['nonce'],original['tx_hash'],original['raw_cipher']))
        self.mine();worker.tick()
        self.assertEqual(restored.store.one("SELECT used FROM qualifications WHERE partner_id='partner-a'")['used'],3)
        self.assertTrue(restored.quarantined()) # Success never unlocks new business/signing.
    def test_restore_rejects_raw_nonce_binding_conflict_before_broadcast(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        def stop(phase):
            if phase=='after_sign': raise RuntimeError('Signed backup')
        with self.assertRaises(RuntimeError): Worker(self.backend,Path(self.config['issuerKeyFile']).read_bytes(),stop).tick()
        bundle=backup_bundle(self.config,Path(self.tmp.name)/'raw-bundle')
        config=restore_bundle(bundle,Path(self.tmp.name)/'raw-restore');restored=load_backend(config)
        restored.store.execute('UPDATE outbox SET nonce=nonce+1 WHERE operation_id=?',(op_id,))
        worker=Worker(restored,Path(config['issuerKeyFile']).read_bytes())
        with self.assertRaises(ChainConflict): worker.tick()
        self.assertEqual(restored.store.one('SELECT broadcast_count FROM outbox WHERE operation_id=?',(op_id,))['broadcast_count'],0)
        self.assertEqual(restored.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],3)
    def test_backup_rejects_tamper_and_existing_restore_directory(self):
        bundle=backup_bundle(self.config,Path(self.tmp.name)/'bundle')
        with self.assertRaises(FileExistsError): restore_bundle(bundle,Path(self.tmp.name)/'fixture')
        (bundle/'issuer.key').write_bytes(b'corrupt')
        destination=Path(self.tmp.name)/'rejected'
        with self.assertRaises(ValueError): restore_bundle(bundle,destination)
        self.assertFalse(destination.exists())
    def test_hard_process_crash_boundaries_keep_same_raw_and_nonce(self):
        # Actually terminate three subprocesses at durable boundaries, then reopen DB/worker.
        for phase in ('before_sign','after_sign','after_broadcast'):
            with self.subTest(phase=phase):
                self.backend.store.execute("UPDATE qualifications SET quota=quota+1 WHERE partner_id='partner-a'")
                _,_,funded=self.funded(1);r,_=self.issue(funded['intent']['batchId'],1)
                self.assertEqual(r.status_code,202,r.text);op_id=r.json()['operation']['id']
                code="""import json,os,sys
from pathlib import Path
from server.local import load_backend
from server.outbox import Worker
c=json.loads(Path(sys.argv[1]).read_text())
def crash(p):
 if p==sys.argv[2]: os._exit(71)
Worker(load_backend(c),Path(c['issuerKeyFile']).read_bytes(),crash).tick()
"""
                proc=subprocess.run([sys.executable,'-c',code,str(Path(self.tmp.name)/'fixture/config.json'),phase],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
                self.assertEqual(proc.returncode,71,proc.stderr.decode())
                before=self.backend.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
                self.assertIsNotNone(before['nonce'])
                fresh=load_backend(self.config);self.assertFalse(fresh.quarantined())
                worker=Worker(fresh,Path(self.config['issuerKeyFile']).read_bytes());worker.tick();self.mine();worker.tick()
                after=self.backend.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
                self.assertEqual(after['nonce'],before['nonce']);self.assertEqual(after['state'],'DONE')
                if before['tx_hash']:self.assertEqual(before['tx_hash'],after['tx_hash'])
                self.assertEqual(len(self.get(self.partner,'/operations/'+op_id).json()['vouchers']),1)
                issued=[e for e in self.rpc.events(int(self.config['deployment']['deploymentBlock']),'latest') if e['eventName']=='Issued' and e['args']['operationId']==op_id]
                self.assertEqual(len(issued),1)
    def test_broadcast_response_loss_and_rpc_outage_hold_reservation(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        original=self.rpc.broadcast_same_raw
        def send_then_lose(raw): original(raw);raise TimeoutError('Injected lost response')
        with patch.object(self.rpc,'broadcast_same_raw',send_then_lose): self.worker.tick()
        self.assertEqual(self.op(op_id)['status'],'SUBMISSION_UNKNOWN')
        q=self.backend.store.one("SELECT * FROM qualifications WHERE partner_id='partner-a'");self.assertEqual(q['reserved'],3)
        with patch.object(self.rpc,'guard',side_effect=TimeoutError('RPC unavailable')):
            with self.assertRaises(TimeoutError): self.worker.tick()
        self.assertEqual(self.op(op_id)['status'],'SUBMISSION_UNKNOWN')
        self.mine();self.worker.tick();self.assertEqual(self.op(op_id)['status'],'FINALIZED_SUCCESS')
        with patch.object(self.rpc,'guard',side_effect=TimeoutError()):
            with self.assertRaises(TimeoutError):self.worker.tick()
        self.assertEqual(self.op(op_id)['status'],'FINALIZED_SUCCESS')
    def test_finalized_revert_releases_reservation_only_after_confirmation(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        def stop(phase):
            if phase=='after_sign':raise RuntimeError('Before broadcast')
        with self.assertRaises(RuntimeError):Worker(self.backend,Path(self.config['issuerKeyFile']).read_bytes(),stop).tick()
        # Revoke issuer AFTER signing; raw transaction is still broadcast unchanged and genuinely reverts.
        role=self.rpc.contract.functions.ISSUER_ROLE().call()
        self.w3.eth.wait_for_transaction_receipt(self.rpc.contract.functions.revokeRole(role,self.config['deployment']['issuer']).transact({'from':self.w3.eth.accounts[0]}))
        self.worker.tick();self.worker.tick();self.assertEqual(self.op(op_id)['status'],'INCLUDED_REVERT')
        self.assertEqual(self.backend.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],3)
        self.mine();self.worker.tick();self.assertEqual(self.op(op_id)['status'],'FINALIZED_REVERT')
        self.assertEqual(self.backend.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],0)
        self.assertEqual(self.get(self.partner,'/operations/'+op_id).json()['vouchers'],[])
    def test_unsigned_preflight_rejection_preserves_original_reservation(self):
        _,_,funded=self.funded();r,body=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        def stop(phase):
            if phase=='before_sign': raise RuntimeError('Unsigned crash')
        with self.assertRaises(RuntimeError): Worker(self.backend,Path(self.config['issuerKeyFile']).read_bytes(),stop).tick()
        original=self.backend.store.one('SELECT nonce FROM outbox WHERE operation_id=?',(op_id,))['nonce']
        role=self.rpc.contract.functions.ISSUER_ROLE().call()
        admin={'from':self.w3.eth.accounts[0]}
        self.w3.eth.wait_for_transaction_receipt(self.rpc.contract.functions.revokeRole(role,self.config['deployment']['issuer']).transact(admin))
        self.worker.tick();self.assertEqual(self.op(op_id)['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.backend.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],3)
        self.assertEqual(self.backend.store.one('SELECT state FROM reservations WHERE operation_id=?',(op_id,))['state'],'PENDING')
        self.w3.eth.wait_for_transaction_receipt(self.rpc.contract.functions.grantRole(role,self.config['deployment']['issuer']).transact(admin))
        self.worker.tick()
        self.assertEqual(self.backend.store.one('SELECT nonce FROM outbox WHERE operation_id=?',(op_id,))['nonce'],original)
        self.mine();self.worker.tick();self.assertEqual(self.op(op_id)['status'],'FINALIZED_SUCCESS')
    def test_queued_backup_recovers_included_issuance_without_releasing_quota(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        backup_path=Path(self.tmp.name)/'queued-backup.sqlite3'
        source=self.backend.store.connect();backup=sqlite3.connect(backup_path)
        source.backup(backup);source.close();backup.close()
        self.worker.tick();self.worker.tick();self.assertEqual(self.op(op_id)['status'],'INCLUDED_SUCCESS')
        original=self.backend.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        restored=load_backend({**self.config,'databasePath':str(backup_path)})
        replay=Worker(restored,Path(self.config['issuerKeyFile']).read_bytes());replay.tick()
        op=restored.store.one('SELECT * FROM operations WHERE id=?',(op_id,))
        self.assertEqual((op['status'],op['tx_hash']),('INCLUDED_SUCCESS',original['tx_hash']))
        self.assertEqual(restored.store.one('SELECT state FROM reservations WHERE operation_id=?',(op_id,))['state'],'PENDING')
        q=restored.store.one("SELECT reserved,used FROM qualifications WHERE partner_id='partner-a'")
        self.assertEqual((q['reserved'],q['used']),(3,0))
        self.mine();replay.tick()
        self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(op_id,))['status'],'FINALIZED_SUCCESS')
        q=restored.store.one("SELECT reserved,used FROM qualifications WHERE partner_id='partner-a'")
        self.assertEqual((q['reserved'],q['used']),(0,3))
        row=restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.assertEqual((row['nonce'],row['tx_hash'],row['broadcast_count']),(original['nonce'],original['tx_hash'],0))
    def test_queued_backup_pending_nonce_never_signs_a_replacement(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        backup_path=Path(self.tmp.name)/'pending-backup.sqlite3'
        source=self.backend.store.connect();backup=sqlite3.connect(backup_path)
        source.backup(backup);source.close();backup.close()
        self.w3.provider.make_request('evm_setAutomine',[False])
        try:
            self.worker.tick()
            restored=load_backend({**self.config,'databasePath':str(backup_path)})
            replay=Worker(restored,Path(self.config['issuerKeyFile']).read_bytes());replay.tick()
            op=restored.store.one('SELECT * FROM operations WHERE id=?',(op_id,))
            self.assertEqual((op['status'],op['error_code']),('SUBMISSION_UNKNOWN','SIGNER_NONCE_UNRESOLVED'))
            row=restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
            self.assertIsNone(row['raw_cipher']);self.assertEqual(row['broadcast_count'],0)
            self.assertEqual(restored.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],3)
        finally: self.w3.provider.make_request('evm_setAutomine',[True])
        self.mine();replay.tick()
        self.assertEqual(restored.store.one("SELECT used FROM qualifications WHERE partner_id='partner-a'")['used'],3)
    def test_changed_partner_scope_rejects_idempotent_post_and_reads(self):
        _,_,funded=self.funded();r,body=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        self.worker.tick();self.mine();self.worker.tick()
        self.backend.store.execute("UPDATE users SET partner_id='partner-b' WHERE id='partner-a'")
        for response in (self.get(self.partner,'/operations/'+op_id),self.get(self.partner,'/work/issuances/by-intent/'+body['intentKey']),self.post(self.partner,'/work/issuances',body)):
            self.assertEqual(response.status_code,403,response.text)
            self.assertNotIn('vouchers',response.json());self.assertNotIn('request',response.json())
    def test_released_reservation_cannot_silently_finalize_success(self):
        _,_,funded=self.funded();r,_=self.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        self.worker.tick()
        # Model an old database carrying the reviewer's already-corrupted state.
        self.backend.store.execute("UPDATE reservations SET state='RELEASED' WHERE operation_id=?",(op_id,))
        self.backend.store.execute("UPDATE qualifications SET reserved=0 WHERE partner_id='partner-a'")
        self.mine()
        with self.assertRaises(ChainConflict): self.worker.tick()
        self.assertNotEqual(self.op(op_id)['status'],'FINALIZED_SUCCESS')
        self.assertTrue(self.backend.store.one("SELECT value FROM metadata WHERE key='halted'")['value'])
    def test_receipt_payload_mismatch_is_rejected_before_projection(self):
        _,_,funded=self.prepare();self.fund(funded);self.mine()
        original=self.rpc.events
        def corrupted(*args):
            events=original(*args)
            for event in events:
                if event['eventName']=='Funded': event['args']['amount']+=PRICE
            return events
        with patch.object(self.rpc,'events',side_effect=corrupted):
            with self.assertRaises(ChainConflict): self.worker.tick()
        self.assertEqual(self.backend.store.one('SELECT count(*) AS n FROM batches')['n'],0)
        self.assertEqual(self.op(funded['operation']['id'])['status'],'PREPARED')
    def test_two_batches_duplicate_event_feed_and_restart(self):
        _,_,a=self.funded(3);_,_,b=self.funded(2)
        r,_=self.issue(a['intent']['batchId']);self.worker.tick();self.mine();self.worker.tick()
        original=self.rpc.events
        with patch.object(self.rpc,'events',side_effect=lambda *args:original(*args)*2):self.worker.tick()
        fresh=load_backend(self.config);Projector(fresh).sync()
        batch_a=self.get(self.partner,'/batches/'+a['intent']['batchId']).json()['batch']
        batch_b=self.get(self.partner,'/batches/'+b['intent']['batchId']).json()['batch']
        self.assertEqual((batch_a['A'],batch_a['R']),('0',str(3*PRICE)))
        self.assertEqual((batch_b['A'],batch_b['R']),(str(2*PRICE),'0'))
        self.assertEqual(self.backend.store.one("SELECT used FROM qualifications WHERE partner_id='partner-a'")['used'],3)
    def test_pause_and_prefinalized_reorg(self):
        s,body,result=self.prepare()
        snapshot=self.w3.provider.make_request('evm_snapshot',[])['result']
        self.fund(result);self.worker.tick();self.assertEqual(self.op(result['operation']['id'])['status'],'INCLUDED_SUCCESS')
        self.w3.provider.make_request('evm_revert',[snapshot])
        with self.assertRaises(ChainUnavailable): self.worker.tick()
        self.assertEqual(self.op(result['operation']['id'])['status'],'INCLUDED_SUCCESS')
        self.w3.provider.make_request('anvil_mine',['0x1']);self.worker.tick()
        self.assertEqual(self.op(result['operation']['id'])['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.get(s,'/batches/'+result['intent']['batchId']).status_code,404)
        # Continue same original intent, under explicit local test control, not worker auto repayment.
        self.fund(result);self.mine();self.worker.tick()
        self.w3.eth.wait_for_transaction_receipt(self.rpc.contract.functions.setPaused(True).transact({'from':self.w3.eth.accounts[0]}))
        r,_=self.issue(result['intent']['batchId']);self.assertEqual(r.status_code,409)
        self.assertEqual(r.json()['code'],'PAUSED')
    def test_finalized_checkpoint_conflict_halts_new_writes(self):
        _,_,funded=self.funded()
        self.backend.store.execute("UPDATE checkpoints SET block_hash=? WHERE block_number=(SELECT max(block_number) FROM checkpoints)",('0x'+'0'*64,))
        with self.assertRaises(ChainConflict): self.worker.tick()
        self.assertEqual(self.op(funded['operation']['id'])['status'],'FINALIZED_SUCCESS')
        r,_=self.issue(funded['intent']['batchId']);self.assertEqual(r.status_code,503)
        self.assertTrue(self.backend.store.one("SELECT value FROM metadata WHERE key='halted'")['value'])
    def test_worker_lease_and_foreign_database_binding(self):
        with self.worker.lease():
            with self.assertRaises(RuntimeError): self.worker.tick()
        foreign=json.loads(json.dumps(self.config));foreign['deployment']['deploymentId']='different-instance'
        with self.assertRaises(ValueError):load_backend(foreign)

if __name__=='__main__':unittest.main()
