// Independent V3 deployment review. No signer, broadcast, approval-registry writes or secret loading.
import {ContractFactory,Interface,keccak256,formatEther,toQuantity,getCreateAddress} from 'ethers';
import {TARGET as V2_PUBLIC_TARGET,verificationArtifactDigest,normalizedRuntime,reserveReview,reviewConfiguration} from '../product-v2/deployment-review.mjs';
export {verificationArtifactDigest,normalizedRuntime,reserveReview,reviewConfiguration};
export const CREATION_CODE_HASH='0x46d42d619518518c78adb453437890040ad5bc3535df23913abba7299190f19c';
export const VERIFICATION_ARTIFACT_HASH='0x78ade420bdacfdc07afff5d923348a7d786bb9b830fe108b999fdc08e2b23a9a';
// Operational budgets retain the approved public product-v2/monad-deployment.json values.
export const OPERATION_BUDGET=Object.freeze({maxFeePerGas:'300000000000',maxTransactionFee:'300000000000000000',claimGasLimit:'1000000',settlementGasLimit:'1000000'});
// Only public fixed addresses are reused. The V2 commit and deployed contract are not V3 evidence.
export const TARGET=Object.freeze(Object.fromEntries(['chainId','deployer','asset','assetCodeHash','claimAuthority','redemptionAuthority','policySeconds'].map(k=>[k,V2_PUBLIC_TARGET[k]]).concat([['contractVersion',3]])));
const requireThat=(ok,code)=>{if(!ok)throw Error(code);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const isHash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n;
function reviewTarget(profile,localTarget){
 if(profile==='monad-testnet'){requireThat(!localTarget,'LOCAL_TARGET_FORBIDDEN');return TARGET;}
 requireThat(profile==='local-acceptance'&&localTarget?.chainId===31337&&localTarget.policySeconds===7200,'INVALID_REVIEW_PROFILE');
 requireThat(['deployer','asset','claimAuthority','redemptionAuthority'].every(k=>address(localTarget[k]))&&isHash(localTarget.assetCodeHash),'INVALID_LOCAL_TARGET');
 requireThat(new Set(['deployer','claimAuthority','redemptionAuthority'].map(k=>localTarget[k].toLowerCase())).size===3,'DUPLICATE_AUTHORITIES');
 return Object.freeze(Object.fromEntries(Object.keys(TARGET).map(k=>[k,k==='contractVersion'?3:localTarget[k]])));
}
export function assertDeploymentTransaction(tx, data, target=TARGET) {
  requireThat(tx && tx.to===null && same(tx.from,target.deployer) && BigInt(tx.value)===0n &&
    BigInt(tx.chainId)===BigInt(target.chainId) && same(tx.data,data), 'NOT_EXPECTED_DEPLOYMENT');
}
export async function makeReview(provider, artifact, {profile='monad-testnet',localTarget}={}) {
  const target=reviewTarget(profile,localTarget);
  requireThat(keccak256(artifact.bytecode.object)===CREATION_CODE_HASH,'UNPINNED_DEPLOYMENT_ARTIFACT');
  requireThat(verificationArtifactDigest(artifact)===VERIFICATION_ARTIFACT_HASH,'UNPINNED_VERIFICATION_ARTIFACT');
  const {data}=await new ContractFactory(artifact.abi,artifact.bytecode.object).getDeployTransaction(
    target.asset,target.claimAuthority,target.redemptionAuthority,target.policySeconds);
  const abi=new Interface(artifact.abi);
  async function read(address, name, tag) {
    const payload=abi.encodeFunctionData(name,[]);
    return abi.decodeFunctionResult(name,await provider.send('eth_call',[{to:address,data:payload},tag]))[0];
  }
  async function preflight() {
    requireThat(BigInt(await provider.send('eth_chainId',[]))===BigInt(target.chainId),'WRONG_CHAIN');
    const block=await provider.send('eth_getBlockByNumber',['finalized',false]);
    requireThat(isHash(block?.hash)&&/^0x[0-9a-f]+$/i.test(block?.number),'FINALITY_UNAVAILABLE');
    const assetCode=await provider.send('eth_getCode',[target.asset,block.number]);
    requireThat(keccak256(assetCode)===target.assetCodeHash,'ASSET_CODE_CHANGED');
    const decimals=await provider.send('eth_call',[{to:target.asset,data:'0x313ce567'},block.number]);
    requireThat(BigInt(decimals)===6n,'ASSET_DECIMALS_CHANGED');
    for (const address of [target.deployer,target.claimAuthority,target.redemptionAuthority]) {
      requireThat(await provider.send('eth_getCode',[address,block.number])==='0x','ACCOUNT_HAS_CODE');
    }
    const [nonce,pending,price,estimate,balance]=await Promise.all([
      provider.send('eth_getTransactionCount',[target.deployer,'latest']),
      provider.send('eth_getTransactionCount',[target.deployer,'pending']),
      provider.send('eth_gasPrice',[]),
      provider.send('eth_estimateGas',[{from:target.deployer,data,value:'0x0'}]),
      provider.send('eth_getBalance',[target.deployer,'latest']),
    ]);
    requireThat(BigInt(nonce)===BigInt(pending),'DEPLOYER_HAS_PENDING_TRANSACTION');
    const gas=(BigInt(estimate)*120n+99n)/100n, gasPrice=(BigInt(price)*120n+99n)/100n;
    requireThat(gasPrice>0n && gasPrice<=300_000_000_000n && gas*gasPrice<=2n*10n**18n,'DEPLOYMENT_BUDGET_EXCEEDED');
    requireThat(BigInt(balance)>=gas*gasPrice,'INSUFFICIENT_DEPLOYMENT_GAS');
    const canonical=await provider.send('eth_getBlockByNumber',[block.number,false]);
    requireThat(canonical?.hash===block.hash,'CHAIN_CHANGED');
    return {...target,data,dataHash:keccak256(data),nonce:toQuantity(BigInt(nonce)),gas:toQuantity(gas),gasPrice:toQuantity(gasPrice),
      maximumMon:formatEther(gas*gasPrice),checkedAt:Date.now(),finalizedBlock:Number(BigInt(block.number))};
  }
  async function verify(hash,attempt) {
    requireThat(/^0x[0-9a-f]{64}$/i.test(hash),'INVALID_HASH');
    attempt=checkedAttempt(attempt);
    requireThat(BigInt(await provider.send('eth_chainId',[]))===BigInt(target.chainId),'WRONG_CHAIN');
    const [tx,receipt,final]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash),provider.getBlock('finalized')]);
    assertDeploymentTransaction(tx,data,target);
    requireThat(BigInt(tx.nonce)===BigInt(attempt.nonce) && tx.gasLimit<=BigInt(attempt.gas) &&
      (tx.maxFeePerGas??tx.gasPrice)<=BigInt(attempt.gasPrice),'ORIGINAL_REVIEW_MISMATCH');
    requireThat(receipt && receipt.status===1 && receipt.contractAddress && final && Number.isSafeInteger(receipt.blockNumber) && receipt.blockNumber>=0 && Number.isSafeInteger(final.number) && receipt.blockNumber<=final.number,'NOT_FINAL_SUCCESS');
    requireThat(same(tx.hash,hash) && same(receipt.hash,hash) && same(receipt.from,tx.from) && receipt.to===null &&
      isHash(receipt.blockHash) && receipt.blockHash===tx.blockHash && receipt.blockNumber===tx.blockNumber &&
      same(receipt.contractAddress,getCreateAddress({from:tx.from,nonce:tx.nonce})) &&
      receipt.gasUsed<=BigInt(attempt.gas) && receipt.gasPrice<=BigInt(attempt.gasPrice),'RECEIPT_MISMATCH');
    const block=await provider.getBlock(receipt.blockNumber);
    requireThat(block?.hash===receipt.blockHash,'NON_CANONICAL_RECEIPT');
    requireThat(isHash(final.hash),'FINALITY_UNAVAILABLE');
    const tag=toQuantity(final.number), escrow=receipt.contractAddress;
    const assetCode=await provider.send('eth_getCode',[target.asset,tag]);
    requireThat(keccak256(assetCode)===target.assetCodeHash,'ASSET_CODE_CHANGED');
    requireThat(BigInt(await provider.send('eth_call',[{to:target.asset,data:'0x313ce567'},tag]))===6n,'ASSET_DECIMALS_CHANGED');
    const code=await provider.send('eth_getCode',[escrow,tag]);
    requireThat(normalizedRuntime(code,artifact.deployedBytecode.immutableReferences)===
      normalizedRuntime(artifact.deployedBytecode.object,artifact.deployedBytecode.immutableReferences),'WRONG_RUNTIME');
    for (const name of ['asset','claimAuthority','redemptionAuthority','policySeconds','contractVersion']) {
      requireThat(same(await read(escrow,name,tag),target[name]),'WRONG_CONSTRUCTOR_'+name);
    }
    const receiptAgain=await provider.getBlock(receipt.blockNumber);
    requireThat(receiptAgain?.hash===receipt.blockHash,'NON_CANONICAL_RECEIPT');
    const finalAgain=await provider.getBlock(final.number);
    requireThat(finalAgain?.hash===final.hash,'FINALITY_CHANGED');
    return {...target,...OPERATION_BUDGET,reviewStatus:'VERIFIED_CANDIDATE_NOT_APPROVED',creationCodeHash:CREATION_CODE_HASH,verificationArtifactHash:VERIFICATION_ARTIFACT_HASH,escrow,escrowCodeHash:keccak256(code),assetDecimals:6,deploymentBlock:receipt.blockNumber,
      transactionHash:hash,finalizedBlock:final.number,finalizedHash:final.hash};
  }
  function checkedAttempt(attempt) {
    requireThat(attempt && Object.keys(attempt).every(k=>['nonce','gas','gasPrice','dataHash','createdAt'].includes(k)) && attempt.dataHash===keccak256(data),'MISSING_ORIGINAL_REVIEW');
    for(const key of ['nonce','gas','gasPrice'])requireThat(typeof attempt[key]==='string'&&/^0x[0-9a-f]+$/i.test(attempt[key]),'INVALID_ORIGINAL_REVIEW');
    requireThat(BigInt(attempt.nonce)<=BigInt(Number.MAX_SAFE_INTEGER)&&BigInt(attempt.gas)>0n&&BigInt(attempt.gasPrice)>0n&&BigInt(attempt.gasPrice)<=300_000_000_000n&&BigInt(attempt.gas)*BigInt(attempt.gasPrice)<=2n*10n**18n,'DEPLOYMENT_BUDGET_EXCEEDED');
    return {...attempt};
  }
  function restore(attempt) {
    const original=checkedAttempt(attempt);
    return {...target,data,...original,maximumMon:formatEther(BigInt(original.gas)*BigInt(original.gasPrice)),attempt:original};
  }
  return {preflight,verify,restore};
}
