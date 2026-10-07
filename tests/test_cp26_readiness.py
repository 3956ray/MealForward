import asyncio
import json
import unittest
import threading
import time
from unittest.mock import patch
from server.wallet_readiness.check import PROFILE,ReadRpc,CheckError,inspect,number
from server.wallet_readiness.web import create_app
ADDRESS='0x'+'0'*40
NOW=2000000000
BLOCK={'number':'0x64','hash':'0x'+'1'*64,'timestamp':hex(NOW-2)}
class Rpc:
    def __init__(self,change=None):self.calls=[];self.change=change or {}
    async def call(self,m,p):
        self.calls.append((m,p));key=(m,str(p));v=self.change.get(key)
        if v is not None:
            if isinstance(v,Exception):raise v
            return v
        if m=='eth_chainId':return '0x279f'
        if m=='eth_getBalance':return '0x0'
        if m=='eth_getCode':return '0x'
        if p[0]=='0x0':return {'number':'0x0','hash':PROFILE['genesisHash'],'timestamp':'0x0'}
        return BLOCK.copy()
class Content:
    def __init__(self,body):self.body=body
    async def iter_chunked(self,n):
        for i in range(0,len(self.body),n):yield self.body[i:i+n]
class Response:
    def __init__(self,body=None,status=200,headers=None,delay=0):self.status=status;self.headers=headers or {};self.content=Content(body or b'{"jsonrpc":"2.0","id":1,"result":"0x279f"}');self.delay=delay
    async def __aenter__(self):await asyncio.sleep(self.delay);return self
    async def __aexit__(self,*args):pass
class Session:
    def __init__(self,response):self.response=response;self.requests=[]
    def post(self,*args,**kwargs):self.requests.append((args,kwargs));return self.response
class ReadinessTests(unittest.TestCase):
    def run_check(self,rpc):return asyncio.run(inspect(rpc,ADDRESS,now=lambda:NOW))
    def test_success_fixed_finalized_scope_and_missing_manifest(self):
        rpc=Rpc();r=self.run_check(rpc)
        self.assertEqual(r['network']['status'],'PASS');self.assertEqual(r['account']['balanceWei'],'0')
        self.assertEqual(r['deployment']['status'],'NOT_CONFIGURED');self.assertEqual(r['roles']['status'],'NOT_CHECKED')
        self.assertEqual(r['expiresAt']-r['startedAt'],60);self.assertEqual(len(rpc.calls),7)
        self.assertIn(('eth_getBalance',[ADDRESS,'0x64']),rpc.calls)
    def test_mismatch_stale_conflict_and_contract_account(self):
        cases=[({('eth_chainId','[]'):'0x7a69'},'WRONG_RPC_CHAIN'),({('eth_getBlockByNumber',str(['0x0',False])):{**BLOCK,'hash':'0x'+'2'*64}},'GENESIS_MISMATCH'),({('eth_getBlockByNumber',str(['latest',False])):{**BLOCK,'timestamp':hex(NOW-121)}},'BLOCK_STALE_OR_CONFLICT'),({('eth_getBlockByNumber',str(['0x64',False])):{**BLOCK,'hash':'0x'+'2'*64}},'BLOCK_CONFLICT'),({('eth_getBalance',str([ADDRESS,'0x64'])):CheckError('RPC_TIMEOUT')},'RPC_TIMEOUT')]
        for changes,reason in cases:
            with self.subTest(reason=reason):
                r=self.run_check(Rpc(changes));self.assertEqual(r['network']['reason'],reason);self.assertIsNone(r['checkedAt']);self.assertEqual(r['account']['status'],'NOT_CHECKED')
        r=self.run_check(Rpc({('eth_getCode',str([ADDRESS,'0x64'])):'0x1234'}));self.assertEqual(r['account']['status'],'FAIL')
    def test_same_height_head_identity(self):
        for latest in ({**BLOCK,'hash':'0x'+'2'*64},{**BLOCK,'timestamp':hex(NOW-1)}):
            with self.subTest(latest=latest):
                rpc=Rpc({('eth_getBlockByNumber',str(['latest',False])):latest})
                r=self.run_check(rpc)
                self.assertEqual(r['network'],{'status':'FAIL','reason':'BLOCK_CONFLICT'})
                self.assertEqual(r['account']['status'],'NOT_CHECKED')
                self.assertIsNone(r['checkedAt']);self.assertEqual(len(rpc.calls),4)
        r=self.run_check(Rpc())
        self.assertEqual(r['latestBlock'],r['block'])
        self.assertEqual(r['network']['status'],'PASS');self.assertEqual(r['account']['status'],'PASS')
    def test_config_identifies_api_instance(self):
        origin='http://127.0.0.1:15847'
        apps=[create_app(origin),create_app(origin)]
        ids=[app.test_client().get('/api/cp26/config',base_url=origin).json['instanceId'] for app in apps]
        self.assertNotEqual(*ids)
        self.assertEqual(len(ids[0]),32)
        self.assertEqual(apps[0].test_client().get('/api/cp26/config',base_url=origin).json['instanceId'],ids[0])
    def test_rpc_whitelist_budget_and_request_options(self):
        s=Session(Response());rpc=ReadRpc(s)
        for method in ('eth_call','eth_sendTransaction','eth_sendRawTransaction','personal_sign','anvil_mine'):
            with self.assertRaisesRegex(CheckError,'METHOD_DENIED'):asyncio.run(rpc.call(method,[]))
        self.assertEqual(s.requests,[])
        self.assertEqual(asyncio.run(rpc.call('eth_chainId',[])),'0x279f');self.assertFalse(s.requests[0][1]['allow_redirects'])
        rpc.calls=12
        with self.assertRaisesRegex(CheckError,'RPC_BUDGET'):asyncio.run(rpc.call('eth_chainId',[]))
        rpc=ReadRpc(s,clock=lambda:0);rpc.clock=lambda:21
        with self.assertRaisesRegex(CheckError,'RPC_BUDGET'):asyncio.run(rpc.call('eth_chainId',[]))
    def test_rpc_transport_rejects_redirect_encoding_size_schema_and_timeout(self):
        for response,error in [(Response(status=302),'RPC_UNAVAILABLE'),(Response(headers={'Content-Encoding':'gzip'}),'RPC_ENCODING'),(Response(body=b'x'*1048577),'RPC_SIZE_LIMIT'),(Response(body=b'{"jsonrpc":"2.0","id":99,"result":1}'),'RPC_SCHEMA'),(Response(delay=3.1),'RPC_TIMEOUT')]:
            with self.subTest(error=error),self.assertRaisesRegex(CheckError,error):asyncio.run(ReadRpc(Session(response)).call('eth_chainId',[]))
    def test_quantity_schema(self):
        for value in ('12','0x00','0x','0x-1',True,None):
            with self.assertRaises(CheckError):number(value)
    def test_http_disabled_origin_and_payload_admission(self):
        c=create_app('http://127.0.0.1:15847').test_client();kw={'base_url':'http://127.0.0.1:15847','headers':{'Origin':'http://127.0.0.1:15847'}}
        self.assertFalse(c.get('/api/cp26/config',base_url=kw['base_url']).json['online'])
        self.assertEqual(c.post('/api/cp26/check',json={'address':ADDRESS},**kw).status_code,409)
        self.assertEqual(c.post('/api/cp26/check',json={'address':ADDRESS},base_url=kw['base_url']).status_code,403)
        for body in ({'address':ADDRESS,'rpcUrl':'http://evil'}, {'address':'bad'},{'method':'eth_call'},[]):self.assertEqual(c.post('/api/cp26/check',json=body,**kw).status_code,400)
        self.assertEqual(c.post('/api/cp26/check',json={'address':'x'*5000},**kw).status_code,413)
        self.assertEqual(c.get('/api/cp26/config',base_url='http://evil').status_code,403)
    def test_http_rate_limit_and_sanitized_failure(self):
        async def good(address):return {'address':address}
        c=create_app('http://127.0.0.1:15847',True,good).test_client();kw={'base_url':'http://127.0.0.1:15847','headers':{'Origin':'http://127.0.0.1:15847'}}
        for _ in range(10):self.assertEqual(c.post('/api/cp26/check',json={'address':ADDRESS},**kw).status_code,200)
        self.assertEqual(c.post('/api/cp26/check',json={'address':ADDRESS},**kw).status_code,429)
        async def fail(address):raise RuntimeError('SECRET SHOULD NOT LEAK')
        c=create_app(kw['base_url'],True,fail).test_client();r=c.post('/api/cp26/check',json={'address':ADDRESS},**kw)
        self.assertEqual(r.status_code,503);self.assertNotIn('SECRET',r.text)
    def test_http_inflight_refuses_second_request(self):
        entered=threading.Event();release=threading.Event()
        async def delayed(address):
            entered.set()
            await asyncio.to_thread(release.wait,2)
            return {'address':address}
        app=create_app('http://127.0.0.1:15847',True,delayed)
        kw={'base_url':'http://127.0.0.1:15847','headers':{'Origin':'http://127.0.0.1:15847'}}
        results=[]
        def first():results.append(app.test_client().post('/api/cp26/check',json={'address':ADDRESS},**kw).status_code)
        t=threading.Thread(target=first);t.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(app.test_client().post('/api/cp26/check',json={'address':ADDRESS},**kw).status_code,429)
        finally:release.set();t.join(timeout=3)
        self.assertEqual(results,[200])

if __name__=='__main__':unittest.main()
