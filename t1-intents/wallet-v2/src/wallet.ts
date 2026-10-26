import {createConfig,connect as wagmiConnect} from '@wagmi/core';
import {injected} from '@wagmi/connectors';
import {createWalletClient,custom,defineChain,type Address,type TypedData} from 'viem';
import {CHAIN_ID} from './contract.ts';

export type ProviderChoice={id:string;name:string};
export type WalletObservation={account:string|null;chainId:number|null};
export interface WalletPort{
 providers():ProviderChoice[];
 select(id:string):void;
 inspect():Promise<WalletObservation>;
 connect():Promise<WalletObservation>;
 sign(typedData:unknown,account:string):Promise<string>;
 dispose():void;
}
type Provider={request(args:{method:string;params?:unknown[]}):Promise<unknown>;on?(name:string,listener:(value:unknown)=>void):void;removeListener?(name:string,listener:(value:unknown)=>void):void};
type Announce={info?:{uuid?:unknown;name?:unknown};provider?:Provider};
// The custom EIP-1193 transport below is the only transport; this placeholder
// keeps chain metadata local and cannot create an external RPC request.
const chain=defineChain({id:CHAIN_ID,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['/']}}});
const fail=(code:string):never=>{throw Error('WALLET_'+code)};
const address=(x:unknown):x is string=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x);
const chainNumber=(x:unknown)=>typeof x==='string'&&/^0x[0-9a-fA-F]+$/.test(x)&&Number.isSafeInteger(Number(BigInt(x)))?Number(BigInt(x)):null;
/** EIP-6963 discovery stays live; no provider request occurs during construction. */
export function createWalletPort({changed}:{changed:()=>void}):WalletPort{
 const view=globalThis.window as Window&{ethereum?:Provider};
 const choices=new Map<string,{name:string;provider:Provider}>();
 let selected:string|null=null,disposed=false;
 const emit=()=>{if(!disposed)changed()};
 const watched=['accountsChanged','chainChanged','disconnect','connect'] as const;
 let listening:Provider|null=null;
 function attach(p:Provider|null){
  if(listening===p)return;
  if(listening)for(const event of watched)listening.removeListener?.(event,emit);
  listening=p;
  if(p)for(const event of watched)p.on?.(event,emit);
 }
 function add(id:string,name:string,provider:Provider){
  if(disposed||!provider||typeof provider.request!=='function')return;
  const old=choices.get(id);choices.set(id,{name,provider});
  if(!selected||selected===id){selected=id;attach(provider)}
  if(!old||old.provider!==provider)emit();
 }
 const announcement=(event:Event)=>{
  const detail=(event as CustomEvent<Announce>).detail;
  if(!detail||typeof detail.info?.uuid!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(detail.info.uuid)||typeof detail.info.name!=='string'||!detail.info.name.trim()||!detail.provider)return;
  add(detail.info.uuid,detail.info.name.slice(0,80),detail.provider);
 };
 view.addEventListener('eip6963:announceProvider',announcement);
 if(view.ethereum)add('legacy-injected','Injected wallet',view.ethereum);
 view.dispatchEvent(new Event('eip6963:requestProvider'));
 function current():Provider{if(disposed)return fail('DISPOSED');const p=selected&&choices.get(selected)?.provider;return p||fail('NO_PROVIDER')}
 async function inspect():Promise<WalletObservation>{
  const p=current();
  try{
   const accounts=await p.request({method:'eth_accounts'});
   const chainId=chainNumber(await p.request({method:'eth_chainId'}));
   return {account:Array.isArray(accounts)&&address(accounts[0])?accounts[0].toLowerCase():null,chainId};
  }catch{return fail('INSPECT')}
 }
 async function connect():Promise<WalletObservation>{
  const p=current();
  // Core's injected connector owns the permission request. The adapter never
  // reconnects automatically and uses transient config storage.
  const connector=injected({shimDisconnect:false,target:{id:selected||'injected',name:choices.get(selected||'')?.name||'Injected',provider:p as never}});
  const config=createConfig({chains:[chain],connectors:[connector],transports:{[CHAIN_ID]:custom(p as never)},storage:null,multiInjectedProviderDiscovery:false,ssr:true});
  try{await wagmiConnect(config,{connector:config.connectors[0]});return await inspect()}
  catch{return fail('CONNECT')}
 }
 async function sign(typedData:unknown,account:string):Promise<string>{
  const p=current();if(!address(account))return fail('ACCOUNT');
  const observed=await inspect();
  if(observed.account!==account.toLowerCase()||observed.chainId!==CHAIN_ID)return fail('CONTEXT');
  if(!typedData||typeof typedData!=='object')return fail('TYPED_DATA');
  const t=typedData as {domain?:object;types?:TypedData;primaryType?:string;message?:object};
  if(!t.domain||!t.types||!t.primaryType||!t.message)return fail('TYPED_DATA');
  try{
   const client=createWalletClient({account:account as Address,chain,transport:custom(p as never)});
   return await client.signTypedData({domain:t.domain,types:t.types,primaryType:t.primaryType,message:t.message} as never);
  }catch{return fail('SIGN')}
 }
 return Object.freeze({providers:()=>[...choices].map(([id,{name}])=>({id,name})),select:(id:string)=>{if(!choices.has(id))return fail('UNKNOWN_PROVIDER');selected=id;attach(current());emit()},inspect,connect,sign,dispose:()=>{disposed=true;view.removeEventListener('eip6963:announceProvider',announcement);attach(null);choices.clear()}});
}
