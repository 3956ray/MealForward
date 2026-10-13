import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, encodeEventTopics, getAddress, hashTypedData, keccak256 } from 'viem';
import { prepareCreateStore, prepareRegistrationTypedData, registrationDigest, registrationFactoryAbi, compiledStoreEscrowCreationCodeHash } from './index.mjs';
import { observerFactoryAbi, observerEscrowAbi, runtimeTemplates } from './observer-artifacts.mjs';
export { runtimeTemplates, observerFactoryAbi, observerEscrowAbi };

const METHODS = new Set(['eth_chainId','eth_getCode','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber','eth_call']);
const FIELDS = ['factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority'];
const word = value => { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw Error('INVALID_WORD'); return value.toLowerCase(); };
const addr = value => getAddress(value).toLowerCase();
const hex = value => { if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw Error('INVALID_HEX'); return value.toLowerCase(); };
const quantity = value => { if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw Error('INVALID_RPC_QUANTITY'); return BigInt(value); };
const decimal = value => { if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw Error('INVALID_INTEGER'); return BigInt(value); };
const safe = value => { const n = quantity(value); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('UNSAFE_INTEGER'); return Number(n); };
const equal = (actual, expected, reason) => { if (actual !== expected) throw Error(reason); };
const tag = n => '0x'+n.toString(16);

/** Fixed same-build mask only. Every repeated immutable occurrence must agree. */
export function verifyRuntimeTemplate(code, kind, pin) {
  const template = runtimeTemplates[kind];
  if (!template || word(pin) !== template.templateHash) throw Error('RUNTIME_TEMPLATE_PIN');
  const actual = hex(code);
  if (actual.length !== template.code.length) throw Error('RUNTIME_CODE_MISMATCH');
  const expectedGroups={factory:['5141','5143','5145','5147','5149','5152','5155','12875','12877','12879','12881','12883','12885','12887'],
    escrow:['280','282','284','286','288','290','292','294','5141','5143','5145','5147','5149','5152','5155']};
  if(JSON.stringify(Object.keys(template.immutableReferences))!==JSON.stringify(expectedGroups[kind])) throw Error('UNSUPPORTED_RUNTIME_TEMPLATE');
  const covered=new Set();
  const output = actual.slice(2).split('');
  for (const slots of Object.values(template.immutableReferences)) {
    let first;
    for (const {start,length} of slots) {
      if (!Number.isSafeInteger(start) || length !== 32 || start < 0 || (start+length)*2 > output.length) throw Error('UNSUPPORTED_RUNTIME_TEMPLATE');
      for(let i=start;i<start+length;i++){if(covered.has(i)) throw Error('UNSUPPORTED_RUNTIME_TEMPLATE');covered.add(i);}
      const value = actual.slice(2+start*2, 2+(start+length)*2);
      if (first === undefined) first = value;
      else equal(value,first,'INCONSISTENT_RUNTIME_IMMUTABLE');
      output.fill('0',start*2,(start+length)*2);
    }
  }
  equal('0x'+output.join(''),template.code.toLowerCase(),'RUNTIME_CODE_MISMATCH');
  return true;
}

function boundedTransport(transport, budget) {
  const constraints = {maxCalls:[1,48],maxTotalMs:[1,40000],maxCallMs:[1,3000],maxResponseBytes:[1,1048576],maxTotalBytes:[1,1048576],maxCatalogEntries:[1,3]};
  for (const [key,[min,max]] of Object.entries(constraints)) if (!Number.isSafeInteger(budget?.[key]) || budget[key]<min || budget[key]>max) throw Error('INVALID_CALL_BUDGET');
  if (budget.maxCallMs > budget.maxTotalMs || !transport || typeof transport.request !== 'function') throw Error('INVALID_TRANSPORT');
  const started = performance.now();
  let calls=0, bytes=0;
  return async (method,params) => {
    if (!METHODS.has(method) || ++calls>budget.maxCalls) throw Error('CALL_LIMIT');
    const remaining=budget.maxTotalMs-(performance.now()-started);
    if (remaining<=0) throw Error('TOTAL_TIME_LIMIT');
    let timer;
    try {
      const response = await Promise.race([
        Promise.resolve().then(()=>transport.request(method,params)),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CALL_TIMEOUT')),Math.min(remaining,budget.maxCallMs));}),
      ]);
      const size=Buffer.byteLength(JSON.stringify(response));
      bytes+=size;
      if (size>budget.maxResponseBytes || bytes>budget.maxTotalBytes) throw Error('RESPONSE_LIMIT');
      if (performance.now()-started>budget.maxTotalMs) throw Error('TOTAL_TIME_LIMIT');
      return response;
    } finally { clearTimeout(timer); }
  };
}
function material(profile,original,deployment) {
  const chainId=Number(original.chainId);
  if (!Number.isSafeInteger(chainId)||chainId<1) throw Error('INVALID_CHAIN');
  equal(chainId,profile.chainId,'PROFILE_CHAIN');
  for(const field of FIELDS) equal(addr(original[field]),addr(profile[field]),'PROFILE_'+field);
  equal(word(original.escrowCreationCodeHash),compiledStoreEscrowCreationCodeHash,'ORIGINAL_CODE_PIN');
  equal(word(profile.escrowCreationCodeHash),compiledStoreEscrowCreationCodeHash,'PROFILE_CODE_PIN');
  if (profile.finality!=='rpc-finalized' || profile.eip1898!==true) throw Error('UNSUPPORTED_FINALITY_PROFILE');
  const binding={...Object.fromEntries(FIELDS.map(f=>[f,original[f]])),chainId,escrowCreationCodeHash:original.escrowCreationCodeHash};
  const catalog=original.catalog.map(e=>({current:e.current,terms:Object.fromEntries(Object.entries(e.terms).map(([k,v])=>[k,typeof v==='number'?String(v):v]))}));
  const registration=Object.fromEntries(['registrationId','storeId','owner','deadline'].map(f=>[f,original[f]]));
  const typedData=prepareRegistrationTypedData({binding,wallet:{chainId,account:original.owner},registration,catalog,now:'0'});
  const decoded=decodeFunctionData({abi:registrationFactoryAbi,data:deployment.data});
  equal(decoded.functionName,'createStore','ORIGINAL_CALL');
  const expected=prepareCreateStore({binding,registrar:{chainId,account:original.registrar},registration,catalog,ownerSignature:decoded.args[2],now:'0'});
  equal(deployment.chainId,chainId,'DEPLOYMENT_CHAIN');
  equal(addr(deployment.from),addr(original.registrar),'DEPLOYMENT_SENDER');
  equal(addr(deployment.to),addr(original.factory),'DEPLOYMENT_TARGET');
  equal(decimal(deployment.value),0n,'DEPLOYMENT_VALUE');
  equal(hex(deployment.data),expected.data.toLowerCase(),'DEPLOYMENT_CALLDATA');
  equal(word(deployment.callDataDigest),keccak256(deployment.data),'DEPLOYMENT_CALLDATA_DIGEST');
  return {binding,catalog,typedData,configHash:typedData.message.configHash,parametersDigest:registrationDigest(typedData)};
}

/** No ambient clients/config. Caller performs all transport IO outside a DB transaction. */
export async function observeRegistration({transport,profile,original,deployment,transactionHash}) {
  try {
    const v=material(profile,original,deployment);
    if (!profile.runtimeTemplatePins?.factory || !profile.runtimeTemplatePins?.escrow) return {status:'UNVERIFIED',reason:'RUNTIME_TEMPLATE_MISSING',evidence:null};
    for (const kind of ['factory','escrow']) equal(word(profile.runtimeTemplatePins[kind]),runtimeTemplates[kind].templateHash,'RUNTIME_TEMPLATE_PIN');
    const request=boundedTransport(transport,profile.budget);
    if(v.catalog.length>profile.budget.maxCatalogEntries) throw Error('CATALOG_LIMIT');
    if(!transactionHash) return {status:'UNKNOWN',reason:'ORIGINAL_HASH_MISSING',evidence:null};
    const hash=word(transactionHash);
    equal(quantity(await request('eth_chainId',[])),BigInt(v.binding.chainId),'CHAIN_MISMATCH');
    const genesis=await request('eth_getBlockByNumber',['0x0',false]);
    equal(word(genesis?.hash),word(profile.genesisHash),'GENESIS_MISMATCH');
    equal(quantity(genesis.number),0n,'GENESIS_NUMBER');
    const tx=await request('eth_getTransactionByHash',[hash]);
    if(!tx) return {status:'UNKNOWN',reason:'ORIGINAL_TRANSACTION_NOT_FOUND',evidence:null};
    equal(word(tx.hash),hash,'ORIGINAL_HASH');
    equal(quantity(tx.chainId),BigInt(v.binding.chainId),'ORIGINAL_CHAIN');
    equal(addr(tx.from),addr(deployment.from),'ORIGINAL_SENDER');
    equal(addr(tx.to),addr(deployment.to),'ORIGINAL_TARGET');
    equal(quantity(tx.value),0n,'ORIGINAL_VALUE');
    equal(hex(tx.input),hex(deployment.data),'ORIGINAL_CALLDATA');
    const receipt=await request('eth_getTransactionReceipt',[hash]);
    if(!receipt) return {status:'PENDING',reason:'RECEIPT_NOT_FOUND',evidence:null};
    equal(word(receipt.transactionHash),hash,'RECEIPT_HASH');
    equal(addr(receipt.from),addr(deployment.from),'RECEIPT_SENDER');
    equal(addr(receipt.to),addr(deployment.to),'RECEIPT_TARGET');
    if(quantity(receipt.status)!==1n) return {status:'UNKNOWN',reason:'ORIGINAL_REVERTED',evidence:null};
    const blockHash=word(receipt.blockHash),blockNumber=safe(receipt.blockNumber);
    equal(word(tx.blockHash),blockHash,'ORIGINAL_BLOCK_HASH');
    equal(safe(tx.blockNumber),blockNumber,'ORIGINAL_BLOCK_NUMBER');
    const canonical=await request('eth_getBlockByNumber',[tag(BigInt(blockNumber)),false]);
    equal(word(canonical?.hash),blockHash,'NONCANONICAL_RECEIPT');
    equal(safe(canonical.number),blockNumber,'CANONICAL_NUMBER');
    const finalized=await request('eth_getBlockByNumber',['finalized',false]);
    if(!finalized) return {status:'UNKNOWN',reason:'FINALIZED_UNAVAILABLE',evidence:null};
    const finalNumber=safe(finalized.number);
    word(finalized.hash);
    if(finalNumber<blockNumber) return {status:'PENDING',reason:'NOT_FINALIZED',evidence:null};
    const finalCanonical=await request('eth_getBlockByNumber',[tag(BigInt(finalNumber)),false]);
    equal(word(finalCanonical?.hash),word(finalized.hash),'NONCANONICAL_FINALIZED');
    equal(safe(finalCanonical.number),finalNumber,'FINALIZED_CANONICAL_NUMBER');
    const topic=encodeEventTopics({abi:registrationFactoryAbi,eventName:'StoreCreated'})[0].toLowerCase();
    const logs=(receipt.logs??[]).filter(l=>addr(l.address)===addr(original.factory)&&l.topics?.[0]?.toLowerCase()===topic);
    const matches=logs.map(log=>({log,event:decodeEventLog({abi:registrationFactoryAbi,data:log.data,topics:log.topics,strict:true})})).filter(({event})=>event.args.registrationId.toLowerCase()===word(original.registrationId));
    if(matches.length!==1) throw Error('ORIGINAL_CREATED_EVENT');
    const {log,event}=matches[0],a=event.args;
    if(log.removed===true) throw Error('REMOVED_EVENT');
    equal(word(log.transactionHash),hash,'EVENT_TRANSACTION_HASH');
    equal(word(log.blockHash),blockHash,'EVENT_BLOCK_HASH');
    equal(safe(log.blockNumber),blockNumber,'EVENT_BLOCK_NUMBER');
    const logIndex=safe(log.logIndex),escrow=addr(a.escrow);
    equal(word(a.storeId),word(original.storeId),'EVENT_STORE');
    equal(addr(a.owner),addr(original.owner),'EVENT_OWNER');
    equal(word(a.configHash),v.configHash,'EVENT_CONFIG_HASH');
    if(a.slot>=3n) throw Error('EVENT_SLOT');
    const snapshot={blockHash,requireCanonical:true};
    const call=async(target,abi,functionName,args=[])=>decodeFunctionResult({abi,functionName,data:await request('eth_call',[{to:target,data:encodeFunctionData({abi,functionName,args})},snapshot])});
    verifyRuntimeTemplate(await request('eth_getCode',[original.factory,snapshot]),'factory',profile.runtimeTemplatePins.factory);
    verifyRuntimeTemplate(await request('eth_getCode',[escrow,snapshot]),'escrow',profile.runtimeTemplatePins.escrow);
    for(const field of FIELDS.filter(f=>f!=='factory')) equal(addr(await call(original.factory,observerFactoryAbi,field)),addr(original[field]),'FACTORY_'+field);
    equal(word(await call(original.factory,observerFactoryAbi,'escrowCreationCodeHash')),compiledStoreEscrowCreationCodeHash,'FACTORY_CODE_HASH');
    const uses=await call(original.factory,observerFactoryAbi,'registrationUses',[word(original.registrationId)]);
    equal(word(uses[0]),v.parametersDigest,'REGISTRATION_USE_DIGEST'); equal(addr(uses[1]),escrow,'REGISTRATION_USE_ESCROW');
    equal(addr(await call(original.factory,observerFactoryAbi,'escrowFor',[word(original.storeId)])),escrow,'ESCROW_FOR');
    equal(addr(await call(original.factory,observerFactoryAbi,'escrows',[a.slot])),escrow,'FACTORY_SLOT');
    equal(word(await call(original.factory,observerFactoryAbi,'registrationDigest',[v.typedData.message])),v.parametersDigest,'FACTORY_EIP712_DIGEST');
    for(const field of ['asset','owner','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']) equal(addr(await call(escrow,observerEscrowAbi,field)),addr(original[field]),'ESCROW_'+field);
    equal(addr(await call(escrow,observerEscrowAbi,'receiver')),addr(original.owner),'ESCROW_RECEIVER');
    equal(word(await call(escrow,observerEscrowAbi,'storeId')),word(original.storeId),'ESCROW_STORE');
    const domain=await call(escrow,observerEscrowAbi,'eip712Domain');
    equal(domain[0],'0x0f','ESCROW_DOMAIN_FIELDS'); equal(domain[1],'MealForward C0 Funding','ESCROW_DOMAIN_NAME'); equal(domain[2],'1','ESCROW_DOMAIN_VERSION');
    equal(domain[3],BigInt(v.binding.chainId),'ESCROW_DOMAIN_CHAIN'); equal(addr(domain[4]),escrow,'ESCROW_DOMAIN_ADDRESS');
    equal(word(domain[5]),'0x'+'0'.repeat(64),'ESCROW_DOMAIN_SALT'); if(domain[6].length!==0) throw Error('ESCROW_DOMAIN_EXTENSIONS');
    const normalizedTerms=t=>Object.fromEntries(Object.entries(t).map(([k,x])=>[k,typeof x==='bigint'?x:typeof x==='number'?BigInt(x):/^0x/.test(x)?x.toLowerCase():BigInt(x)]));
    for(const entry of v.catalog) {
      const t=normalizedTerms(entry.terms);
      const observed=await call(escrow,observerEscrowAbi,'getTerms',[t.mealId,t.version]);
      const expectedHash=await call(escrow,observerEscrowAbi,'computeTermsHash',[entry.terms]);
      equal(word(observed.termsHash),word(expectedHash),'CATALOG_TERMS_HASH');
      for(const field of ['unitPrice','bodyDigest','imageDigest','windowCount','startMinute0','endMinute0','startMinute1','endMinute1']) {
        const x=observed[field]; equal(typeof x==='number'?BigInt(x):typeof x==='string'?x.toLowerCase():x,t[field],'CATALOG_'+field);
      }
      if(entry.current) {
        equal(await call(escrow,observerEscrowAbi,'currentVersion',[t.mealId]),t.version,'CATALOG_CURRENT_VERSION');
        equal(await call(escrow,observerEscrowAbi,'listed',[t.mealId]),true,'CATALOG_LISTED');
      }
    }
    const probe={quoteId:'0x'+'1'.padStart(64,'0'),payer:original.owner,mealId:v.catalog[0].terms.mealId,
      currentVersion:BigInt(v.catalog[0].terms.version),termsHash:await call(escrow,observerEscrowAbi,'computeTermsHash',[v.catalog[0].terms]),
      quantity:1n,unitPrice:BigInt(v.catalog[0].terms.unitPrice),amount:BigInt(v.catalog[0].terms.unitPrice),deadline:BigInt(original.deadline)};
    const probeTypes=observerEscrowAbi.find(e=>e.name==='quoteDigest').inputs[0].components.map(({name,type})=>({name,type}));
    const expectedQuoteDigest=hashTypedData({domain:{name:'MealForward C0 Funding',version:'1',chainId:v.binding.chainId,verifyingContract:escrow},
      types:{FundingQuote:probeTypes},primaryType:'FundingQuote',message:probe});
    equal(word(await call(escrow,observerEscrowAbi,'quoteDigest',[probe])),expectedQuoteDigest,'ESCROW_EIP712_DIGEST');
    const ending=await request('eth_getBlockByNumber',[tag(BigInt(blockNumber)),false]);
    equal(word(ending?.hash),blockHash,'CANONICAL_CHANGED');
    equal(quantity(await request('eth_chainId',[])),BigInt(v.binding.chainId),'CHAIN_CHANGED');
    const evidence={...structuredClone(original),configHash:v.configHash,parametersDigest:v.parametersDigest,
      receiver:addr(original.owner),deployment:structuredClone(deployment),escrow,transactionHash:hash,blockHash,blockNumber,logIndex};
    return {status:'VERIFIED',reason:'CANONICAL_FINALIZED_ORIGINAL_CONFIG',evidence};
  } catch(error) {
    const reason=typeof error.message==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:'VERIFICATION_FAILED';
    return {status:['UNSUPPORTED_RUNTIME_TEMPLATE','INVALID_FIXED_TEMPLATE','UNSUPPORTED_FINALITY_PROFILE'].includes(reason)?'UNVERIFIED':'UNKNOWN',reason,evidence:null};
  }
}

/** ReceiptVerifier adapter: only complete evidence crosses the domain commit boundary. */
export function createReceiptVerifier({transport,profile}) {
  return {verify_original:async(original,transactionHash,deployment)=>{
    const result=await observeRegistration({transport,profile,original,transactionHash,deployment});
    return result.status==='VERIFIED'?result.evidence:null;
  }};
}
