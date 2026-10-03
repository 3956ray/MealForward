import copy
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from eth_abi import encode
from eth_utils import keccak
from server.testnet_readonly.identity import MANIFEST, ABI, EVENTS, ADDRESS, BATCH, START, raw, hx, ReadError, guard
from server.testnet_readonly.rpc import METHODS, ReadRpc
from server.testnet_readonly.store import ReadStore
from server.testnet_readonly.sync import Synchronizer
from server.testnet_readonly.web import create_app

class FakeRpc:
    def __init__(self):
        self.height=START+70; self.calls=[]; self.fail=None; self.wrong=False; self.code=b'read-only-test-code'
        self.blocks={};self.receipts={}; self.logs=[]
        self.functions={hx(keccak(text=a['name']+'('+','.join(i['type'] for i in a['inputs'])+')')[:4]):a for a in ABI if a['type']=='function'}
        price=int(MANIFEST['priceWei'])
        for i,item in enumerate(MANIFEST['history']):
            name=item['kind']; definition=next(v for v in EVENTS.values() if v['name']==name)
            values={'batchId':raw(BATCH),'payer':MANIFEST['merchant'],'intentId':b'1'*32,'amount':price,
                    'operationId':b'2'*32,'voucherIds':[raw(MANIFEST['voucherId'])],
                    'voucherId':raw(MANIFEST['voucherId']),'lockId':b'3'*32,'merchant':MANIFEST['merchant']}
            topics=[next(k for k,v in EVENTS.items() if v['name']==name)]
            topics += [hx(encode([v['type']],[values[v['name']]])) for v in definition['inputs'] if v['indexed']]
            ordinary=[v for v in definition['inputs'] if not v['indexed']]; b=START+i*10+1
            log=dict(address=ADDRESS,blockNumber=hex(b),blockHash=self.hash(b),transactionHash=item['transactionHash'],transactionIndex='0x0',logIndex='0x1',topics=topics,data=hx(encode([v['type'] for v in ordinary],[values[v['name']] for v in ordinary])))
            self.logs.append(log); self.receipts[item['transactionHash']]=dict(status='0x1',to=ADDRESS,transactionHash=item['transactionHash'],blockHash=self.hash(b),blockNumber=hex(b),transactionIndex='0x0',logs=[log])
    def hash(self,b): return MANIFEST['genesisHash'] if b==0 else self.blocks.get(b,'0x'+format(b,'064x'))
    def call(self, method, params):
        assert method in METHODS
        self.calls.append((method,copy.deepcopy(params)))
        if self.fail: raise ReadError(self.fail)
        if method=='eth_chainId': return hex(143 if self.wrong else 10143)
        if method=='eth_getCode':return hx(self.code)
        if method=='eth_getBlockByNumber':
            n=self.height if params[0]=='finalized' else int(params[0],16)
            return dict(number=hex(n),hash=self.hash(n))
        if method=='eth_getBalance':return '0x0'
        if method=='eth_getTransactionReceipt':return copy.deepcopy(self.receipts[params[0]])
        if method=='eth_getLogs':
            p=params[0];return copy.deepcopy([l for l in self.logs if int(p['fromBlock'],16)<=int(l['blockNumber'],16)<=int(p['toBlock'],16)])
        if method=='eth_call':
            a=self.functions[params[0]['data'][:10]]; n=a['name']; p=int(MANIFEST['priceWei'])
            values={'merchant':[MANIFEST['merchant']], 'priceWei':[p], 'fundingCapWei':[int(MANIFEST['fundingCapWei'])], 'maxQuantity':[3], 'ruleVersion':[raw(MANIFEST['ruleVersion'])], 'recoveryEnabled':[False], 'getBatch':[p,0,0,0,p,0,0], 'liability':[0], 'getVoucher':[raw(BATCH),4,b'3'*32]}
            return hx(encode([v['type'] for v in a['outputs']],values[n]))
        raise AssertionError(method)
    def close(self):pass

class ReadTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.rpc=FakeRpc();self.patch=patch.dict(MANIFEST,runtimeCodeHash=hx(keccak(self.rpc.code)));self.patch.start();self.addCleanup(self.patch.stop)
        self.store=ReadStore(Path(self.tmp.name)/'read.sqlite3');self.sync=Synchronizer(self.store,lambda:self.rpc)
        self.addCleanup(self.sync.close)
    def test_live_shape_exact_amounts_canonical_history_and_idempotence(self):
        self.sync.run();v=self.sync.view()
        self.assertEqual(v['sync']['state'],'VERIFIED');self.assertEqual(v['amounts']['F'],'1000000000000000')
        self.assertEqual(len(self.store.events()),5);self.sync.run();self.assertEqual(len(self.store.events()),5)
        self.assertNotIn('X',v['amounts']);self.assertNotIn('L',v['amounts'])
        blocks=[p[1] for m,p in self.rpc.calls if m in ('eth_call','eth_getBalance')]
        self.assertEqual(set(blocks),{hex(self.rpc.height)})
    def test_timeout_preserves_success_timestamp_and_conflict_halts_across_restart(self):
        self.sync.run();old=self.sync.view()['source']['checkedAt']
        self.rpc.fail='RPC_TIMEOUT';self.sync.run()
        self.assertEqual(self.sync.view()['sync']['state'],'STALE');self.assertEqual(self.sync.view()['source']['checkedAt'],old)
        self.rpc.fail=None;self.rpc.blocks[self.rpc.height]='0x'+'a'*64;self.sync.run()
        self.assertEqual(self.sync.view()['sync']['state'],'HALTED');self.assertIsNone(self.sync.view()['amounts'])
        self.sync.close();new=Synchronizer(self.store,lambda:self.rpc)
        try:new.run();self.assertEqual(new.view()['sync']['state'],'HALTED')
        finally:new.close()
    def test_wrong_chain_and_receipt_conflict_fail_closed(self):
        self.rpc.wrong=True;self.sync.run();self.assertEqual(self.store.state()['halted'],'WRONG_CHAIN')
        self.assertNotIn('eth_getLogs',[m for m,p in self.rpc.calls])
    def test_forged_receipt_halts_without_advancing_cursor(self):
        self.rpc.receipts[MANIFEST['history'][0]['transactionHash']]['status']='0x0'
        self.sync.run();self.assertEqual(self.store.state()['halted'],'RECEIPT_CONFLICT')
        self.assertEqual(self.store.state()['cursor'],START-1)
    def test_partial_history_and_restart_new_database(self):
        original=self.rpc.call
        def limited(method,params):
            if method=='eth_getLogs':raise ReadError('SYNC_BUDGET')
            return original(method,params)
        self.rpc.call=limited;self.sync.run()
        self.assertEqual(self.sync.view()['sync']['state'],'HISTORY_SYNCING');self.assertEqual(len(self.store.events()),5)
        self.rpc.call=original;self.sync.run();self.assertEqual(self.sync.view()['sync']['state'],'VERIFIED')
        other=ReadStore(Path(self.tmp.name)/'fresh.sqlite3');new=Synchronizer(other,lambda:self.rpc)
        try:
            new.run();self.assertEqual(new.view()['amounts'],self.sync.view()['amounts']);self.assertEqual(other.events(),self.store.events())
        finally:new.close()
    def test_restore_path_and_identity_rejected(self):
        other=Path(self.tmp.name)/'copy.sqlite3';other.write_bytes(self.store.path.read_bytes())
        self.assertEqual(ReadStore(other).state()['halted'],'RESTORE_QUARANTINED')
        with patch.dict(MANIFEST,chainId=31337):
            with self.assertRaises(ReadError):ReadStore(self.store.path)
    def test_single_inflight_ttl_and_process_lease(self):
        with self.assertRaises(ReadError):Synchronizer(self.store,lambda:self.rpc)
        gate=threading.Event();finish=threading.Event()
        def run():gate.set();finish.wait(2)
        self.sync.run=run
        self.assertTrue(self.sync.trigger());self.assertTrue(gate.wait(1))
        for _ in range(5):self.assertFalse(self.sync.trigger())
        finish.set()
        for _ in range(100):
            if not self.sync.active:break
            time.sleep(.01)
        self.assertFalse(self.sync.trigger())
    def test_api_whitelist_cursors_no_send_and_rate_limit(self):
        self.sync.run();app=create_app(self.sync);client=app.test_client();base='http://127.0.0.1:15207'
        path='/api/v1/testnet/batches/'+BATCH
        response=client.get(path+'?cached=1',base_url=base);self.assertEqual(response.status_code,200)
        events=client.get(path+'/events',base_url=base).json['events'];self.assertEqual(len(events),5)
        self.assertNotIn('voucherId',json.dumps(events));self.assertNotIn('transactionIndex',events[0])
        self.assertEqual(client.get(path+'/events?cursor=bad',base_url=base).status_code,400)
        self.assertEqual(client.get(path+'x',base_url=base).status_code,404)
        self.assertEqual(client.post(path,base_url=base,json={}).status_code,405)
        self.assertEqual(client.get(path,base_url='http://evil.invalid').status_code,403)
        for _ in range(120):r=client.get('/api/v1/testnet/config',base_url=base)
        self.assertEqual(r.status_code,429)
    def test_identity_failures_and_first_unavailable_do_not_create_amounts(self):
        self.rpc.fail='RPC_TIMEOUT';self.sync.run()
        self.assertIsNone(self.sync.view()['amounts']);self.assertEqual(self.sync.view()['sync']['state'],'UNAVAILABLE')
        self.rpc.fail=None;self.rpc.code=b'wrong runtime';self.sync.run()
        self.assertEqual(self.store.state()['halted'],'CODE_CONFLICT')
    def test_finalized_behind_preserves_original_snapshot(self):
        self.sync.run();previous=self.sync.view()['source']
        self.rpc.height-=1;self.sync.run()
        self.assertEqual(self.sync.view()['source'],previous)
        self.assertEqual(self.sync.view()['sync']['state'],'STALE')
        self.assertEqual(self.sync.view()['sync']['lastErrorCode'],'FINALITY_BEHIND')
    def test_scan_pages_within_provider_limit_and_interrupted_cursor(self):
        self.sync.run()
        ranges=[p[0] for m,p in self.rpc.calls if m=='eth_getLogs']
        self.assertLessEqual(len(ranges),8)
        self.assertTrue(all(int(p['toBlock'],16)-int(p['fromBlock'],16)<10 for p in ranges))
        self.assertEqual(self.store.state()['cursor'],self.rpc.height)
    def test_rpc_has_no_send_capability_and_boundaries(self):
        self.assertTrue(all('send' not in m.lower() and 'sign' not in m.lower() for m in METHODS))
        rpc=object.__new__(ReadRpc)
        with self.assertRaises(ReadError) as e:rpc.call('eth_sendRawTransaction',['secret'])
        self.assertEqual(e.exception.code,'METHOD_DENIED')
        rpc.clock=lambda:0;rpc.deadline=30;rpc.attempts=40
        with self.assertRaises(ReadError):rpc.call('eth_chainId',[])

class TransportTests(unittest.TestCase):
    def rpc(self,response,clock=lambda:0):
        rpc=object.__new__(ReadRpc);rpc.endpoint='https://fixture.invalid/v2/never-sent';rpc.clock=clock;rpc.deadline=30;rpc.attempts=0
        class Session:
            def post(self,*args,**kwargs):
                self.options=kwargs;return response
        rpc.session=Session();return rpc
    def test_slow_stream_deadline_and_compression_rejected_without_retry(self):
        now=[0]
        class Response:
            status_code=200;headers={}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            @property
            def raw(self):return self
            def read(self,*args,**kwargs):now[0]+=1;return b' '
        rpc=self.rpc(Response(),lambda:now[0])
        with self.assertRaises(ReadError) as e:rpc.call('eth_chainId',[])
        self.assertEqual(e.exception.code,'RPC_TIMEOUT');self.assertEqual(rpc.attempts,1);self.assertLessEqual(now[0],6)
        response=Response();response.headers={'Content-Encoding':'gzip'};rpc=self.rpc(response)
        with self.assertRaises(ReadError) as e:rpc.call('eth_chainId',[])
        self.assertEqual(e.exception.code,'RPC_ENCODING_DENIED');self.assertEqual(rpc.attempts,1)
    def test_rpc_protocol_rate_limit_and_response_cap(self):
        import io
        class Response:
            status_code=200;headers={}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n,**kwargs):return self.body.read(n)
            @property
            def raw(self):return self
        for content,status,code in [(b'{"jsonrpc":"2.0","id":2,"result":"0x279f"}',200,'RPC_PROTOCOL'),(b'',429,'RPC_RATE_LIMITED'),(b' '* (1024*1024+1),200,'RPC_LIMIT')]:
            response=Response();response.status_code=status;response.body=io.BytesIO(content);rpc=self.rpc(response)
            with self.assertRaises(ReadError) as e:rpc.call('eth_chainId',[])
            self.assertEqual(e.exception.code,code);self.assertEqual(rpc.attempts,1)
