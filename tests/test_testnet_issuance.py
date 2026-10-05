import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from eth_abi import encode
from eth_utils import keccak
from server.testnet_issuance.chain import *
from server.testnet_issuance.chain import SIGNATURES,MANIFEST
from server.testnet_issuance.store import IssuanceStore,canonical
from server.testnet_issuance.service import IssuanceService
from server.testnet_issuance.web import create_app,BASE
from server.testnet_issuance.rpc import METHODS,IssuanceRpc

ISSUANCE_ID='0x'+'56'*32
HASH='0x'+'34'*32
PARTNER='partner-a'
RECIPIENT='test-recipient-01'

def bh(n): return '0x'+n.to_bytes(32,'big').hex()

class FakeRpc:
    def __init__(self):
        self.height=100;self.final=100;self.role=True;self.paused=False
        self.total=2*PRICE;self.liability=PRICE;self.balance=PRICE
        self.nonce=7;self.base=100*10**9
        self.operation=(bytes(32),bytes(32));self.voucher=(bytes(32),0,bytes(32))
        self.batch=(PRICE,PRICE,0,0,0,0,0)
        self.state_from=None;self.pre_batch=self.batch
        self.logs=[];self.tx=None;self.receipt=None;self.calls=[]
        self.reorg={};self.fail=None
    def close(self): pass
    @staticmethod
    def default(kind):
        if kind=='address': return OPERATOR
        if kind=='uint8': return 1
        if kind=='bytes32[]': return [bytes(32)]
        return ZERO
    def call(self,method,params):
        self.calls.append((method,params))
        if self.fail and self.fail(method,params): raise IssuanceError('RPC_UNAVAILABLE',503)
        if method=='eth_chainId': return hex(10143)
        if method=='eth_getCode': return '0x12' if params[0].lower()==ADDRESS.lower() else '0x'
        if method=='eth_getBlockByNumber':
            tag=params[0];n=self.height if tag=='latest' else self.final if tag=='finalized' else int(tag,16)
            return {'number':hex(n),'hash':self.reorg.get(n,MANIFEST['genesisHash'] if n==0 else bh(n)),'baseFeePerGas':hex(self.base)}
        if method=='eth_getBalance': return hex(self.balance if params[0].lower()==ADDRESS.lower() else 10**18)
        if method=='eth_getTransactionCount': return hex(self.nonce)
        if method=='eth_getTransactionByHash': return self.tx
        if method=='eth_getTransactionReceipt': return self.receipt
        if method=='eth_getLogs':
            wanted=params[0]['topics'];lo=int(params[0]['fromBlock'],16);hi=int(params[0]['toBlock'],16)
            def matches(log):
                if not lo<=int(log['blockNumber'],16)<=hi: return False
                if log['address'].lower()!=params[0]['address'].lower(): return False
                return all(log['topics'][i].lower()==t.lower() for i,t in enumerate(wanted))
            return [l for l in self.logs if matches(l)]
        if method=='eth_call':
            data=params[0]['data']
            if data.startswith(encode_call('issue',[ZERO,ZERO,[bytes(32)]])[:10]): return '0x'
            name=next(k for k in SIGNATURES if encode_call(k,[self.default(t) for t in SIGNATURES[k][0]])[:10]==data[:10])
            tag=params[1];effective=self.height if tag=='latest' else self.final if tag=='finalized' else int(tag,16)
            operation,voucher,batch=self.operation,self.voucher,self.batch
            if self.state_from is not None and effective<self.state_from:
                operation,voucher,batch=(bytes(32),bytes(32)),(bytes(32),0,bytes(32)),self.pre_batch
            values={'merchant':(MANIFEST['merchant'],),'priceWei':(PRICE,),'fundingCapWei':(10**16,),'ruleVersion':(bytes.fromhex(RULE[2:]),),
                'maxQuantity':(3,),'recoveryEnabled':(False,),'paused':(self.paused,),'hasRole':(self.role,),'totalFunded':(self.total,),
                'liability':(self.liability,),'getOperation':operation,'getVoucher':voucher}
            result=batch if name=='getBatch' else values[name]
            return '0x'+encode(SIGNATURES[name][1],result).hex()
        raise AssertionError(method)
    def issued(self,record,*,status=1,n=101,operator=OPERATOR):
        self.height=self.final=n
        self.state_from=n;self.pre_batch=(PRICE,PRICE,0,0,0,0,0)
        self.operation=(bytes.fromhex(record['expectedPayloadHash'][2:]),bytes.fromhex(record['batchId'][2:]))
        self.voucher=(bytes.fromhex(record['batchId'][2:]),1,bytes(32))
        self.batch=(PRICE,0,PRICE,0,0,0,0)
        log={'address':ADDRESS,'topics':[ISSUED,record['operationId'],record['batchId']],
             'data':'0x'+encode(['bytes32[]'],[[bytes.fromhex(record['voucherId'][2:])]]).hex(),
             'blockNumber':hex(n),'blockHash':bh(n),'transactionHash':HASH,'logIndex':'0x0'}
        self.logs=[log] if status else []
        self.tx={'from':operator,'to':ADDRESS,'input':record['data'],'chainId':hex(10143),'nonce':hex(7),'value':'0x0',
                 'gas':hex(120000),'maxFeePerGas':hex(102*10**9),'maxPriorityFeePerGas':hex(TIP),'type':'0x2',
                 'hash':HASH,'blockNumber':hex(n),'blockHash':bh(n)}
        self.receipt={'transactionHash':HASH,'blockNumber':hex(n),'blockHash':bh(n),'status':hex(status),'gasUsed':hex(100000),
                      'effectiveGasPrice':hex(101*10**9),'logs':[log] if status else []}

class IssuanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.directory=Path(self.tmp.name)/'issuance';self.store=IssuanceStore(self.directory)
        self.config={'version':1,'issuanceId':ISSUANCE_ID,'batchId':BATCH,'operator':OPERATOR,
                     'partnerLabel':PARTNER,'recipientRef':RECIPIENT,'approved':True,'sourceCommit':'a'*40}
        self.rpc=FakeRpc();self.now=1000
        self.identity=patch.dict(MANIFEST,{'runtimeCodeHash':'0x'+keccak(bytes.fromhex('12')).hex()});self.identity.start();self.addCleanup(self.identity.stop)
        self.service=IssuanceService(self.store,lambda:self.rpc,lambda:self.now)
        self.record=self.service.initialize(self.config)
    def assertCode(self,code,fn):
        with self.assertRaises(IssuanceError) as caught: fn()
        self.assertEqual(code,caught.exception.code)
    def test_deterministic_derivation_and_calldata(self):
        operation_id,voucher_id=derive(ISSUANCE_ID)
        self.assertEqual(operation_id,'0x'+keccak(text='mealforward-cp22:'+ISSUANCE_ID).hex())
        self.assertEqual(voucher_id,'0x'+keccak(text='mealforward-cp22:voucher:'+ISSUANCE_ID+':0').hex())
        self.assertNotEqual(operation_id,'0x'+keccak(text='mealforward-cp21:'+ISSUANCE_ID).hex())
        self.assertEqual(self.record['operationId'],operation_id)
        self.assertEqual(self.record['voucherId'],voucher_id)
        self.assertEqual(self.record['batchId'],BATCH)
        self.assertEqual(self.record['data'],encode_call('issue',[operation_id,BATCH,[hex_data(voucher_id,32)]]))
        self.assertEqual(self.record['expectedPayloadHash'],
                         '0x'+keccak(encode(['bytes32','bytes32[]'],[bytes.fromhex(BATCH[2:]),[bytes.fromhex(voucher_id[2:])]])).hex())
        self.assertEqual(100,self.record['scanStart']);self.assertEqual(99,self.record['scanThrough'])
    def test_reinit_idempotent_and_intent_conflict_409(self):
        calls=len(self.rpc.calls)
        again=self.service.initialize(self.config)
        self.assertEqual(canonical(self.record),canonical(again))
        self.assertEqual(calls,len(self.rpc.calls))
        for changed in ({'partnerLabel':'partner-b'},{'issuanceId':'0x'+'78'*32}):
            with self.subTest(changed=sorted(changed)):
                with self.assertRaises(IssuanceError) as caught: self.service.initialize({**self.config,**changed})
                self.assertEqual('INTENT_CONFLICT',caught.exception.code);self.assertEqual(409,caught.exception.status)
        for field,value in [('batchId','0x'+'11'*32),('operator','0x'+'22'*20),('approved',False)]:
            with self.subTest(field=field):
                self.assertCode('APPROVED_ISSUANCE_REQUIRED' if field=='approved' else
                                'BATCH_FROZEN_REQUIRED' if field=='batchId' else 'OPERATOR_FROZEN_REQUIRED',
                                lambda:IssuanceService(IssuanceStore(Path(self.tmp.name)/('x-'+field)),lambda:self.rpc).initialize({**self.config,field:value}))
    def test_init_refuses_already_issued(self):
        self.rpc.operation=(b'\x01'*32,bytes(32))
        store=IssuanceStore(Path(self.tmp.name)/'other')
        self.assertCode('ISSUED_BEFORE_INIT',lambda:IssuanceService(store,lambda:self.rpc).initialize(self.config))
        self.assertFalse(store.configured());self.assertFalse((Path(self.tmp.name)/'other').exists())
    def test_anchor_first_and_quarantine_on_mismatch(self):
        other=Path(self.tmp.name)/'other';store=IssuanceStore(other)
        with patch('server.testnet_issuance.store.sqlite3.connect',side_effect=OSError('disk fault')):
            with self.assertRaises(OSError): store.initialize(self.config)
        self.assertTrue(store.anchor.exists())
        self.assertCode('RESTORE_QUARANTINE',store.load)
        self.assertCode('RESTORE_QUARANTINE',lambda:store.initialize(self.config))
        record=self.store.load();record['operationId']='0x'+'99'*32
        self.store.save(record);self.assertCode('RESTORE_QUARANTINE',self.store.load)
        self.store.path.unlink();self.assertCode('RESTORE_QUARANTINE',self.store.load)
    def test_scan_matches_issued_and_filters_wrong_batch_or_operation(self):
        self.rpc.issued(self.record)
        self.rpc.logs.extend([
            {'address':ADDRESS,'topics':[ISSUED,self.record['operationId'],'0x'+'22'*32],
             'data':self.rpc.logs[0]['data'],'blockNumber':hex(101),'blockHash':bh(101),'transactionHash':'0x'+'aa'*32,'logIndex':'0x0'},
            {'address':ADDRESS,'topics':[ISSUED,'0x'+'11'*32,self.record['batchId']],
             'data':self.rpc.logs[0]['data'],'blockNumber':hex(101),'blockHash':bh(101),'transactionHash':'0x'+'bb'*32,'logIndex':'0x0'},
        ])
        result=self.service.operation()
        self.assertEqual('ACCOUNTING_VERIFIED',result['operation']['status'])
        self.assertEqual(HASH,result['operation']['txHash'])
        self.assertTrue(all(m!='eth_sendRawTransaction' for m,_ in self.rpc.calls))
        bad=FakeRpc();service=IssuanceService(IssuanceStore(Path(self.tmp.name)/'bad'),lambda:bad,lambda:self.now)
        record=service.initialize(self.config)
        bad.issued(record)
        bad.logs[0]['data']='0x'+encode(['bytes32[]'],[[b'\x55'*32]]).hex()  # matching topics, wrong voucher payload
        result=service.operation()
        self.assertEqual('HALTED',result['operation']['status']);self.assertEqual('EVENT_CONFLICT',result['operation']['errorCode'])
    def test_reorg_and_canonical_conflict_halt(self):
        self.rpc.issued(self.record);self.service.operation()
        self.rpc.reorg[101]=bh(999)
        result=self.service.operation()
        self.assertEqual('HALTED',result['operation']['status']);self.assertEqual('CANONICAL_CONFLICT',result['operation']['errorCode'])
        self.rpc.reorg={}
        self.assertEqual('HALTED',self.service.operation()['operation']['status'])
        rpc=FakeRpc();service=IssuanceService(IssuanceStore(Path(self.tmp.name)/'scan'),lambda:rpc,lambda:self.now)
        service.initialize(self.config)
        service.operation()
        rpc.reorg[100]=bh(555)
        result=service.operation()
        self.assertEqual('HALTED',result['operation']['status']);self.assertEqual('SCAN_CONFLICT',result['operation']['errorCode'])
    def test_finalized_accounting_far_and_global_invariants(self):
        self.rpc.issued(self.record)
        result=self.service.operation()
        operation,accounting=result['operation'],result['accounting']
        self.assertEqual('ACCOUNTING_VERIFIED',operation['status'])
        self.assertEqual((str(PRICE),'0',str(PRICE),'0','0'),(accounting['F'],accounting['A'],accounting['R'],accounting['H'],accounting['S']))
        self.assertEqual(str(PRICE),accounting['liabilityWei'])
        self.assertEqual(str(2*PRICE),accounting['totalFundedWei'])
        self.assertEqual(str(PRICE),accounting['contractBalanceWei'])
        self.assertEqual(HASH,operation['txHash']);self.assertEqual(101,operation['finalizedBlock'])
        self.assertIsNone(operation['errorCode'])
    def test_accounting_conflict_retains_finality(self):
        self.rpc.issued(self.record)
        self.rpc.liability=2*PRICE
        result=self.service.operation()
        self.assertEqual('HALTED',result['operation']['status'])
        self.assertEqual('ACCOUNTING_CONFLICT',result['operation']['errorCode'])
        self.assertEqual(101,result['operation']['finalizedBlock']);self.assertIsNone(result['accounting'])
        self.rpc.liability=PRICE;self.rpc.batch=(PRICE,PRICE,0,0,0,0,0)
        result=self.service.operation()  # halted records stay isolated, never re-verified silently
        self.assertEqual('ACCOUNTING_CONFLICT',result['operation']['errorCode']);self.assertIsNone(result['accounting'])
        self.assertEqual('HALTED',result['operation']['status'])
    def test_revert_is_terminal_no_second_attempt(self):
        # a reverted issue leaves no event and no mapping: the observer honestly stays PREPARED
        self.rpc.issued(self.record,status=0)
        self.rpc.operation=(bytes(32),bytes(32));self.rpc.voucher=(bytes(32),0,bytes(32))
        self.rpc.batch=(PRICE,PRICE,0,0,0,0,0);self.rpc.state_from=None
        result=self.service.operation()
        self.assertEqual('PREPARED',result['operation']['status']);self.assertIsNone(result['operation']['txHash'])
        self.assertIsNone(result['operation']['errorCode'])
        # with a persisted hash the revert is terminal evidence; observation never retries or re-parameters
        record=self.store.load();record['txHash']=HASH;self.store.save(record)
        result=self.service.operation()
        self.assertEqual('FINALIZED_REVERT',result['operation']['status']);self.assertIsNone(result['accounting'])
        self.assertIsNone(result['operation']['errorCode'])
        self.assertEqual(result,self.service.operation())
        self.assertTrue(all(m!='eth_sendRawTransaction' for m,_ in self.rpc.calls))
    def test_restart_resumes_watermark(self):
        self.rpc.issued(self.record,n=250)
        result=self.service.operation()
        self.assertEqual(179,result['operation']['scanThrough'])
        self.assertEqual('PREPARED',result['operation']['status']);self.assertIsNone(result['operation']['txHash'])
        service=IssuanceService(IssuanceStore(self.directory),lambda:self.rpc,lambda:self.now)
        self.assertEqual('ACCOUNTING_VERIFIED',service.operation()['operation']['status'])
        for method,params in self.rpc.calls:
            if method=='eth_getLogs': self.assertLessEqual(int(params[0]['toBlock'],16)-int(params[0]['fromBlock'],16)+1,10)
    def test_no_hash_unknown_keeps_observing_never_releases(self):
        for _ in range(3):
            result=self.service.operation()
            self.assertEqual('PREPARED',result['operation']['status'])
            self.assertIsNone(result['operation']['txHash']);self.assertIsNone(result['operation']['errorCode'])
        self.assertEqual(100,result['operation']['scanThrough'])
        self.rpc.issued(self.record,n=295);self.rpc.height=self.rpc.final=300
        result=self.service.operation()
        self.assertEqual('PREPARED',result['operation']['status']);self.assertIsNone(result['operation']['txHash'])
        result=self.service.operation()
        self.assertEqual('PREPARED',result['operation']['status'])
        result=self.service.operation()
        self.assertEqual('ACCOUNTING_VERIFIED',result['operation']['status'])
    def test_cp20_public_boundary_negative(self):
        from server.testnet_readonly.identity import BATCH as CP20_BATCH
        from server.testnet_readonly.store import ReadStore
        from server.testnet_readonly.sync import Synchronizer
        from server.testnet_readonly.web import create_app as cp20_create_app
        from tests.test_testnet_readonly import FakeRpc as Cp20Rpc
        self.rpc.issued(self.record)
        self.assertEqual('ACCOUNTING_VERIFIED',self.service.operation()['operation']['status'])
        cp20=Cp20Rpc()
        with patch.dict(MANIFEST,{'runtimeCodeHash':'0x'+keccak(cp20.code).hex()}):
            sync=Synchronizer(ReadStore(Path(self.tmp.name)/'cp20.sqlite3'),lambda:cp20)
            try:
                sync.run();before=sync.view()
                sync.run();after=sync.view()
                self.assertEqual(before['amounts'],after['amounts'])
                self.assertEqual(before['liabilityWei'],after['liabilityWei'])
                self.assertEqual(before['contractBalanceWei'],after['contractBalanceWei'])
                self.assertEqual('1000000000000000',after['amounts']['F'])
                client=cp20_create_app(sync).test_client();base='http://127.0.0.1:15207'
                self.assertEqual(404,client.get('/api/v1/testnet/batches/'+BATCH,base_url=base).status_code)
                self.assertEqual(404,client.get('/api/v1/testnet/batches/'+BATCH+'/events',base_url=base).status_code)
                self.assertEqual(200,client.get('/api/v1/testnet/batches/'+CP20_BATCH+'?cached=1',base_url=base).status_code)
                events=client.get('/api/v1/testnet/batches/'+CP20_BATCH+'/events',base_url=base).json
                self.assertNotIn(HASH,json.dumps(events))
                self.assertNotIn(self.record['operationId'],json.dumps(events))
            finally: sync.close()
    def test_http_admission_host_origin_rate_limit_get_only(self):
        now=[0.0];app=create_app(self.service,clock=lambda:now[0]);client=app.test_client();base='http://127.0.0.1:15207'
        self.assertEqual(200,client.get(BASE+'/config',base_url=base).status_code)
        self.assertEqual(403,client.get(BASE+'/config',base_url='http://evil:15207').status_code)
        self.assertEqual(403,client.get(BASE+'/config',headers={'Origin':'http://evil.com'},base_url=base).status_code)
        self.assertEqual(403,client.get(BASE+'/config',headers={'Sec-Fetch-Site':'cross-site'},base_url=base).status_code)
        self.assertEqual(405,client.post(BASE+'/config',base_url=base).status_code)
        self.assertEqual(422,client.get(BASE+'/config',data='x',base_url=base).status_code)
        self.assertEqual(400,client.get(BASE+'/operation?cached=0',base_url=base).status_code)
        self.assertEqual(200,client.get(BASE+'/operation?cached=1',base_url=base).status_code)
        now[0]+=10;self.assertEqual(200,client.get(BASE+'/operation',base_url=base).status_code)
        now[0]+=10;self.assertEqual(200,client.get(BASE+'/operation',base_url=base).status_code)
        now[0]+=10
        limited=client.get(BASE+'/operation',base_url=base)
        self.assertEqual(429,limited.status_code);self.assertEqual('60',limited.headers['Retry-After'])
        now[0]+=10;self.assertEqual(200,client.get(BASE+'/operation?cached=1',base_url=base).status_code)
        tick=[0.0];flood=create_app(self.service,clock=lambda:tick[0]);flood_client=flood.test_client()
        for _ in range(120):
            tick[0]+=0.4
            if flood_client.get(BASE+'/config',base_url=base).status_code!=200: self.fail('premature limit')
        tick[0]+=0.4
        self.assertEqual(429,flood_client.get(BASE+'/config',base_url=base).status_code)
    def test_unconfigured_web_only_public_config(self):
        service=IssuanceService(IssuanceStore(Path(self.tmp.name)/'empty'))
        client=create_app(service).test_client();base='http://127.0.0.1:15207'
        response=client.get(BASE+'/config',base_url=base)
        self.assertEqual(200,response.status_code)
        self.assertEqual({'chainId','contract','ruleVersion','priceWei','testOnly','configured'},set(response.json))
        self.assertFalse(response.json['configured'])
        refused=client.get(BASE+'/operation?cached=1',base_url=base)
        self.assertEqual(409,refused.status_code);self.assertEqual('NOT_CONFIGURED',refused.json['code'])
    def test_rpc_method_whitelist_no_send(self):
        self.assertEqual(frozenset(('eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance',
                                    'eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash')),METHODS)
        self.assertNotIn('eth_sendRawTransaction',METHODS);self.assertNotIn('eth_sendTransaction',METHODS)
        rpc=IssuanceRpc.__new__(IssuanceRpc);rpc.methods=METHODS
        self.assertCode('METHOD_DENIED',lambda:rpc.call('eth_sendRawTransaction',['0x02']))
    def test_labels_and_no_claim_credential_fields(self):
        result=self.service.operation()
        self.assertEqual(PARTNER,result['operation']['partnerLabel'])
        self.assertEqual(RECIPIENT,result['operation']['recipientRef'])
        for text in (json.dumps(result),json.dumps(self.store.load())):
            for forbidden in ('secret','claim','credential','token','privatekey','invite','qrcode'):
                self.assertNotIn(forbidden,text.lower())
        configured=create_app(self.service).test_client().get(BASE+'/config',base_url='http://127.0.0.1:15207').json
        self.assertEqual(PARTNER,configured['partnerLabel'])

if __name__=='__main__': unittest.main()
