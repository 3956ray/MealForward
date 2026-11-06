// Operator-only loopback review. This process has no private keys and never sends transactions.
import { createServer } from 'node:http';
import { readFile, mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ContractFactory, Interface, JsonRpcProvider, FetchRequest, keccak256, formatEther, toQuantity, toUtf8Bytes, getCreateAddress } from 'ethers';

export const TARGET = Object.freeze({
  chainId: 10143,
  deployer: '0xC4F8a468f10d5f98DCfF3282516125E97F26433b',
  asset: '0x534b2f3a21130d7a60830c2df862319e593943a3',
  assetCodeHash: '0x96215e6049ed615cdc22fea7701e85458a8e51a2df3e7d45e8f9fa1d521b5a78',
  claimAuthority: '0x41DCBFED391b79FAC7B2951dD136c6B7e1384259',
  redemptionAuthority: '0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3',
  policySeconds: 7200,
  sourceCommit: 'c69a20162d54a600fe13f2e5bb13898ebbc9334e',
});
const requireThat = (ok, code) => { if (!ok) throw new Error(code); };
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export function verificationArtifactDigest(artifact) {
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  const immutableRanges=Object.values(artifact.deployedBytecode.immutableReferences).flat().sort((a,b)=>a.start-b.start||a.length-b.length);
  // Source maps and compiler AST ids are debug metadata, not verification inputs.
  // Pin the exact ABI, runtime bytes and every masked byte range instead.
  return keccak256(toUtf8Bytes(JSON.stringify(canonical({abi:artifact.abi,runtime:artifact.deployedBytecode.object,immutableRanges}))));
}
export function normalizedRuntime(code, references) {
  requireThat(/^0x(?:[0-9a-f]{2})+$/i.test(code), 'INVALID_RUNTIME');
  let out=code.slice(2).toLowerCase();
  for (const refs of Object.values(references)) for (const {start,length} of refs) {
    requireThat(start>=0 && length>0 && (start+length)*2<=out.length, 'INVALID_IMMUTABLE_REFERENCE');
    out=out.slice(0,start*2)+'0'.repeat(length*2)+out.slice((start+length)*2);
  }
  return out;
}
export function assertDeploymentTransaction(tx, data) {
  requireThat(tx && tx.to===null && same(tx.from,TARGET.deployer) && BigInt(tx.value)===0n &&
    BigInt(tx.chainId)===10143n && same(tx.data,data), 'NOT_EXPECTED_DEPLOYMENT');
}
export async function makeReview(provider, artifact) {
  requireThat(keccak256(artifact.bytecode.object)==='0x3fdd567c59002116e5496f483c7263af959eac3658e5a1da925a2bb99bd7eb87','UNPINNED_DEPLOYMENT_ARTIFACT');
  requireThat(verificationArtifactDigest(artifact)==='0x252fb729e495158b3cbb30fa0bb6902b0e74ab2bdbe60e38c40eda0a61842b72','UNPINNED_VERIFICATION_ARTIFACT');
  const {data}=await new ContractFactory(artifact.abi,artifact.bytecode.object).getDeployTransaction(
    TARGET.asset,TARGET.claimAuthority,TARGET.redemptionAuthority,TARGET.policySeconds);
  const abi=new Interface(artifact.abi);
  async function read(address, name, tag) {
    const payload=abi.encodeFunctionData(name,[]);
    return abi.decodeFunctionResult(name,await provider.send('eth_call',[{to:address,data:payload},tag]))[0];
  }
  async function preflight() {
    requireThat(BigInt(await provider.send('eth_chainId',[]))===10143n,'WRONG_CHAIN');
    const block=await provider.send('eth_getBlockByNumber',['finalized',false]);
    requireThat(block?.hash,'FINALITY_UNAVAILABLE');
    const assetCode=await provider.send('eth_getCode',[TARGET.asset,block.number]);
    requireThat(keccak256(assetCode)===TARGET.assetCodeHash,'ASSET_CODE_CHANGED');
    const decimals=await provider.send('eth_call',[{to:TARGET.asset,data:'0x313ce567'},block.number]);
    requireThat(BigInt(decimals)===6n,'ASSET_DECIMALS_CHANGED');
    for (const address of [TARGET.deployer,TARGET.claimAuthority,TARGET.redemptionAuthority]) {
      requireThat(await provider.send('eth_getCode',[address,block.number])==='0x','ACCOUNT_HAS_CODE');
    }
    const [nonce,pending,price,estimate,balance]=await Promise.all([
      provider.send('eth_getTransactionCount',[TARGET.deployer,'latest']),
      provider.send('eth_getTransactionCount',[TARGET.deployer,'pending']),
      provider.send('eth_gasPrice',[]),
      provider.send('eth_estimateGas',[{from:TARGET.deployer,data,value:'0x0'}]),
      provider.send('eth_getBalance',[TARGET.deployer,'latest']),
    ]);
    requireThat(BigInt(nonce)===BigInt(pending),'DEPLOYER_HAS_PENDING_TRANSACTION');
    const gas=(BigInt(estimate)*120n+99n)/100n, gasPrice=(BigInt(price)*120n+99n)/100n;
    requireThat(gasPrice>0n && gasPrice<=300_000_000_000n && gas*gasPrice<=2n*10n**18n,'DEPLOYMENT_BUDGET_EXCEEDED');
    requireThat(BigInt(balance)>=gas*gasPrice,'INSUFFICIENT_DEPLOYMENT_GAS');
    const canonical=await provider.send('eth_getBlockByNumber',[block.number,false]);
    requireThat(canonical?.hash===block.hash,'CHAIN_CHANGED');
    return {...TARGET,data,dataHash:keccak256(data),nonce:toQuantity(BigInt(nonce)),gas:toQuantity(gas),gasPrice:toQuantity(gasPrice),
      maximumMon:formatEther(gas*gasPrice),checkedAt:Date.now(),finalizedBlock:Number(BigInt(block.number))};
  }
  async function verify(hash,attempt) {
    requireThat(/^0x[0-9a-f]{64}$/i.test(hash),'INVALID_HASH');
    requireThat(attempt && attempt.dataHash===keccak256(data),'MISSING_ORIGINAL_REVIEW');
    requireThat(BigInt(await provider.send('eth_chainId',[]))===10143n,'WRONG_CHAIN');
    const [tx,receipt,final]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash),provider.getBlock('finalized')]);
    assertDeploymentTransaction(tx,data);
    requireThat(BigInt(tx.nonce)===BigInt(attempt.nonce) && tx.gasLimit<=BigInt(attempt.gas) &&
      (tx.maxFeePerGas??tx.gasPrice)<=BigInt(attempt.gasPrice),'ORIGINAL_REVIEW_MISMATCH');
    requireThat(receipt && receipt.status===1 && receipt.contractAddress && final && receipt.blockNumber<=final.number,'NOT_FINAL_SUCCESS');
    requireThat(same(tx.hash,hash) && same(receipt.hash,hash) && same(receipt.from,tx.from) && receipt.to===null &&
      receipt.blockHash===tx.blockHash && receipt.blockNumber===tx.blockNumber &&
      same(receipt.contractAddress,getCreateAddress({from:tx.from,nonce:tx.nonce})) &&
      receipt.gasUsed<=BigInt(attempt.gas) && receipt.gasPrice<=BigInt(attempt.gasPrice),'RECEIPT_MISMATCH');
    const block=await provider.getBlock(receipt.blockNumber);
    requireThat(block?.hash===receipt.blockHash,'NON_CANONICAL_RECEIPT');
    const tag=toQuantity(final.number), escrow=receipt.contractAddress;
    const code=await provider.send('eth_getCode',[escrow,tag]);
    requireThat(normalizedRuntime(code,artifact.deployedBytecode.immutableReferences)===
      normalizedRuntime(artifact.deployedBytecode.object,artifact.deployedBytecode.immutableReferences),'WRONG_RUNTIME');
    for (const name of ['asset','claimAuthority','redemptionAuthority','policySeconds']) {
      requireThat(same(await read(escrow,name,tag),TARGET[name]),'WRONG_CONSTRUCTOR_'+name);
    }
    const finalAgain=await provider.getBlock(final.number);
    requireThat(finalAgain?.hash===final.hash,'FINALITY_CHANGED');
    return {...TARGET,escrow,escrowCodeHash:keccak256(code),assetDecimals:6,deploymentBlock:receipt.blockNumber,
      transactionHash:hash,finalizedBlock:final.number,finalizedHash:final.hash};
  }
  function restore(attempt) {
    requireThat(attempt?.dataHash===keccak256(data),'MISSING_ORIGINAL_REVIEW');
    return {...TARGET,data,...attempt,maximumMon:formatEther(BigInt(attempt.gas)*BigInt(attempt.gasPrice)),attempt};
  }
  return {preflight,verify,restore};
}

export async function reviewConfiguration(review,attempt){return attempt?review.restore(attempt):review.preflight();}

export async function reserveReview(path,attempt) {
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(JSON.stringify(attempt));await file.sync();} finally {await file.close();}
  const directory=await open(new URL('./',path),'r');
  try {await directory.sync();} finally {await directory.close();}
}

export async function startReview({port=0}={}) {
  const artifact=JSON.parse(await readFile(new URL('../../mvp-contracts/out/ProductEscrow.sol/ProductEscrow.json',import.meta.url),'utf8'));
  const rpc=new FetchRequest('https://testnet-rpc.monad.xyz');rpc.timeout=15_000;
  const provider=new JsonRpcProvider(rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
  const review=await makeReview(provider,artifact);
  const html=await readFile(new URL('./deployment-review.html',import.meta.url));
  const js=await readFile(new URL('./deployment-review-client.mjs',import.meta.url));
  const attemptPath=new URL('../../.local-product-acceptance/product-v2-deployment-attempt.json',import.meta.url);
  await mkdir(new URL('./',attemptPath),{recursive:true});
  const getAttempt=async()=>{try{return JSON.parse(await readFile(attemptPath,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const initial=await reviewConfiguration(review,await getAttempt());
  let origin;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const finish=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return finish(403,'{}');
    try {
      const url=new URL(req.url,origin);
      if(req.method==='POST' && url.pathname==='/reserve' && req.headers.origin===origin && req.headers['content-type']==='application/json') {
        requireThat(!await getAttempt(),'ORIGINAL_REVIEW_EXISTS');
        let body='';for await(const chunk of req){body+=chunk;requireThat(body.length<=512,'BODY_TOO_LARGE');}
        const requested=JSON.parse(body),fresh=await review.preflight();
        requireThat(requested.nonce===fresh.nonce && requested.dataHash===fresh.dataHash && BigInt(requested.gas)>=BigInt(fresh.gas) && BigInt(requested.gasPrice)>=BigInt(fresh.gasPrice),'REVIEW_CHANGED');
        requireThat(BigInt(requested.gasPrice)<=300_000_000_000n && BigInt(requested.gas)*BigInt(requested.gasPrice)<=2n*10n**18n,'DEPLOYMENT_BUDGET_EXCEEDED');
        await reserveReview(attemptPath,{nonce:fresh.nonce,dataHash:fresh.dataHash,gas:requested.gas,gasPrice:requested.gasPrice,createdAt:new Date().toISOString()});
        return finish(200,'{"reserved":true}');
      }
      if(req.method!=='GET')return finish(405,'{}');
      if(url.pathname==='/')return finish(200,html,'text/html; charset=utf-8');
      if(url.pathname==='/client.mjs')return finish(200,js,'text/javascript; charset=utf-8');
      if(url.pathname==='/preflight')return finish(200,JSON.stringify(await reviewConfiguration(review,await getAttempt())));
      if(url.pathname==='/verify')return finish(200,JSON.stringify(await review.verify(url.searchParams.get('hash'),await getAttempt())));
      return finish(404,'{}');
    } catch(e){return finish(409,JSON.stringify({error:/^[A-Z_]+$/.test(e.message)?e.message:'READ_CHECK_FAILED'}));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({reviewUrl:origin,maximumMon:initial.maximumMon,dataHash:initial.dataHash,finalizedBlock:initial.finalizedBlock}));
  return {server,provider};
}
if(process.argv[1]===fileURLToPath(import.meta.url))startReview({port:Number(process.env.MF_PRODUCT_DEPLOY_REVIEW_PORT||0)}).catch(()=>{console.error('DEPLOYMENT_PREFLIGHT_FAILED');process.exitCode=1;});
