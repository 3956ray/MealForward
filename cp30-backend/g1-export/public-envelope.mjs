/**
 * CP31 G1 offline public snapshot receiver. SOURCE ONLY, NOT DEPLOYED.
 *
 * Ed25519 verifies who signed this bounded, publicly allowlisted snapshot;
 * it does NOT independently verify chain finality or food delivery.
 * A trusted public key and persistent previous sequence MUST be supplied
 * by the eventual reviewed deployment. No private keys, DB queries or HTTP.
 */
import {createPublicKey,createHash,verify as verifyEd25519} from 'node:crypto';

const CONTEXT='MealForward CP31 G1 PUBLIC DATA ENVELOPE V1\n';
const HEX64=/^[0-9a-f]{64}$/;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const UINT=/^(0|[1-9][0-9]{0,77})$/;
const NONZERO=/^[1-9][0-9]{0,77}$/;
const VERSION=/^[1-9][0-9]{0,17}$/;
const COUNTS=['F','A','R','H','S','X'];
const BUCKETS=['A','R','H','S','X'];
const deny=()=>{const error=new Error('G1_PUBLIC_ENVELOPE_REJECTED');error.code='G1_PUBLIC_ENVELOPE_REJECTED';throw error;};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const fields=(obj,expected)=>{
 if(!plain(obj)||Object.keys(obj).length!==expected.length||
  expected.some(k=>!Object.hasOwn(obj,k)))deny();
};
const safeString=s=>typeof s==='string'&&s.length<=1500&&!s.includes('\u0000');
const array=(x,n)=>Array.isArray(x)&&x.length<=n;
const strId=x=>typeof x==='string'&&HEX64.test(x);
const money=x=>typeof x==='string'&&UINT.test(x);
const positiveMoney=x=>typeof x==='string'&&NONZERO.test(x);
const num=x=>Number.isSafeInteger(x)&&x>=0;

export function canonicalPublicJson(value,depth=0){
 if(depth>12)deny();
 if(value===null)return 'null';
 if(typeof value==='string'){
  if(value.length>65536||value.includes('\u0000'))deny();
  return JSON.stringify(value);
 }
 if(typeof value==='number'){
  if(!Number.isSafeInteger(value))deny();
  return JSON.stringify(value);
 }
 if(typeof value==='boolean')return value?'true':'false';
 if(Array.isArray(value)){
  if(value.length>10000)deny();
  return '['+value.map(v=>canonicalPublicJson(v,depth+1)).join(',')+']';
 }
 if(plain(value)){
  const keys=Object.keys(value).sort();
  if(keys.length>200)deny();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonicalPublicJson(value[k],depth+1)).join(',')+'}';
 }
 deny();
}
export function publicEnvelopeSigningBytes(unsigned){
 fields(unsigned,['v','keyId','audience','issuedAt','expiresAt','sequence','data']);
 return Buffer.from(CONTEXT+canonicalPublicJson(unsigned),'utf8');
}
const validateFinance=(f)=>{
 fields(f,['F','A','R','H','S','X','liability','counts']);
 fields(f.counts,COUNTS);
 for(const key of COUNTS)if(!money(f[key])||!money(f.counts[key]))deny();
 const ct=BUCKETS.reduce((a,k)=>a+BigInt(f.counts[k]),0n);
 const amounts=BUCKETS.reduce((a,k)=>a+BigInt(f[k]),0n);
 if(ct!==BigInt(f.counts.F)||amounts!==BigInt(f.F)||
  BigInt(f.liability)!==BigInt(f.A)+BigInt(f.R)+BigInt(f.H))deny();
};
const validateWindows=windows=>{
 if(!array(windows,2)||windows.length===0)deny();
 let lastEnd=0;
 for(const row of windows){
  if(!Array.isArray(row)||row.length!==2||!row.every(num)||
   row[0]<lastEnd||row[0]>=row[1]||row[1]>1440)deny();
  lastEnd=row[1];
 }
};
export function assertPublicG1Snapshot(payload){
 fields(payload,['mode','source','businessTransactionsAllowed','asOf','stores','ledger','meals']);
 if(payload.mode!=='G1_PUBLIC_SOURCE_PROJECTION_ONLY'||
  payload.source!=='CP30_ORIGINAL_POSTGRES'||
  payload.businessTransactionsAllowed!==false||!num(payload.asOf))deny();
 fields(payload.stores,['items']);fields(payload.ledger,['items']);fields(payload.meals,['items']);
 if(!array(payload.stores.items,1)||!array(payload.ledger.items,1)||
  !array(payload.meals.items,3))deny();
 const stores=new Set(),meals=new Set(),ledgers=new Set();
 for(const st of payload.stores.items){
  fields(st,['id','store','name','escrow']);
  if(!strId(st.id)||st.store!==st.id||!safeString(st.name)||
     st.name.trim().length===0||st.name.length>120||!ADDRESS.test(st.escrow))deny();
  stores.add(st.id);
 }
 for(const row of payload.ledger.items){
  fields(row,['store','funded','financial']);
  if(!strId(row.store)||!stores.has(row.store)||!money(row.funded))deny();
  validateFinance(row.financial);
  if(row.funded!==row.financial.counts.F||ledgers.has(row.store))deny();
  ledgers.add(row.store);
 }
 if(ledgers.size!==stores.size)deny();
 for(const meal of payload.meals.items){
  fields(meal,['id','meal','mealId','store','version','name','description',
    'windows','listed','published','eligible','supported','unitPrice',
    'assetDecimals','assetSymbol','financial','collectionTimeZone']);
  if(!strId(meal.id)||meal.meal!==meal.id||meal.mealId!=='0x'+meal.id||
    !stores.has(meal.store)||meals.has(meal.id)||
    typeof meal.version!=='string'||!VERSION.test(meal.version)||
    !safeString(meal.name)||meal.name.trim().length===0||
    meal.name.length>120||!safeString(meal.description)||
    typeof meal.listed!=='boolean'||meal.published!==true||
    meal.assetDecimals!==6||meal.assetSymbol!=='USDC'||
    meal.collectionTimeZone!=='Asia/Shanghai'||
    !positiveMoney(meal.unitPrice)||!money(meal.eligible)||!money(meal.supported))deny();
  validateWindows(meal.windows);
  validateFinance(meal.financial);
  if(meal.eligible!==meal.financial.counts.A||
     meal.supported!==meal.financial.counts.F)deny();
  meals.add(meal.id);
 }
 return payload;
}
export function verifyPublicG1Envelope(envelope,{
 publicKey,expectedKeyId,expectedAudience,now,previousSequence
}={}){
 fields(envelope,['v','keyId','audience','issuedAt','expiresAt','sequence','data','signature']);
 if(envelope.v!==1||envelope.keyId!==expectedKeyId||
  typeof expectedKeyId!=='string'||expectedKeyId.length<8||
  envelope.audience!==expectedAudience||
  typeof expectedAudience!=='string'||!/^https:\/\/[a-z0-9-]+\.onrender\.com$/.test(expectedAudience)||
  !num(now)||!num(envelope.issuedAt)||!num(envelope.expiresAt)||
  envelope.issuedAt>now+10||envelope.expiresAt<=now||
  envelope.expiresAt-envelope.issuedAt>120||envelope.expiresAt<=envelope.issuedAt||
  !UINT.test(envelope.sequence)||!UINT.test(previousSequence))deny();
 if(BigInt(envelope.sequence)<=BigInt(previousSequence))deny();
 const data=assertPublicG1Snapshot(envelope.data);
 if(data.asOf>envelope.issuedAt+5||envelope.issuedAt-data.asOf>120)deny();
 if(typeof envelope.signature!=='string'||
   !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))deny();
 const signature=Buffer.from(envelope.signature,'base64url');
 if(signature.length!==64||signature.toString('base64url')!==envelope.signature)deny();
 const unsigned={v:envelope.v,keyId:envelope.keyId,audience:envelope.audience,
   issuedAt:envelope.issuedAt,expiresAt:envelope.expiresAt,
   sequence:envelope.sequence,data};
 let key;
 try{key=createPublicKey(publicKey)}catch{deny()}
 if(key.asymmetricKeyType!=='ed25519')deny();
 if(!verifyEd25519(null,publicEnvelopeSigningBytes(unsigned),key,signature))deny();
 const hash=createHash('sha256').update(publicEnvelopeSigningBytes(unsigned)).digest('hex');
 return {authenticatedPublicSource:true,chainFinalityIndependentlyVerified:false,
  sequence:envelope.sequence,receiptDigest:hash,expiresAt:envelope.expiresAt,data};
}
