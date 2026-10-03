import concurrent.futures
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from eth_abi import encode
from eth_utils import keccak
from server.testnet_funding.chain import *
from server.testnet_funding.chain import SIGNATURES,MANIFEST
from server.testnet_funding.store import FundingStore,private_json,atomic
from server.testnet_funding.service import FundingService
from server.testnet_funding.web import create_app,BASE,COOKIE
from server.testnet_funding.rpc import METHODS,FundingRpc

PAYER='0x'+'12'*20
HASH='0x'+'34'*32

def bh(n): return '0x'+n.to_bytes(32,'big').hex()

class FakeRpc:
    def __init__(self):
        self.height=100;self.final=100;self.role=True;self.paused=False;self.total=PRICE
        self.balance=10**18;self.nonce=7;self.base=100*10**9;self.estimate=180000
        self.mapping=bytes(32);self.logs=[];self.tx=None;self.receipt=None;self.calls=[]
        self.batch=(PRICE,PRICE,0,0,0,0,0);self.reorg={};self.fail=None
    def close(self): pass
    def call(self,method,params):
        self.calls.append((method,params))
        if self.fail and self.fail(method,params): raise FundingError('RPC_UNAVAILABLE',503)
        if method=='eth_chainId': return hex(10143)
        if method=='eth_getCode': return '0x12' if params[0].lower()==ADDRESS.lower() else '0x'
        if method=='eth_getBlockByNumber':
            tag=params[0];n=self.height if tag=='latest' else self.final if tag=='finalized' else int(tag,16)
            return {'number':hex(n),'hash':self.reorg.get(n,MANIFEST['genesisHash'] if n==0 else bh(n)),'baseFeePerGas':hex(self.base)}
        if method=='eth_getBalance': return hex(PRICE if params[0].lower()==ADDRESS.lower() else self.balance)
        if method=='eth_getTransactionCount': return hex(self.nonce)
        if method=='eth_estimateGas': return hex(self.estimate)
        if method=='eth_getTransactionByHash': return self.tx
        if method=='eth_getTransactionReceipt': return self.receipt
        if method=='eth_getLogs':
            return [l for l in self.logs if int(params[0]['fromBlock'],16)<=int(l['blockNumber'],16)<=int(params[0]['toBlock'],16)]
        if method=='eth_call':
            data=params[0]['data']
            if data.startswith(encode_call('fund',[ZERO,1,RULE])[:10]): return '0x'
            name=next(k for k in SIGNATURES if encode_call(k,[bytes(32) if t=='bytes32' else PAYER if t=='address' else 1 for t in SIGNATURES[k][0]])[:10]==data[:10])
            values={'merchant':MANIFEST['merchant'],'priceWei':PRICE,'fundingCapWei':10**16,'ruleVersion':bytes.fromhex(RULE[2:]),
                'maxQuantity':3,'recoveryEnabled':False,'paused':self.paused,'hasRole':self.role,'totalFunded':self.total,
                'fundedBatch':self.mapping,'liability':PRICE}
            result=self.batch if name=='getBatch' else (values[name],)
            return '0x'+encode(SIGNATURES[name][1],result).hex()
        raise AssertionError(method)
    def funded(self,record,*,status=1,n=101):
        self.height=self.final=n;self.mapping=bytes.fromhex(record['batchId'][2:]) if status else bytes(32)
        log={'address':ADDRESS,'topics':[FUNDED,record['batchId'],'0x'+PAYER[2:].rjust(64,'0'),record['intentId']],
             'data':'0x'+encode(['uint256'],[PRICE]).hex(),'blockNumber':hex(n),'blockHash':bh(n),'transactionHash':HASH,'logIndex':'0x0'}
        self.logs=[log] if status else []
        self.tx={**record['transaction'],'input':record['data'],'hash':HASH,'blockNumber':hex(n),'blockHash':bh(n)}
        self.receipt={'transactionHash':HASH,'blockNumber':hex(n),'blockHash':bh(n),'status':hex(status),'gasUsed':hex(180000),
                      'effectiveGasPrice':hex(102*10**9),'logs':self.logs}
        self.total=PRICE*2

class FundingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)/'funding';self.store=FundingStore(self.directory)
        self.config={'version':1,'campaignId':'0x'+'56'*32,'payer':PAYER,'nonce':7,'approved':True,'sourceCommit':'a'*40}
        self.store.initialize(self.config);self.rpc=FakeRpc();self.now=1000
        self.identity=patch.dict(MANIFEST,{'runtimeCodeHash':'0x'+keccak(bytes.fromhex('12')).hex()});self.identity.start();self.addCleanup(self.identity.stop)
        self.service=FundingService(self.store,lambda:self.rpc,lambda:self.now)
        self.token,self.view=self.service.session(None)
    def review(self): return self.service.review(self.token,{'account':PAYER,'chainId':10143})
    def submit(self):
        reviewed=self.review();return self.service.submit(self.token,{'reviewId':reviewed['review']['id']})
    def assertCode(self,code,fn):
        with self.assertRaises(FundingError) as caught: fn()
        self.assertEqual(code,caught.exception.code)
    def test_finalized_and_same_block_accounting(self):
        self.submit();r=self.store.load();self.rpc.funded(r)
        result=self.service.reconcile(self.token)
        self.assertEqual('ACCOUNTING_VERIFIED',result['operation']['status'])
        self.assertEqual(str(PRICE),result['accounting']['A'])
        self.assertEqual(101,result['accounting']['blockNumber'])
        self.assertEqual(HASH,result['operation']['txHash'])
        self.assertTrue(all(m!='eth_sendRawTransaction' for m,_ in self.rpc.calls))
    def test_immutable_campaign_and_capability(self):
        self.assertCode('CAMPAIGN_ALREADY_EXISTS',lambda:self.store.initialize(self.config))
        self.assertCode('ORIGINAL_ACCESS_REQUIRED',lambda:self.service.session(None))
        self.assertCode('ORIGINAL_ACCESS_REQUIRED',lambda:self.service.get('other'))
        self.assertEqual(self.view,self.service.get(self.token))
        self.assertNotIn(self.token,self.store.path.read_bytes().decode(errors='ignore'))
        self.now+=86401
        self.assertCode('ORIGINAL_ACCESS_REQUIRED',lambda:self.service.get(self.token))
        self.assertCode('ORIGINAL_ACCESS_REQUIRED',lambda:self.service.session(None))
    def test_preflight_failures_do_not_consume(self):
        for field,value,code in [('role',False,'SUPPORTER_ROLE_REQUIRED'),('paused',True,'CONTRACT_PAUSED'),
             ('total',10**16,'FUNDING_CAP_EXCEEDED'),('balance',0,'INSUFFICIENT_FUNDS'),('nonce',8,'NONCE_CONFLICT'),
             ('base',200*10**9,'FEE_CAP_EXCEEDED'),('estimate',260000,'GAS_CAP_EXCEEDED')]:
            with self.subTest(field=field):
                old=getattr(self.rpc,field);setattr(self.rpc,field,value)
                self.assertCode(code,self.review);setattr(self.rpc,field,old)
                self.assertFalse(self.store.load()['submitted'])
    def test_wrong_account_chain_and_stale_review(self):
        self.assertCode('PAYER_CHANGED',lambda:self.service.review(self.token,{'account':PAYER,'chainId':1}))
        self.assertCode('PAYER_CHANGED',lambda:self.service.review(self.token,{'account':'0x'+'13'*20,'chainId':10143}))
        q=self.review()['review'];self.now+=121
        self.assertCode('REVIEW_REQUIRED',lambda:self.service.submit(self.token,{'reviewId':q['id']}))
    def test_changed_quote_rechecks_without_consumption(self):
        q=self.review()['review'];self.rpc.base+=40*10**9
        self.assertCode('FEE_CAP_EXCEEDED',lambda:self.service.submit(self.token,{'reviewId':q['id']}))
        self.assertFalse(self.store.load()['submitted'])
    def test_duplicate_submit_concurrency_single_permission(self):
        q=self.review()['review']
        def run():
            try: return self.service.submit(self.token,{'reviewId':q['id']})['operation']['status']
            except FundingError as e:return e.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:run(),range(2)))
        self.assertCountEqual(['SUBMISSION_UNKNOWN','READ_ORIGINAL_ONLY'],results)
    def test_unknown_restart_no_hash_zero_mapping_never_releases(self):
        self.submit()
        service=FundingService(FundingStore(self.directory),lambda:self.rpc,lambda:self.now)
        self.assertEqual('SUBMISSION_UNKNOWN',service.reconcile(self.token)['operation']['status'])
        self.assertCode('READ_ORIGINAL_ONLY',lambda:service.review(self.token,{'account':PAYER,'chainId':10143}))
        self.assertCode('ORIGINAL_ACCESS_REQUIRED',lambda:service.session(None))
    def test_anchor_written_before_db_prevents_crash_resign(self):
        q=self.review()['review']
        with patch.object(self.store,'save',side_effect=OSError('disk fault')):
            with self.assertRaises(OSError):self.service.submit(self.token,{'reviewId':q['id']})
        self.assertCode('RESTORE_QUARANTINE',self.store.load)
    def test_old_backup_quarantines_and_missing_db_cannot_reinit(self):
        backup=Path(self.tmp.name)/'old.sqlite';shutil.copy2(self.store.path,backup)
        self.submit();shutil.copy2(backup,self.store.path)
        self.assertCode('RESTORE_QUARANTINE',self.store.load)
        self.store.path.unlink();self.assertCode('CAMPAIGN_ALREADY_EXISTS',lambda:self.store.initialize(self.config))
    def test_no_cap_after_bind_crash_cannot_steal_original(self):
        other=FundingStore(Path(self.tmp.name)/'other');other.initialize({**self.config,'campaignId':'0x'+'78'*32})
        service=FundingService(other)
        with patch.object(other,'save',side_effect=OSError()):
            with self.assertRaises(OSError):service.session(None)
        self.assertCode('RESTORE_QUARANTINE',other.load)
    def test_finalized_revert_consumes_no_new_payment(self):
        self.submit();self.rpc.funded(self.store.load(),status=0)
        self.service.attach(self.token,{'txHash':HASH})
        result=self.service.reconcile(self.token)
        self.assertEqual('FINALIZED_REVERT',result['operation']['status']);self.assertIsNone(result['accounting'])
        self.assertCode('READ_ORIGINAL_ONLY',self.review)
    def test_accounting_failure_retains_finality(self):
        self.submit();self.rpc.funded(self.store.load())
        self.service.attach(self.token,{'txHash':HASH})
        selector=encode_call('getBatch',[ZERO])[:10]
        self.rpc.fail=lambda m,p:m=='eth_call' and p[0]['data'].startswith(selector)
        result=self.service.reconcile(self.token)
        self.assertEqual('FINALIZED_SUCCESS',result['operation']['status']);self.assertIsNone(result['accounting'])
        self.rpc.fail=None
        self.assertEqual('ACCOUNTING_VERIFIED',self.service.reconcile(self.token)['operation']['status'])
    def test_included_not_finalized(self):
        self.submit();self.rpc.funded(self.store.load());self.rpc.final=100
        self.service.attach(self.token,{'txHash':HASH})
        result=self.service.reconcile(self.token)
        self.assertEqual('INCLUDED_SUCCESS',result['operation']['status']);self.assertIsNone(result['accounting'])
    def test_conflicting_payload_event_canonical_or_budget_halts(self):
        self.submit();self.rpc.funded(self.store.load());self.service.attach(self.token,{'txHash':HASH})
        self.rpc.tx['input']='0x'
        result=self.service.reconcile(self.token)
        self.assertEqual('HALTED',result['operation']['status']);self.assertEqual('TRANSACTION_CONFLICT',result['operation']['errorCode'])
    def test_reorg_after_inclusion_halts(self):
        self.submit();self.rpc.funded(self.store.load());self.rpc.final=100;self.service.attach(self.token,{'txHash':HASH})
        self.service.reconcile(self.token);self.rpc.reorg[101]=bh(102)
        self.assertEqual('HALTED',self.service.reconcile(self.token)['operation']['status'])
    def test_scan_pages_checkpoint_and_restart(self):
        self.submit();self.rpc.funded(self.store.load(),n=250)
        result=self.service.reconcile(self.token)
        self.assertEqual(179,result['operation']['scanThrough']);self.assertIsNone(result['operation']['txHash'])
        service=FundingService(FundingStore(self.directory),lambda:self.rpc,lambda:self.now)
        self.assertEqual('ACCOUNTING_VERIFIED',service.reconcile(self.token)['operation']['status'])
        for method,params in self.rpc.calls:
            if method=='eth_getLogs': self.assertLessEqual(int(params[0]['toBlock'],16)-int(params[0]['fromBlock'],16)+1,10)
    def test_role_must_be_finalized_before_review(self):
        original=self.rpc.call
        selector=encode_call('hasRole',[SUPPORTER,PAYER])
        def call(method,params):
            if method=='eth_call' and params[0]['data']==selector and params[1]=='0x64':
                return '0x'+encode(['bool'],[False]).hex()
            return original(method,params)
        self.rpc.call=call
        self.assertCode('SUPPORTER_ROLE_NOT_FINALIZED',self.review)
        self.assertFalse(self.store.load()['submitted'])
    def test_fund_identity_guard_wrong_chain_and_code(self):
        original=self.rpc.call
        for method,value,code in [('eth_chainId','0x1','WRONG_CHAIN'),('eth_getCode','0x99','CODE_CONFLICT')]:
            with self.subTest(method=method):
                self.rpc.call=lambda m,p: value if m==method else original(m,p)
                self.assertCode(code,self.review)
        self.rpc.call=original
    def test_event_and_budget_conflicts_are_not_accounted(self):
        self.submit();self.rpc.funded(self.store.load());self.service.attach(self.token,{'txHash':HASH})
        original=self.store.load()
        self.rpc.receipt['logs'][0]['topics'][2]='0x'+'99'*32
        self.assertEqual('EVENT_CONFLICT',self.service.reconcile(self.token)['operation']['errorCode'])
        self.store.save(original);self.rpc.funded(original)
        self.rpc.tx['maxFeePerGas']=hex(MAX_FEE+1)
        result=self.service.reconcile(self.token)
        self.assertEqual('BUDGET_EXCEEDED',result['operation']['errorCode']);self.assertIsNone(result['accounting'])
    def test_accounting_conflict_keeps_original_finality_evidence(self):
        self.submit();self.rpc.funded(self.store.load());self.service.attach(self.token,{'txHash':HASH})
        self.rpc.batch=(PRICE,0,PRICE,0,0,0,0)
        result=self.service.reconcile(self.token)
        self.assertEqual('HALTED',result['operation']['status'])
        self.assertEqual('ACCOUNTING_CONFLICT',result['operation']['errorCode'])
        self.assertEqual(101,result['operation']['finalizedBlock']);self.assertIsNone(result['accounting'])
    def test_http_mutation_path_rate_limit_and_no_send(self):
        app=create_app(self.service);client=app.test_client();base='http://127.0.0.1:15207'
        headers={'Origin':base,'X-CP21-Request':'1'}
        client.set_cookie(COOKIE,self.token,domain='127.0.0.1',path=BASE)
        q=client.post(BASE+'/review',json={'account':PAYER,'chainId':10143},headers=headers,base_url=base)
        self.assertEqual(200,q.status_code)
        submitted=client.post(BASE+'/submit-start',json={'reviewId':q.json['review']['id']},headers=headers,base_url=base)
        self.assertEqual(200,submitted.status_code)
        self.assertEqual(429,client.post(BASE+'/reconcile',json={},headers=headers,base_url=base).status_code)
        self.assertEqual(404,client.post(BASE+'/sendRawTransaction',json={},headers=headers,base_url=base).status_code)
        self.assertEqual(200,client.get(BASE+'/operation',base_url=base).status_code)
        self.assertTrue(self.store.load()['submitted'])
    def test_quote_small_base_change_still_within_reviewed_cap(self):
        q=self.review()['review'];self.rpc.base+=10**9
        result=self.service.submit(self.token,{'reviewId':q['id']})
        self.assertEqual(q['transaction'],result['transaction'])

    def test_read_only_method_admission(self):
        self.assertNotIn('eth_sendRawTransaction',METHODS);self.assertNotIn('eth_sendTransaction',METHODS)
        rpc=FundingRpc.__new__(FundingRpc)
        self.assertCode('METHOD_DENIED',lambda:rpc.call('eth_sendRawTransaction',[]))
    def test_http_csrf_cookie_scope_no_private_config(self):
        app=create_app(self.service);client=app.test_client();base='http://127.0.0.1:15207'
        self.assertEqual(403,client.post(BASE+'/session',json={},base_url=base).status_code)
        self.assertEqual(403,client.get(BASE+'/config',base_url='http://evil:15207').status_code)
        response=client.get(BASE+'/config',base_url=base)
        self.assertEqual(200,response.status_code);self.assertNotIn('payer',response.json)
        headers={'Origin':base,'X-CP21-Request':'1'}
        self.assertEqual(401,client.post(BASE+'/session',json={},headers=headers,base_url=base).status_code)
        client.set_cookie(COOKIE,self.token,domain='127.0.0.1',path=BASE)
        response=client.post(BASE+'/session',json={},headers=headers,base_url=base)
        self.assertEqual(200,response.status_code)
        self.assertEqual(403,client.post(BASE+'/reconcile',json={},headers={**headers,'Origin':'http://evil'},base_url=base).status_code)
    def test_fresh_session_cookie_attributes(self):
        other=FundingStore(Path(self.tmp.name)/'fresh');other.initialize({**self.config,'campaignId':'0x'+'90'*32})
        client=create_app(FundingService(other)).test_client();base='http://127.0.0.1:15207'
        response=client.post(BASE+'/session',json={},headers={'Origin':base,'X-CP21-Request':'1'},base_url=base)
        self.assertEqual(200,response.status_code)
        cookie=response.headers['Set-Cookie']
        for part in ('HttpOnly','SameSite=Strict','Max-Age=86400','Path='+BASE):self.assertIn(part,cookie)
        self.assertNotIn('Secure',cookie)

if __name__=='__main__': unittest.main()
