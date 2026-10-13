"""Synthetic in-memory RPC + installed pure viem/BusinessCodec. Never network/sign/DB."""
from copy import deepcopy
from pathlib import Path
import json
import subprocess
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from business.codec import BusinessCodec
from business.observer import StoreEscrowObserver, BusinessObservationError, PINS, RUNTIME_PIN

NODE='/opt/homebrew/bin/node'
ROOT=Path(__file__).resolve().parent
_FIXTURE_JS=r'''
import {readFileSync}from'node:fs';
import {encodeFunctionResult,encodeFunctionData,encodeEventTopics,encodeAbiParameters,keccak256}from'viem';
import {prepareIssue,prepareLock,prepareFundingQuote,jsonValue}from'./index.mjs';
import {catalogAbi as businessEscrowAbi,preparePublish,prepareSetListed,catalogTermsHash}from'./catalog.mjs';
import {prepareSettle}from'../wallet/index.mjs';
import {runtimeTemplates}from'../wallet/registration-observer.mjs';
const mode=JSON.parse(readFileSync(0)),w=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),a=n=>'0x'+n.toString(16).padStart(40,'0');
const b={chainId:10143,escrow:a(1),asset:a(2),storeId:w(3),owner:a(4),receiver:a(4),quoteAuthority:a(5),catalogAuthority:a(6),issuerAuthority:a(7),operatorAuthority:a(8)};
const block={number:'0xa',hash:w(20),timestamp:'0x64'},genesis={number:'0x0',hash:w(21)},txHash=w(22),mealId=w(23),termsHash=w(24),batchId=w(25),voucherId=w(26),opId=w(27);
const t={unitPrice:'100',termsHash,bodyDigest:w(28),imageDigest:w(29),windowCount:'1',startMinute0:'0',endMinute0:'1440',startMinute1:'0',endMinute1:'0'};
const registrationEvidence={...b,chainId:'10143',configHash:w(30),parametersDigest:w(31),transactionHash:w(32),blockHash:w(33),registrationId:w(34),deployment:{synthetic:true},catalog:[{terms:{mealId},current:true}]};
let record=null,events=[],payloadHash=w(35),operation={kind:'0',caller:a(0),payloadHash:w(0),result:w(0),executedAt:'0'},bucket='0',generation='0';
const newMealId=w(80),newInput={mealId:newMealId,version:'1',unitPrice:'500000',bodyDigest:w(81),imageDigest:w(82),windowCount:'1',startMinute0:'0',endMinute0:'420',startMinute1:'0',endMinute1:'0'};
const newHash=catalogTermsHash({binding:b,input:newInput}).termsHash;
const params={opId,mealId,expectedUnitSeq:'0',expectedNextGeneration:'1',expectedTermsHash:termsHash,deadline:'200'};
if(mode==='publish'||mode==='setListed'){
 const parameters=mode==='publish'?{opId,expectedControlRevision:'0',input:newInput}:{opId,expectedControlRevision:'1',mealId:newMealId,value:true};
 const p=(mode==='publish'?preparePublish:prepareSetListed)({binding:b,caller:b.catalogAuthority,parameters});
 record={functionName:mode,parameters,deployment:Object.fromEntries(['chainId','from','to','value','data','callDataDigest'].map(k=>[k,p[k]])),payloadHash:p.paramsDigest};
 const kind=mode==='publish'?1:2,result=mode==='publish'?newHash:w(2);
 payloadHash=p.paramsDigest;operation={kind:String(kind),caller:b.catalogAuthority,payloadHash:p.paramsDigest,result,executedAt:'100'};
 events.push(mode==='publish'?['Published',{mealId:newMealId,version:1n,termsHash:newHash,revision:1n}]:['ControlChanged',{kind:2,mealId:newMealId,value:true,revision:2n}]);
 events.push(['OperationExecuted',{opId,kind,caller:b.catalogAuthority,payloadHash:p.paramsDigest,result}]);
}else if(mode==='issue'){
 const p=prepareIssue({binding:b,caller:b.issuerAuthority,parameters:params,now:'0'});
 record={functionName:'issue',parameters:params,deployment:Object.fromEntries(['chainId','from','to','value','data','callDataDigest'].map(k=>[k,p[k]])),payloadHash:p.paramsDigest};
 payloadHash=p.paramsDigest;operation={kind:'5',caller:b.issuerAuthority,payloadHash,result:voucherId,executedAt:'100'};bucket='1';generation='1';
 events.push(['Issued',{voucherId,unitSeq:0,generation:1n,termsHash,issuedAt:100n,expiresAt:259300n}]);
 events.push(['OperationExecuted',{opId,kind:5,caller:b.issuerAuthority,payloadHash,result:voucherId}]);
}else if(mode==='lock_revert'){
 const parameters={opId,voucherId,generation:'1',deadline:'200'};
 const p=prepareLock({binding:b,caller:b.operatorAuthority,parameters,now:'0'});
 record={functionName:'lock',parameters,deployment:Object.fromEntries(['chainId','from','to','value','data','callDataDigest'].map(k=>[k,p[k]])),payloadHash:p.paramsDigest};
 bucket='1';generation='1';
}else if(mode==='fund'){
 const quote={quoteId:w(36),payer:a(9),mealId,currentVersion:'1',termsHash,quantity:'1',unitPrice:'100',amount:'100',deadline:'200'},signature='0x'+'11'.repeat(65);
 const p=prepareFundingQuote({binding:b,quote,now:'0'});payloadHash=p.payloadHash;
 const data=encodeFunctionData({abi:businessEscrowAbi,functionName:'fund',args:[quote,signature]});
 record={functionName:'fund',parameters:{quote,signature},payloadHash,deployment:{chainId:10143,from:quote.payer,to:b.escrow,value:'0',data,callDataDigest:keccak256(data)}};
 events.push(['Funded',{quoteId:quote.quoteId,batchId,payer:quote.payer,mealId,version:1n,termsHash,unitPrice:100n,quantity:1n,firstUnit:0n,amount:100n}]);
}else if(mode==='settle'){
 const p=prepareSettle({binding:b,wallet:{chainId:10143,account:b.owner},opId,voucherId,generation:'1'});
 const abi=businessEscrowAbi.find(x=>x.name==='settle'),inputs=businessEscrowAbi.find(x=>x.name==='operationPayloadHash').inputs;
 const parametersHash=keccak256(encodeAbiParameters(abi.inputs.slice(1),[voucherId,1n]));
 const {stringToHex}=await import('viem');
 payloadHash=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'address'},...inputs],[keccak256(stringToHex('MealForwardOperationV1')),1n,10143n,b.escrow,9,b.owner,opId,parametersHash]));
 record={functionName:'settle',parameters:{opId,voucherId,generation:'1'},payloadHash,deployment:{chainId:10143,from:b.owner,to:b.escrow,value:'0',data:p.data,callDataDigest:keccak256(p.data)}};
 operation={kind:'9',caller:b.owner,payloadHash,result:w(100),executedAt:'100'};bucket='3';generation='1';
 events.push(['Settled',{voucherId,opId,receiver:b.receiver,amount:100n}]);events.push(['OperationExecuted',{opId,kind:9,caller:b.owner,payloadHash,result:w(100)}]);
}
const funded=mode==='empty'?0:1,counts=['0','0','0','0','0'],amounts=[...counts];if(funded){counts[Number(bucket)]='1';amounts[Number(bucket)]='100';}
const batch={payer:a(9),mealId,version:'1',termsHash,unitPrice:'100',quantity:'1',firstUnit:'0',refundedMask:'0'};
const unit={batchId,localIndex:'0',payer:a(9),mealId,version:'1',termsHash,unitPrice:'100',bucket,generation,voucherId:generation==='0'?w(0):voucherId};
const v={unitSeq:'0',generation:'1',termsHash,issuedAt:'100',expiresAt:'259300',issuer:b.issuerAuthority,lockId:mode==='settle'?w(40):w(0),lockedAt:mode==='settle'?'100':'0',operator:mode==='settle'?b.operatorAuthority:a(0),processor:mode==='settle'?b.owner:a(0),markerId:mode==='settle'?w(41):w(0),handoverRecordedAt:mode==='settle'?'100':'0',handoverBlock:mode==='settle'?'10':'0',reportId:mode==='settle'?w(42):w(0),settleId:mode==='settle'?opId:w(0),expired:false};
const values={...b,getAccounting:{fundedUnits:String(funded),fundedAmount:String(funded*100),counts,amounts,liability:bucket==='3'?'0':String(funded*100)},getUnit:unit,getBatch:batch,getVoucher:v,getTerms:t,getOperation:operation,nextCandidate:{available:funded===1&&bucket==='0',unitSeq:'0',nextGeneration:funded===1&&bucket==='0'?'1':'0',termsHash:funded===1&&bucket==='0'?termsHash:w(0),needsExpiry:false},currentVersion:'1',listed:true,paused:false,closed:false,controlRevision:mode==='publish'?'1':mode==='setListed'?'2':'0',quoteUses:[payloadHash,batchId],operationPayloadHash:payloadHash};
const results={};for(const [name,value]of Object.entries(values)){if(businessEscrowAbi.some(x=>x.type==='function'&&x.name===name))results[name]=encodeFunctionResult({abi:businessEscrowAbi,functionName:name,result:value});}
const {toFunctionSelector}=await import('viem');const selectorMap=Object.fromEntries(businessEscrowAbi.filter(x=>x.type==='function').map(x=>[toFunctionSelector(x),x.name]));
const logs=events.map(([name,args],i)=>{const abi=businessEscrowAbi.find(x=>x.type==='event'&&x.name===name);return{address:b.escrow,transactionHash:txHash,blockHash:block.hash,blockNumber:block.number,logIndex:'0x'+i.toString(16),removed:false,topics:encodeEventTopics({abi:[abi],eventName:name,args}),data:encodeAbiParameters(abi.inputs.filter(x=>!x.indexed),abi.inputs.filter(x=>!x.indexed).map(x=>args[x.name]))};});
const tx=record?{hash:txHash,from:record.deployment.from,to:b.escrow,value:'0x0',chainId:'0x279f',input:record.deployment.data,blockHash:block.hash,blockNumber:block.number}:null;
const receipt=record?{transactionHash:txHash,from:tx.from,to:b.escrow,status:mode==='lock_revert'?'0x0':'0x1',blockHash:block.hash,blockNumber:block.number,logs}:null;
const newValues={currentVersion:'1',listed:mode==='setListed',nextCandidate:{available:false,unitSeq:'0',nextGeneration:'0',termsHash:w(0),needsExpiry:false},getTerms:{...t,...newInput,termsHash:newHash}};delete newValues.getTerms.mealId;delete newValues.getTerms.version;
const newResults=Object.fromEntries(Object.entries(newValues).map(([name,result])=>[name,encodeFunctionResult({abi:businessEscrowAbi,functionName:name,result})]));
process.stdout.write(JSON.stringify(jsonValue({newMealId,newResults,binding:b,registrationEvidence,genesis,block,txHash,record,tx,receipt,results,selectorMap,code:runtimeTemplates.escrow.code,opId,mealId,voucherId})));
'''


class MemoryTransport:
    def __init__(self, fixture, fault=None): self.f=fixture; self.fault=fault; self.calls=[]
    def request(self, method, params, *, deadline):
        assert time.monotonic()<deadline
        self.calls.append((method,deepcopy(params)))
        if method=='eth_chainId': return '0x279f'
        if method=='eth_getBlockByNumber':
            if params[0]=='0x0': return self.f['genesis']
            if params[0]=='finalized' and self.fault=='pending': return {**self.f['block'],'number':'0x9','hash':'0x'+'f'*64}
            if params[0]=='0x9' and self.fault=='pending': return {**self.f['block'],'number':'0x9','hash':'0x'+'f'*64}
            if self.fault=='fork': return {**self.f['block'],'hash':'0x'+'f'*64}
            return self.f['block']
        if method=='eth_getCode': return self.f['code']
        if method=='eth_getTransactionByHash': return {**self.f['tx'],'from':'0x'+'f'*40} if self.fault=='wrong' else self.f['tx']
        if method=='eth_getTransactionReceipt': return self.f['receipt']
        assert method=='eth_call'
        assert params[0]['to']==self.f['binding']['escrow']
        assert params[1]=={'blockHash':self.f['block']['hash'],'requireCanonical':True}
        name=self.f['selectorMap'][params[0]['data'][:10]]
        if name in self.f['newResults'] and params[0]['data'][10:74]==self.f['newMealId'][2:]:return self.f['newResults'][name]
        return self.f['results'][name]


class ObserverTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures={}
        for mode in ('issue','fund','settle','empty','lock_revert','publish','setListed'):
            run=subprocess.run([NODE,'--input-type=module','-e',_FIXTURE_JS],input=json.dumps(mode).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={},cwd=str(ROOT),timeout=2,check=True)
            cls.fixtures[mode]=json.loads(run.stdout)

    def observer(self, f, transport):
        profile={'binding':f['binding'],'registrationState':'CONFIRMED','registrationEvidence':f['registrationEvidence'],
                 'genesisHash':f['genesis']['hash'],'finality':'rpc-finalized','eip1898':True,'runtimeTemplatePin':RUNTIME_PIN,'compilerPins':PINS,
                 'budget':{'maxCalls':96,'maxTotalMs':20000,'maxCallMs':3000,'maxResponseBytes':1048576,'maxTotalBytes':1048576,'maxMealIds':3 if f['record'] and f['record']['functionName'] in {'publish','setListed'} else 1}}
        return StoreEscrowObserver(codec=BusinessCodec(NODE),transport_factory=lambda:transport,profile=profile)

    def test_original_issue_fund_owner_settle_are_chain_bound_facts(self):
        for mode in ('issue','fund','settle'):
            f=self.fixtures[mode]; transport=MemoryTransport(f)
            result=self.observer(f,transport).verify_original_operation(f['record'],f['txHash'])
            self.assertIsNotNone(result,mode)
            self.assertEqual(result['original'],f['record']);self.assertEqual(result['blockNumber'],'10')
            self.assertEqual(result['snapshot']['units'][0]['seq'],'0')
            self.assertEqual(result['snapshot']['accounting']['fundedAmount'],'100')
            self.assertLessEqual(len(transport.calls),96)

    def test_lock_revert_requires_original_canonical_finalized_receipt(self):
        f=self.fixtures['lock_revert'];transport=MemoryTransport(f)
        result=self.observer(f,transport).verify_original_operation(f['record'],f['txHash'])
        self.assertEqual(result['authority'],'VERIFIED_ORIGINAL_LOCK_REVERT')
        self.assertEqual(result['receiptStatus'],'0');self.assertEqual(result['original'],f['record'])
        self.assertEqual(result['voucher']['generation'],'1');self.assertEqual(result['operation']['kind'],'0')
        for fault in ('pending','fork','wrong'):
            self.assertIsNone(self.observer(f,MemoryTransport(f,fault)).verify_original_operation(f['record'],f['txHash']))
        for name in ('getVoucher','getOperation'):
            changed=deepcopy(f);changed['results'][name]=self.fixtures['settle']['results'][name]
            self.assertIsNone(self.observer(changed,MemoryTransport(changed)).verify_original_operation(changed['record'],changed['txHash']))
        for mode in ('issue','settle','fund'):
            other=deepcopy(self.fixtures[mode]);other['receipt']['status']='0x0'
            self.assertIsNone(self.observer(other,MemoryTransport(other)).verify_original_operation(other['record'],other['txHash']))

    def test_catalog_originals_include_new_and_original_meal_without_rewriting_history(self):
        from business.projection import projection_rows
        for mode in ('publish','setListed'):
            f=self.fixtures[mode];transport=MemoryTransport(f)
            result=self.observer(f,transport).verify_original_operation(f['record'],f['txHash'],meal_ids=[f['newMealId']])
            self.assertIsNotNone(result,mode)
            self.assertEqual(set(result['snapshot']['menu']),{f['mealId'],f['newMealId']})
            self.assertEqual(result['snapshot']['units'][0]['mealId'],f['mealId'])
            self.assertEqual(result['snapshot']['menu'][f['newMealId']]['terms']['unitPrice'],'500000')
            self.assertEqual(result['snapshot']['menu'][f['newMealId']]['listed'],mode=='setListed')
            rows=projection_rows(result,'00000000-0000-4000-8000-000000000001','inert',{f['mealId']:'original',f['newMealId']:'new'})
            self.assertEqual(rows['units'][0]['meal'],'original');self.assertEqual(rows['receipt']['functionName'],mode)

    def test_zero_accounting_and_absent_operation_zero_result_are_preserved(self):
        f=self.fixtures['empty'];transport=MemoryTransport(f)
        result=self.observer(f,transport).read_finalized(op_ids=[f['opId']])
        self.assertIsNotNone(result)
        self.assertEqual(result['accounting']['fundedAmount'],'0');self.assertEqual(result['units'],[])
        self.assertEqual(result['operations'][f['opId']]['kind'],'0')
        self.assertEqual(result['operations'][f['opId']]['result'],'0x'+'0'*64)
        self.assertFalse(result['menu'][f['mealId']]['candidate']['available'])
        self.assertFalse(any(f['selectorMap'].get(p[0]['data'][:10])=='getUnit' for m,p in transport.calls if m=='eth_call'))

    def test_pending_wrong_original_and_wrong_canonical_block_never_return_evidence(self):
        f=self.fixtures['issue']
        for fault in ('pending','wrong','fork'):
            self.assertIsNone(self.observer(f,MemoryTransport(f,fault)).verify_original_operation(f['record'],f['txHash']))
        record={**f['record'],'functionName':'expire'}
        self.assertIsNone(self.observer(f,MemoryTransport(f)).verify_original_operation(record,f['txHash']))
        with self.assertRaises(BusinessObservationError):
            self.observer({**f,'registrationEvidence':{**f['registrationEvidence'],'owner':'0x'+'f'*40}},MemoryTransport(f))


if __name__=='__main__':unittest.main()
