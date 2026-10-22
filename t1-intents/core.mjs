/**
 * Isolated MealForward T1-C PostgreSQL ledger. INTERNAL ONLY; no HTTP
 * service, private key, signer, transaction broadcaster, or old CP30 access.
 *
 * A caller must inject its own genuine verified-wallet session resolver.
 * Browser-supplied payer strings are NOT an authentication system.
 */
import {randomUUID,randomBytes} from 'node:crypto';
import {Interface,TypedDataEncoder,verifyTypedData,keccak256,getAddress} from 'ethers';
import {verifyOriginalAttemptReceipt} from './receipt.mjs';

const CHAIN=10143;
const ESCROW='0xcf0c8827c8610eeff1ecbd9719e559d805fafe58';
const TOKEN='0x534b2f3a21130d7a60830c2df862319e593943a3';
const MEAL='0x44f977bbf22112030199e42ccf232d08fe6e8223be9c274944c8a40671f6ae6b';
const TERMS='0x0ec28ec279f5a4b4321da6d4b1698fea8e57cd8a64743de02677c73cb86a9222';
const QUOTE='0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952';
const PRICE=7000000n;
const RFC_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const stop=(ok,reason)=>{if(!ok)throw Error(reason)};
const validWallet=raw=>{
 stop(typeof raw==='string'&&/^0x[0-9a-f]{40}$/i.test(raw),'UNVERIFIED_WALLET');
 const val=getAddress(raw).toLowerCase();
 stop(!same(val,'0x0000000000000000000000000000000000000000'),'ZERO_WALLET');
 return val;
};
const signatureDomain=Object.freeze({
 name:'MealForward C0 Funding',version:'1',chainId:CHAIN,verifyingContract:ESCROW
});
const quoteTypes=Object.freeze({
 FundingQuote:[
  {name:'quoteId',type:'bytes32'},{name:'payer',type:'address'},
  {name:'mealId',type:'bytes32'},{name:'currentVersion',type:'uint256'},
  {name:'termsHash',type:'bytes32'},{name:'quantity',type:'uint256'},
  {name:'unitPrice',type:'uint256'},{name:'amount',type:'uint256'},
  {name:'deadline',type:'uint256'}
 ]
});
const erc20=new Interface(['function approve(address spender,uint256 value) returns (bool)']);
const escrowAbi=new Interface([
 'function fund((bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline) quote,bytes signature) returns (bytes32)'
]);
const nowSecs=()=>Math.floor(Date.now()/1000);
const cleanHash=x=>{stop(HASH.test(x),'INVALID_HASH');return x.toLowerCase()};
const validNonce=x=>{
 stop((typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)||
  (typeof x==='bigint'&&x>=0n&&x<=BigInt(Number.MAX_SAFE_INTEGER))||
  (typeof x==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(x)&&BigInt(x)<=BigInt(Number.MAX_SAFE_INTEGER)),
 'INVALID_WALLET_NONCE');
 return BigInt(x).toString();
};
const quoteFromRow=i=>Object.freeze({
 quoteId:i.quote_id,payer:i.payer,mealId:i.meal_id,
 currentVersion:BigInt(i.version),termsHash:i.terms_hash,
 quantity:BigInt(i.quantity),unitPrice:BigInt(i.unit_price),
 amount:BigInt(i.amount),deadline:BigInt(i.quote_deadline)
});
const display=i=>({
 intentId:i.intent_id,stage:i.stage,quoteId:i.quote_id,
 chainId:i.chain_id,escrow:i.escrow,payer:i.payer,
 mealId:i.meal_id,quantity:i.quantity,
 amount:i.amount.toString(),unitPrice:i.unit_price.toString(),
 quoteDeadline:i.quote_deadline.toString(),
 quoteDigest:i.quote_digest,
 quoteSignatureFingerprint:i.quote_signature_hash,
 revision:i.revision.toString()
});
async function inTx(pool,fn){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const result=await fn(c);
  await c.query('COMMIT');
  return result;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
 finally{c.release()}
}
async function originalIntent(c,id,payer){
 stop(RFC_UUID.test(id),'INVALID_INTENT_ID');
 const r=await c.query('SELECT * FROM mf_t1c.intents WHERE intent_id=$1 AND payer=$2 FOR UPDATE',[id,payer]);
 stop(r.rowCount===1,'INTENT_NOT_FOUND');
 return r.rows[0];
}
async function attempt(c,id,kind,lock=true){
 const r=await c.query('SELECT * FROM mf_t1c.wallet_attempts WHERE intent_id=$1 AND kind=$2 '+(lock?'FOR UPDATE':''),[id,kind]);
 stop(r.rowCount===1,'ORIGINAL_ATTEMPT_NOT_FOUND');
 return r.rows[0];
}
async function event(c,id,type,hash=null){
 await c.query('INSERT INTO mf_t1c.audit_events(intent_id,event_type,public_tx_hash) VALUES($1,$2,$3)',[id,type,hash]);
}
function expectedAttempt(i,kind,tx,authority){
 stop(tx&&typeof tx==='object','WALLET_TX_REQUIRED');
 const sender=validWallet(tx.from);
 stop(sender===i.payer,'TX_PAYER_MISMATCH');
 const nonce=validNonce(tx.nonce);
 stop(BigInt(tx.value??'0')===0n,'TX_VALUE_MUST_BE_ZERO');
 stop(typeof tx.data==='string'&&/^0x[0-9a-f]+$/i.test(tx.data)&&tx.data.length>=10,'TX_CALLDATA_REQUIRED');
 const calldata=tx.data.toLowerCase();
 let to;
 if(kind==='approve'){
  to=TOKEN;
  const decoded=erc20.parseTransaction({data:calldata});
  stop(decoded?.name==='approve','ONLY_EXACT_ERC20_APPROVE');
  stop(same(decoded.args[0],ESCROW)&&decoded.args[1]===BigInt(i.amount),'APPROVE_ALLOWANCE_NOT_EXACT');
 }else if(kind==='fund'){
  to=ESCROW;
  const decoded=escrowAbi.parseTransaction({data:calldata});
  stop(decoded?.name==='fund','ONLY_ORIGINAL_FUND_CALLDATA');
  const q=decoded.args[0],wanted=quoteFromRow(i);
  for(const name of ['quoteId','payer','mealId','termsHash'])
   stop(same(q[name],wanted[name]),'QUOTE_CALLDATA_MISMATCH_'+name);
  for(const name of ['currentVersion','quantity','unitPrice','amount','deadline'])
   stop(BigInt(q[name])===BigInt(wanted[name]),'QUOTE_CALLDATA_MISMATCH_'+name);
  stop(i.quote_signature_hash!==null&&same(keccak256(decoded.args[1]),i.quote_signature_hash),
   'QUOTE_SIGNATURE_FINGERPRINT_MISMATCH');
  stop(same(verifyTypedData(signatureDomain,quoteTypes,wanted,decoded.args[1]),authority),
   'QUOTE_SIGNATURE_AUTHORITY_MISMATCH');
 }else throw Error('UNSUPPORTED_WALLET_KIND');
 stop(same(tx.to,to),'ORIGINAL_TRANSACTION_TARGET_MISMATCH');
 return {payer:sender,to,nonce,calldataHash:keccak256(calldata),calldata};
}

export function createT1IntentLedger({
 pool,resolveWallet,now=nowSecs,quoteAuthority=QUOTE,persistSignedQuotes=false
}={}){
 stop(pool&&typeof pool.connect==='function','POSTGRES_POOL_REQUIRED');
 stop(typeof resolveWallet==='function','SERVER_VERIFIED_PRINCIPAL_REQUIRED');
 stop(typeof now==='function','CLOCK_REQUIRED');
 stop(typeof persistSignedQuotes==='boolean','INVALID_SIGNED_QUOTE_PERSISTENCE_POLICY');
 const authority=validWallet(quoteAuthority);
 if(authority!==QUOTE){
  stop(process.env.GITHUB_ACTIONS==='true'&&
   process.env.MF_T1C_DISPOSABLE_ONLY==='ack-fresh-t1c-postgres17',
   'REAL_T1_QUOTE_AUTHORITY_IMMUTABLE');
 }
 async function payerFromSession(session){
  const principal=await resolveWallet(session);
  stop(principal?.verified===true&&principal.source==='TESTNET_WALLET_AUTHORITY',
   'UNVERIFIED_T1_WALLET_PRINCIPAL');
  return validWallet(principal.address);
 }
 async function prepare({session,idempotencyKey,quantity}={}){
  const payer=await payerFromSession(session);
  stop(typeof idempotencyKey==='string'&&RFC_UUID.test(idempotencyKey),'INVALID_IDEMPOTENCY_KEY');
  stop(Number.isInteger(quantity)&&quantity>=1&&quantity<=10,'INVALID_QUANTITY');
  const id=randomUUID(),quoteId='0x'+randomBytes(32).toString('hex');
  const deadline=BigInt(now()+1800);
  stop(deadline>0n,'BAD_SERVER_QUOTE_CLOCK');
  return inTx(pool,async c=>{
   await c.query(
    'INSERT INTO mf_t1c.intents '+
    '(intent_id,payer,idempotency_key,quote_id,meal_id,terms_hash,version,quantity,unit_price,amount,quote_deadline) '+
    'VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10) '+
    'ON CONFLICT (chain_id,escrow,payer,idempotency_key) DO NOTHING',
    [id,payer,idempotencyKey,quoteId,MEAL,TERMS,quantity,PRICE.toString(),
     (PRICE*BigInt(quantity)).toString(),deadline.toString()]
   );
   const result=await c.query(
    'SELECT * FROM mf_t1c.intents WHERE chain_id=$1 AND escrow=$2 AND payer=$3 AND idempotency_key=$4 FOR UPDATE',
    [CHAIN,ESCROW,payer,idempotencyKey]
   );
   stop(result.rowCount===1,'INTENT_CREATION_FAILED');
   const row=result.rows[0];
   stop(row.quantity===quantity,'IDEMPOTENCY_PAYLOAD_CONFLICT');
   if(row.intent_id===id)await event(c,id,'INTENT_PREPARED');
   return {...display(row),unsignedQuote:quoteFromRow(row)};
  });
 }
 async function fetchOriginal({session,intentId}={}){
  const payer=await payerFromSession(session);
  const r=await pool.query('SELECT * FROM mf_t1c.intents WHERE intent_id=$1 AND payer=$2',[intentId,payer]);
  stop(r.rowCount===1,'INTENT_NOT_FOUND');
  const a=await pool.query(
   'SELECT kind,status,tx_hash,tx_nonce,receipt_block,receipt_block_hash FROM mf_t1c.wallet_attempts WHERE intent_id=$1 ORDER BY kind',[intentId]);
  return {...display(r.rows[0]),attempts:a.rows.map(x=>({
   kind:x.kind,status:x.status,txHash:x.tx_hash,
   nonce:x.tx_nonce.toString(),block:x.receipt_block?.toString()??null,blockHash:x.receipt_block_hash
  }))};
 }
 async function bindQuote({session,intentId,signature}={}){
  const payer=await payerFromSession(session);
  return inTx(pool,async c=>{
   const i=await originalIntent(c,intentId,payer);
   stop(i.stage==='PREPARED','QUOTE_ALREADY_BOUND_OR_IN_FLIGHT');
   stop(BigInt(i.quote_deadline)>BigInt(now()+5),'ORIGINAL_QUOTE_EXPIRED');
   stop(typeof signature==='string'&&/^0x[0-9a-f]{130}$/i.test(signature),'INVALID_ECDSA_SIGNATURE');
   const quote=quoteFromRow(i);
   stop(same(verifyTypedData(signatureDomain,quoteTypes,quote,signature),authority),
    'ORIGINAL_QUOTE_SIGNER_MISMATCH');
   const digest=TypedDataEncoder.hash(signatureDomain,quoteTypes,quote);
   const signatureHash=keccak256(signature);
   const updated=await c.query(
    'UPDATE mf_t1c.intents SET quote_digest=$3,quote_signature_hash=$4, '+
    "stage='QUOTE_BOUND',revision=revision+1 WHERE intent_id=$1 AND payer=$2 RETURNING *",
    [intentId,payer,digest.toLowerCase(),signatureHash.toLowerCase()]
   );
   if(persistSignedQuotes){
    stop(i.quantity===1&&BigInt(i.amount)===PRICE,
     'T1D_ONLY_ONE_SEVEN_TEST_USDC_QUOTE');
    // The signed capability and stage transition COMMIT atomically.
    await c.query(
     'INSERT INTO mf_t1c.quote_authorizations '+
     '(intent_id,quote_id,signed_authority,quote_digest,signature,signature_fingerprint) '+
     'VALUES($1,$2,$3,$4,$5,$6)',
     [intentId,i.quote_id,QUOTE,digest.toLowerCase(),
      signature.toLowerCase(),signatureHash.toLowerCase()]
    );
   }
   await event(c,intentId,'QUOTE_BOUND');
   return display(updated.rows[0]);
  });
 }
 async function recoverSignedQuote({session,intentId}={}){
  stop(persistSignedQuotes,'SIGNED_QUOTE_RECOVERY_NOT_ENABLED');
  const payer=await payerFromSession(session);
  stop(RFC_UUID.test(intentId||''),'INVALID_INTENT_ID');
  const found=await pool.query(
   'SELECT i.*,q.signature AS signed_signature,q.quote_id AS signed_quote_id,'+
   'q.quote_digest AS signed_digest,q.signature_fingerprint AS signed_fingerprint '+
   'FROM mf_t1c.intents i JOIN mf_t1c.quote_authorizations q '+
   'ON q.intent_id=i.intent_id WHERE i.intent_id=$1 AND i.payer=$2',
   [intentId,payer]
  );
  stop(found.rowCount===1,'SIGNED_QUOTE_NOT_FOUND');
  const r=found.rows[0];
  stop(['QUOTE_BOUND','APPROVE_UNKNOWN','APPROVED'].includes(r.stage),
   'SIGNED_QUOTE_IN_FLIGHT_OR_FINISHED');
  stop(BigInt(r.quote_deadline)>BigInt(now()+5),'SIGNED_QUOTE_EXPIRED');
  const signature=r.signed_signature;
  stop(same(r.quote_id,r.signed_quote_id)&&
   same(r.quote_digest,r.signed_digest)&&
   same(r.quote_signature_hash,r.signed_fingerprint)&&
   same(keccak256(signature),r.quote_signature_hash),
   'ORIGINAL_SIGNED_QUOTE_RECORD_CONFLICT');
  const typed=quoteFromRow(r);
  stop(same(TypedDataEncoder.hash(signatureDomain,quoteTypes,typed),r.quote_digest)&&
   same(verifyTypedData(signatureDomain,quoteTypes,typed,signature),authority),
   'ORIGINAL_SIGNED_QUOTE_INVALID');
  return {
   intentId:r.intent_id,quoteId:r.quote_id,
   signature,quoteDigest:r.quote_digest,
   quoteSignatureFingerprint:r.quote_signature_hash,
   expiresAt:r.quote_deadline.toString(),
   restoredFromOriginalPostgres:true
  };
 }
 async function reserve({session,intentId,kind,transaction}={}){
  const payer=await payerFromSession(session);
  stop(kind==='approve'||kind==='fund','INVALID_ATTEMPT_KIND');
  return inTx(pool,async c=>{
   const i=await originalIntent(c,intentId,payer);
   stop(i.stage===(kind==='approve'?'QUOTE_BOUND':'APPROVED'),
    'ORIGINAL_WALLET_ATTEMPT_UNKNOWN_OR_BLOCKED');
   stop(BigInt(i.quote_deadline)>BigInt(now()+5),'SIGNED_QUOTE_EXPIRED');
   if(kind==='fund'){
    const approved=await attempt(c,intentId,'approve');
    stop(approved.status==='CONFIRMED','ORIGINAL_APPROVAL_NOT_CONFIRMED');
   }
   const tx=expectedAttempt(i,kind,transaction,authority);
   await c.query(
    'INSERT INTO mf_t1c.wallet_attempts(intent_id,kind,chain_id,payer,tx_to,tx_data_hash,tx_nonce) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7)',
    [intentId,kind,CHAIN,tx.payer,tx.to,tx.calldataHash,tx.nonce]
   );
   const stage=kind==='approve'?'APPROVE_UNKNOWN':'FUND_UNKNOWN';
   await c.query('UPDATE mf_t1c.intents SET stage=$2,revision=revision+1 WHERE intent_id=$1',[intentId,stage]);
   await event(c,intentId,kind==='approve'?'APPROVE_RESERVED':'FUND_RESERVED');
   return {intentId,stage,kind,txHash:null,nonce:tx.nonce,
    transactionDigest:tx.calldataHash,mustNotRetryOriginalOperation:true};
  });
 }
 async function bindOriginalHash({session,intentId,kind,txHash,rpc}={}){
  const payer=await payerFromSession(session);
  stop(kind==='approve'||kind==='fund','INVALID_ATTEMPT_KIND');
  const hash=cleanHash(txHash);
  stop(rpc&&typeof rpc.send==='function','READ_ONLY_RPC_REQUIRED');
  const [chain,tx]=await Promise.all([
   rpc.send('eth_chainId',[]),rpc.send('eth_getTransactionByHash',[hash])
  ]);
  stop(BigInt(chain)===BigInt(CHAIN),'WRONG_CHAIN');
  stop(tx&&same(tx.hash,hash),'ORIGINAL_HASH_NOT_FOUND');
  return inTx(pool,async c=>{
   const i=await originalIntent(c,intentId,payer);
   stop(i.stage===(kind==='approve'?'APPROVE_UNKNOWN':'FUND_UNKNOWN'),'INTENT_STAGE_NOT_UNKNOWN');
   const old=await attempt(c,intentId,kind);
   stop(old.status==='UNKNOWN'||(old.status==='HASH_BOUND'&&same(old.tx_hash,hash)),
    'ORIGINAL_HASH_ALREADY_BOUND');
   stop(same(tx.from,old.payer)&&same(tx.to,old.tx_to)&&
    BigInt(tx.nonce).toString()===old.tx_nonce.toString()&&
    BigInt(tx.value??'0x0')===0n&&
    same(keccak256(tx.input??tx.data),old.tx_data_hash),'TX_NOT_ORIGINAL_WALLET_INTENT');
   if(tx.chainId!==undefined&&tx.chainId!==null)
    stop(BigInt(tx.chainId)===BigInt(CHAIN),'TX_CHAIN_CONFLICT');
   if(old.status==='HASH_BOUND')return {intentId,kind,hash,locatorOnly:true};
   await c.query(
    "UPDATE mf_t1c.wallet_attempts SET tx_hash=$3,status='HASH_BOUND' WHERE intent_id=$1 AND kind=$2",
    [intentId,kind,hash]
   );
   await event(c,intentId,kind==='approve'?'APPROVE_HASH_BOUND':'FUND_HASH_BOUND',hash);
   return {intentId,kind,hash,locatorOnly:true};
  });
 }
 async function reconcile({session,intentId,kind,rpc}={}){
  const payer=await payerFromSession(session);
  stop(kind==='approve'||kind==='fund','INVALID_ATTEMPT_KIND');
  const i=await pool.query('SELECT * FROM mf_t1c.intents WHERE intent_id=$1 AND payer=$2',[intentId,payer]);
  stop(i.rowCount===1,'INTENT_NOT_FOUND');
  const a=await pool.query('SELECT * FROM mf_t1c.wallet_attempts WHERE intent_id=$1 AND kind=$2',[intentId,kind]);
  stop(a.rowCount===1,'ORIGINAL_ATTEMPT_NOT_FOUND');
  const previous=a.rows[0];
  if(previous.status==='CONFIRMED'||previous.status==='REVERTED')
   return {status:previous.status,txHash:previous.tx_hash,alreadyFinal:true};
  stop(previous.status==='HASH_BOUND','UNKNOWN_WITHOUT_ORIGINAL_HASH');
  const proof=await verifyOriginalAttemptReceipt({rpc,kind,original:previous,intent:i.rows[0]});
  if(proof.status==='PENDING')return {status:'UNKNOWN',txHash:previous.tx_hash,mustNotRetry:true};
  return inTx(pool,async c=>{
   const locked=await originalIntent(c,intentId,payer);
   const old=await attempt(c,intentId,kind);
   stop(same(old.tx_hash,proof.txHash)&&old.status==='HASH_BOUND',
    'ORIGINAL_ATTEMPT_MOVED_DURING_RECOVERY');
   stop(locked.stage===(kind==='approve'?'APPROVE_UNKNOWN':'FUND_UNKNOWN'),
    'ORIGINAL_STAGE_CHANGED_DURING_RECOVERY');
   const confirmed=proof.status==='CONFIRMED';
   await c.query(
    'UPDATE mf_t1c.wallet_attempts SET status=$3,receipt_block=$4,receipt_block_hash=$5,receipt_status=$6 '+
    'WHERE intent_id=$1 AND kind=$2',
    [intentId,kind,confirmed?'CONFIRMED':'REVERTED',
     proof.blockNumber,proof.blockHash,confirmed?1:0]
   );
   const stage=confirmed?(kind==='approve'?'APPROVED':'FUNDED'):'FAILED';
   await c.query('UPDATE mf_t1c.intents SET stage=$2,revision=revision+1 WHERE intent_id=$1',[intentId,stage]);
   await event(c,intentId,confirmed?
    (kind==='approve'?'APPROVE_CONFIRMED':'FUND_CONFIRMED'):'TX_REVERTED',proof.txHash);
   return {status:confirmed?'CONFIRMED':'REVERTED',stage,txHash:proof.txHash,
    blockNumber:proof.blockNumber,blockHash:proof.blockHash,readOnlyProof:true};
  });
 }
 return Object.freeze({prepare,fetchOriginal,bindQuote,recoverSignedQuote,reserve,bindOriginalHash,reconcile});
}
export {CHAIN,ESCROW,TOKEN,MEAL,TERMS,QUOTE,PRICE,erc20,escrowAbi,quoteTypes,signatureDomain,quoteFromRow};
