/**
 * Read-only original Monad Testnet TX/receipt reconciliation. A successful
 * receipt by itself is NEVER sufficient to call an Approve or Fund successful.
 * Must match reserved nonce, sender, exact calldata hash, token events,
 * contract events and actual read-back at the receipt block.
 * All RPC methods here are read-only; no wallet methods or private keys.
 */
import {Interface,keccak256} from 'ethers';

const CHAIN=10143;
const ESCROW='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
const TOKEN='0x534b2f3a21130d7a60830c2df862319e593943a3';
const strict=(v,c)=>{if(!v)throw Error(c)};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const num=n=>{try{return BigInt(n)}catch{throw Error('INVALID_CHAIN_NUMBER')}};
const ERC20=new Interface([
 'function allowance(address owner,address spender) view returns (uint256)',
 'function balanceOf(address owner) view returns (uint256)',
 'event Approval(address indexed owner,address indexed spender,uint256 value)',
 'event Transfer(address indexed from,address indexed to,uint256 value)'
]);
const ESCROW_ABI=new Interface([
 'event Funded(bytes32 indexed quoteId,bytes32 indexed batchId,address indexed payer,bytes32 mealId,uint256 version,bytes32 termsHash,uint256 unitPrice,uint256 quantity,uint256 firstUnit,uint256 amount)',
 'function liability() view returns (uint256)',
 'function quoteUses(bytes32 quoteId) view returns (bytes32 payloadHash,bytes32 batchId)',
 'function quotePayloadHash((bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline) quote) pure returns (bytes32)'
]);

async function readAt(rpc,contract,abi,fn,args=[],tag){
 const result=await rpc.send('eth_call',[{
  to:contract,data:abi.encodeFunctionData(fn,args)
 },tag]);
 strict(typeof result==='string'&&/^0x[0-9a-f]*$/i.test(result),'INVALID_READ_PROOF');
 try{return abi.decodeFunctionResult(fn,result)}
 catch{throw Error('READ_PROOF_DECODE_FAILED_'+fn)}
}
function parseEvent(log,iface,event){
 try{
  const decoded=iface.parseLog(log);
  return decoded?.name===event?decoded.args:null;
 }catch{return null}
}
function txMatches(tx,old){
 strict(tx&&same(tx.hash,old.tx_hash),'ORIGINAL_TX_NOT_FOUND');
 strict(same(tx.from,old.payer)&&same(tx.to,old.tx_to) &&
   num(tx.nonce)===num(old.tx_nonce) &&
   num(tx.value??'0x0')===0n &&
   same(keccak256(tx.input??tx.data),old.tx_data_hash),
   'ORIGINAL_TX_BYTES_OR_NONCE_MISMATCH');
 if(tx.chainId!==undefined&&tx.chainId!==null)
  strict(num(tx.chainId)===BigInt(CHAIN),'TX_CHAIN_ID_MISMATCH');
}
function verifyApproveLogs(receipt,old,intent){
 const expected=BigInt(intent.amount);
 let count=0;
 for(const log of receipt.logs){
  if(!same(log.address,TOKEN))continue;
  const args=parseEvent(log,ERC20,'Approval');
  if(!args)continue;
  if(same(args.owner,old.payer)&&same(args.spender,ESCROW)&&args.value===expected)count++;
 }
 strict(count===1,'ORIGINAL_APPROVAL_EVENT_NOT_PROVEN');
}
async function verifyFundLogs(receipt,old,intent,rpc){
 let funded=null,transfer=0;
 for(const log of receipt.logs){
  if(same(log.address,ESCROW)){
   const ev=parseEvent(log,ESCROW_ABI,'Funded');
   if(!ev)continue;
   strict(funded===null,'DUPLICATE_FUNDED_EVENT');
   funded=ev;
  }else if(same(log.address,TOKEN)){
   const ev=parseEvent(log,ERC20,'Transfer');
   if(ev&&same(ev.from,old.payer)&&same(ev.to,ESCROW)&&
    ev.value===BigInt(intent.amount))transfer++;
  }
 }
 strict(funded!==null,'ORIGINAL_FUNDED_EVENT_NOT_PROVEN');
 strict(same(funded.quoteId,intent.quote_id)&&same(funded.payer,old.payer)&&
  same(funded.mealId,intent.meal_id)&&same(funded.termsHash,intent.terms_hash)&&
  funded.version===BigInt(intent.version)&&
  funded.unitPrice===BigInt(intent.unit_price)&&
  funded.quantity===BigInt(intent.quantity)&&funded.amount===BigInt(intent.amount),
  'ORIGINAL_FUNDED_FIELDS_MISMATCH');
 strict(transfer===1,'EXACT_ERC20_TRANSFER_NOT_PROVEN');
 const at=receipt.blockNumber;
 const [use,liability,balance]=await Promise.all([
  readAt(rpc,ESCROW,ESCROW_ABI,'quoteUses',[intent.quote_id],at),
  readAt(rpc,ESCROW,ESCROW_ABI,'liability',[],at),
  readAt(rpc,TOKEN,ERC20,'balanceOf',[ESCROW],at)
 ]);
 strict(same(use.batchId,funded.batchId)&&
  funded.batchId!=='0x'+'0'.repeat(64),'ORIGINAL_QUOTE_USE_NOT_RECORDED');
 strict(balance[0]>=liability[0],'POST_FUND_ESCROW_INSOLVENT');
}
export async function verifyOriginalAttemptReceipt({rpc,kind,original,intent}={}){
 strict(typeof rpc?.send==='function','READ_ONLY_RPC_REQUIRED');
 strict(kind==='approve'||kind==='fund','UNSUPPORTED_KIND');
 strict(original?.status==='HASH_BOUND','ORIGINAL_TX_HASH_NOT_BOUND');
 const [chain,tx,receipt,head]=await Promise.all([
  rpc.send('eth_chainId',[]),
  rpc.send('eth_getTransactionByHash',[original.tx_hash]),
  rpc.send('eth_getTransactionReceipt',[original.tx_hash]),
  rpc.send('eth_blockNumber',[])
 ]);
 strict(num(chain)===BigInt(CHAIN),'WRONG_MONAD_NETWORK');
 txMatches(tx,original);
 if(receipt===null)return {status:'PENDING',txHash:original.tx_hash};
 strict(same(receipt.transactionHash,original.tx_hash)&&
  same(receipt.from,original.payer)&&same(receipt.to,original.tx_to),
  'ORIGINAL_RECEIPT_IDENTITY_MISMATCH');
 strict(same(tx.blockHash,receipt.blockHash)&&
  num(tx.blockNumber)===num(receipt.blockNumber),
  'TX_RECEIPT_BLOCK_MISMATCH');
 const depth=num(head)-num(receipt.blockNumber)+1n;
 strict(depth>=2n&&depth<100000n,'RECEIPT_NOT_CONFIRMED');
 const at=await rpc.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
 strict(at&&same(at.hash,receipt.blockHash),'NON_CANONICAL_RECEIPT_BLOCK');
 const status=num(receipt.status);
 strict(status===0n||status===1n,'INVALID_RECEIPT_STATUS');
 if(status===1n){
  strict(Array.isArray(receipt.logs),'MISSING_EVENT_LOGS');
  if(kind==='approve'){
   verifyApproveLogs(receipt,original,intent);
   const allowed=await readAt(rpc,TOKEN,ERC20,'allowance',[original.payer,ESCROW],receipt.blockNumber);
   strict(allowed[0]>=BigInt(intent.amount),'ORIGINAL_ALLOWANCE_NOT_PROVEN');
  }else await verifyFundLogs(receipt,original,intent,rpc);
 }
 const again=await rpc.send('eth_getBlockByNumber',[receipt.blockNumber,false]);
 strict(again&&same(again.hash,receipt.blockHash),'REORG_DURING_RECEIPT_PROOF');
 return {
  status:status===1n?'CONFIRMED':'REVERTED',
  txHash:original.tx_hash,
  blockNumber:num(receipt.blockNumber).toString(),
  blockHash:receipt.blockHash.toLowerCase(),
  confirmations:depth.toString(),
  safeToBroadcastAgain:false
 };
}
export {ERC20,ESCROW_ABI};
