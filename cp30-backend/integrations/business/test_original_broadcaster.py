"""Fake codec/process only; never invoke production worker, HTTP, key, signing or PG."""
import ast
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from business import original_broadcaster as b
from business.test_original_signer import profile as signer_profile, operation_record, FakeBusinessCodec, FakeTransactionCrypto, w, a


def profile(): return {**signer_profile(),'genesisHash':w(60)}
def config(): return {'endpoint':'https://approved.invalid/rpc','allowedEndpoints':['https://approved.invalid/rpc'],'allowedHosts':['approved.invalid'],'pythonExecutable':'/usr/bin/python3','budget':deepcopy(b.CAPS)}

class FakeProcess:
    calls=[];original=None;missing=False;wrong=False;send_error=False;instances=[]
    def __init__(self,argv,**options):
        assert options['env']=={} and argv[1]=='-I' and Path(argv[2]).name=='broadcast_rpc_worker.py'
        self.stdin=io.BytesIO();self.stdout=io.BytesIO();self.returncode=None;self.__class__.instances.append(self)
    def communicate(self,raw,timeout):
        assert 0<timeout<=3
        p=json.loads(raw);m=p['method'];params=p['params'];self.__class__.calls.append((m,params));d=self.original['deployment'];plan=self.original['transaction']
        if m=='eth_chainId':v=hex(d['chainId'])
        elif m=='eth_getBlockByNumber': v={'number':'0x0' if params[0]=='0x0' else '0xa','hash':w(60) if params[0]=='0x0' else w(61)}
        elif m=='eth_getCode':v='0x1234'
        elif m=='eth_getTransactionCount':v='0x7'
        elif m=='eth_sendRawTransaction':
            if self.send_error:
                self.returncode=1;return b'{"error":"private provider input must never escape"}',None
            v=w(50)
        elif m=='eth_getTransactionByHash':
            v=None if self.missing else {'hash':params[0],'chainId':hex(d['chainId']),'from':a(99) if self.wrong else d['from'],'to':d['to'],'input':d['data'],'value':'0x0','type':'0x2','accessList':[],**{k:hex(int(x)) for k,x in plan.items()}}
        else:raise AssertionError(m)
        response={'jsonrpc':'2.0','id':p['id'],'result':v};count=len(json.dumps(response).encode())+100
        self.returncode=0;return json.dumps({'response':response,'responseBytes':count}).encode(),None
    def poll(self):return self.returncode
    def kill(self):self.returncode=-9
    def wait(self,timeout):return self.returncode

class BroadcasterTest(unittest.TestCase):
    def setUp(self):
        FakeProcess.calls=[];FakeProcess.instances=[];FakeProcess.missing=FakeProcess.wrong=FakeProcess.send_error=False
        self.codec=FakeBusinessCodec();self.p=profile();self.record=operation_record(self.p,self.codec);FakeProcess.original=self.record
        self.gates=[]
        self.process=patch.object(b.subprocess,'Popen',FakeProcess);self.process.start()
        self.hasher=patch.object(b.DedicatedBusinessBroadcaster,'_runtime_hash',lambda _,code,end:w(9));self.hasher.start()
        self.addCleanup(self.process.stop);self.addCleanup(self.hasher.stop)
    def create(self,role='issuerAuthority',p=None,gate=None):
        return b.DedicatedBusinessBroadcaster(role=role,profile=p or self.p,business_codec=self.codec,transaction_crypto=FakeTransactionCrypto(),rpc_config=config(),before_broadcast=gate or self.gates.append,node_executable='/opt/homebrew/bin/node')
    def test_concrete_original_send_lookup_and_fixed_pending_nonce(self):
        for operation,role in [('issue','issuerAuthority'),('lock','operatorAuthority'),('markHandover','operatorAuthority'),('report','operatorAuthority')]:
            record=operation_record(self.p,self.codec,operation);FakeProcess.original=record;c=self.create(role)
            self.assertEqual(c.broadcast_original('0x02aa',w(50),record),w(50))
            self.assertEqual(c.lookup_original(record,w(50)),w(50))
            self.assertEqual(c.pending_nonce(),'7')
            self.assertEqual(FakeProcess.calls[-1],('eth_getTransactionCount',[self.p['binding'][role],'pending']))
        self.assertEqual(self.gates,[operation_record(self.p,self.codec,op) for op in ('issue','lock','markHandover','report')])
        self.assertTrue(all(p.stdin.closed and p.stdout.closed for p in FakeProcess.instances))
        self.assertEqual(c.original_lookup_protocol,'CP30_ORIGINAL_OPERATION_V1')
    def test_descriptor_raw_caps_and_roles_fail_before_rpc(self):
        c=self.create()
        for changed in ({**self.record,'operation':'fund'},{**self.record,'operation':'settle'},{**self.record,'namespace':'other'},{**self.record,'deployment':{**self.record['deployment'],'data':'0xabcd'}},{**self.record,'transaction':{**self.record['transaction'],'gas':'100001'}}):
            with self.assertRaises(ValueError):c.broadcast_original('0x02aa',w(50),changed)
        with self.assertRaises(ValueError):c.broadcast_original('0x02aa',w(51),self.record)
        with self.assertRaises(ValueError):self.create('owner')
        with self.assertRaises(ValueError):self.create('quoteAuthority')
        self.assertEqual(FakeProcess.calls,[]);self.assertEqual(self.gates,[])
    def test_uncertain_send_is_original_lookup_only_and_rpc_wrong_original_rejected(self):
        c=self.create();FakeProcess.send_error=True
        with self.assertRaisesRegex(b.OriginalBroadcastClosed,'^ORIGINAL_BROADCAST_UNKNOWN$'):c.broadcast_original('0x02aa',w(50),self.record)
        FakeProcess.send_error=False
        with self.assertRaisesRegex(b.OriginalBroadcastClosed,'^ORIGINAL_BROADCAST_UNKNOWN$'):c.broadcast_original('0x02aa',w(50),self.record)
        self.assertEqual(sum(m=='eth_sendRawTransaction' for m,_ in FakeProcess.calls),1)
        self.assertEqual(len(self.gates),1)
        FakeProcess.missing=True;self.assertIsNone(c.lookup_original(self.record,w(50)))
        FakeProcess.missing=False;FakeProcess.wrong=True
        with self.assertRaisesRegex(b.OriginalBroadcastClosed,'BROADCAST_LOOKUP_ORIGINAL_MISMATCH'):c.lookup_original(self.record,w(50))
        self.assertEqual(sum(m=='eth_sendRawTransaction' for m,_ in FakeProcess.calls),1)
    def test_transport_scope_and_future_worker_source_only(self):
        scope={'profile':self.p,'role':'issuerAuthority','transactionHash':w(50),'raw':None,'stateBlockHash':w(61),'stateBlockNumber':'0xa'}
        for method,params in [('eth_sendRawTransaction',['0x02aa']),('eth_getTransactionByHash',[w(51)]),('eth_getTransactionCount',[a(8),'pending']),('eth_getCode',[a(1),'latest']),('eth_getCode',[a(1),{'blockHash':w(61),'requireCanonical':False}]),('eth_getTransactionReceipt',[w(50)]),('eth_call',[{},'latest'])]:
            with self.assertRaises(b.OriginalBroadcastClosed): b.validate_request(method,params,scope)
        with self.assertRaises(ValueError):b.rpc_config({**config(),'endpoint':'http://approved.invalid/rpc'})
        with self.assertRaises(ValueError):b.OriginalBroadcastRpcSession(config=config(),profile=self.p,role='issuerAuthority',deadline=1,transaction_hash=w(50),raw='0x02aa')
        c=self.create(p={**self.p,'genesisHash':w(99)})
        with self.assertRaisesRegex(b.OriginalBroadcastClosed,'BROADCAST_GENESIS_MISMATCH'):c.pending_nonce()
        with patch.object(b.DedicatedBusinessBroadcaster,'_runtime_hash',lambda _,code,end:w(99)):
            with self.assertRaisesRegex(b.OriginalBroadcastClosed,'BROADCAST_RUNTIME_CODE_MISMATCH'):self.create().pending_nonce()
        root=Path(__file__).resolve().parent
        for name in ('original_broadcaster.py','broadcast_rpc_worker.py'):ast.parse((root/name).read_text())
        worker=(root/'broadcast_rpc_worker.py').read_text()
        self.assertIn('ssl.create_default_context()',worker);self.assertIn('finally: c.close()',worker)
        self.assertNotIn('signTransaction',worker);self.assertNotIn('eth_getTransactionReceipt',worker)
        self.assertEqual(set(b.METHODS),{'eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getTransactionCount','eth_getTransactionByHash','eth_sendRawTransaction'})

if __name__=='__main__':unittest.main()
