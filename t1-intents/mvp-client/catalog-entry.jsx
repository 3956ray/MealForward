import React,{useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogProduct} from './catalog-product.jsx';
import {createProductWallet,validateProductConfiguration} from './product-network.mjs';
import {createProductJournal,executeProductOperation} from './product-wallet.mjs';
import {validateProductChallenge} from './product-login.mjs';

/** Separate entry; no legacy role/payer/transaction guard is relaxed. */
export function CatalogEntry({fetchImpl=fetch,walletFactory=createProductWallet}) {
  const [session,setSession]=useState(null),[providers,setProviders]=useState([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const walletRef=useRef(null),epoch=useRef(0),csrf=useRef(null),loginLock=useRef(false),sessionRef=useRef(null),journalRef=useRef(null);
  sessionRef.current=session;
  const api=useCallback(async(path,options={})=>{
    const ticket=epoch.current;
    const headers={'Content-Type':'application/json'},method=options.method||'GET';
    if(csrf.current)headers['x-mf-product-v2-csrf']=csrf.current;
    if(path==='/auth/pre-session')headers['x-mf-product-v2-bootstrap']='1';
    const response=await fetchImpl('/v1/product'+path,{method,headers,credentials:'same-origin',cache:'no-store',...(options.body?{body:JSON.stringify(options.body)}:{})});
    let value;try{value=await response.json();}catch{throw Error('新产品服务尚未接通。');}
    if(!response.ok){
      if(response.status===401&&epoch.current===ticket){epoch.current++;csrf.current=null;sessionRef.current=null;setSession(null);}
      throw Object.assign(Error(value.error==='PRODUCT_NOT_CONNECTED'?'新产品服务尚未开放，原钱包版仍可使用。':value.error||'请求未完成，请查询原记录。'),{code:value.error,status:response.status});
    }
    if(epoch.current!==ticket)throw Error('钱包已变化，请重新登录。');
    if(method==='GET'&&/^\/(intents|approvals|catalog-operations|merchant\/operations)\/[a-zA-Z0-9_-]+$/.test(path)&&['SEND_UNKNOWN','HASH_BOUND'].includes(value.state)&&sessionRef.current){
      const record=journalRef.current?.get(sessionRef.current.wallet,value);
      if(record?.txHash&&!value.txHash&&record.txHash!==value.candidateHash){
        await api(path+'/hash',{method:'POST',body:{txHash:record.txHash}});
        if(epoch.current!==ticket)throw Error('钱包已变化，请重新登录。');
        value=await api(path+'/reconcile',{method:'POST',body:{}});
      }
    }
    return value;
  },[fetchImpl]);
  useEffect(()=>{
    const invalidate=()=>{epoch.current++;csrf.current=null;sessionRef.current=null;setSession(null);};
    try{journalRef.current=createProductJournal();}catch{}
    walletRef.current=walletFactory({onChange:invalidate,onDiscovery:()=>setProviders(walletRef.current?.providers()||[])});
    setProviders(walletRef.current.providers());
    return()=>{invalidate();walletRef.current?.dispose();};
  },[walletFactory]);
  async function login(providerId){
    if(loginLock.current)return;loginLock.current=true;setBusy(true);setError('');
    try {
      // Check server capability before asking a wallet to connect or sign.
      const setup=await api('/identity/setup');
      const configuration=await api('/configuration');
      validateProductConfiguration(configuration,location.origin);
      if(setup.walletLoginEnabled!==true || setup.walletLoginChainId!==configuration.chainId || setup.walletLoginOrigin!==location.origin)throw Error('新产品登录尚未接通。');
      walletRef.current.configure(configuration);
      walletRef.current.select(providerId);
      const connection=await walletRef.current.connect(),ticket=epoch.current;
      if(connection.chainId!==configuration.chainId)throw Error(configuration.profile==='local-acceptance'?'请在钱包中选择本地验收网络。':'请在钱包中选择 Monad Testnet。');
      const check=()=>{if(epoch.current!==ticket)throw Error('钱包已变化，请重新登录。');};
      const pre=await api('/auth/pre-session',{method:'POST',body:{}});check();csrf.current=pre.csrf;
      const challenge=await api('/identity/wallet/challenge',{method:'POST',body:{address:connection.account}});check();
      validateProductChallenge(challenge,connection.account,location.origin,configuration);
      const signature=await walletRef.current.signMessage(connection.account,challenge.message,check);check();
      const result=await api('/identity/wallet/login',{method:'POST',body:{challengeId:challenge.challengeId,signature}});check();csrf.current=result.csrf;
      const identity=await api('/me');check();
      if(identity.wallet?.toLowerCase()!==connection.account.toLowerCase())throw Error('登录身份不匹配。');
      setSession(identity);setOpen(false);
    } catch(e){csrf.current=null;setSession(null);setError(e.message);}
    finally{loginLock.current=false;setBusy(false);}
  }
  async function refresh(){const ticket=epoch.current;if(!sessionRef.current)return;const me=await api('/me');if(ticket===epoch.current)setSession(me);}
  async function sendOperation(operation){
    const ticket=epoch.current,currentSession=sessionRef.current,configuration=await api('/configuration');
    if(!journalRef.current)journalRef.current=createProductJournal();
    const result=await executeProductOperation({operation,session:currentSession,configuration,wallet:walletRef.current,api,journal:journalRef.current,isCurrent:()=>ticket===epoch.current&&sessionRef.current?.wallet===currentSession?.wallet});
    if(result.state==='CONFIRMED')await refresh();return result;
  }
  async function logout(){epoch.current++;sessionRef.current=null;setSession(null);try{await api('/auth/logout',{method:'POST',body:{}});}catch(e){setError(e.message);}finally{csrf.current=null;}}
  const cancellationEpoch=epoch.current;
  return <><CatalogProduct walletClient={walletRef.current} configuration={()=>api('/configuration')} isCurrent={()=>epoch.current===cancellationEpoch&&sessionRef.current?.wallet===session?.wallet} api={api} session={session} onLogin={()=>{setError('');setOpen(true);}} onLogout={logout} onRefresh={refresh} onWalletOperation={sendOperation}/>{open&&<section className="container panel" role="dialog" aria-modal="true" aria-label="钱包登录"><h2>选择钱包</h2>{providers.map(p=><button className="button" key={p.id} disabled={busy} onClick={()=>login(p.id)}>{p.name}</button>)}{!providers.length&&<p>未发现钱包扩展。安装钱包后刷新此页。</p>}<button disabled={busy} onClick={()=>setOpen(false)}>关闭</button><p role="alert">{error}</p></section>}{error&&!open&&<p className="container" role="alert">{error}</p>}</>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<CatalogEntry/>);
