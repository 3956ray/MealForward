"""C0 owner protocol: real HTTP, EOA signatures and owned Anvil; not browser acceptance."""
import json
import hashlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest
from eth_account import Account
from eth_account.messages import encode_defunct
import tests.test_backend_chain as chain_tests
from server.backend import digest, random_id
from server.contracts import AuthContext, ApiError
from server.local import load_backend, load_worker_keys
from server.outbox import Worker
from server.recovery import backup_bundle, restore_bundle

class OwnerC0Tests(unittest.TestCase):
    setUpClass=classmethod(chain_tests.BackendChainTests.setUpClass.__func__)
    tearDownClass=classmethod(chain_tests.BackendChainTests.tearDownClass.__func__)
    def setUp(self):
        self.h=chain_tests.BackendChainTests('test_http_end_to_end_and_finality_secrets')
        self.h.rpc_url=self.rpc_url;self.h.fixture_options={'owner_mode':True}
        self.h.setUp();self.addCleanup(self.h.tearDown)
        self.b=self.h.backend;self.owner=self.h.login('owner-a')
        Account.enable_unaudited_hdwallet_features()
        # Disposable default Anvil key exists only in this test driver, never backend config/files.
        self.wallet=Account.from_mnemonic('test test test test test test test test test test test junk',account_path="m/44'/60'/0'/0/5")
        self.assertEqual(self.wallet.address,self.b.deployment['merchant'])
        self.worker=Worker(self.b,load_worker_keys(self.h.config))
        self.actor=AuthContext('owner-a','owner',None,'shop-local',digest(self.owner.cookies.get('work_session')))
    def post(self,path,body,session=None): return self.h.post(session or self.owner,path,body)
    def prove(self,session=None):
        challenge=self.post('/work/wallet/challenge',{},session)
        self.assertEqual(challenge.status_code,200,challenge.text)
        c=challenge.json();signature=self.wallet.sign_message(encode_defunct(text=c['message'])).signature.hex()
        response=self.post('/work/wallet/verify',{'challengeId':c['challengeId'],'signature':signature},session)
        self.assertEqual(response.status_code,200,response.text)
        return c,signature
    def payable(self):
        self.prove();_,_,funded=self.h.funded();issued,_=self.h.issue(funded['intent']['batchId'])
        self.worker.tick();self.h.mine();self.worker.tick()
        voucher=issued.json()['operation']['id']
        voucher=self.b.store.one('SELECT id FROM private_vouchers WHERE operation_id=? ORDER BY rowid LIMIT 1',(voucher,))['id']
        redemption=random_id();lock_id=random_id();lock_op=random_id()
        # C0 shared transaction setup. Full redemption HTTP belongs to subsequent module acceptance.
        with self.b.store.transaction() as db:
            self.b.work.enqueue(db,self.actor,'lock','owner-c0-lock',voucher,{'voucherId':voucher},
                                {'voucherId':voucher,'lockId':lock_id},redemption_id=redemption,operation_id=lock_op)
            db.execute('INSERT INTO redemptions VALUES(?,?,?,?,?,?,?,?,?)',
                       (redemption,voucher,'owner-a','shop-local',None,lock_id,lock_op,'LOCK_PENDING',self.b.now()))
            db.execute('INSERT INTO voucher_claims VALUES(?,?)',(voucher,redemption))
        self.worker.tick();self.h.mine();self.worker.tick()
        with self.b.store.transaction() as db:
            db.execute('INSERT INTO handoff_statements VALUES(?,?,?,?,?,?)',
                       (random_id(),redemption,'owner-a','shop-local','owner-c0-handoff',self.b.now()))
            self.b.work.enqueue(db,self.actor,'report','owner-c0-report',voucher,{'redemptionId':redemption},
                                {'voucherId':voucher,'lockId':lock_id},redemption_id=redemption)
        self.worker.tick();self.h.mine();self.worker.tick()
        self.assertEqual(self.b.store.one('SELECT H FROM batches')['H'],10**15)
        result=self.post('/work/payables/'+redemption+'/settle',{'intentKey':'owner-c0-settle'})
        self.assertEqual(result.status_code,201,result.text)
        return redemption,result.json()
    def send(self,result):
        i=result['intent']
        tx={'from':self.wallet.address,'to':i['to'],'chainId':i['chainId'],'data':i['data'],'value':0,
            'nonce':self.h.w3.eth.get_transaction_count(self.wallet.address),
            'gas':250000,'gasPrice':self.h.w3.eth.gas_price}
        signed=self.wallet.sign_transaction(tx)
        return self.h.w3.to_hex(self.h.w3.eth.send_raw_transaction(signed.raw_transaction))
    def test_identity_proof_is_bound_single_use_and_not_an_address_claim(self):
        self.assertEqual(self.h.get(self.owner,'/work/wallet/session').json()['verified'],False)
        with self.assertRaises(ApiError):
            with self.b.store.transaction() as db:self.b.work.require_owner(db,self.actor)
        c,sig=self.prove()
        self.assertEqual(self.post('/work/wallet/verify',{'challengeId':c['challengeId'],'signature':sig}).status_code,403)
        other=self.h.login('owner-a')
        self.assertEqual(self.h.get(other,'/work/wallet/session').json()['verified'],False)
        challenge=self.post('/work/wallet/challenge',{}).json()
        forged=Account.create().sign_message(encode_defunct(text=challenge['message'])).signature.hex()
        self.assertEqual(self.post('/work/wallet/verify',{'challengeId':challenge['challengeId'],'signature':forged}).status_code,403)
        signature=self.wallet.sign_message(encode_defunct(text=challenge['message'])).signature.hex()
        self.assertEqual(self.post('/work/wallet/verify',{'challengeId':challenge['challengeId'],'signature':signature},other).status_code,403)
        with self.assertRaises(ApiError):
            self.b.owner_wallet.verify(self.actor,{'challengeId':challenge['challengeId'],'signature':signature},'http://127.0.0.1:1')
        self.b.store.execute('UPDATE owner_wallet_challenges SET expires_at=0 WHERE id=?',(challenge['challengeId'],))
        self.assertEqual(self.post('/work/wallet/verify',{'challengeId':challenge['challengeId'],'signature':signature}).status_code,403)
        self.assertEqual(self.post('/work/wallet/logout',{}).status_code,204)
        self.assertFalse(self.h.get(self.owner,'/work/wallet/session').json()['verified'])
    def test_owner_direct_settlement_original_hash_recovery_and_finality(self):
        redemption,result=self.payable();op_id=result['operation']['id']
        self.assertIsNone(self.b.store.one('SELECT * FROM outbox WHERE operation_id=?',(op_id,)))
        with self.assertRaises(ApiError):
            with self.b.store.transaction() as db:self.b.work.enqueue(db,self.actor,'settle','forbidden',result['operation']['target'],{}, {},redemption_id=redemption)
        started=self.post('/work/operations/'+op_id+'/submission-start',{})
        self.assertEqual(started.status_code,200,started.text)
        self.assertTrue(started.json()['maySubmit'],started.text)
        self.assertFalse(self.post('/work/operations/'+op_id+'/submission-start',{}).json()['maySubmit'])
        tx_hash=self.send(result)  # Deliberately do not report hash; worker must find original event.
        self.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'],'INCLUDED_SUCCESS')
        self.assertEqual(self.b.store.one('SELECT H,S FROM batches'),{'H':10**15,'S':0})
        self.h.mine();self.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'],'FINALIZED_SUCCESS')
        self.assertEqual(self.h.op(op_id)['tx_hash'],tx_hash)
        self.assertEqual(self.b.store.one('SELECT R,H,S FROM batches'),{'R':2*10**15,'H':0,'S':10**15})
        self.assertEqual(self.h.w3.eth.get_transaction(tx_hash)['from'],self.wallet.address)
        self.assertEqual(set(load_worker_keys(self.h.config)),{'issuer','operator'})
    def test_submission_start_is_atomic_and_unknown_does_not_allow_another_intent(self):
        redemption,result=self.payable();op_id=result['operation']['id']
        def start(_): return self.b.owner_wallet.start(self.actor,op_id,{})['maySubmit']
        with ThreadPoolExecutor(max_workers=2) as pool: self.assertEqual(sorted(pool.map(start,range(2))),[False,True])
        self.worker.tick();self.h.mine();self.worker.tick()
        self.assertEqual(self.h.op(op_id)['status'],'SUBMISSION_UNKNOWN')
        self.assertEqual(self.post('/work/payables/'+redemption+'/settle',{'intentKey':'another-intent'}).status_code,409)
        self.assertEqual(self.b.store.one('SELECT H,S FROM batches'),{'H':10**15,'S':0})
        self.assertIsNone(self.h.op(op_id)['tx_hash'])
    def test_backup_has_no_owner_key_and_restore_revokes_proofs(self):
        self.prove();bundle=backup_bundle(self.h.config,Path(self.h.tmp.name)/'owner-backup')
        manifest=json.loads((bundle/'backup.json').read_text())
        self.assertEqual(manifest['schemaVersion'],4)
        self.assertNotIn('settler.key',manifest['sha256'])
        self.assertNotIn(self.wallet.key.hex(),(bundle/'config.json').read_text())
        restored=load_backend(restore_bundle(bundle,Path(self.h.tmp.name)/'owner-restore'))
        self.assertTrue(restored.quarantined())
        self.assertEqual(restored.store.one('SELECT revoked FROM owner_wallet_sessions')['revoked'],1)
        with self.assertRaises(ApiError):restored.owner_wallet.challenge(self.actor,{},self.h.origin)
        with self.assertRaises(ValueError):load_backend({**self.h.config,'ownerWalletMode':False})
        with self.assertRaises(ValueError):load_backend({**self.h.config,'workSigners':{'operator':self.wallet.address}})
    def test_http_transaction_binding_and_finalized_revert_preserve_h(self):
        redemption,result=self.payable();op_id=result['operation']['id']
        self.assertEqual(self.post('/work/operations/'+op_id+'/transaction',{'txHash':'0x'+'00'*32}).status_code,409)
        self.assertTrue(self.post('/work/operations/'+op_id+'/submission-start',{}).json()['maySubmit'])
        wrong=self.b.store.one("SELECT tx_hash FROM operations WHERE kind='report'")['tx_hash']
        self.assertEqual(self.post('/work/operations/'+op_id+'/transaction',{'txHash':wrong}).status_code,409)
        self.assertIsNone(self.h.op(op_id)['tx_hash'])
        # Real on-chain permission loss causes an actual reverted owner transaction.
        c=self.h.rpc.contract
        self.h.w3.eth.wait_for_transaction_receipt(c.functions.revokeRole(c.functions.SETTLER_ROLE().call(),self.wallet.address).transact({'from':self.h.w3.eth.accounts[0]}))
        tx_hash=self.send(result)
        bound=self.post('/work/operations/'+op_id+'/transaction',{'txHash':tx_hash})
        self.assertEqual(bound.status_code,200,bound.text)
        self.worker.tick();self.assertEqual(self.h.op(op_id)['status'],'INCLUDED_REVERT')
        self.h.mine();self.worker.tick();self.assertEqual(self.h.op(op_id)['status'],'FINALIZED_REVERT')
        self.assertEqual(self.b.store.one('SELECT H,S FROM batches'),{'H':10**15,'S':0})
        self.assertEqual(self.post('/work/payables/'+redemption+'/settle',{'intentKey':'retry-without-role'}).status_code,403)
        self.h.w3.eth.wait_for_transaction_receipt(c.functions.grantRole(c.functions.SETTLER_ROLE().call(),self.wallet.address).transact({'from':self.h.w3.eth.accounts[0]}))
        retry=self.post('/work/payables/'+redemption+'/settle',{'intentKey':'retry-after-revert'})
        self.assertEqual(retry.status_code,201,retry.text)
        self.assertNotEqual(retry.json()['operation']['id'],op_id)
    def test_actual_v2_bundle_migrates_without_owner_authority(self):
        root=Path(self.h.tmp.name)/'actual-v2';root.mkdir()
        db=sqlite3.connect(root/'backend.sqlite3')
        for name in ('001_backend.sql','002_redemption.sql'):
            db.executescript((chain_tests.ROOT/'server/migrations'/name).read_text())
        db.execute('PRAGMA user_version=2');db.commit();db.close()
        config={**self.h.config,'ownerWalletMode':False}
        for name,key in [('encryption.key','secretKeyFile'),('issuer.key','issuerKeyFile'),('operator.key','operatorKeyFile')]:
            (root/name).write_bytes(Path(config[key]).read_bytes())
        (root/'config.json').write_text(json.dumps(config))
        files=('backend.sqlite3','encryption.key','issuer.key','operator.key','config.json')
        manifest={'format':'mealforward-cp16-quarantined-backup-v2','schemaVersion':2,'createdAt':1,'backupId':'actual-v2',
                  'deploymentId':config['deployment']['deploymentId'],'sha256':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in files}}
        (root/'backup.json').write_text(json.dumps(manifest))
        restored=load_backend(restore_bundle(root,Path(self.h.tmp.name)/'v2-restored'))
        self.assertTrue(restored.quarantined());self.assertFalse(restored.owner_mode)
        self.assertEqual(restored.store.one('PRAGMA user_version')['user_version'],4)
        self.assertEqual(restored.store.one('SELECT count(*) AS n FROM owner_wallet_bindings')['n'],0)

if __name__=='__main__': unittest.main()
