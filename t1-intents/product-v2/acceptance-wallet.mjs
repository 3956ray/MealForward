/** Opt-in synthetic EIP-1193 bridge. ONLY the local acceptance host may mount it.
 * Synthetic keys remain in-process; browser receives public addresses and results.
 * This is explicitly NOT MetaMask or a production signing service. */
import {randomUUID} from 'node:crypto';
import {Interface,toUtf8String} from 'ethers';
import {parseSiweMessage} from 'viem/siwe';
import {makeProductSiwe} from './siwe.mjs';
import {publicationInterface} from './publication-wire.mjs';
import {fundingInterface} from './funding-wire.mjs';
import {redemptionInterface,redemptionTypes,redemptionDomain} from './redemption-wire.mjs';
const tokenInterface=new Interface(['function approve(address spender,uint256 amount) returns(bool)']);
const allowed=new Set(['eth_accounts','eth_chainId','eth_requestAccounts','personal_sign','eth_sendTransaction','eth_signTypedData_v4']);
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(ok,code,status=422)=>{if(!ok)throw Object.assign(Error(code),{code,status});};
const loopback=address=>['127.0.0.1','::ffff:127.0.0.1'].includes(address);
const hex=v=>typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v);
export function makeAcceptanceWallet({origin,provider,wallets,target}){
 check(/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(origin)&&target?.chainId===31337&&address(target.escrow)&&address(target.asset),'LOCAL_WALLET_CONFIG_REQUIRED');
 const roles=['merchant','donor','recipient'],accounts=Object.fromEntries(roles.map(role=>{check(address(wallets?.[role]?.address),'LOCAL_WALLET_IDENTITY_REQUIRED');return [role,wallets[role].address];}));
 const siwe=makeProductSiwe({profile:'local-acceptance',origin});
 const host=new URL(origin).host;
 async function handler(req,res){
  const url=new URL(req.url,origin);if(url.pathname!=='/v1/local-wallet')return false;
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   check(loopback(req.socket.remoteAddress)&&req.headers.host===host&&url.origin===origin&&!url.search&&req.headers.origin===origin&&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin'),'LOCAL_WALLET_ORIGIN_DENIED',403);
   check(req.method==='POST'&&(req.headers['content-type']||'').split(';')[0]==='application/json','LOCAL_WALLET_POST_JSON_REQUIRED',415);
   let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;check(bytes<=16384,'LOCAL_WALLET_BODY_TOO_LARGE',413);chunks.push(chunk);}let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('LOCAL_WALLET_INVALID_JSON'),{code:'LOCAL_WALLET_INVALID_JSON',status:400});}
   check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join()==='confirmed,method,params,role','LOCAL_WALLET_INVALID_REQUEST');
   check(allowed.has(body.method)&&Array.isArray(body.params),'LOCAL_WALLET_METHOD_DENIED',403);
   check(await provider.send('eth_chainId',[])==='0x7a69','LOCAL_WALLET_CHAIN_DENIED',403);
   const wallet=roles.includes(body.role)?wallets[body.role]:null;
   if(body.method==='eth_chainId'){check(body.params.length===0,'LOCAL_WALLET_INVALID_REQUEST');send(200,{result:'0x7a69'});return true;}
   if(['eth_accounts','eth_requestAccounts'].includes(body.method)){check(body.params.length===0,'LOCAL_WALLET_INVALID_REQUEST');if(body.method==='eth_requestAccounts')check(wallet&&body.confirmed===true,'LOCAL_WALLET_SELECTION_REQUIRED',403);send(200,{result:wallet?[wallet.address]:[]});return true;}
   check(wallet&&body.confirmed===true,'LOCAL_WALLET_CONFIRMATION_REQUIRED',403);let result;
   if(body.method==='personal_sign'){
    check(body.params.length===2&&same(body.params[1],wallet.address)&&typeof body.params[0]==='string','LOCAL_WALLET_SIGNER_MISMATCH');const message=body.params[0].startsWith('0x')?toUtf8String(body.params[0]):body.params[0];check(message.length<=8192,'LOCAL_WALLET_MESSAGE_TOO_LARGE');const p=parseSiweMessage(message),at=Math.floor(Date.now()/1000),issuedAt=Math.floor(p.issuedAt?.getTime()/1000),expiresAt=Math.floor(p.expirationTime?.getTime()/1000);
    check(p.domain===host&&p.uri===origin&&p.chainId===31337&&same(p.address,wallet.address)&&p.version==='1'&&p.statement==='Sign in to MealForward with your test wallet.'&&issuedAt<=at&&at<expiresAt&&expiresAt-issuedAt===180,'LOCAL_WALLET_SIWE_ONLY',403);
    const rebuilt=siwe.makeChallenge({wallet:wallet.address.toLowerCase(),origin,chainId:31337,nonce:p.nonce,challengeId:p.requestId,issuedAt,expiresAt});check(rebuilt.message===message,'LOCAL_WALLET_SIWE_ONLY',403);result=await wallet.signMessage(message);
   }else if(body.method==='eth_signTypedData_v4'){
    check(body.params.length===2&&same(body.params[0],wallet.address),'LOCAL_WALLET_SIGNER_MISMATCH');const typed=typeof body.params[1]==='string'?JSON.parse(body.params[1]):body.params[1],domain=redemptionDomain(target);check(typed&&typed.primaryType==='RedemptionPermit'&&typed.domain&&Object.keys(typed.domain).sort().join()===Object.keys(domain).sort().join()&&Object.keys(domain).every(k=>String(typed.domain[k]).toLowerCase()===String(domain[k]).toLowerCase())&&JSON.stringify(typed.types?.RedemptionPermit)===JSON.stringify(redemptionTypes.RedemptionPermit)&&Object.keys(typed.types||{}).every(k=>['RedemptionPermit','EIP712Domain'].includes(k)),'LOCAL_WALLET_REDEMPTION_DOMAIN_ONLY',403);
    const m=typed.message,now=BigInt(Math.floor(Date.now()/1000));check(m&&same(m.owner,wallet.address)&&/^0x[0-9a-f]{64}$/i.test(m.voucherId)&&BigInt(m.generation)>0n&&BigInt(m.issuedAt)<=now+30n&&BigInt(m.deadline)>now&&BigInt(m.deadline)-BigInt(m.issuedAt)<=120n,'LOCAL_WALLET_REDEMPTION_ONLY',403);result=await wallet.signTypedData(domain,redemptionTypes,m);
   }else{
    check(body.params.length===1,'LOCAL_WALLET_INVALID_REQUEST');const tx=body.params[0];check(tx&&typeof tx==='object'&&Object.keys(tx).every(k=>['from','to','chainId','nonce','data','value','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','type'].includes(k))&&same(tx.from,wallet.address)&&(same(tx.to,target.asset)||same(tx.to,target.escrow)||same(tx.to,wallet.address)&&tx.data==='0x')&&(tx.chainId===undefined||BigInt(tx.chainId)===31337n)&&BigInt(tx.value||'0x0')===0n&&hex(tx.nonce)&&Number.isSafeInteger(Number(BigInt(tx.nonce)))&&typeof tx.data==='string'&&/^0x[0-9a-f]*$/i.test(tx.data)&&tx.data.length%2===0,'LOCAL_WALLET_TRANSACTION_DENIED',403);
    if(same(tx.to,wallet.address)){check(tx.data==='0x','LOCAL_WALLET_CANCELLATION_ONLY',403);}else if(same(tx.to,target.asset)){const decoded=tokenInterface.parseTransaction(tx);check(decoded?.name==='approve'&&same(decoded.args.spender,target.escrow)&&decoded.args.amount>0n&&decoded.args.amount<2n**256n-1n,'LOCAL_WALLET_APPROVAL_ONLY',403);}else{let decoded;for(const abi of [publicationInterface,fundingInterface,redemptionInterface]){try{decoded=abi.parseTransaction(tx);if(decoded)break;}catch{}}check(decoded&&['registerStore','publish','supplement','setListed','closeStore','refundBatch','fund','redeem','settle'].includes(decoded.name),'LOCAL_WALLET_PRODUCT_TRANSACTION_ONLY',403);}
    const feeCap=BigInt(target.maxFeePerGas||'10000000000'),gas=tx.gas?BigInt(tx.gas):null;check(!gas||gas>0n&&gas<=5000000n,'LOCAL_WALLET_GAS_LIMIT',403);for(const k of ['gasPrice','maxFeePerGas','maxPriorityFeePerGas'])if(tx[k]!==undefined)check(BigInt(tx[k])>=0n&&BigInt(tx[k])<=feeCap,'LOCAL_WALLET_FEE_LIMIT',403);
    const {from,gas:_,chainId:__,...rest}=tx;const sent=await wallet.sendTransaction({...rest,chainId:31337,...(gas?{gasLimit:gas}:{})});result=sent.hash;
   }
   send(200,{result});return true;
  }catch(error){send(error.status||422,{error:/^LOCAL_WALLET_[A-Z_]+$/.test(error.code||'')?error.code:'LOCAL_WALLET_REQUEST_REJECTED'});return true;}
 }
 const frontendSource=`(()=>{const accounts=${JSON.stringify(accounts)},listeners=new Map();let role=null;const emit=(name,value)=>(listeners.get(name)||[]).forEach(fn=>fn(value));const provider={on(name,fn){listeners.set(name,[...(listeners.get(name)||[]),fn]);},removeListener(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(x=>x!==fn));},async request({method,params=[]}){if(method==='eth_accounts'&&!role)return [];if(method!=='eth_chainId'&&!role)throw Object.assign(Error('请先选择本地测试身份；这不是 MetaMask'),{code:4100});let confirmed=false;if(method==='eth_requestAccounts'){confirmed=window.confirm('连接本地测试身份：'+role+'\\n'+accounts[role]+'\\n仅独立31337测试链，不是MetaMask。');if(!confirmed)throw Object.assign(Error('用户取消'),{code:4001});}else if(['personal_sign','eth_sendTransaction','eth_signTypedData_v4'].includes(method)){confirmed=window.confirm('本地测试钱包确认（非MetaMask）\\n身份：'+role+'\\n操作：'+method+'\\n'+JSON.stringify(params,null,2));if(!confirmed)throw Object.assign(Error('用户取消'),{code:4001});}const response=await fetch('/v1/local-wallet',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({role,method,params,confirmed})});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'本地测试钱包请求未确认'),{code:-32000});return value.result;}};const info={uuid:${JSON.stringify(randomUUID())},name:'本地测试钱包（非MetaMask）',rdns:'local.mealforward.acceptance',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text y="50" font-size="50">🍚</text></svg>'};const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info,provider}}));window.addEventListener('eip6963:requestProvider',announce);announce();function mount(){const box=document.createElement('aside');box.setAttribute('aria-label','本地测试钱包');box.style.cssText='position:fixed;bottom:12px;right:12px;z-index:10000;background:#fff5d9;color:#222;padding:10px;border:1px solid #886;border-radius:8px;max-width:300px;font:14px sans-serif';const label=document.createElement('label');label.textContent='本地测试身份（非MetaMask） ';const select=document.createElement('select');select.setAttribute('aria-label','选择本地测试身份');[['','请选择身份'],['merchant','商家'],['donor','支持者'],['recipient','领取者']].forEach(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);});select.onchange=()=>{role=select.value||null;emit('accountsChanged',role?[accounts[role]]:[]);};label.append(select);box.append(label);document.body.append(box);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();})();`;
 return {handler,frontendSource,accounts};
}
