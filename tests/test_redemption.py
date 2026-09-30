"""Real SQLite/Backend/WorkCore + ABI encoding, simulated finalized projection.
No HTTP, signer/worker, RPC or chain finality integration is claimed by these tests.
"""
import concurrent.futures
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from cryptography.fernet import Fernet
from web3 import Web3
from server.backend import Backend, random_id
from server.contracts import AuthContext, ApiError
from server.redemption import RedemptionService
from server.storage import Store


class LegacyRedemptionTests(unittest.TestCase):
    """Historical staff/settler compatibility only; never owner authorization."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cp16-redemption-')
        self.addCleanup(self.tmp.cleanup)
        self.time = 10000
        store = Store(Path(self.tmp.name) / 'backend.sqlite3')
        abi = json.loads((Path(__file__).resolve().parents[1] / 'shared/MealForward.abi.json').read_text())
        contract = Web3().eth.contract(address='0x' + '1' * 40, abi=abi)
        self.b = Backend(store, SimpleNamespace(contract=contract, deployment={'deploymentId': 'isolated-unit', 'merchant':'0x'+'5'*40}),
                         Fernet.generate_key(), '0x' + '2' * 40, lambda: self.time,
                         signers=({'operator': '0x' + '3' * 40} if getattr(self,'OWNER',False) else {'operator': '0x' + '3' * 40, 'settler': '0x' + '4' * 40}),
                         owner_mode=getattr(self,'OWNER',False))
        self.s = RedemptionService(self.b)
        for actor, role, shop in [('staff-a','staff','shop-local'),('staff-b','staff','shop-local'),
                                  ('settler-a','settler','shop-local'),('settler-b','settler','shop-local'),
                                  ('staff-other','staff','shop-other')]:
            store.create_user(actor, actor, 'unused-unit-hash', role, shop_id=shop)
        self.a, self.other, self.settler = self.actor('staff-a'), self.actor('staff-b'), self.actor('settler-a')
        if getattr(self,'OWNER',False):
            store.create_user('owner-a','owner-a','unused-unit-hash','owner',shop_id='shop-local')
            self.a=self.actor('owner-a'); self.settler=self.a
            store.create_session(self.a.session_id,self.a.actor_id,'unused-csrf',self.time,self.time+3600)
            with store.transaction() as db:
                db.execute('INSERT INTO owner_wallet_bindings VALUES(?,?,?,?,1)',('owner-a','shop-local','isolated-unit',self.b.deployment['merchant']))
                db.execute('INSERT INTO owner_wallet_sessions VALUES(?,?,?,?,?,0)',(self.a.session_id,self.a.actor_id,self.b.deployment['merchant'],self.time,self.time+1800))
            # Offline module tests: proof/finality are explicit persisted fixtures;
            # actual chain permission RPC and challenge signatures are main integration.
            permission=patch.object(self.b.owner_wallet,'chain_permission',return_value=None)
            permission.start();self.addCleanup(permission.stop)
        self.vouchers = []
        self.codes = ['00123456', '00123457', '00123458']
        self.issue_id = random_id()
        with store.transaction() as db:
            db.execute("INSERT INTO operations(id,kind,actor_id,partner_id,intent_key,request_json,payload_hash,status,created_at,updated_at,finalized_block) VALUES(?,'issue','partner','partner','issue','{}','hash','FINALIZED_SUCCESS',1,1,1)", (self.issue_id,))
            for i, code in enumerate(self.codes):
                vid = random_id(); self.vouchers.append(vid)
                db.execute('INSERT INTO private_vouchers(id,operation_id,batch_id,secret_hash,secret_cipher,confirmed) VALUES(?,?,?,?,?,1)', (vid,self.issue_id,'batch','hash',self.b.encrypt('NEVER_EXPOSE_SECRET')))
                db.execute('INSERT INTO public_vouchers(id,batch_id,status) VALUES(?,?,1)', (vid,'batch'))
                db.execute('INSERT INTO recipient_sessions(token_hash,session_id,voucher_id,csrf_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
                           (f'session{i}',f'id{i}',vid,'csrf',self.time,self.time+1800,self.time))
                db.execute('INSERT INTO recipient_heads(voucher_id,session_hash) VALUES(?,?)', (vid,f'session{i}'))
                db.execute('INSERT INTO presentation_codes(id,voucher_id,session_hash,intent_key,code_hash,code_cipher,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
                           (f'code{i}',vid,f'session{i}','show',self.b.work.code_hash(code),self.b.encrypt(code),self.time,self.time+120))

    def actor(self, name):
        user = self.b.store.get_user(name)
        return AuthContext(user['id'],user['role'],user['partner_id'],user['shop_id'],name+'-session' if getattr(self,'OWNER',False) else 'unit-session')

    def error(self, status, function, *args):
        with self.assertRaises(ApiError) as caught:
            function(*args)
        self.assertEqual(caught.exception.status, status)
        return caught.exception

    def accept_lock(self, n=0, actor=None, key=None):
        return self.s.lock(actor or self.a, {'intentKey': key or f'lock{n}', 'code':self.codes[n]}, '127.0.0.1')

    def finalized(self, result, kind, *, status='FINALIZED_SUCCESS'):
        """Simulate main projector only; this does NOT verify a real receipt/chain."""
        rid, oid = result['redemptionId'], result['operation']['id']
        with self.b.store.transaction() as db:
            db.execute('UPDATE operations SET status=?,finalized_block=10,receipt_block=9,receipt_hash=?,tx_hash=? WHERE id=?', (status,'0xreceipt','0xtx',oid))
            row = db.execute('SELECT * FROM redemptions WHERE id=?',(rid,)).fetchone()
            state = {'lock':'LOCKED','report':'REPORTED','settle':'SETTLED'}[kind]
            if status == 'FINALIZED_SUCCESS':
                db.execute('UPDATE redemptions SET state=? WHERE id=?',(state,rid))
                db.execute('UPDATE public_vouchers SET status=?,lock_id=? WHERE id=?', ({'lock':2,'report':3,'settle':4}[kind],row['lock_id'],row['voucher_id']))
            else:
                db.execute('UPDATE redemptions SET state=? WHERE id=?',({'lock':'LOCK_FAILED','report':'HANDED_OFF','settle':'REPORTED'}[kind],rid))
                if kind == 'lock':
                    db.execute('DELETE FROM voucher_claims WHERE redemption_id=?',(rid,))

    def handed_off(self, n=0):
        lock = self.accept_lock(n); self.finalized(lock,'lock')
        self.s.handoff(self.a, lock['redemptionId'], {'intentKey':f'hand{n}'})
        return lock['redemptionId']

    def reported(self, n=0):
        rid = self.handed_off(n)
        report = self.s.report(self.a,rid,{'intentKey':f'report{n}'})
        self.finalized(report,'report')
        return rid

    def test_groups_only_presented_vouchers_no_consumption_no_siblings_or_secrets(self):
        g = self.s.create_group(self.a,{'intentKey':'group'})['group']['id']
        self.assertEqual(g,self.s.create_group(self.a,{'intentKey':'group'})['group']['id'])
        for n in (0,1):
            self.s.precheck(self.a,{'code':self.codes[n]},'ip')
            self.s.add(self.a,g,{'intentKey':f'add{n}','code':self.codes[n]},'ip')
        value = self.s.group(self.a,g)
        self.assertEqual([v['voucherId'] for v in value['group']['items']],self.vouchers[:2])
        self.assertEqual({v['status'] for v in value['group']['items']},{'needs_code'})
        self.assertNotIn(self.vouchers[2],json.dumps(value))
        for prohibited in [*self.codes,'secret','recipient_ref','batch','operation_id']:
            self.assertNotIn(prohibited,json.dumps(value))
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],0)
        self.assertEqual(self.b.store.one('SELECT sum(active) AS n FROM presentation_codes')['n'],3)
        second = self.s.create_group(self.a,{'intentKey':'second'})['group']['id']
        self.error(409,self.s.add,self.a,second,{'intentKey':'different','code':self.codes[0]},'ip')
        self.error(403,self.s.group,self.other,g)
        self.error(409,self.s.add,self.a,g,{'intentKey':'add0','code':self.codes[1]},'ip')
        self.s.add(self.a,g,{'intentKey':'add0','code':self.codes[0]},'ip')
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM processing_item_requests')['n'],2)
        self.error(409,self.accept_lock,0)
        lock = self.s.lock(self.a,{'intentKey':'group-lock','code':self.codes[0],'groupId':g},'ip')
        self.assertEqual(self.s.group(self.a,g)['group']['items'][0]['redemptionId'],lock['redemptionId'])

    def test_consumption_enqueue_failure_rollback_and_original_retry(self):
        real = self.b.work.enqueue
        def fail(*args,**kwargs):
            real(*args,**kwargs)
            raise RuntimeError('after enqueue, before claim')
        with patch.object(self.b.work,'enqueue',side_effect=fail):
            with self.assertRaises(RuntimeError): self.accept_lock()
        self.assertEqual(self.b.store.one("SELECT active FROM presentation_codes WHERE id='code0'")['active'],1)
        self.assertEqual(self.b.store.one("SELECT count(*) AS n FROM operations WHERE kind='lock'")['n'],0)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM outbox')['n'],0)
        lock = self.accept_lock()
        self.assertEqual(self.b.store.one("SELECT active,code_cipher FROM presentation_codes WHERE id='code0'"),{'active':0,'code_cipher':None})
        self.time += 130
        same = self.s.lock(self.a,{'intentKey':'lock0','code':self.codes[0],'groupId':None},'ip')
        self.assertEqual(lock,same)
        snapshot = self.b.store.one('SELECT request_json FROM operations WHERE id=?',(lock['operation']['id'],))['request_json']
        self.assertNotIn(self.codes[0],snapshot)
        self.error(409,self.s.lock,self.a,{'intentKey':'lock0','code':self.codes[1]},'ip')
        self.assertEqual(self.s.operation(self.a,kind='lock',key='lock0'),lock)
        self.error(403,self.s.operation,self.other,lock['operation']['id'])

    def test_concurrent_staff_single_claim(self):
        def attempt(actor):
            try: return self.accept_lock(actor=actor)
            except ApiError: return None
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            values=list(pool.map(attempt,[self.a,self.other]))
        self.assertEqual(sum(x is not None for x in values),1)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],1)
        self.assertEqual(self.b.store.one("SELECT count(*) AS n FROM operations WHERE kind='lock'")['n'],1)

    def test_finalized_predecessors_and_partial_three_voucher_lifecycle(self):
        lock = self.accept_lock(); rid=lock['redemptionId']
        self.error(409,self.s.handoff,self.a,rid,{'intentKey':'h'})
        self.b.store.execute("UPDATE redemptions SET state='LOCKED' WHERE id=?",(rid,))
        self.error(409,self.s.handoff,self.a,rid,{'intentKey':'h'})
        self.finalized(lock,'lock')
        self.error(409,self.s.report,self.a,rid,{'intentKey':'r'})
        first=self.s.handoff(self.a,rid,{'intentKey':'h'})
        self.assertEqual(first,self.s.handoff(self.a,rid,{'intentKey':'another-h'}))
        report=self.s.report(self.a,rid,{'intentKey':'r'})
        self.error(409,self.s.settle,self.settler,rid,{'intentKey':'s'})
        self.assertEqual(self.b.store.one('SELECT status FROM public_vouchers WHERE id=?',(self.vouchers[0],))['status'],2)
        self.assertEqual(self.s.report(self.a,rid,{'intentKey':'r'}),report)
        self.finalized(report,'report')
        settle=self.s.settle(self.settler,rid,{'intentKey':'s'})
        self.assertEqual(self.b.store.one('SELECT status FROM public_vouchers WHERE id=?',(self.vouchers[0],))['status'],3)
        self.error(409,self.s.settle,self.actor('settler-b'),rid,{'intentKey':'other-s'})
        self.finalized(settle,'settle')
        second=self.reported(1)
        self.assertEqual([v['status'] for v in self.b.store.all('SELECT status FROM public_vouchers ORDER BY rowid')],[4,3,1])
        payables=self.s.payables(self.settler)['payables']
        self.assertEqual({v['id'] for v in payables},{rid,second})
        self.assertNotIn('group',json.dumps(payables))
        self.assertNotIn('secret',json.dumps(payables))
        self.assertEqual(self.s.settle(self.settler,rid,{'intentKey':'s'})['operation']['status'],'FINALIZED_SUCCESS')

    def test_staff_scope_revocation_and_actor_role_change_cannot_self_settle(self):
        rid=self.reported()
        self.error(403,self.s.get,self.other,rid)
        self.error(403,self.s.handoff,self.other,rid,{'intentKey':'steal'})
        self.b.store.execute("UPDATE users SET role='settler' WHERE id='staff-a'")
        changed=self.actor('staff-a')
        self.error(403,self.s.settle,changed,rid,{'intentKey':'self'})
        self.error(403,self.s.get,self.a,rid)
        self.b.store.execute("UPDATE users SET role='staff',shop_id='shop-other' WHERE id='staff-a'")
        self.error(403,self.s.operation,self.a,None,'lock','lock0')
        self.error(403,self.s.get,self.actor('staff-a'),rid)
        self.b.store.set_user_enabled('staff-b',False)
        self.error(401,self.s.precheck,self.other,{'code':self.codes[1]},'ip')

    def test_pause_old_lock_exception_restore_blocks_every_write(self):
        lock=self.accept_lock();self.finalized(lock,'lock');rid=lock['redemptionId']
        self.b.store.execute("UPDATE metadata SET value='1' WHERE key='paused'")
        self.error(409,self.accept_lock,1)
        self.s.handoff(self.a,rid,{'intentKey':'h'})
        report=self.s.report(self.a,rid,{'intentKey':'r'});self.finalized(report,'report')
        self.error(409,self.s.settle,self.settler,rid,{'intentKey':'s'})
        self.b.store.execute("UPDATE metadata SET value='QUARANTINED' WHERE key='recovery_state'")
        for function,args in [
            (self.s.handoff,(self.a,rid,{'intentKey':'h'})),
            (self.s.report,(self.a,rid,{'intentKey':'r'})),
            (self.s.settle,(self.settler,rid,{'intentKey':'s'})),
            (self.s.create_group,(self.a,{'intentKey':'g'})),
            (self.s.precheck,(self.a,{'code':self.codes[1]},'ip')),
            (self.s.lock,(self.a,{'intentKey':'lock0','code':self.codes[0]},'ip'))]:
            self.error(503,function,*args)
        self.assertEqual(self.s.operation(self.a,report['operation']['id'])['operation']['status'],'FINALIZED_SUCCESS')

    def test_shared_failed_code_throttle_is_durable_and_does_not_leak_inputs(self):
        gid=self.s.create_group(self.a,{'intentKey':'group'})['group']['id']
        calls=[lambda:self.s.precheck(self.a,{'code':'99999999'},'source'),
               lambda:self.s.add(self.a,gid,{'intentKey':'add','code':'99999999'},'source'),
               lambda:self.s.lock(self.a,{'intentKey':'lock','code':'99999999'},'source')]
        for n in range(5): self.error(404,calls[n%3])
        fresh=RedemptionService(self.b)
        self.error(429,fresh.precheck,self.a,{'code':self.codes[0]},'different-ip')
        records=json.dumps(self.b.store.all('SELECT * FROM auth_failures'))
        self.assertNotIn('99999999',records)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM auth_failures')['n'],10)
        self.time+=61
        self.assertEqual(fresh.precheck(self.a,{'code':self.codes[0]},'source')['voucherId'],self.vouchers[0])

    def test_shared_ip_limit_across_accounts(self):
        for n in range(6):
            name=f'extra{n}'
            self.b.store.create_user(name,name,'unused','staff',shop_id='shop-local')
            for _ in range(5): self.error(404,self.s.precheck,self.actor(name),{'code':'99999999'},'shared-ip')
        self.error(429,self.s.precheck,self.a,{'code':self.codes[0]},'shared-ip')
        self.s.precheck(self.a,{'code':self.codes[0]},'separate-ip')

    def test_expired_rotated_revoked_unfinalized_codes_uniformly_unavailable(self):
        self.time+=121
        self.error(404,self.s.precheck,self.a,{'code':self.codes[0]},'ip')
        self.time-=121
        self.b.store.execute("UPDATE recipient_sessions SET revoked=1 WHERE token_hash='session0'")
        self.error(404,self.s.precheck,self.a,{'code':self.codes[0]},'ip')
        self.b.store.execute("UPDATE presentation_codes SET active=0 WHERE id='code1'")
        self.error(404,self.s.precheck,self.a,{'code':self.codes[1]},'ip')
        self.b.store.execute("UPDATE operations SET status='INCLUDED_SUCCESS' WHERE id=?",(self.issue_id,))
        self.error(404,self.s.precheck,self.a,{'code':self.codes[2]},'ip')

    def test_explicit_retry_after_finalized_revert_preserves_handoff(self):
        rid=self.handed_off()
        report=self.s.report(self.a,rid,{'intentKey':'r'})
        self.b.store.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN' WHERE id=?",(report['operation']['id'],))
        self.error(409,self.s.report,self.a,rid,{'intentKey':'r2'})
        self.finalized(report,'report',status='FINALIZED_REVERT')
        new=self.s.report(self.a,rid,{'intentKey':'r2'})
        self.assertNotEqual(new['operation']['id'],report['operation']['id'])
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM handoff_statements')['n'],1)
        self.finalized(new,'report')
        settle=self.s.settle(self.settler,rid,{'intentKey':'s'})
        self.finalized(settle,'settle',status='FINALIZED_REVERT')
        self.assertEqual(self.b.store.one('SELECT status FROM public_vouchers WHERE id=?',(self.vouchers[0],))['status'],3)
        self.s.settle(self.settler,rid,{'intentKey':'s2'})

    def test_finalized_failed_lock_requires_fresh_code_and_new_intent(self):
        old=self.accept_lock()
        self.finalized(old,'lock',status='FINALIZED_REVERT')
        self.error(404,self.s.lock,self.a,{'intentKey':'retry','code':self.codes[0]},'ip')
        new_code='00765432'
        with self.b.store.transaction() as db:
            db.execute('INSERT INTO presentation_codes(id,voucher_id,session_hash,intent_key,code_hash,code_cipher,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
                       ('retry-code',self.vouchers[0],'session0','fresh-show',self.b.work.code_hash(new_code),self.b.encrypt(new_code),self.time,self.time+120))
        new=self.s.lock(self.a,{'intentKey':'retry','code':new_code},'ip')
        self.assertNotEqual(new['redemptionId'],old['redemptionId'])
        self.assertEqual(self.b.store.one("SELECT count(*) AS n FROM operations WHERE kind='lock'")['n'],2)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],1)
        self.assertEqual(self.b.store.one("SELECT active FROM presentation_codes WHERE id='code0'")['active'],0)

    def test_failure_after_claim_rolls_back_whole_acceptance(self):
        with patch.object(self.s,'_op_result',side_effect=RuntimeError('response construction failed')):
            with self.assertRaises(RuntimeError): self.accept_lock()
        for table in ('outbox','redemptions','voucher_claims','work_audit'):
            self.assertEqual(self.b.store.one(f'SELECT count(*) AS n FROM {table}')['n'],0)
        self.assertEqual(self.b.store.one("SELECT active,consumed_by FROM presentation_codes WHERE id='code0'"),{'active':1,'consumed_by':None})

    def test_not_submitted_retry_requires_trusted_never_signed_audit(self):
        rid=self.handed_off()
        report=self.s.report(self.a,rid,{'intentKey':'old'})
        oid=report['operation']['id']
        with self.b.store.transaction() as db:
            db.execute("UPDATE operations SET status='NOT_SUBMITTED' WHERE id=?",(oid,))
            db.execute("UPDATE redemptions SET state='HANDED_OFF' WHERE id=?",(rid,))
            db.execute("UPDATE outbox SET signing_stage='SIGNING_STARTED' WHERE operation_id=?",(oid,))
        self.error(409,self.s.report,self.a,rid,{'intentKey':'new'})
        self.b.store.execute("UPDATE outbox SET signing_stage='NEVER_SIGNED' WHERE operation_id=?",(oid,))
        self.error(409,self.s.report,self.a,rid,{'intentKey':'new'})
        self.b.store.execute("INSERT INTO work_audit(operation_id,event,created_at) VALUES(?,'REJECTED_BEFORE_SIGNING',?)",(oid,self.time))
        self.s.report(self.a,rid,{'intentKey':'new'})

    def test_strict_bodies_and_unconfigured_signer_do_not_consume(self):
        self.error(422,self.s.lock,self.a,{'intentKey':'l','voucherId':self.vouchers[0]},'ip')
        self.error(422,self.s.create_group,self.a,{'intentKey':'g','actor':'staff-b'})
        self.b.signers.pop('operator')
        self.error(503,self.accept_lock)
        self.assertEqual(self.b.store.one("SELECT active FROM presentation_codes WHERE id='code0'")['active'],1)



class OwnerRedemptionTests(unittest.TestCase):
    """Corrected product mode. Legacy class above only verifies historical compatibility."""
    OWNER=True
    setUp=LegacyRedemptionTests.setUp
    actor=LegacyRedemptionTests.actor
    error=LegacyRedemptionTests.error
    accept_lock=LegacyRedemptionTests.accept_lock
    finalized=LegacyRedemptionTests.finalized
    handed_off=LegacyRedemptionTests.handed_off
    reported=LegacyRedemptionTests.reported
    test_atomic_rollback_and_original_retry=LegacyRedemptionTests.test_consumption_enqueue_failure_rollback_and_original_retry
    test_atomic_claim_rollback=LegacyRedemptionTests.test_failure_after_claim_rolls_back_whole_acceptance
    test_code_expiry_and_finality=LegacyRedemptionTests.test_expired_rotated_revoked_unfinalized_codes_uniformly_unavailable
    test_durable_shared_code_limit=LegacyRedemptionTests.test_shared_failed_code_throttle_is_durable_and_does_not_leak_inputs
    test_new_code_after_finalized_failed_lock=LegacyRedemptionTests.test_finalized_failed_lock_requires_fresh_code_and_new_intent
    test_trusted_never_signed_retry=LegacyRedemptionTests.test_not_submitted_retry_requires_trusted_never_signed_audit
    test_groups_preserve_presented_scope=LegacyRedemptionTests.test_groups_only_presented_vouchers_no_consumption_no_siblings_or_secrets

    def test_same_owner_handoff_report_and_external_settlement_no_backend_queue(self):
        rid=self.reported()
        handoff=self.s.get(self.a,rid)['redemption']['handoff']
        self.assertEqual(handoff['statement'],'OWNER_DECLARED_HANDOFF')
        result=self.s.settle(self.a,rid,{'intentKey':'owner-settle'})
        self.assertEqual(result['operation']['status'],'PREPARED')
        self.assertEqual(result['intent']['from'],self.b.deployment['merchant'])
        self.assertEqual(self.b.store.one("SELECT count(*) AS n FROM outbox JOIN operations ON operations.id=outbox.operation_id WHERE kind='settle'")['n'],0)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM owner_settlements')['n'],1)
        self.assertEqual(self.s.payable(self.a,rid)['payable']['status'],'SETTLE_PENDING')
        started=self.b.owner_wallet.start(self.a,result['operation']['id'],{})
        self.assertTrue(started['maySubmit'])
        self.assertFalse(self.b.owner_wallet.start(self.a,result['operation']['id'],{})['maySubmit'])
        self.error(409,self.s.settle,self.a,rid,{'intentKey':'do-not-replace'})
        self.b.store.execute('UPDATE owner_wallet_sessions SET revoked=1')
        self.assertEqual(self.s.payable(self.a,rid)['payable']['status'],'SETTLE_PENDING')
        self.assertEqual(self.s.operation(self.a,kind='settle',key='owner-settle')['operation']['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.b.store.one('SELECT status FROM public_vouchers WHERE id=?',(self.vouchers[0],))['status'],3)

    def test_proof_required_for_all_new_writes_and_original_key_replays_reads_remain(self):
        gid=self.s.create_group(self.a,{'intentKey':'g'})['group']['id']
        self.s.add(self.a,gid,{'intentKey':'add','code':self.codes[0]},'ip')
        lock_body={'intentKey':'l','code':self.codes[0],'groupId':gid}
        lock=self.s.lock(self.a,lock_body,'ip');self.finalized(lock,'lock');rid=lock['redemptionId']
        self.s.handoff(self.a,rid,{'intentKey':'h'})
        self.s.report(self.a,rid,{'intentKey':'r'})
        self.b.store.execute('UPDATE owner_wallet_sessions SET revoked=1')
        calls=[(self.s.create_group,(self.a,{'intentKey':'g'})),
               (self.s.precheck,(self.a,{'code':self.codes[1]},'ip')),
               (self.s.add,(self.a,gid,{'intentKey':'add','code':self.codes[0]},'ip')),
               (self.s.lock,(self.a,lock_body,'ip')),
               (self.s.handoff,(self.a,rid,{'intentKey':'h'})),
               (self.s.report,(self.a,rid,{'intentKey':'r'}))]
        for fn,args in calls:
            self.assertEqual(self.error(403,fn,*args).code,'WALLET_PROOF_REQUIRED')
        self.assertEqual(self.s.group(self.a,gid)['group']['id'],gid)
        self.assertEqual(self.s.get(self.a,rid)['redemption']['id'],rid)
        self.assertEqual(self.s.operation(self.a,lock['operation']['id'])['operation']['id'],lock['operation']['id'])

    def test_expired_proof_and_work_session_or_binding_change_reject_writes(self):
        self.b.store.execute('UPDATE owner_wallet_sessions SET expires_at=?',(self.time,))
        self.error(403,self.s.create_group,self.a,{'intentKey':'no-proof'})
        self.b.store.execute('UPDATE owner_wallet_sessions SET expires_at=?',(self.time+1800,))
        self.b.store.execute('UPDATE work_sessions SET revoked=1')
        self.error(403,self.s.create_group,self.a,{'intentKey':'no-session'})
        self.b.store.execute('UPDATE work_sessions SET revoked=0')
        self.b.store.execute('UPDATE owner_wallet_bindings SET enabled=0')
        self.error(403,self.s.create_group,self.a,{'intentKey':'no-binding'})

    def test_legacy_roles_not_automatically_owner_and_owner_cannot_read_other_responsibility(self):
        self.error(403,self.s.precheck,self.actor('staff-a'),{'code':self.codes[0]},'ip')
        self.error(403,self.s.create_group,self.actor('settler-a'),{'intentKey':'no-upgrade'})
        rid=self.reported()
        self.b.store.execute("UPDATE redemptions SET actor_id='legacy-owner' WHERE id=?",(rid,))
        self.error(403,self.s.get,self.a,rid)
        self.error(403,self.s.payable,self.a,rid)
        self.assertEqual(self.s.payables(self.a),{'payables':[]})

    def test_owner_pause_old_lock_exception_and_restore_quarantine(self):
        lock=self.accept_lock();self.finalized(lock,'lock');rid=lock['redemptionId']
        self.b.store.execute("UPDATE metadata SET value='1' WHERE key='paused'")
        self.error(409,self.accept_lock,1)
        self.s.handoff(self.a,rid,{'intentKey':'h'})
        report=self.s.report(self.a,rid,{'intentKey':'r'});self.finalized(report,'report')
        self.error(409,self.s.settle,self.a,rid,{'intentKey':'s'})
        self.b.store.execute("UPDATE metadata SET value='QUARANTINED' WHERE key='recovery_state'")
        self.error(503,self.s.handoff,self.a,rid,{'intentKey':'h'})
        self.error(503,self.s.report,self.a,rid,{'intentKey':'r'})
        self.error(503,self.s.settle,self.a,rid,{'intentKey':'s'})
        self.assertEqual(self.s.payable(self.a,rid)['payable']['id'],rid)

    def test_owner_concurrent_intents_have_one_claim(self):
        def attempt(key):
            try: return self.accept_lock(key=key)
            except ApiError: return None
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(attempt,['device-a','device-b']))
        self.assertEqual(sum(r is not None for r in results),1)
        self.assertEqual(self.b.store.one('SELECT count(*) AS n FROM voucher_claims')['n'],1)


if __name__ == '__main__':
    unittest.main()
