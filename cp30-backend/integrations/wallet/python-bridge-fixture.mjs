import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, hashTypedData, keccak256, parseAbiParameters } from 'viem';
import { prepareCreateStore, prepareRegistrationTypedData, registrationDigest, registrationFactoryAbi, compiledStoreEscrowCreationCodeHash } from './index.mjs';
import { observeRegistration, createReceiptVerifier, observerFactoryAbi, observerEscrowAbi, runtimeTemplates } from './registration-observer.mjs';
const id=n=>'0x'+n.toString(16).padStart(64,'0');
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const original={chainId:'10143',factory:addr(1),registrar:addr(2),asset:addr(3),quoteAuthority:addr(4),catalogAuthority:addr(5),issuerAuthority:addr(6),operatorAuthority:addr(7),escrowCreationCodeHash:compiledStoreEscrowCreationCodeHash,registrationId:id(1),storeId:id(2),owner:addr(8),deadline:'100',
  catalog:[{terms:{mealId:id(3),version:'1',unitPrice:'100',bodyDigest:id(4),imageDigest:id(5),windowCount:1,startMinute0:660,endMinute0:840,startMinute1:0,endMinute1:0},current:true}]};
const binding={...original,chainId:10143};
const catalog=original.catalog.map(e=>({current:e.current,terms:Object.fromEntries(Object.entries(e.terms).map(([k,v])=>[k,typeof v==='number'?String(v):v]))}));
const registration={registrationId:original.registrationId,storeId:original.storeId,owner:original.owner,deadline:original.deadline};
const typedData=prepareRegistrationTypedData({binding,wallet:{chainId:10143,account:original.owner},registration,catalog,now:'0'});
const parametersDigest=registrationDigest(typedData);
const escrow=addr(9),txHash=id(10),blockHash=id(11),genesisHash=id(12),termsHash=id(13);
const prepared=prepareCreateStore({binding,registrar:{chainId:10143,account:original.registrar},registration,catalog,now:'0',ownerSignature:'0x1234'});
const deployment={chainId:10143,from:prepared.from.toLowerCase(),to:prepared.to.toLowerCase(),value:'0',data:prepared.data,callDataDigest:keccak256(prepared.data)};
const profile={...original,chainId:10143,genesisHash,finality:'rpc-finalized',eip1898:true,
  runtimeTemplatePins:{factory:runtimeTemplates.factory.templateHash,escrow:runtimeTemplates.escrow.templateHash},
  budget:{maxCalls:48,maxTotalMs:20000,maxCallMs:3000,maxResponseBytes:262144,maxTotalBytes:1048576,maxCatalogEntries:1}};
const block={hash:blockHash,number:'0xa'};
const transaction={hash:txHash,chainId:'0x279f',from:deployment.from,to:deployment.to,value:'0x0',input:deployment.data,blockHash,blockNumber:block.number};
const log={address:original.factory,transactionHash:txHash,blockHash,blockNumber:block.number,logIndex:'0x0',removed:false,
  topics:encodeEventTopics({abi:registrationFactoryAbi,eventName:'StoreCreated',args:{registrationId:original.registrationId,storeId:original.storeId,escrow}}),
  data:encodeAbiParameters(parseAbiParameters('address,bytes32,uint256'),[original.owner,typedData.message.configHash,0n])};
const receipt={transactionHash:txHash,from:deployment.from,to:deployment.to,status:'0x1',blockHash,blockNumber:block.number,logs:[log]};

function fixture(overrides={}) {
  const calls=[];
  return {calls,transport:{async request(method,params){
    calls.push({method,params});
    if(Object.hasOwn(overrides,method)) return typeof overrides[method]==='function'?overrides[method](params,calls):overrides[method];
    if(method==='eth_chainId') return '0x279f';
    if(method==='eth_getBlockByNumber') return params[0]==='0x0'?{hash:genesisHash,number:'0x0'}:block;
    if(method==='eth_getTransactionByHash') return transaction;
    if(method==='eth_getTransactionReceipt') return receipt;
    if(method==='eth_getCode') {
      assert.deepEqual(params[1],{blockHash,requireCanonical:true});
      return runtimeTemplates[params[0]===original.factory?'factory':'escrow'].code;
    }
    assert.equal(method,'eth_call');
    assert.deepEqual(params[1],{blockHash,requireCanonical:true});
    const isFactory=params[0].to===original.factory;
    const abi=isFactory?observerFactoryAbi:observerEscrowAbi;
    const decoded=decodeFunctionData({abi,data:params[0].data});
    const name=decoded.functionName,args=decoded.args??[];
    let result;
    if(['asset','registrar','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','owner'].includes(name)) result=original[name];
    else if(name==='escrowCreationCodeHash') result=original.escrowCreationCodeHash;
    else if(name==='registrationUses') result=[parametersDigest,escrow];
    else if(['escrowFor','escrows'].includes(name)) result=escrow;
    else if(name==='registrationDigest') result=parametersDigest;
    else if(name==='receiver') result=original.owner;
    else if(name==='storeId') result=original.storeId;
    else if(name==='eip712Domain') result=['0x0f','MealForward C0 Funding','1',10143n,escrow,id(0),[]];
    else if(name==='getTerms') {
      const t=original.catalog[0].terms;
      result={unitPrice:100n,termsHash,bodyDigest:t.bodyDigest,imageDigest:t.imageDigest,windowCount:1,startMinute0:660,endMinute0:840,startMinute1:0,endMinute1:0};
    } else if(name==='computeTermsHash') result=termsHash;
    else if(name==='currentVersion') result=1n;
    else if(name==='listed') result=true;
    else if(name==='quoteDigest') {
      const types=observerEscrowAbi.find(e=>e.name==='quoteDigest').inputs[0].components.map(({name,type})=>({name,type}));
      result=hashTypedData({domain:{name:'MealForward C0 Funding',version:'1',chainId:10143,verifyingContract:escrow},types:{FundingQuote:types},primaryType:'FundingQuote',message:args[0]});
    } else throw Error('UNEXPECTED_METHOD_'+name);
    return encodeFunctionResult({abi,functionName:name,result});
  }}};
}
const request=f=>({transport:f.transport,profile,original,deployment,transactionHash:txHash});

// Standalone synthetic transcript fixture. No network/HTTP/provider.
const f=fixture(),entries=[];
const base=f.transport.request;
f.transport.request=async(method,params)=>{const result=await base(method,params);entries.push({method,params,result});return result;};
const value=await observeRegistration(request(f));
assert.equal(value.status,'VERIFIED');
const profileKeys=['chainId','genesisHash','factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority','escrowCreationCodeHash','finality','eip1898','runtimeTemplatePins','budget'];
process.stdout.write(JSON.stringify({profile:Object.fromEntries(profileKeys.map(k=>[k,profile[k]])),original,deployment,transactionHash:txHash,entries,evidence:value.evidence}));
