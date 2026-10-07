import asyncio
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from eth_utils import keccak
from server.wallet_readiness.check import CheckError
from server.wallet_readiness.contract_check import ContractRpc,inspect_contract,calldata
from server.wallet_readiness.manifest import load_manifest,context,ROOT,PINNED_DIGEST,digest,ROLE_NAMES
from server.wallet_readiness.web import create_app
from tests.test_cp26_readiness import Rpc,Session,Response,ADDRESS,NOW,BLOCK

MANIFEST=load_manifest()
artifact=json.loads((ROOT/MANIFEST['artifactFile']).read_text())
code=bytearray.fromhex(artifact['deployedBytecode']['object'].removeprefix('0x'))
for positions in artifact['deployedBytecode']['immutableReferences'].values():
    for pos in positions:code[pos['start']:pos['start']+32]=bytes.fromhex(MANIFEST['expectedMerchant'][2:]).rjust(32,b'\0')
CODE='0x'+code.hex()
word=lambda value:'0x'+format(value,'064x')

class ContractFake(Rpc):
    def __init__(self,change=None,fail_at=None,flags=None):
        super().__init__(change);self.fail_at=fail_at;self.flags=flags or {};self.call_count=0;self.canonical_count=0
    def authorize_context(self,manifest,address,tag):self.encoded=calldata(manifest,address)
    async def call(self,method,params):
        if method=='eth_getCode' and params[0]==MANIFEST['contractAddress']:
            self.calls.append((method,params));return self.flags.get('code',CODE)
        if method=='eth_getBlockByNumber' and params[0]=='0x64':
            self.canonical_count+=1
            if self.canonical_count==2 and self.flags.get('conflict'):
                self.calls.append((method,params));return {**BLOCK,'hash':'0x'+'2'*64}
        if method=='eth_call':
            self.calls.append((method,params));i=self.call_count;self.call_count+=1
            if i==self.fail_at:raise CheckError('RPC_TIMEOUT')
            expected=[MANIFEST['expectedRuleVersion'],'0x'+MANIFEST['expectedMerchant'][2:].lower().rjust(64,'0'),word(0)]+[word(0)]*5
            return self.flags.get(i,expected[i])
        return await super().call(method,params)

class ContractReadinessTests(unittest.TestCase):
    def inspect(self,rpc,**kwargs):return asyncio.run(inspect_contract(rpc,ADDRESS,now=lambda:NOW,**kwargs))
    def test_pinned_manifest_and_artifact(self):
        self.assertEqual(digest(MANIFEST),PINNED_DIGEST)
        self.assertEqual('0x'+keccak(bytes.fromhex(CODE[2:])).hex(),MANIFEST['expectedRuntimeKeccak'])
        approved=json.loads((ROOT/'historical-manifest.json').read_text())
        self.assertEqual(approved['normalRequestCount'],17)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'manifest.json'
            with self.assertRaisesRegex(CheckError,'MANIFEST_NOT_CONFIGURED'):load_manifest(p)
            for key,value in [('schemaVersion',2),('contractAddress',ADDRESS),('chainId',31337),('expectedRuntimeKeccak','0x'+'0'*64),('artifactFile','/tmp/other')]:
                candidate={**MANIFEST,key:value};p.write_text(json.dumps(candidate))
                with self.subTest(key=key),self.assertRaisesRegex(CheckError,'MANIFEST_UNTRUSTED'):load_manifest(p)
        with patch.object(Path,'read_bytes',return_value=b'{}'):
            with self.assertRaisesRegex(CheckError,'ARTIFACT_UNTRUSTED'):load_manifest()
    def test_same_block_17_calls_all_false_and_multiple_roles(self):
        for flags in ({},{3:word(1),4:word(1),2:word(1)}):
            rpc=ContractFake(flags=flags);r=self.inspect(rpc)
            self.assertEqual(len(rpc.calls),17);self.assertEqual(r['roles']['status'],'OBSERVED')
            self.assertEqual(r['manifest'],context(MANIFEST));self.assertIsNone(r['newBusinessTarget'])
            self.assertEqual(r['roles']['values']['DEFAULT_ADMIN_ROLE'],bool(flags))
            self.assertEqual(r['roles']['values']['SUPPORTER_ROLE'],bool(flags))
            self.assertFalse(r['roles']['merchantMatches']);self.assertEqual(r['roles']['paused'],bool(flags))
            for method,params in rpc.calls:
                if method in ('eth_getBalance','eth_getCode','eth_call'):self.assertEqual(params[-1],'0x64')
                if method=='eth_call':self.assertEqual(set(params[0]),{'to','data','gas'});self.assertEqual(params[0]['gas'],'0x186a0')
            self.assertEqual(rpc.calls[-1],('eth_getBlockByNumber',['0x64',False]))
    def test_missing_manifest_keeps_basic_only(self):
        def missing():raise CheckError('MANIFEST_NOT_CONFIGURED')
        rpc=ContractFake();r=self.inspect(rpc,loader=missing)
        self.assertEqual(len(rpc.calls),7);self.assertEqual(r['network']['status'],'PASS');self.assertIsNone(r['manifest'])
        self.assertEqual(r['deployment']['status'],'NOT_CONFIGURED');self.assertNotIn('values',r['roles'])
    def test_identity_mismatch_stops_dependent_reads(self):
        for flags,reason,expected in [({'code':'0x'},'RUNTIME_MISMATCH',8),({0:word(0)},'RULE_MISMATCH',9),({1:word(1)},'MERCHANT_MISMATCH',10)]:
            rcp=ContractFake(flags=flags);r=self.inspect(rcp)
            self.assertEqual(len(rcp.calls),expected);self.assertEqual(r['roles']['reason'],reason);self.assertNotIn('values',r['roles'])
            self.assertEqual(r['network']['status'],'PASS')
    def test_each_dynamic_failure_clears_whole_group(self):
        for index in range(8):
            with self.subTest(index=index):
                r=self.inspect(ContractFake(fail_at=index));self.assertEqual(r['roles'],{'status':'NOT_CHECKED','reason':'RPC_TIMEOUT'})
                self.assertEqual(r['network']['status'],'PASS')
    def test_strict_return_words(self):
        for i,value in [(0,'0x'),(0,word(1)+'00'),(1,word(0)),(1,'0x'+'ff'*32),(2,word(2)),(3,word(2)),(4,None)]:
            with self.subTest(index=i,value=value):
                r=self.inspect(ContractFake(flags={i:value}));self.assertEqual(r['roles']['reason'],'CALL_SCHEMA');self.assertNotIn('values',r['roles'])
    def test_final_conflict_revokes_all_same_block_results(self):
        r=self.inspect(ContractFake(flags={'conflict':True}))
        for name in ('network','account','deployment','roles'):
            self.assertNotIn(r[name]['status'],('PASS','OBSERVED'));self.assertEqual(r[name]['reason'],'BLOCK_CONFLICT')
        self.assertNotIn('block',r);self.assertNotIn('balanceWei',r['account']);self.assertIsNone(r['checkedAt'])
    def test_expiry_revokes_all(self):
        times=iter([NOW]*4+[NOW+61]*20)
        r=asyncio.run(inspect_contract(ContractFake(),ADDRESS,now=lambda:next(times)))
        self.assertNotEqual(r['roles']['status'],'OBSERVED')
        self.assertEqual(r['network']['reason'],'OBSERVATION_EXPIRED')
        self.assertNotIn('balanceWei',r['account'])
    def test_call_allowlist_budget_and_no_overrides(self):
        session=Session(Response());rpc=ContractRpc(session)
        valid=[{'to':MANIFEST['contractAddress'],'data':'0x7593a0eb','gas':'0x186a0'},'0x64']
        with self.assertRaisesRegex(CheckError,'CALL_DENIED'):asyncio.run(rpc.call('eth_call',valid))
        rpc.authorize_context(MANIFEST,ADDRESS,'0x64')
        for change in [ [{**valid[0],'to':ADDRESS},'0x64'],[{**valid[0],'data':'0xdeadbeef'},'0x64'],[{**valid[0],'data':valid[0]['data']+'00'},'0x64'],[{**valid[0],'from':ADDRESS},'0x64'],[{**valid[0],'gas':'0x186a1'},'0x64'],[valid[0],'latest'],[valid[0],'0x64',{}], [{'to':MANIFEST['contractAddress'],'data':calldata(MANIFEST,'0x'+'1'*40)[3],'gas':'0x186a0'},'0x64'] ]:
            with self.subTest(change=change),self.assertRaisesRegex(CheckError,'CALL_DENIED'):asyncio.run(rpc.call('eth_call',change))
        self.assertEqual(session.requests,[])
        asyncio.run(rpc.call('eth_call',valid));self.assertEqual(len(session.requests),1)
        rpc.calls=18
        with self.assertRaisesRegex(CheckError,'RPC_BUDGET'):asyncio.run(rpc.call('eth_chainId',[]))
        rpc=ContractRpc(session,clock=lambda:0);rpc.clock=lambda:20
        with self.assertRaisesRegex(CheckError,'RPC_BUDGET'):asyncio.run(rpc.call('eth_chainId',[]))
    def test_http_target_input_rejected(self):
        c=create_app('http://127.0.0.1:15847').test_client();kw={'base_url':'http://127.0.0.1:15847','headers':{'Origin':'http://127.0.0.1:15847'}}
        for key in ('target','manifest','data','block','gas','rpcUrl'):
            self.assertEqual(c.post('/api/cp26/check',json={'address':ADDRESS,key:'x'},**kw).status_code,400)
        config=c.get('/api/cp26/config',base_url=kw['base_url']).json
        self.assertEqual(config['deploymentManifest']['manifestDigest'],PINNED_DIGEST);self.assertIsNone(config['newBusinessTarget'])

if __name__=='__main__':unittest.main()
