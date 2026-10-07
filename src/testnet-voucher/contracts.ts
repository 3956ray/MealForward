export const CHAIN_ID = 10143 as const
export const PRICE_WEI = '1000000000000000' as const
export const INVITE_SECRET = /^[A-Za-z0-9_-]{43}$/
export const DISPLAY_QR = /^mealforward:testnet:v1:[A-Za-z0-9_-]{32}$/
const HASH32 = /^0x[0-9a-f]{64}$/
const LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/

export class VoucherApiError extends Error { constructor(code:string){super(code);this.name='VoucherApiError'} }
function ok(value:unknown): asserts value { if(!value) throw new VoucherApiError('INVALID_RESPONSE') }
function record(value:unknown){ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>}
function exact(value:Record<string,unknown>,keys:string[]){ok(Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)))}
function timestamp(value:unknown){return typeof value==='number'&&Number.isSafeInteger(value)&&value>0}

export type DeliveryStatus='READY'|'LINK_CREATED'|'OPENED'
export interface DeliveryView {chainId:10143;testOnly:true;distribution:'PRIVATE_LINK';status:DeliveryStatus;voucherId:string;batchId:string;operationId:string;partnerLabel:string;recipientRef:string;invite:null|{version:number;createdAt:number;expiresAt:number;openedAt:number|null};linkRecoverable:false}
export interface InviteResult {url:string;expiresAt:number;replacesPrevious:boolean;warning:'PRIVATE_BEARER_LINK'}
export interface RecipientVoucher {chainId:10143;testOnly:true;state:'ISSUED';mealLabel:'1份标准餐';valueWei:'1000000000000000';voucherId:string;batchId:string;operationId:string;partnerLabel:string;inviteExpiresAt:number;sessionExpiresAt:number}
export interface VoucherSession {voucher:RecipientVoucher;csrfToken:string}
export interface VoucherDisplay {qrPayload:string;code:string;expiresAt:number;nonce:number}

export function recipientSecretFromHash(hash:string):string|null|undefined{
  if(hash==='#/recipient')return null
  const prefix='#/recipient/'
  if(!hash.startsWith(prefix))return undefined
  const secret=hash.slice(prefix.length)
  return INVITE_SECRET.test(secret)?secret:null
}
export function parseDelivery(value:unknown):DeliveryView{
  const v=record(value);exact(v,['chainId','testOnly','distribution','status','voucherId','batchId','operationId','partnerLabel','recipientRef','linkRecoverable','invite'])
  ok(v.chainId===CHAIN_ID&&v.testOnly===true&&v.distribution==='PRIVATE_LINK'&&['READY','LINK_CREATED','OPENED'].includes(v.status as string)&&v.linkRecoverable===false)
  ok(typeof v.voucherId==='string'&&HASH32.test(v.voucherId)&&typeof v.batchId==='string'&&HASH32.test(v.batchId)&&typeof v.operationId==='string'&&HASH32.test(v.operationId))
  ok(typeof v.partnerLabel==='string'&&LABEL.test(v.partnerLabel)&&typeof v.recipientRef==='string'&&LABEL.test(v.recipientRef))
  if(v.invite!==null){const i=record(v.invite);exact(i,['version','createdAt','expiresAt','openedAt']);ok(Number.isSafeInteger(i.version)&&Number(i.version)>0&&timestamp(i.createdAt)&&timestamp(i.expiresAt)&&Number(i.expiresAt)>Number(i.createdAt)&&(i.openedAt===null||timestamp(i.openedAt)))}
  return v as unknown as DeliveryView
}
export function parseInvite(value:unknown):InviteResult{
  const v=record(value);exact(v,['url','expiresAt','replacesPrevious','warning'])
  ok(typeof v.url==='string'&&/^http:\/\/(127\.0\.0\.1|localhost):15207\/#\/recipient\/[A-Za-z0-9_-]{43}$/.test(v.url)&&timestamp(v.expiresAt)&&typeof v.replacesPrevious==='boolean'&&v.warning==='PRIVATE_BEARER_LINK')
  return v as unknown as InviteResult
}
export function parseSession(value:unknown):VoucherSession{
  const v=record(value);exact(v,['voucher','csrfToken']);const x=record(v.voucher)
  exact(x,['chainId','testOnly','state','mealLabel','valueWei','voucherId','batchId','operationId','partnerLabel','inviteExpiresAt','sessionExpiresAt'])
  ok(x.chainId===CHAIN_ID&&x.testOnly===true&&x.state==='ISSUED'&&x.mealLabel==='1份标准餐'&&x.valueWei===PRICE_WEI)
  ok(typeof x.voucherId==='string'&&HASH32.test(x.voucherId)&&typeof x.batchId==='string'&&HASH32.test(x.batchId)&&typeof x.operationId==='string'&&HASH32.test(x.operationId)&&typeof x.partnerLabel==='string'&&LABEL.test(x.partnerLabel))
  ok(timestamp(x.inviteExpiresAt)&&timestamp(x.sessionExpiresAt)&&typeof v.csrfToken==='string'&&/^[0-9a-f]{64}$/.test(v.csrfToken))
  return v as unknown as VoucherSession
}
export function parseDisplay(value:unknown):VoucherDisplay{
  const v=record(value);exact(v,['display']);const d=record(v.display);exact(d,['qrPayload','code','expiresAt','nonce'])
  ok(typeof d.qrPayload==='string'&&DISPLAY_QR.test(d.qrPayload)&&typeof d.code==='string'&&/^[0-9]{6}$/.test(d.code)&&timestamp(d.expiresAt)&&Number.isSafeInteger(d.nonce)&&Number(d.nonce)>0)
  return d as unknown as VoucherDisplay
}
