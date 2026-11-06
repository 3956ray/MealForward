import en from './messages-en.json' with {type:'json'};
const key='mf-language',listeners=new Set(),reverse=new Map(Object.entries(en).map(([zh,english])=>[english,zh]));
let language;
export function getLanguage(){if(language===undefined){try{language=globalThis.localStorage?.getItem(key)==='en'?'en':'zh';}catch{language='zh';}}return language;}
export const getLocale=()=>getLanguage()==='en'?'en-US':'zh-CN';
function notify(){for(const fn of listeners)fn();}
export function setLanguage(value){if(!['zh','en'].includes(value))return;language=value;try{globalThis.localStorage?.setItem(key,value);}catch{/* Preferences remain usable when storage is unavailable. */}notify();}
function storageChanged(event){if(event.key!==key)return;language=event.newValue==='en'?'en':'zh';notify();}
export function subscribeLanguage(fn){if(!listeners.size)globalThis.window?.addEventListener('storage',storageChanged);listeners.add(fn);return()=>{listeners.delete(fn);if(!listeners.size)globalThis.window?.removeEventListener('storage',storageChanged);};}
export function t(message,values){if(typeof message!=='string')return message;const source=Object.hasOwn(en,message)?message:reverse.get(message)||message;const result=getLanguage()==='en'?(en[source]||source):source;return values?result.replace(/\{(\d+)\}/g,(match,index)=>String(values[index]??match)):result;}
// Translate system errors at display time. Technical codes are retained for recovery.
const errors={
 WALLET_OPERATION_PENDING:'你还有一笔待处理操作，请先继续或取消原操作。',
 OPERATION_EXPIRED:'审核已过期。请查询原请求；尚未发送时可取消并重新审核。',
 REVIEW_EXPIRED:'审核已过期，请重新核对金额与条件。',
 UNAUTHENTICATED:'请使用原钱包重新登录。',
 ACTION_REJECTED:'你取消了钱包确认，请查看原操作状态。',
 CLAIM_COOLDOWN:'还未到下一次可领取时间，请查看已有餐券。',
 PRODUCT_NOT_CONNECTED:'服务正在恢复，请稍后重试。',
 REGISTRATION_PENDING:'厨房登记正在处理中，请继续原登记。',
 WRONG_CHAIN:'请在钱包中切换到 Monad Testnet。',
 ACCOUNT_CHANGED:'钱包账户已改变，请使用当前钱包重新登录。',
 SESSION_EXPIRED:'登录已过期，请使用原钱包重新登录。',
 Failed_to_fetch:'网络连接中断，请重试查询原记录。'
};
export function translateError(message){const known=errors[message==='Failed to fetch'?'Failed_to_fetch':message];if(known)return t(known);if(typeof message==='string'&&/^[A-Z][A-Z0-9_]{2,}$/.test(message))return t('暂时无法完成，请查看原操作状态。')+' ('+message+')';return t(message);}
