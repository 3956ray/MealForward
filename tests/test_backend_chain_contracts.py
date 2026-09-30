"""CP16 C0: real isolated chain fixture and shared transactions, not module acceptance."""
import hashlib
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch
import tests.test_backend_chain as chain_tests
from server.backend import random_id
from server.contracts import AuthContext, ApiError
from server.local import load_backend, load_worker_keys
from server.recovery import backup_bundle, restore_bundle, FILES
from server.storage import Store
from server.outbox import Worker
from server.actions import ACTIONS, action_fingerprint, action_transaction

class C0Tests(unittest.TestCase):
    setUpClass=classmethod(chain_tests.BackendChainTests.setUpClass.__func__)
    tearDownClass=classmethod(chain_tests.BackendChainTests.tearDownClass.__func__)
    def setUp(self):
        self.h=chain_tests.BackendChainTests('test_http_end_to_end_and_finality_secrets')
        self.h.rpc_url=self.rpc_url;self.h.setUp();self.addCleanup(self.h.tearDown)
        self.b=self.h.backend
    def actor(self,name='staff-a'):
        u=self.b.store.get_user(name)
        return AuthContext(u['id'],u['role'],u['partner_id'],u['shop_id'],'c0-transaction-test')
    def issued_code(self):
        _,_,funded=self.h.funded();r,_=self.h.issue(funded['intent']['batchId'])
        self.h.worker.tick();self.h.mine();self.h.worker.tick()
        voucher=self.b.store.one('SELECT id FROM private_vouchers ORDER BY rowid LIMIT 1')['id']
        now=self.b.now();code='00123456'
        with self.b.store.transaction() as db:
            db.execute('INSERT INTO recipient_sessions VALUES(?,?,?,?,?,?,?,0)',('session-hash','session-id',voucher,'csrf-hash',now,now+1800,now))
            db.execute('INSERT INTO recipient_heads VALUES(?,?)',(voucher,'session-hash'))
            db.execute('INSERT INTO presentation_codes VALUES(?,?,?,?,?,?,?,?,1,NULL)',
                       ('code-id',voucher,'session-hash','show-1',self.b.work.code_hash(code),self.b.encrypt(code),now,now+120))
        return voucher,code
    def test_v1_migration_preserves_balance_quarantine_and_marks_untrusted_history(self):
        path=Path(self.h.tmp.name)/'v1.sqlite3';db=sqlite3.connect(path)
        db.executescript((chain_tests.ROOT/'server/migrations/001_backend.sql').read_text())
        db.execute("INSERT INTO metadata VALUES('recovery_state','QUARANTINED')")
        db.execute("INSERT INTO batches VALUES('batch','payer',3,3,0,0,0,0,0)")
        db.execute("INSERT INTO operations(id,kind,actor_id,intent_key,request_json,payload_hash,status,created_at,updated_at) VALUES('old','issue','old-user','old-key','{}','hash','QUEUED',1,1)")
        db.execute("INSERT INTO outbox(operation_id,signer,tx_json,state) VALUES('old','signer','{}','QUEUED')")
        db.execute('PRAGMA user_version=1');db.commit();db.close()
        store=Store(path)
        self.assertEqual(store.one('PRAGMA user_version')['user_version'],2)
        self.assertEqual(store.one("SELECT value FROM metadata WHERE key='recovery_state'")['value'],'QUARANTINED')
        self.assertEqual(store.one('SELECT F,A FROM batches'),{'F':3,'A':3})
        self.assertEqual(store.one('SELECT signing_stage FROM outbox')['signing_stage'],'LEGACY_UNKNOWN')
        self.assertEqual(store.one('SELECT count(*) AS n FROM work_audit')['n'],0)
    def test_signing_started_without_raw_cannot_resign_after_restart(self):
        _,_,funded=self.h.funded();r,_=self.h.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        key=Path(self.h.config['issuerKeyFile']).read_bytes()
        def stop(phase):
            if phase=='signing_started': raise RuntimeError('Crash inside signing boundary')
        with self.assertRaises(RuntimeError): Worker(self.b,key,stop).tick()
        restored=load_backend(self.h.config);worker=Worker(restored,key)
        with patch.object(worker.account,'sign_transaction',side_effect=AssertionError('Must not re-sign')):worker.tick()
        job=restored.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.assertEqual(job['signing_stage'],'SIGNING_STARTED');self.assertIsNone(job['raw_cipher'])
        self.assertEqual(job['broadcast_count'],0)
        self.assertEqual(restored.store.one('SELECT status FROM operations WHERE id=?',(op_id,))['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(restored.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],3)
    def test_code_consumption_claim_and_outbox_share_one_transaction(self):
        voucher,code=self.issued_code();actor=self.actor();op_id=random_id();redemption=random_id();lock=random_id()
        request={'intentKey':'lock-key','codeHash':self.b.work.code_hash(code)}
        def accept(db):
            self.b.work.validate_and_consume_code(db,actor,code,op_id)
            self.b.work.enqueue(db,actor,'lock','lock-key',voucher,request,{'voucherId':voucher,'lockId':lock},redemption_id=redemption,operation_id=op_id)
            db.execute('INSERT INTO redemptions VALUES(?,?,?,?,?,?,?,?,?)',(redemption,voucher,actor.actor_id,actor.shop_id,None,lock,op_id,'LOCK_PENDING',self.b.now()))
            db.execute('INSERT INTO voucher_claims VALUES(?,?)',(voucher,redemption))
        with self.assertRaises(RuntimeError):
            with self.b.store.transaction() as db: accept(db);raise RuntimeError('Fail before commit')
        self.assertEqual(self.b.store.one('SELECT active FROM presentation_codes')['active'],1)
        self.assertIsNone(self.b.store.one('SELECT id FROM operations WHERE id=?',(op_id,)))
        with self.b.store.transaction() as db: accept(db)
        self.assertEqual(self.b.store.one('SELECT signing_stage FROM outbox WHERE operation_id=?',(op_id,))['signing_stage'],'NEVER_SIGNED')
        self.assertNotIn(code,self.b.store.one('SELECT request_json FROM operations WHERE id=?',(op_id,))['request_json'])
        with self.assertRaises(ApiError):
            with self.b.store.transaction() as db:self.b.work.validate_and_consume_code(db,self.actor('staff-b'),code,random_id())
        with self.b.store.transaction() as db:
            self.assertEqual(self.b.work.original(db,actor,'lock','lock-key',request)['id'],op_id)
        self.b.store.execute("UPDATE users SET shop_id='shop-other' WHERE id='staff-a'")
        with self.assertRaises(ApiError):
            with self.b.store.transaction() as db:self.b.work.original(db,actor,'lock','lock-key',request)
    def test_signer_roles_and_action_encodings_are_bound(self):
        self.assertEqual(len(set(self.b.signers.values())),3)
        for role,address in self.b.signers.items():
            role_id=getattr(self.h.rpc.contract.functions,role.upper()+'_ROLE')().call()
            self.assertTrue(self.h.rpc.contract.functions.hasRole(role_id,address).call())
        for kind,spec in ACTIONS.items():
            payload={'batchId':random_id(),'voucherIds':[random_id()],'voucherId':random_id(),'lockId':random_id()}
            tx=action_transaction(self.h.rpc.contract,kind,random_id(),payload)
            method,args=self.h.rpc.contract.decode_function_input(tx['data'])
            self.assertEqual(method.fn_name,kind);self.assertEqual(tx['chainId'],31337)
            fingerprint,result=action_fingerprint(kind,payload)
            self.assertEqual(len(fingerprint),66);self.assertEqual(result,payload[spec.fields[0]])
        legacy={k:v for k,v in self.h.config.items() if k not in ('workSigners','operatorKeyFile','settlerKeyFile')}
        self.assertEqual(set(load_backend(legacy).signers),{'issuer'})
        with self.assertRaises(ValueError):load_backend({**self.h.config,'workSigners':{'operator':self.b.signers['settler']}})
    def test_worker_protocol_lock_report_settle_uses_distinct_signers_and_finality(self):
        voucher,code=self.issued_code();actor=self.actor();lock_id=random_id();redemption=random_id();lock_op=random_id()
        batch_id=self.b.store.one('SELECT batch_id FROM private_vouchers WHERE id=?',(voucher,))['batch_id']
        with self.b.store.transaction() as db:
            self.b.work.validate_and_consume_code(db,actor,code,lock_op)
            self.b.work.enqueue(db,actor,'lock','lock-worker',voucher,{'codeHash':self.b.work.code_hash(code)},
                                {'voucherId':voucher,'lockId':lock_id},redemption_id=redemption,operation_id=lock_op)
            db.execute('INSERT INTO redemptions VALUES(?,?,?,?,?,?,?,?,?)',(redemption,voucher,actor.actor_id,actor.shop_id,None,lock_id,lock_op,'LOCK_PENDING',self.b.now()))
            db.execute('INSERT INTO voucher_claims VALUES(?,?)',(voucher,redemption))
        worker=Worker(self.b,load_worker_keys(self.h.config));worker.tick();worker.tick()
        self.assertEqual(self.h.op(lock_op)['status'],'INCLUDED_SUCCESS')
        self.assertEqual(self.b.store.one('SELECT state FROM redemptions')['state'],'LOCK_PENDING')
        self.h.mine();worker.tick();self.assertEqual(self.b.store.one('SELECT state FROM redemptions')['state'],'LOCKED')
        with self.b.store.transaction() as db:
            db.execute('INSERT INTO handoff_statements VALUES(?,?,?,?,?,?)',(random_id(),redemption,actor.actor_id,actor.shop_id,'handoff-worker',self.b.now()))
            db.execute("UPDATE redemptions SET state='HANDED_OFF' WHERE id=?",(redemption,))
            report=self.b.work.enqueue(db,actor,'report','report-worker',voucher,{'redemptionId':redemption},
                                       {'voucherId':voucher,'lockId':lock_id},redemption_id=redemption)
        send=self.h.rpc.broadcast_same_raw
        def lost(raw): send(raw);raise TimeoutError('Lost original report response')
        with patch.object(self.h.rpc,'broadcast_same_raw',lost):worker.tick()
        self.assertEqual(self.h.op(report['id'])['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.b.store.one('SELECT H FROM batches')['H'],0)
        self.h.mine();worker.tick();self.assertEqual(self.b.store.one('SELECT state FROM redemptions')['state'],'REPORTED')
        _,_,other_fund=self.h.funded(1)
        pending,_=self.h.issue(other_fund['intent']['batchId'],1,session=self.h.login('partner-b'))
        pending_issuer=pending.json()['operation']['id']
        with self.b.store.transaction() as db:
            settle=self.b.work.enqueue(db,self.actor('settler-a'),'settle','settle-worker',voucher,{'redemptionId':redemption},
                                       {'voucherId':voucher},redemption_id=redemption)
        before=self.h.w3.eth.get_balance(self.h.config['deployment']['merchant'])
        def issuer_unavailable(raw):
            if self.h.w3.eth.account.recover_transaction(raw)==self.b.signers['issuer']:raise TimeoutError('Issuer unavailable')
            return send(raw)
        with patch.object(self.h.rpc,'broadcast_same_raw',issuer_unavailable):
            worker.tick();self.h.mine();worker.tick()
        self.assertEqual(self.h.op(pending_issuer)['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.h.op(settle['id'])['status'],'FINALIZED_SUCCESS')
        self.assertEqual(self.b.store.one('SELECT state FROM redemptions')['state'],'SETTLED')
        self.assertEqual(self.h.w3.eth.get_balance(self.h.config['deployment']['merchant'])-before,10**15)
        rows=self.b.store.all('SELECT signer,nonce FROM outbox WHERE operation_id IN (?,?,?) ORDER BY rowid',(lock_op,report['id'],settle['id']))
        self.assertEqual([(r['signer'],r['nonce']) for r in rows],[(self.b.signers['operator'],0),(self.b.signers['operator'],1),(self.b.signers['settler'],0)])
        self.assertEqual(self.b.store.one('SELECT R,H,S FROM batches WHERE id=?',(batch_id,)),{'R':2*10**15,'H':0,'S':10**15})
    def test_async_scope_revocation_before_sign_rejects_without_broadcast(self):
        _,_,funded=self.h.funded();r,_=self.h.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        self.b.store.set_user_enabled('partner-a',False)
        with patch.object(self.h.worker.account,'sign_transaction',side_effect=AssertionError('Revoked actor')):self.h.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'],'NOT_SUBMITTED')
        row=self.b.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.assertIsNone(row['raw_cipher']);self.assertEqual(row['broadcast_count'],0)
        self.assertEqual(self.b.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],0)
    def test_async_scope_revocation_after_sign_keeps_raw_and_reservation(self):
        _,_,funded=self.h.funded();r,_=self.h.issue(funded['intent']['batchId']);op_id=r.json()['operation']['id']
        def stop(phase):
            if phase=='after_sign':raise RuntimeError('Signed original')
        key=Path(self.h.config['issuerKeyFile']).read_bytes()
        with self.assertRaises(RuntimeError):Worker(self.b,key,stop).tick()
        before=self.b.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.b.store.set_user_enabled('partner-a',False);self.h.worker.tick()
        after=self.b.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,))
        self.assertEqual((after['raw_cipher'],after['tx_hash'],after['broadcast_count']),(before['raw_cipher'],before['tx_hash'],0))
        self.assertEqual(self.h.op(op_id)['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.b.store.one("SELECT reserved FROM qualifications WHERE partner_id='partner-a'")['reserved'],3)
    def test_v2_backup_carries_signers_and_revokes_recipient_capabilities(self):
        _,_=self.issued_code()
        bundle=backup_bundle(self.h.config,Path(self.h.tmp.name)/'v2-bundle')
        config=restore_bundle(bundle,Path(self.h.tmp.name)/'v2-restore');restored=load_backend(config)
        self.assertTrue(restored.quarantined());self.assertEqual(restored.signers,self.b.signers)
        self.assertEqual(restored.store.one('SELECT revoked FROM recipient_sessions')['revoked'],1)
        self.assertEqual(restored.store.one('SELECT active,code_cipher FROM presentation_codes'),{'active':0,'code_cipher':None})
        for role in ('operator','settler'):
            self.assertEqual(Path(config[role+'KeyFile']).read_bytes(),Path(self.h.config[role+'KeyFile']).read_bytes())
    def test_legacy_v1_bundle_restores_without_new_signer_activation(self):
        # Build an actual v1 SQLite artifact, not a v2 database mislabeled v1.
        root=Path(self.h.tmp.name)/'v1-bundle';root.mkdir(mode=0o700)
        db=sqlite3.connect(root/'backend.sqlite3')
        db.executescript((chain_tests.ROOT/'server/migrations/001_backend.sql').read_text())
        db.execute('PRAGMA user_version=1');db.commit();db.close()
        for name,key in [('encryption.key','secretKeyFile'),('issuer.key','issuerKeyFile')]:
            (root/name).write_bytes(Path(self.h.config[key]).read_bytes())
        config={k:v for k,v in self.h.config.items() if k not in ('workSigners','operatorKeyFile','settlerKeyFile')}
        (root/'config.json').write_text(json.dumps(config))
        manifest={'format':'mealforward-cp15-quarantined-backup-v1','schemaVersion':1,'createdAt':1,'backupId':'legacy-test',
                  'deploymentId':config['deployment']['deploymentId'],'sha256':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in FILES}}
        (root/'backup.json').write_text(json.dumps(manifest))
        restored=load_backend(restore_bundle(root,Path(self.h.tmp.name)/'v1-restore'))
        self.assertTrue(restored.quarantined());self.assertEqual(set(restored.signers),{'issuer'})
        self.assertEqual(restored.store.one('PRAGMA user_version')['user_version'],2)

if __name__=='__main__': unittest.main()
