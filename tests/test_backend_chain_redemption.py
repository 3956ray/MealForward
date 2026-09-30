"""CP16 actual HTTP and owned Anvil integration; no simulated transaction outcomes."""
import concurrent.futures
from pathlib import Path
import unittest
import threading
from contextlib import contextmanager
from unittest.mock import patch
from eth_account import Account
from eth_account.messages import encode_defunct
from werkzeug.serving import make_server
import tests.test_backend_chain as chain_tests
from server.backend import random_id
from server.local import load_backend, load_worker_keys
from server.outbox import Worker
from server.recovery import backup_bundle, restore_bundle
from server.web import create_app

P=10**15

class RedemptionHttpTests(unittest.TestCase):
    setUpClass=classmethod(chain_tests.BackendChainTests.setUpClass.__func__)
    tearDownClass=classmethod(chain_tests.BackendChainTests.tearDownClass.__func__)
    def setUp(self):
        self.h=chain_tests.BackendChainTests('test_http_end_to_end_and_finality_secrets')
        self.h.rpc_url=self.rpc_url;self.h.fixture_options={'owner_mode':True};self.h.setUp();self.addCleanup(self.h.tearDown)
        self.h.worker=Worker(self.h.backend,load_worker_keys(self.h.config));self.b=self.h.backend
        Account.enable_unaudited_hdwallet_features()
        self.wallet=Account.from_mnemonic('test test test test test test test test test test test junk',account_path="m/44'/60'/0'/0/5")
        self.assertEqual(self.wallet.address,self.b.deployment['merchant'])
    def owner_session(self):
        session=self.h.login('owner-a')
        response=self.h.post(session,'/work/wallet/challenge',{})
        self.assertEqual(response.status_code,200,response.text);challenge=response.json()
        signature=self.wallet.sign_message(encode_defunct(text=challenge['message'])).signature.hex()
        response=self.h.post(session,'/work/wallet/verify',{'challengeId':challenge['challengeId'],'signature':signature})
        self.assertEqual(response.status_code,200,response.text);return session
    def send_settlement(self,owner,result,*,associate=True):
        op=result['operation']['id'];intent=result['intent']
        started=self.h.post(owner,'/work/operations/'+op+'/submission-start',{})
        self.assertEqual(started.status_code,200,started.text);self.assertTrue(started.json()['maySubmit'])
        return self.broadcast_settlement(owner,result,associate=associate)
    def broadcast_settlement(self,owner,result,*,associate=True):
        op=result['operation']['id'];intent=result['intent']
        tx={'from':self.wallet.address,'to':intent['to'],'data':intent['data'],'chainId':31337,'value':0,
            'nonce':self.h.w3.eth.get_transaction_count(self.wallet.address),'gas':250000,'gasPrice':self.h.w3.eth.gas_price}
        signed=self.wallet.sign_transaction(tx)
        tx_hash=self.h.w3.to_hex(self.h.w3.eth.send_raw_transaction(signed.raw_transaction))
        if associate:
            response=self.h.post(owner,'/work/operations/'+op+'/transaction',{'txHash':tx_hash})
            self.assertEqual(response.status_code,200,response.text)
        return self.h.w3.eth.wait_for_transaction_receipt(tx_hash)
    def issue_three(self):
        _,_,funded=self.h.funded();r,_=self.h.issue(funded['intent']['batchId'])
        self.assertEqual(r.status_code,202,r.text);op_id=r.json()['operation']['id']
        self.h.worker.tick();self.h.mine();self.h.worker.tick()
        result=self.h.get(self.h.partner,'/operations/'+op_id).json()
        return funded,[v['id'] for v in result['vouchers']]
    def invitation(self,voucher):
        response=self.h.post(self.h.partner,'/work/vouchers/'+voucher+'/invitation',{'intentKey':random_id()})
        self.assertEqual(response.status_code,200,response.text);return response.json()['secret']
    def recipient(self,secret):
        session=self.h.session();response=self.h.post(session,'/recipient/session',{'secret':secret})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        session.headers['X-CSRF-Token']=response.json()['csrfToken'];return session
    def present(self,session,key=None):
        response=self.h.post(session,'/recipient/presentations',{'intentKey':key or random_id()})
        self.assertEqual(response.status_code,200,response.text);return response.json()
    def lock(self,owner,code,group=None,key=None):
        body={'intentKey':key or random_id(),'code':code}
        if group:body['groupId']=group
        return self.h.post(owner,'/work/locks',body),body
    def final(self):self.h.worker.tick();self.h.mine();self.h.worker.tick()
    def statement(self,owner,redemption):
        r=self.h.post(owner,'/work/redemptions/'+redemption+'/handoff',{'intentKey':random_id()})
        self.assertEqual(r.status_code,200,r.text);return r.json()
    def report(self,owner,redemption):
        r=self.h.post(owner,'/work/redemptions/'+redemption+'/report',{'intentKey':random_id()})
        self.assertEqual(r.status_code,202,r.text);return r.json()['operation']['id']
    @contextmanager
    def http_for(self,backend):
        original=self.h.origin;self.h.origin=f'http://127.0.0.1:{chain_tests.free_port()}'
        server=make_server('127.0.0.1',int(self.h.origin.rsplit(':',1)[1]),create_app(backend,origin=self.h.origin),threaded=True,request_handler=chain_tests.QuietHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:yield
        finally:server.shutdown();server.server_close();thread.join(timeout=5);self.h.origin=original
    def lock_ready(self,owner,voucher):
        session=self.recipient(self.invitation(voucher));code=self.present(session)['code']
        response,_=self.lock(owner,code);self.assertEqual(response.status_code,202,response.text)
        redemption=response.json()['redemptionId'];self.final();return redemption,session
    def test_recipient_http_bootstrap_finality_privacy_and_revocation(self):
        _,_,funded=self.h.funded();r,_=self.h.issue(funded['intent']['batchId'])
        voucher=self.b.store.one('SELECT id FROM private_vouchers ORDER BY rowid LIMIT 1')['id']
        path='/work/vouchers/'+voucher+'/invitation'
        self.assertEqual(self.h.post(self.h.partner,path,{'intentKey':random_id()}).status_code,409)
        self.final();secret=self.invitation(voucher)
        anonymous=self.h.session();anonymous.headers.pop('Origin')
        self.assertEqual(self.h.post(anonymous,'/recipient/session',{'secret':secret}).status_code,403)
        session=self.recipient(secret)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM presentation_codes')['n'],0)
        self.assertNotIn('code',self.h.get(session,'/recipient/voucher').json())
        key=random_id();shown=self.present(session,key)
        self.assertEqual(self.present(session,key),shown)
        self.assertEqual(len(shown['code']),8)
        session.headers.pop('X-CSRF-Token')
        self.assertEqual(self.h.post(session,'/recipient/presentations',{'intentKey':random_id()}).status_code,403)
        replacement=self.recipient(secret)
        old=self.h.get(session,'/recipient/voucher');self.assertEqual(old.status_code,401);self.assertNotIn('Set-Cookie',old.headers)
        self.assertEqual(self.h.get(replacement,'/recipient/voucher').status_code,200)
        self.assertEqual(self.b.store.one('SELECT active FROM presentation_codes')['active'],0)
        owner=self.owner_session()
        self.assertEqual(self.h.post(owner,path,{'intentKey':random_id()}).status_code,403)
        visible=self.h.get(self.h.partner,'/work/vouchers').text+self.h.get(replacement,'/recipient/voucher').text+self.h.get(replacement,'/config').text
        for private in (secret,shown['code'],'REF-A','secret_cipher','token_hash'):self.assertNotIn(private,visible)
    def test_real_http_three_vouchers_finish_s_h_r(self):
        funded,vouchers=self.issue_three();a,b,c=vouchers
        secrets={v:self.invitation(v) for v in vouchers}
        for v,result in ((a,'sent'),(b,'sent'),(c,'failed')):
            response=self.h.post(self.h.partner,'/work/vouchers/'+v+'/deliveries',{'intentKey':random_id(),'channel':'private_message','result':result})
            self.assertEqual(response.status_code,201,response.text)
        recipient_a=self.recipient(secrets[a]);recipient_b=self.recipient(secrets[b])
        code_a=self.present(recipient_a)['code'];code_b=self.present(recipient_b)['code']
        owner=self.owner_session()
        response=self.h.post(owner,'/work/groups',{'intentKey':random_id()});self.assertEqual(response.status_code,201,response.text)
        group=response.json()['group']['id']
        for code in (code_a,code_b):
            self.assertEqual(self.h.post(owner,'/work/prechecks',{'code':code}).status_code,200)
            response=self.h.post(owner,'/work/groups/'+group+'/items',{'intentKey':random_id(),'code':code})
            self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],0)
        group_text=self.h.get(owner,'/work/groups/'+group).text
        self.assertIn(a,group_text);self.assertIn(b,group_text);self.assertNotIn(c,group_text)
        for value in (*secrets.values(),code_a,code_b,'REF-A'):self.assertNotIn(value,group_text)
        lock_a,body=self.lock(owner,code_a,group);self.assertEqual(lock_a.status_code,202,lock_a.text)
        ra=lock_a.json()['redemptionId'];lock_op=lock_a.json()['operation']['id']
        self.assertEqual(self.h.post(owner,'/work/locks',body).json()['operation']['id'],lock_op)
        self.assertEqual(self.h.post(owner,'/work/redemptions/'+ra+'/handoff',{'intentKey':random_id()}).status_code,409)
        self.final();self.statement(owner,ra);self.report(owner,ra)
        self.assertEqual(self.h.post(owner,'/work/payables/'+ra+'/settle',{'intentKey':random_id()}).status_code,409)
        self.final()
        before=self.h.w3.eth.get_balance(self.h.config['deployment']['merchant'])
        settled=self.h.post(owner,'/work/payables/'+ra+'/settle',{'intentKey':random_id()})
        self.assertEqual(settled.status_code,201,settled.text)
        receipt=self.send_settlement(owner,settled.json());self.final()
        gas=receipt['gasUsed']*receipt['effectiveGasPrice']
        self.assertEqual(self.h.w3.eth.get_balance(self.h.config['deployment']['merchant'])-before,P-gas)
        self.assertEqual(self.h.w3.eth.get_transaction(receipt['transactionHash'])['from'],self.wallet.address)
        self.assertIsNone(self.b.store.one('SELECT * FROM outbox WHERE operation_id=?',(settled.json()['operation']['id'],)))
        lock_b,_=self.lock(owner,code_b,group);self.assertEqual(lock_b.status_code,202,lock_b.text)
        rb=lock_b.json()['redemptionId'];self.final();self.statement(owner,rb);report_b=self.report(owner,rb)
        original=self.h.rpc.broadcast_same_raw
        def lost(raw):original(raw);raise TimeoutError('Lost real report response')
        with patch.object(self.h.rpc,'broadcast_same_raw',lost):self.h.worker.tick()
        self.assertEqual(self.h.op(report_b)['status'],'SUBMISSION_UNKNOWN')
        mid=self.h.get(owner,'/batches/'+funded['intent']['batchId']).json()['batch']
        self.assertEqual((mid['R'],mid['H'],mid['S']),(str(2*P),'0',str(P)))
        self.assertEqual(self.h.post(owner,'/work/redemptions/'+rb+'/report',{'intentKey':random_id()}).status_code,409)
        self.h.mine();self.h.worker.tick()
        ledger=self.h.get(owner,'/batches/'+funded['intent']['batchId']).json()['batch']
        self.assertEqual(ledger,{'F':str(3*P),'A':'0','R':str(P),'H':str(P),'S':str(P),'X':'0','L':'0'})
        self.assertEqual(self.h.op(report_b)['status'],'FINALIZED_SUCCESS')
        self.assertEqual(self.b.store.one('SELECT status FROM public_vouchers WHERE id=?',(c,))['status'],1)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM processing_items')['n'],2)
        self.assertEqual(self.h.post(self.h.partner,'/work/vouchers/'+a+'/invitation',{'intentKey':random_id()}).status_code,409)
        self.assertEqual(self.h.post(recipient_a,'/recipient/presentations',{'intentKey':random_id()}).status_code,409)
    def test_expiry_rotation_and_two_owner_sessions_atomic_lock_race(self):
        _,vouchers=self.issue_three();secret=self.invitation(vouchers[0]);recipient=self.recipient(secret)
        old=self.present(recipient);now=self.b.now();self.b.clock=lambda:now+121
        owner_a=self.owner_session();owner_b=self.owner_session()
        self.assertEqual(self.lock(owner_a,old['code'])[0].status_code,404)
        current=self.present(recipient)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda owner:self.lock(owner,current['code'])[0],(owner_a,owner_b)))
        self.assertEqual(sum(r.status_code==202 for r in results),1,[r.text for r in results])
        self.assertTrue(all(r.status_code in (202,404,409) for r in results))
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],1)
        self.assertEqual(self.b.store.one("SELECT count(*) AS n FROM operations WHERE kind='lock'")['n'],1)
        self.final()
        events=[e for e in self.h.rpc.events(self.h.config['deployment']['deploymentBlock'],'latest') if e['eventName']=='Locked']
        self.assertEqual(len(events),1)
    def test_chain_pause_old_report_and_restore_quarantine_are_distinct(self):
        _,vouchers=self.issue_three();owner=self.owner_session()
        group_key=random_id()
        self.assertEqual(self.h.post(owner,'/work/groups',{'intentKey':group_key}).status_code,201)
        redemption,session=self.lock_ready(owner,vouchers[0])
        other=self.recipient(self.invitation(vouchers[1]));other_code=self.present(other)['code']
        admin={'from':self.h.w3.eth.accounts[0]}
        self.h.w3.eth.wait_for_transaction_receipt(self.h.rpc.contract.functions.setPaused(True).transact(admin))
        self.assertEqual(self.lock(owner,other_code)[0].status_code,409)
        self.statement(owner,redemption);report=self.report(owner,redemption)
        bundle=backup_bundle(self.h.config,Path(self.h.tmp.name)/'report-backup')
        config=restore_bundle(bundle,Path(self.h.tmp.name)/'report-restore');restored=load_backend(config)
        recovery=Worker(restored,load_worker_keys(config));recovery.tick()
        self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(report,))['status'],'SUBMISSION_UNKNOWN')
        self.assertIsNone(restored.store.one('SELECT raw_cipher FROM outbox WHERE operation_id=?',(report,))['raw_cipher'])
        self.final();recovery.tick()
        self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(report,))['status'],'FINALIZED_SUCCESS')
        self.assertTrue(restored.quarantined())
        self.assertEqual(self.h.post(owner,'/work/payables/'+redemption+'/settle',{'intentKey':random_id()}).status_code,409)
        original_report=self.h.op(report)['intent_key']
        original_handoff=restored.store.one('SELECT intent_key FROM handoff_statements WHERE redemption_id=?',(redemption,))['intent_key']
        operation_count=restored.store.one('SELECT count(*) AS n FROM operations')['n']
        outbox_count=restored.store.one('SELECT count(*) AS n FROM outbox')['n']
        nonce=self.h.w3.eth.get_transaction_count(self.b.signers['operator'])
        with self.http_for(restored):
            self.assertEqual(self.h.get(owner,'/work/redemptions/'+redemption).status_code,401)
            restored_owner=self.h.login('owner-a')
            self.assertEqual(self.h.get(restored_owner,'/work/redemptions/'+redemption).status_code,200)
            for path,body,who in [('/work/groups',{'intentKey':random_id()},restored_owner),
                                  ('/work/groups',{'intentKey':group_key},restored_owner),
                                  ('/work/prechecks',{'code':other_code},restored_owner),
                                  ('/work/locks',{'intentKey':random_id(),'code':other_code},restored_owner),
                                  ('/work/redemptions/'+redemption+'/handoff',{'intentKey':random_id()},restored_owner),
                                  ('/work/redemptions/'+redemption+'/handoff',{'intentKey':original_handoff},restored_owner),
                                  ('/work/redemptions/'+redemption+'/report',{'intentKey':random_id()},restored_owner),
                                  ('/work/redemptions/'+redemption+'/report',{'intentKey':original_report},restored_owner),
                                  ('/work/payables/'+redemption+'/settle',{'intentKey':random_id()},restored_owner),
                                  ('/work/operations/'+random_id()+'/submission-start',{},restored_owner),
                                  ('/work/wallet/challenge',{},restored_owner)]:
                r=self.h.post(who,path,body);self.assertEqual(r.status_code,503,r.text)
                self.assertEqual(r.json()['code'],'RESTORE_QUARANTINED')
            self.assertIn(self.h.get(session,'/recipient/voucher').status_code,(401,503))
            self.assertEqual(restored.store.one('SELECT count(*) AS n FROM recipient_sessions WHERE revoked=0')['n'],0)
            self.assertEqual(restored.store.one('SELECT count(*) AS n FROM presentation_codes WHERE active=1')['n'],0)
        self.assertEqual(restored.store.one('SELECT count(*) AS n FROM operations')['n'],operation_count)
        self.assertEqual(restored.store.one('SELECT count(*) AS n FROM outbox')['n'],outbox_count)
        self.assertEqual(self.h.w3.eth.get_transaction_count(self.b.signers['operator']),nonce)
    def test_finalized_report_and_payment_reverts_require_explicit_new_intent(self):
        _,vouchers=self.issue_three();owner=self.owner_session()
        redemption,_=self.lock_ready(owner,vouchers[0]);self.statement(owner,redemption)
        report=self.report(owner,redemption)
        def stop(phase):
            if phase=='after_sign':raise RuntimeError('Signed original boundary')
        keys=load_worker_keys(self.h.config)
        with self.assertRaises(RuntimeError):Worker(self.b,keys,stop).tick()
        contract=self.h.rpc.contract;admin={'from':self.h.w3.eth.accounts[0]}
        role=contract.functions.OPERATOR_ROLE().call();operator=self.b.signers['operator']
        self.h.w3.eth.wait_for_transaction_receipt(contract.functions.revokeRole(role,operator).transact(admin))
        self.h.worker.tick();self.h.worker.tick();self.assertEqual(self.h.op(report)['status'],'INCLUDED_REVERT')
        self.assertEqual(self.b.store.one('SELECT H FROM batches')['H'],0)
        self.h.mine();self.h.worker.tick();self.assertEqual(self.h.op(report)['status'],'FINALIZED_REVERT')
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM handoff_statements')['n'],1)
        self.h.w3.eth.wait_for_transaction_receipt(contract.functions.grantRole(role,operator).transact(admin))
        report2=self.report(owner,redemption);self.assertNotEqual(report,report2);self.final()
        r=self.h.post(owner,'/work/payables/'+redemption+'/settle',{'intentKey':random_id()})
        self.assertEqual(r.status_code,201,r.text);settle=r.json()['operation']['id']
        # Owned Anvil fault only: insufficient contract ETH forces the actual native payment to revert.
        contract_balance=self.h.w3.eth.get_balance(contract.address)
        self.h.w3.provider.make_request('anvil_setBalance',[contract.address,'0x0'])
        self.send_settlement(owner,r.json());self.h.worker.tick()
        self.assertEqual(self.h.op(settle)['status'],'INCLUDED_REVERT')
        self.assertEqual(self.b.store.one('SELECT H,S FROM batches'),{'H':P,'S':0})
        self.h.mine();self.h.worker.tick();self.assertEqual(self.h.op(settle)['status'],'FINALIZED_REVERT')
        self.assertEqual(self.b.store.one('SELECT H,S FROM batches'),{'H':P,'S':0})
        self.h.w3.provider.make_request('anvil_setBalance',[contract.address,hex(contract_balance)])
        retry=self.h.post(owner,'/work/payables/'+redemption+'/settle',{'intentKey':random_id()})
        self.assertEqual(retry.status_code,201,retry.text)
        self.send_settlement(owner,retry.json());self.final()
        self.assertEqual(self.h.op(retry.json()['operation']['id'])['status'],'FINALIZED_SUCCESS')
    def test_owner_work_requires_current_wallet_proof_and_shop(self):
        _,vouchers=self.issue_three();owner=self.h.login('owner-a')
        recipient=self.recipient(self.invitation(vouchers[0]));code=self.present(recipient)['code']
        self.assertEqual(self.lock(owner,code)[0].status_code,403)
        owner=self.owner_session()
        redemption,_=self.lock_ready(owner,vouchers[1])
        self.assertEqual(self.h.post(owner,'/work/wallet/logout',{}).status_code,204)
        self.assertEqual(self.h.post(owner,'/work/redemptions/'+redemption+'/handoff',{'intentKey':random_id()}).status_code,403)
        owner=self.owner_session();self.statement(owner,redemption);self.report(owner,redemption);self.final()
        self.b.store.execute("UPDATE users SET shop_id='shop-other' WHERE id='owner-a'")
        self.assertEqual(self.h.get(owner,'/work/redemptions/'+redemption).status_code,403)
        self.assertEqual(self.h.post(owner,'/work/redemptions/'+redemption+'/report',{'intentKey':random_id()}).status_code,403)
        self.assertEqual(self.h.post(owner,'/work/payables/'+redemption+'/settle',{'intentKey':random_id()}).status_code,403)
    def test_lock_lost_response_keeps_original_claim_and_recovers(self):
        _,vouchers=self.issue_three();owner=self.owner_session()
        recipient=self.recipient(self.invitation(vouchers[0]));code=self.present(recipient)['code']
        response,body=self.lock(owner,code);self.assertEqual(response.status_code,202,response.text)
        op_id=response.json()['operation']['id'];redemption=response.json()['redemptionId']
        send=self.h.rpc.broadcast_same_raw
        def lost(raw):send(raw);raise TimeoutError('Lost original lock response')
        with patch.object(self.h.rpc,'broadcast_same_raw',lost):self.h.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],1)
        self.assertEqual(self.h.post(owner,'/work/locks',body).json()['operation']['id'],op_id)
        self.assertNotEqual(self.lock(owner,code)[0].status_code,202)
        self.assertEqual(self.h.post(owner,'/work/redemptions/'+redemption+'/handoff',{'intentKey':random_id()}).status_code,409)
        self.h.mine();self.h.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'],'FINALIZED_SUCCESS')
        self.assertEqual(self.b.store.one('SELECT broadcast_count FROM outbox WHERE operation_id=?',(op_id,))['broadcast_count'],1)
    def test_external_settle_lost_hash_restores_by_original_evidence_without_owner_key(self):
        _,vouchers=self.issue_three();owner=self.owner_session()
        redemption,_=self.lock_ready(owner,vouchers[0]);self.statement(owner,redemption);self.report(owner,redemption);self.final()
        response=self.h.post(owner,'/work/payables/'+redemption+'/settle',{'intentKey':random_id()})
        self.assertEqual(response.status_code,201,response.text);result=response.json();op_id=result['operation']['id']
        started=self.h.post(owner,'/work/operations/'+op_id+'/submission-start',{})
        self.assertTrue(started.json()['maySubmit'])
        bundle=backup_bundle(self.h.config,Path(self.h.tmp.name)/'external-backup')
        config=restore_bundle(bundle,Path(self.h.tmp.name)/'external-restore');restored=load_backend(config)
        recovery=Worker(restored,load_worker_keys(config))
        self.assertEqual(set(load_worker_keys(config)),{'issuer','operator'})
        recovery.tick();self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(op_id,))['status'],'SUBMISSION_UNKNOWN')
        # Original browser/test driver already received the one send permit before this snapshot.
        self.broadcast_settlement(owner,result,associate=False)
        recovery.tick()
        self.assertEqual(restored.store.one('SELECT H,S FROM batches'),{'H':P,'S':0})
        self.h.mine();recovery.tick()
        self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(op_id,))['status'],'FINALIZED_SUCCESS')
        self.assertEqual(restored.store.one('SELECT H,S FROM batches'),{'H':0,'S':P})
        self.assertTrue(restored.quarantined())
        self.assertIsNone(restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,)))
        with self.http_for(restored):
            reader=self.h.login('owner-a')
            original=self.h.get(reader,'/operations/'+op_id)
            self.assertEqual(original.status_code,200,original.text)
            self.assertEqual(original.json()['operation']['status'],'FINALIZED_SUCCESS')
            self.assertEqual(self.h.post(reader,'/work/operations/'+op_id+'/submission-start',{}).status_code,503)

if __name__=='__main__':unittest.main()
