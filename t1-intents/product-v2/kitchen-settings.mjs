/** Kitchen public information only: never a claim/funding pause or voucher terms. */
import {createHash,randomUUID} from 'node:crypto';
import {fail,validateWindows} from './service.mjs';
const check=(v,c,status=409)=>{if(!v)fail(c,status);};
const copy=structuredClone;
const address=v=>{check(typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n,'UNAUTHENTICATED',401);return v.toLowerCase();};
const id=v=>{check(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(v),'INVALID_ID',422);return v;};
const dayKey=now=>{check(Number.isSafeInteger(now)&&now>=0,'INVALID_TIME',503);return new Date((now+480*60)*1000).toISOString().slice(0,10);};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
export function kitchenStatus(settings,now=Math.floor(Date.now()/1000)){
 return {hours:settings?.hours?copy(settings.hours):null,announcement:settings?.announcement||'',restingToday:!!settings?.restDay&&settings.restDay===dayKey(now),restDay:settings?.restDay||null,revision:settings?.revision||0};
}
export function makeKitchenSettingsService({store,chain,clock=()=>Math.floor(Date.now()/1000),newId=randomUUID}){
 async function owner(wallet,storeId){wallet=address(wallet);id(storeId);const catalog=await chain.catalog();check(catalog?.verified===true&&Array.isArray(catalog.stores),'CATALOG_UNVERIFIED',503);check(catalog.stores.some(s=>s.id===storeId&&s.owner?.toLowerCase()===wallet),'STORE_ACCESS_DENIED',403);return wallet;}
 return {
  async get(wallet,storeId){await owner(wallet,storeId);const state=await store.read();return {storeId,...kitchenStatus(state.kitchenSettings?.[storeId],clock())};},
  async save(wallet,storeId,body){wallet=await owner(wallet,storeId);check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join()==='announcement,expectedRevision,hours,requestId,restToday','INVALID_REQUEST',422);
   id(body.requestId);check(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0,'INVALID_REVISION',422);check(typeof body.announcement==='string'&&body.announcement.length<=500&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.announcement),'INVALID_ANNOUNCEMENT',422);check(typeof body.restToday==='boolean','INVALID_REST_STATUS',422);const hours=validateWindows(body.hours),key=wallet+':'+body.requestId,hash=fingerprint({storeId,...body});
   return store.transact(state=>{state.kitchenSettings||={};state.kitchenSettingRequests||={};const old=state.kitchenSettingRequests[key];if(old){check(old.hash===hash,'REQUEST_CONFLICT');return {storeId,...kitchenStatus(old.snapshot,clock())};}
    const current=state.kitchenSettings[storeId];check((current?.revision||0)===body.expectedRevision,'KITCHEN_SETTINGS_REVISION_CHANGED');
    const settings={id:newId(),storeId,wallet,revision:body.expectedRevision+1,hours,announcement:body.announcement.trim(),restDay:body.restToday?dayKey(clock()):null};state.kitchenSettings[storeId]=settings;state.kitchenSettingRequests[key]={hash,snapshot:copy(settings)};return {storeId,...kitchenStatus(settings,clock())};
   });},
 };
}
