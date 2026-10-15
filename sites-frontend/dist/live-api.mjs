import {prepareApprove,prepareFund,prepareSettle,priceUnits,validateWalletLoginChallenge,signWalletLoginMessage} from './assets/live-wallet.mjs';

const ID=/^0x[0-9a-f]{64}$/;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const STORAGE='mealforward-live-requests-v1';
const CSRF='mealforward-live-csrf-v1';
const RELOGIN='mealforward-live-relogin-v1';
const fail=(code,message,status=0)=>Object.assign(new Error(message),{code,status});
// Prefer the real MetaMask provider when multiple wallets inject window.ethereum.
// No website-side account chooser is used: MetaMask owns account permissions.
export function metaMaskProvider(){
  const injected=globalThis.ethereum;
  const providers=Array.isArray(injected?.providers)?injected.providers:[injected];
  return providers.find(p=>p?.isMetaMask===true && p?.isPhantom!==true && p?.isRabby!==true)??null;
}
const reference=id=>{if(!ID.test(id))throw fail('INVALID_REFERENCE','Choose the original registration.');return id;};

export function parseVoucherCode(input,siteOrigin){
  const value=typeof input==='string'?input.trim():'';
  if(/^[A-Za-z0-9_-]{43}$/.test(value))return value;
  try{
    const url=new URL(value),expected=new URL(siteOrigin);
    if(url.origin!==expected.origin||url.username||url.password||url.pathname!=='/'||url.search||!url.hash.startsWith('#verify?'))throw Error();
    const params=new URLSearchParams(url.hash.slice(8)),entries=[...params];
    if(entries.length!==1||entries[0][0]!=='code'||!/^[A-Za-z0-9_-]{43}$/.test(entries[0][1]))throw Error();
    return entries[0][1];
  }catch{throw fail('INVALID_VOUCHER_LINK','Paste a private voucher link from this site or scan its QR code.');}
}

export function walletTypedData(typed){
  const fields=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
  const domain=typed?.domain;
  if(!domain || Object.keys(domain).length!==4 || fields.some(f=>!Object.hasOwn(domain,f.name)) || domain.chainId!==10143 || !/^0x[0-9a-fA-F]{40}$/.test(domain.verifyingContract) || typeof domain.name!=='string' || !domain.name || typeof domain.version!=='string' || !domain.version || !typed.types || (typed.types.EIP712Domain && JSON.stringify(typed.types.EIP712Domain)!==JSON.stringify(fields)))throw fail('INVALID_SIGNING_DOMAIN','The registration signing details do not match. Reload the original registration.');
  return {...typed,domain:{...domain},types:{...typed.types,EIP712Domain:fields}};
}

export function createLiveApi({fetchImpl=(...args)=>fetch(...args),storage=globalThis.sessionStorage,provider=metaMaskProvider,origin=()=>globalThis.location.origin,uuid=()=>crypto.randomUUID(),onSessionInvalidated=()=>globalThis.window?.dispatchEvent(new CustomEvent('mealforward-session-invalidated',{detail:{reason:'wallet-changed'}}))}={}){
  let csrf=storage?.getItem(CSRF)||null,epoch=0,signature=null,session=null,busy=false;
  let requireRelogin=storage?.getItem(RELOGIN)==='1',watched=null;
  const readJournal=()=>{try{return JSON.parse(storage?.getItem(STORAGE)||'{}');}catch{return {};}};
  const journal=readJournal();
  const voucherAccess=new Map();
  const saveJournal=()=>storage?.setItem(STORAGE,JSON.stringify(journal));
  const checkEpoch=value=>{if(epoch!==value)throw fail('SESSION_CHANGED','Your wallet or session changed. Sign in again.');};
  function invalidate(){epoch++;signature=null;session=null;voucherAccess.clear();}
  function invalidateSession(){invalidate();requireRelogin=true;storage?.setItem(RELOGIN,'1');}
  function walletChanged(){invalidateSession();onSessionInvalidated();}
  function unwatchWallet(){if(watched){watched.removeListener('accountsChanged',walletChanged);watched.removeListener('chainChanged',walletChanged);watched=null;}}
  function watchWallet(){const wallet=provider();if(wallet===watched)return;unwatchWallet();if(wallet?.on&&wallet?.removeListener){wallet.on('accountsChanged',walletChanged);wallet.on('chainChanged',walletChanged);watched=wallet;}}
  function requireCurrentLogin(){if(requireRelogin)throw fail('LOGIN_REQUIRED','Wallet changed. Sign in again with the newly selected wallet.');}
  async function request(method,path,body,extra={},control={}){
    if(!path.startsWith('/v1/'))throw fail('INVALID_PATH','Invalid service request.');
    const headers={...extra},options={method,headers,credentials:'same-origin',cache:'no-store'};
    let key;
    if(method!=='GET'){
      if(body instanceof Blob){
        const bytes=await body.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        const metadata=new TextEncoder().encode(JSON.stringify([method,path,body.type,extra['X-C1-Draft-Revision']??null,digest]));
        key='image:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',metadata)),v=>v.toString(16).padStart(2,'0')).join('');
        journal[key] ||= uuid();saveJournal();headers['Content-Type']=body.type;headers['Idempotency-Key']=journal[key];options.body=body;
      }
      else {
        const bytes=new TextEncoder().encode(JSON.stringify([method,path,body]));
        key='request:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
        journal[key] ||= uuid();saveJournal();
        headers['Idempotency-Key']=journal[key];headers['Content-Type']='application/json';options.body=JSON.stringify(body);
      }
      if(control.csrf!==undefined)headers['X-C1-CSRF']=control.csrf;
      else if(csrf)headers['X-C1-CSRF']=csrf;
    }
    if(control.epoch!==undefined)checkEpoch(control.epoch);
    let response,data;
    try{response=await fetchImpl(path,options);}catch{throw fail('CONNECTION_UNAVAILABLE','The service cannot be reached. Your original request is retained.');}
    try{data=await response.json();}catch{throw fail('SERVICE_UNAVAILABLE','The backend is not connected at this address. Your original request is retained.',response.status);}
    if(!response.ok){
      const code=typeof data.error==='string'?data.error:'REQUEST_REJECTED';
      // Retain the same key even after a rejection; never turn a retry into a new operation.
      throw fail(code,`${response.status===401?'Please sign in again.':response.status>=500?'The service is temporarily unavailable. Your original request is retained.':'The request could not be completed.'} (${code})`,response.status);
    }
    if(control.epoch!==undefined)checkEpoch(control.epoch);
    if(typeof data.csrf==='string'){csrf=data.csrf;storage?.setItem(CSRF,csrf);}
    if(key && !control.retainKey){delete journal[key];saveJournal();}
    return data;
  }
  async function setup(){
    const [connection,identity]=await Promise.all([request('GET','/v1/connection'),request('GET','/v1/identity/setup')]);
    return {...connection,walletLoginEnabled:identity.walletLoginEnabled===true && identity.walletLoginChainId===10143 && identity.walletLoginOrigin===origin(),walletLoginOrigin:identity.walletLoginOrigin};
  }
  async function registrationCapacity(config){
    if(config.firstRun?.stores===1 && (await listStores()).length>=1){
      return {...config,registrationEnabled:false,registrationUnavailableReason:'This MVP already has its one test kitchen. Sign in with its owner wallet to continue; additional kitchen registration is unavailable in this run.'};
    }
    return config;
  }
  async function me(){
    requireCurrentLogin();
    const generation=epoch;
    try{const value=await request('GET','/v1/me');checkEpoch(generation);session=value.walletAddress && ADDRESS.test(value.walletAddress)?{wallet:value.walletAddress,stores:[],...value}:null;return session;}
    catch(error){if(error.status!==401)throw error;session=null;return null;}
  }
  async function getContext(){
    watchWallet();
    const generation=epoch,config=await registrationCapacity(await setup());checkEpoch(generation);
    const anonymous={session:null,setup:config,registration:null,registrations:[],store:null};
    if(requireRelogin)return anonymous;
    const current=await me();checkEpoch(generation);
    // A cookie inherited from the older UI has no usable CSRF proof in this tab.
    // Ask for a fresh wallet login rather than render actions that cannot commit.
    if(!current || !csrf)return anonymous;
    if(provider()?.request){try{await checkWallet(provider(),current.wallet);}catch{walletChanged();return anonymous;}checkEpoch(generation);}
    const data=await request('GET','/v1/store-registrations');checkEpoch(generation);
    const stores=await listStores();checkEpoch(generation);
    const registrations=await Promise.all((data.items||[]).map(r=>withListing(r,stores)));checkEpoch(generation);
    const priority=r=>['PENDING','UNKNOWN'].includes(r.state)?0:r.state==='CONFIRMED'?1:2;
    const registration=[...registrations].sort((a,b)=>priority(a)-priority(b))[0]||null;
    const owned=registrations.filter(r=>r.state==='CONFIRMED' && (r.listingConfirmed || r.businessReady)).map(r=>r.storeId.replace(/^0x/,''));
    current.stores=owned;
    let store=null;
    if(owned.length)store=stores.find(s=>owned.includes(s.id))||null;
    return {session:current,setup:config,registration,registrations,hasMore:data.hasMore===true,store};
  }
  async function checkWallet(wallet,address){
    const [accounts,chain]=await Promise.all([wallet.request({method:'eth_accounts'}),wallet.request({method:'eth_chainId'})]);
    if(provider()!==wallet || typeof accounts?.[0]!=='string' || accounts[0].toLowerCase()!==address || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain)!==10143n)throw fail('WALLET_CHANGED','Select the correct account on Monad Testnet (10143) in MetaMask and sign in again.');
  }
  // Start from the user's click: authorized wallets go directly to login signing.
  // First-time wallets may still need MetaMask's required permission prompt.
  async function loginWithMetaMask(){
    if(busy)throw fail('BUSY','A wallet request is already in progress.');
    busy=true;unwatchWallet();invalidate();requireRelogin=true;storage?.setItem(RELOGIN,'1');const generation=epoch;let committed=false,committedCsrf=null;const wallet=provider();
    const changed=()=>invalidate();let watching=false;
    try{
      // Never prompt MetaMask unless the origin-bound login backend responds first.
      const config=await setup();
      if(!config.walletLoginEnabled)throw fail('WALLET_LOGIN_UNAVAILABLE','Wallet login is not enabled for this site address.');
      checkEpoch(generation);
      if(!wallet?.request || !wallet.on || !wallet.removeListener)throw fail('WALLET_UNAVAILABLE','Install or enable MetaMask in this browser, then sign in again.');
      if(wallet.isMetaMask!==true || wallet.isPhantom===true)throw fail('METAMASK_REQUIRED','Sign in with MetaMask, not another wallet provider.');
      // Use MetaMask's already-authorized active account for SIWE sign-in.
      // eth_requestAccounts can re-open a native account picker, even when a
      // connected account exists. Request permission only for a first connection.
      let accounts=await wallet.request({method:'eth_accounts'});
      checkEpoch(generation);
      if(provider()!==wallet)throw fail('WALLET_CHANGED','The MetaMask provider changed during sign-in. Try again.');
      if(!Array.isArray(accounts))throw fail('WALLET_UNAVAILABLE','MetaMask returned an invalid account response.');
      if(accounts.length===0){
        accounts=await wallet.request({method:'eth_requestAccounts'});
        checkEpoch(generation);
        if(provider()!==wallet)throw fail('WALLET_CHANGED','The MetaMask provider changed during connection. Try again.');
      }
      const selected=Array.isArray(accounts)?accounts[0]:null;
      if(typeof selected!=='string'||!ADDRESS.test(selected.toLowerCase()))throw fail('ACCOUNT_NOT_CONNECTED','Unlock MetaMask and connect your current account to continue.');
      const address=selected.toLowerCase();
      wallet.on('accountsChanged',changed);wallet.on('chainChanged',changed);watching=true;
      await checkWallet(wallet,address);checkEpoch(generation);
      await request('POST','/v1/auth/pre-session',{}, {'X-C1-Bootstrap':'1'});checkEpoch(generation);
      const challenge=await request('POST','/v1/identity/wallet/challenge',{address});checkEpoch(generation);
      const context=()=>({address,chainId:10143,origin:origin(),now:Math.floor(Date.now()/1000)});
      validateWalletLoginChallenge(challenge,context());
      const signed=await signWalletLoginMessage(wallet,challenge,context());
      await checkWallet(wallet,address);checkEpoch(generation);validateWalletLoginChallenge(challenge,context());
      if(!/^0x[0-9a-fA-F]{130}$/.test(signed))throw fail('INVALID_SIGNATURE','The wallet returned an invalid login signature.');
      const loginResponse=await request('POST','/v1/identity/wallet/login',{challengeId:challenge.challengeId,signature:signed});committed=true;committedCsrf=loginResponse.csrf;
      checkEpoch(generation);await checkWallet(wallet,address);checkEpoch(generation);
      requireRelogin=false;storage?.removeItem(RELOGIN);
      const result=await getContext();checkEpoch(generation);if(result.session?.wallet?.toLowerCase()!==address)throw fail('LOGIN_ACCOUNT_MISMATCH','The signed-in wallet does not match the active MetaMask account. Sign in again.');return result;
    }catch(error){requireRelogin=true;storage?.setItem(RELOGIN,'1');if(committed){try{if(typeof committedCsrf!=='string')throw Error('missing csrf');await request('POST','/v1/auth/logout',{}, {'X-C1-Preserve-Session-Cookie':'1'},{csrf:committedCsrf});invalidate();}catch{throw fail('LOGOUT_UNCONFIRMED','The incomplete wallet session could not be revoked. Reload and sign out before continuing.');}}throw error;}
    finally{if(watching){wallet.removeListener('accountsChanged',changed);wallet.removeListener('chainChanged',changed);}busy=false;watchWallet();}
  }
  async function logout(){invalidate();await request('POST','/v1/auth/logout',{});csrf=null;storage?.removeItem(CSRF);return {session:null};}
  async function saveRegistration(form){
    const config=await registrationCapacity(await setup()),current=await me(),generation=epoch;
    if(!current || !csrf)throw fail('LOGIN_REQUIRED','Sign in with your test wallet before saving.');
    if(!config.registrationEnabled || !Number.isSafeInteger(config.serverTime))throw fail('REGISTRATION_UNAVAILABLE',config.registrationUnavailableReason || 'Store registration is unavailable.');
    if(!(form.photo instanceof Blob) || !form.photo.size || form.photo.size>5*1024*1024)throw fail('INVALID_IMAGE','Choose a PNG, JPEG or WebP photo up to 5 MB.');
    const price=priceUnits(form.price,config.assetDecimals);
    // Keep the exact submitted request across response loss and page refresh.
    const pendingKey='registration:'+current.wallet;
    let pending=journal[pendingKey];
    if(!pending){
      const saved=await request('PUT','/v1/store-registration-images',form.photo);checkEpoch(generation);
      const fresh=await setup();checkEpoch(generation);
      if(!fresh.registrationEnabled || !Number.isSafeInteger(fresh.serverTime) || ['assetDecimals','assetSymbol','mode','assetVerified'].some(k=>fresh[k]!==config[k]))throw fail('CONFIGURATION_CHANGED','The registration configuration changed. Reload it before saving.');
      pending={name:form.storeName,deadline:String(fresh.serverTime+600),firstMeal:{name:form.mealName,description:form.description,unitPrice:price,imageRef:saved.imageRef,windows:form.windows}};
      journal[pendingKey]=pending;saveJournal();
    }
    const result=await request('POST','/v1/store-registrations',pending,{}, {retainKey:true});checkEpoch(generation);
    delete journal[pendingKey];saveJournal();signature=null;return {...result,request:pending};
  }
  async function withListing(record,stores){
    if(record.state!=='CONFIRMED')return record;
    const id=record.storeId?.replace(/^0x/,'');
    const publicStores=stores||await listStores();
    if(!publicStores.some(s=>s.id===id))return {...record,listingConfirmed:false};
    const meals=await getStoreMeals(id);
    return {...record,listingConfirmed:meals.some(m=>m.listed===true)};
  }
  async function getRegistration(id){requireCurrentLogin();const generation=epoch;const result=await withListing(await request('GET','/v1/store-registrations/'+reference(id)));checkEpoch(generation);return result;}
  async function signRegistration(registration){
    if(busy)throw fail('BUSY','A wallet request is already in progress.');
    busy=true;signature=null;const generation=epoch, wallet=provider();
    const changed=()=>invalidate();let watching=false;
    try{
      const current=await me(),fresh=await getRegistration(registration.registrationId);checkEpoch(generation);
      if(!current || fresh.state!=='DRAFT' || fresh.walletActionsEnabled!==true)throw fail('AUTHORIZATION_UNAVAILABLE','Reload the original registration before authorizing.');
      const config=await registrationCapacity(await setup());checkEpoch(generation);
      if(!config.registrationEnabled)throw fail('REGISTRATION_UNAVAILABLE',config.registrationUnavailableReason || 'Store registration is unavailable.');
      const typed=walletTypedData(fresh.typedData),owner=typed.message?.owner?.toLowerCase();
      if(owner!==current.wallet || !wallet?.request || !wallet.on || !wallet.removeListener)throw fail('OWNER_MISMATCH','Use the original store owner wallet.');
      if(!/^[0-9]+$/.test(String(typed.message?.deadline)) || BigInt(typed.message.deadline)<=BigInt(Math.floor(Date.now()/1000)))throw fail('AUTHORIZATION_EXPIRED','This draft authorization has expired. It cannot be deployed with the original signature.');
      wallet.on('accountsChanged',changed);wallet.on('chainChanged',changed);watching=true;
      await checkWallet(wallet,owner);checkEpoch(generation);
      const value=await wallet.request({method:'eth_signTypedData_v4',params:[owner,JSON.stringify(typed)]});
      await checkWallet(wallet,owner);checkEpoch(generation);
      if(!/^0x[0-9a-fA-F]{130}$/.test(value))throw fail('INVALID_SIGNATURE','The wallet returned an invalid authorization.');
      signature={id:fresh.registrationId,value,owner,epoch:generation};return {signed:true,registrationId:fresh.registrationId};
    }finally{if(watching){wallet.removeListener('accountsChanged',changed);wallet.removeListener('chainChanged',changed);}busy=false;}
  }
  async function enableRegistration(id){
    requireCurrentLogin();
    reference(id);const signed=signature;
    if(!signed || signed.id!==id || signed.epoch!==epoch)throw fail('SIGNATURE_REQUIRED','Sign the original store authorization first.');
    const config=await registrationCapacity(await setup());
    if(!config.registrationEnabled)throw fail('REGISTRATION_UNAVAILABLE',config.registrationUnavailableReason || 'Store registration is unavailable.');
    await checkWallet(provider(),signed.owner);checkEpoch(signed.epoch);
    const value=await request('POST','/v1/store-registrations/'+id+'/enable',{ownerSignature:signed.value});
    signature=null;return value;
  }
  async function getPublicLedger(){const value=await request('GET','/v1/ledger');if(!Array.isArray(value?.items))throw fail('LEDGER_INVALID','The public ledger response needs verification.');return value;}
  async function listStores(){const value=await request('GET','/v1/stores');return value.items||[];}
  async function getStoreMeals(id){if(!/^[0-9a-f]{64}$/.test(id))throw fail('INVALID_STORE','Choose a verified store.');return (await request('GET','/v1/stores/'+id+'/meals')).items||[];}
  async function getOwnerOverview(id){requireCurrentLogin();const generation=epoch;if(!/^[0-9a-f]{64}$/.test(id))throw fail('INVALID_STORE','Choose your store.');const result=await request('GET','/v1/stores/'+id+'/workbench');checkEpoch(generation);return result;}
  function checkedMerchantVoucher(value,storeId){
    if(value?.store!==storeId||!ID.test(value.voucherId??value.voucher??value.id)||!['R','H','S','X'].includes(value.state))throw fail('VOUCHER_MISMATCH','The kitchen voucher could not be verified.');
    return value;
  }
  function checkedRedemptionIntent(value,storeId){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value?.id)||value.store!==storeId||!['lock','handover','report','settle'].includes(value.action))throw fail('REDEMPTION_MISMATCH','The original redemption could not be verified.');
    return value;
  }
  async function checkVoucher({storeId,code}){
    const generation=await ownerScope(storeId),display=parseVoucherCode(code,origin());
    const result=await request('POST','/v1/stores/'+storeId+'/checks',{display},{},{epoch:generation});checkEpoch(generation);
    checkedMerchantVoucher(result,storeId);if(result.valid!==true)throw fail('VOUCHER_NOT_VALID','This voucher is not available for handover.');return result;
  }
  async function lockVoucher({storeId,code}){
    const generation=await ownerScope(storeId),display=parseVoucherCode(code,origin());
    const result=await request('POST','/v1/stores/'+storeId+'/locks',{display},{},{epoch:generation,retainKey:true});checkEpoch(generation);
    checkedRedemptionIntent(result,storeId);if(result.action!=='lock')throw fail('REDEMPTION_MISMATCH','The original reservation could not be verified.');return result;
  }
  async function getRedemptionIntent(storeId,id){
    const generation=await ownerScope(storeId);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw fail('INVALID_REFERENCE','Choose the original redemption.');
    const result=await request('GET','/v1/intents/'+id);checkEpoch(generation);
    checkedRedemptionIntent(result,storeId);if(result.id!==id)throw fail('REDEMPTION_MISMATCH','The original redemption could not be verified.');return result;
  }
  async function getRedemptionCase(storeId,caseId){
    const generation=await ownerScope(storeId);
    const result=await request('GET','/v1/stores/'+storeId+'/cases/'+reference(caseId));checkEpoch(generation);
    checkedMerchantVoucher(result,storeId);if(result.id!==caseId)throw fail('REDEMPTION_MISMATCH','The original handover could not be verified.');return result;
  }
  async function confirmHandover({storeId,caseId}){
    const generation=await ownerScope(storeId);
    const result=await request('POST','/v1/stores/'+storeId+'/cases/'+reference(caseId)+'/handover-intents',{},{},{epoch:generation,retainKey:true});checkEpoch(generation);
    checkedRedemptionIntent(result,storeId);if(result.action!=='handover')throw fail('REDEMPTION_MISMATCH','The original handover could not be verified.');return result;
  }
  async function ownerScope(id){
    requireCurrentLogin();const generation=epoch;
    if(!session?.stores?.includes(id))throw fail('OWNER_ACCESS_REQUIRED','This wallet does not manage this kitchen.',403);
    const wallet=provider();
    if(wallet?.request){try{await checkWallet(wallet,session.wallet);}catch(error){walletChanged();throw error;}checkEpoch(generation);}
    return generation;
  }
  const mealReference=id=>{if(!/^(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(id))throw fail('INVALID_MEAL','Choose an original meal or a new draft.');return id;};
  function displayUnits(value,decimals){
    if(!/^[0-9]+$/.test(value)||!Number.isInteger(decimals)||decimals<0||decimals>36)throw fail('INVALID_PRICE','The saved price could not be read.');
    const raw=String(value).padStart(decimals+1,'0');if(!decimals)return raw;
    const fraction=raw.slice(-decimals).replace(/0+$/,'');return raw.slice(0,-decimals)+(fraction?'.'+fraction:'');
  }
  function draftDto(value,decimals){return {...value,draft:{...value.draft,unitPrice:value.draft.price,price:displayUnits(value.draft.price,decimals)}};}
  async function getOwnerMeals(id){
    const generation=await ownerScope(id);
    const overview=await getOwnerOverview(id);checkEpoch(generation);
    const publicMeals=await getStoreMeals(id);checkEpoch(generation);
    const items=(overview.items||[]).map(meal=>{
      const published=publicMeals.find(item=>(item.id??item.meal)===(meal.id??meal.meal));
      return {...meal,id:meal.id??meal.meal,...(published?{listed:published.listed,imageUrl:published.imageUrl??meal.imageUrl}:{}),published:true};
    });
    const unavailableReasons={create:'Additional meal drafts are not connected yet.',edit:'Saving meal changes is not connected to the backend yet.',upload:'Saving meal photos is not connected to the backend yet.',publish:'Publishing requires the platform catalog transaction service, which is not connected yet.',listing:'Listing changes require the platform catalog transaction service, which is not connected yet.'};
    let drafts;try{drafts=await request('GET','/v1/stores/'+id+'/drafts');}catch(error){if(error.code!=='LIVE_OPERATION_NOT_IMPLEMENTED')throw error;}
    checkEpoch(generation);
    const capabilities=Object.fromEntries(['create','edit','upload','publish','listing'].map(key=>[key,drafts?.capabilities?.[key]===true]));
    if(drafts){
      const config=await setup();checkEpoch(generation);
      for(const value of drafts.items||[]){
        const draft=draftDto(value,config.assetDecimals),canonical=ID.test(draft.mealId)?draft.mealId.slice(2):draft.id,index=items.findIndex(meal=>meal.id===canonical);
        if(index>=0)items[index]={...items[index],draftId:draft.id,draft:draft.draft,draftRevision:draft.draftRevision,saved:draft.saved};
        else items.push({id:draft.id,mealId:draft.mealId??null,draftId:draft.id,...draft.draft,unitPrice:draft.draft.unitPrice,draft:draft.draft,draftRevision:draft.draftRevision,saved:draft.saved,published:false,listed:false});
      }
    }
    return {items,capabilities,unavailableReasons:{...unavailableReasons,...drafts?.unavailableReasons},catalogIntents:(overview.catalogIntents||[]).map(value=>checkedCatalogIntent(value,id))};
  }
  async function getMealDraft(storeId,mealId){
    const generation=await ownerScope(storeId),config=await setup();checkEpoch(generation);
    const value=await request('GET','/v1/stores/'+storeId+'/drafts/'+mealReference(mealId));checkEpoch(generation);
    return draftDto(value,config.assetDecimals);
  }
  async function saveMealDraft(storeId,mealId,input){
    const generation=await ownerScope(storeId),config=await setup();checkEpoch(generation);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw fail('INVALID_REVISION','Reload the current draft before saving.');
    const body={name:input.name,description:input.description,price:priceUnits(input.price,config.assetDecimals),windows:input.windows,expectedRevision:input.expectedRevision};
    const value=await request('PUT','/v1/stores/'+storeId+'/drafts/'+mealReference(mealId),body,{}, {epoch:generation,retainKey:true});checkEpoch(generation);
    return draftDto(value,config.assetDecimals);
  }
  async function uploadMealImage(storeId,mealId,file,{expectedRevision}){
    const generation=await ownerScope(storeId),config=await setup();checkEpoch(generation);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw fail('INVALID_REVISION','Save the meal draft before its photo.');
    if(!(file instanceof Blob)||!file.size||file.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw fail('INVALID_IMAGE','Choose a PNG, JPEG or WebP photo up to 5 MB.');
    const value=await request('PUT','/v1/stores/'+storeId+'/drafts/'+mealReference(mealId)+'/image',file,{'X-C1-Draft-Revision':String(expectedRevision)},{epoch:generation,retainKey:true});checkEpoch(generation);
    return draftDto(value,config.assetDecimals);
  }

  function checkedCatalogIntent(value,storeId){
    intentReference(value?.id);
    if(value.store!==storeId||typeof value.needsListing!=='boolean'||typeof value.targetListed!=='boolean'||!['publish','setListed'].includes(value.action)||!ID.test(value.mealId)||!/^([1-9][0-9]*)$/.test(value.version))throw fail('PUBLICATION_MISMATCH','The original meal publication could not be verified.');
    mealReference(value.draftId);
    if(value.parentIntentId!=null)intentReference(value.parentIntentId);
    return value;
  }
  async function createMealPublishReview({storeId,draftId,expectedRevision}){
    const generation=await ownerScope(storeId);mealReference(draftId);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw fail('INVALID_REVISION','Save the meal and reload its current revision before publishing.');
    const value=await request('POST','/v1/stores/'+storeId+'/drafts/'+draftId+'/review',{expectedRevision},{},{epoch:generation});checkEpoch(generation);
    intentReference(value.reviewId);const r=value.review;
    if(value.store!==storeId||r?.draftId!==draftId||typeof r.needsListing!=='boolean'||typeof r.targetListed!=='boolean'||r.draftRevision!==expectedRevision||!ID.test(r.mealId)||!/^([1-9][0-9]*)$/.test(r.version)||!/^([1-9][0-9]*)$/.test(r.unitPrice)||r.price!==r.unitPrice||typeof r.name!=='string'||!r.name||typeof r.description!=='string'||r.collectionTimeZone!=='Asia/Shanghai'||!ID.test(r.imageDigest)||!ID.test(r.bodyDigest)||!ID.test(r.termsHash)||!/^(0|[1-9][0-9]*)$/.test(r.expectedControlRevision)||!Number.isSafeInteger(r.expiresAt)||!Array.isArray(r.windows)||r.windows.length<1||r.windows.length>2||r.windows.some((w,i)=>!Array.isArray(w)||w.length!==2||w.some(x=>!Number.isInteger(x)||x<0||x>1440||x%30!==0)||w[0]>=w[1]||(i>0&&w[0]<r.windows[i-1][1])))throw fail('PUBLICATION_MISMATCH','The saved meal details could not be verified for publication.');
    return value;
  }
  async function confirmMealPublish({storeId,draftId,reviewId}){
    const generation=await ownerScope(storeId);mealReference(draftId);intentReference(reviewId);
    const value=await request('POST','/v1/stores/'+storeId+'/drafts/'+draftId+'/publish',{reviewId},{},{epoch:generation,retainKey:true});checkEpoch(generation);
    checkedCatalogIntent(value,storeId);
    if(value.action!=='publish'||value.draftId!==draftId)throw fail('PUBLICATION_MISMATCH','The original meal publication could not be verified.');return value;
  }
  async function getMealPublishIntent(storeId,id){
    const generation=await ownerScope(storeId);intentReference(id);
    const value=await request('GET','/v1/intents/'+id);checkEpoch(generation);checkedCatalogIntent(value,storeId);
    if(value.id!==id)throw fail('PUBLICATION_MISMATCH','The original publication reference does not match.');return value;
  }
  async function getMealPublishIntents(storeId,draftId){
    const generation=await ownerScope(storeId);mealReference(draftId);
    const overview=await getOwnerOverview(storeId);checkEpoch(generation);
    return (overview.catalogIntents||[]).map(value=>checkedCatalogIntent(value,storeId)).filter(value=>value.draftId===draftId);
  }

  const intentReference=id=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw fail('INVALID_REFERENCE','Choose the original contribution.');return id;};
  async function supportScope(){
    requireCurrentLogin();const generation=epoch,current=session,wallet=provider();
    if(!current?.wallet||!csrf)throw fail('LOGIN_REQUIRED','Sign in with your contribution wallet first.',401);
    try{await checkWallet(wallet,current.wallet);}catch(error){walletChanged();throw error;}checkEpoch(generation);
    return {generation,wallet,address:current.wallet,csrf};
  }
  async function createSupportReview({storeId,mealId,quantity}){
    const scope=await supportScope();
    if(!/^[0-9a-f]{64}$/.test(storeId)||!/^[0-9a-f]{64}$/.test(mealId)||!Number.isSafeInteger(quantity)||quantity<1||quantity>10)throw fail('INVALID_SUPPORT','Choose a published meal and between 1 and 10 portions.');
    const value=await request('POST','/v1/support/reviews',{store:storeId,meal:mealId,quantity},{},{epoch:scope.generation});checkEpoch(scope.generation);
    const r=value.review;
    if(value.store!==storeId||r?.mealId!=='0x'+mealId||String(r.quantity)!==String(quantity)||r.payer?.toLowerCase()!==scope.address||!/^\d+$/.test(r.amount)||!/^\d+$/.test(r.unitPrice)||BigInt(r.amount)!==BigInt(r.unitPrice)*BigInt(quantity))throw fail('REVIEW_MISMATCH','The contribution details could not be verified.');
    return value;
  }
  async function confirmSupport(reviewId){
    const scope=await supportScope();intentReference(reviewId);
    const value=await request('POST','/v1/support/intents',{reviewId},{},{epoch:scope.generation,retainKey:true});checkEpoch(scope.generation);return value;
  }
  async function getSupportIntent(id){const scope=await supportScope();const result=await request('GET','/v1/intents/'+intentReference(id));checkEpoch(scope.generation);return result;}
  async function getSupportOrders(){const scope=await supportScope();const result=await request('GET','/v1/my/orders');checkEpoch(scope.generation);return result.items||[];}
  function preparedSupport(data,address){
    const m=data.material;if(m?.kind!=='fund'||m.expectedAccount?.toLowerCase()!==address||m.binding?.chainId!==10143)throw fail('PAYMENT_ACCOUNT_MISMATCH','This contribution belongs to another wallet or network.');
    const wallet={chainId:10143,account:address};
    const prepared=[prepareApprove({binding:m.binding,wallet,payer:m.signedQuote.quote.payer,amount:m.signedQuote.quote.amount}),prepareFund({binding:m.binding,wallet,signedQuote:m.signedQuote,now:String(data.now)})];
    if(!Array.isArray(data.transactions)||data.transactions.length!==prepared.length)throw fail('PAYMENT_DETAILS_MISMATCH','The original payment details do not match.');
    for(const tx of prepared){const server=data.transactions.find(item=>item.functionName===tx.functionName);
      if(!server||server.authority!=='PREPARATION_ONLY'||server.chainId!==tx.chainId||server.from?.toLowerCase()!==tx.from.toLowerCase()||server.to?.toLowerCase()!==tx.to.toLowerCase()||server.data?.toLowerCase()!==tx.data.toLowerCase()||!['0','0x0'].includes(String(server.value)))throw fail('PAYMENT_DETAILS_MISMATCH','The original payment details do not match.');
    }
    return prepared;
  }
  async function getSupportWalletPreparation(id){
    const scope=await supportScope(),data=await request('GET','/v1/intents/'+intentReference(id)+'/wallet-preparation');checkEpoch(scope.generation);
    const prepared=preparedSupport(data,scope.address);
    return {...data,actions:prepared.map(tx=>({kind:tx.functionName,account:tx.from,to:tx.to,amount:String(data.material.signedQuote.quote.amount),canRetryRecord:journal['wallet-attempt:'+id+':'+tx.functionName]?.wallet===scope.address&&!!journal['wallet-attempt:'+id+':'+tx.functionName]?.hash&&!data.attempts?.[tx.functionName]?.hash,allowed:data.walletActionsEnabled===true&&data.allowedKinds?.includes(tx.functionName)===true&&!data.attempts?.[tx.functionName]&&!journal['wallet-attempt:'+id+':'+tx.functionName]&&(tx.functionName!=='fund'||data.attempts?.approve?.confirmed===true)}))};
  }
  async function retrySupportTransactionRecord(id,kind){
    const scope=await supportScope();intentReference(id);
    if(!['approve','fund'].includes(kind))throw fail('INVALID_PAYMENT_STEP','Choose an original payment step.');
    const saved=journal['wallet-attempt:'+id+':'+kind];
    if(saved?.wallet!==scope.address||!/^0x[0-9a-f]{64}$/.test(saved?.hash))throw fail('ORIGINAL_HASH_UNKNOWN','The original transaction hash is unknown. Do not send it again.');
    const result=await request('POST','/v1/intents/'+id+'/wallet-transactions',{kind,transactionHash:saved.hash},{},{epoch:scope.generation,retainKey:true});checkEpoch(scope.generation);
    return {transactionHash:saved.hash,status:'PENDING',result};
  }
  async function sendSupportTransaction(id,kind){
    if(busy)throw fail('BUSY','A wallet request is already in progress.');busy=true;
    let admissionStarted=!!journal['wallet-attempt:'+id+':'+kind];
    try{
      const scope=await supportScope();intentReference(id);
      const data=await getSupportWalletPreparation(id);checkEpoch(scope.generation);
      if(!data.actions.some(action=>action.kind===kind&&action.allowed))throw fail('ORIGINAL_PAYMENT_PENDING','This payment step is unavailable or already attempted. Check the original result.');
      const prepared=preparedSupport(data,scope.address).find(tx=>tx.functionName===kind),key='wallet-attempt:'+id+':'+kind;
      // Persist uncertainty before the server admission request: response loss must never cause another send.
      admissionStarted=true;
      journal[key]={wallet:scope.address,hash:null};saveJournal();
      await request('POST','/v1/intents/'+id+'/wallet-attempts',{kind},{},{epoch:scope.generation,retainKey:true});checkEpoch(scope.generation);
      await checkWallet(scope.wallet,scope.address);checkEpoch(scope.generation);
      let hash;
      try{hash=await scope.wallet.request({method:'eth_sendTransaction',params:[{from:prepared.from,to:prepared.to,data:prepared.data,value:'0x0',chainId:'0x279f'}]});}
      catch{throw fail('ORIGINAL_PAYMENT_UNKNOWN','The wallet request is unresolved. Check this original contribution; do not send it again.');}
      if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw fail('ORIGINAL_HASH_UNKNOWN','The wallet did not return a valid transaction hash. Do not resend.');
      journal[key].hash=hash.toLowerCase();saveJournal();checkEpoch(scope.generation);
      return await retrySupportTransactionRecord(id,kind);
    }catch(error){
      if(!admissionStarted&&error&&typeof error==='object')error.walletStepNotStarted=true;
      throw error;
    }finally{busy=false;}
  }

  async function getPayouts(storeId){
    const generation=await ownerScope(storeId),data=await request('GET','/v1/stores/'+storeId+'/payouts');checkEpoch(generation);return data;
  }
  async function createSettlementReview({storeId,voucherId}){
    const generation=await ownerScope(storeId),data=await request('POST','/v1/stores/'+storeId+'/payouts/'+reference(voucherId)+'/settle-reviews',{},{},{epoch:generation});checkEpoch(generation);
    intentReference(data.reviewId);
    if(data.store!==storeId||data.review?.voucherId!==voucherId||!/^\d+$/.test(data.review.amount)||!/^\d+$/.test(data.review.generation))throw fail('SETTLEMENT_MISMATCH','The original settlement details could not be verified.');return data;
  }
  async function confirmSettlement({storeId,reviewId}){
    const generation=await ownerScope(storeId);intentReference(reviewId);
    const data=await request('POST','/v1/stores/'+storeId+'/settle-intents',{reviewId},{},{epoch:generation,retainKey:true});checkEpoch(generation);
    checkedRedemptionIntent(data,storeId);if(data.action!=='settle')throw fail('SETTLEMENT_MISMATCH','The original settlement could not be verified.');return data;
  }
  async function getSettlementIntent(storeId,id){
    const data=await getRedemptionIntent(storeId,id);if(data.action!=='settle')throw fail('SETTLEMENT_MISMATCH','Choose the original settlement.');return data;
  }
  function preparedSettlement(data,address,intent){
    const m=data.material;
    if(m?.kind!=='settle'||m.expectedAccount?.toLowerCase()!==address||m.binding?.owner?.toLowerCase()!==address||m.binding?.chainId!==10143||m.operation?.voucherId!==intent.voucherId||String(m.operation.generation)!==String(intent.generation)||String(m.amount)!==String(intent.amount))throw fail('SETTLEMENT_MISMATCH','The settlement does not match the owner or original voucher.');
    const tx=prepareSettle({binding:m.binding,wallet:{chainId:10143,account:address},...m.operation}),server=data.transactions?.[0];
    if(data.transactions?.length!==1||server?.functionName!=='settle'||server.authority!=='PREPARATION_ONLY'||server.chainId!==tx.chainId||server.from?.toLowerCase()!==tx.from.toLowerCase()||server.to?.toLowerCase()!==tx.to.toLowerCase()||server.data?.toLowerCase()!==tx.data.toLowerCase()||!['0','0x0'].includes(String(server.value)))throw fail('SETTLEMENT_MISMATCH','The prepared settlement transaction does not match.');return tx;
  }
  async function getSettlementWalletPreparation(storeId,id){
    const generation=await ownerScope(storeId),scope=await supportScope(),intent=await getSettlementIntent(storeId,id);checkEpoch(generation);
    const data=await request('GET','/v1/intents/'+intentReference(id)+'/wallet-preparation');checkEpoch(generation);
    const tx=preparedSettlement(data,scope.address,intent),saved=journal['wallet-attempt:'+id+':settle'];
    return {...data,actions:[{kind:'settle',account:tx.from,to:tx.to,amount:String(data.material.amount),canRetryRecord:saved?.wallet===scope.address&&!!saved.hash&&!data.attempts?.settle?.hash,allowed:data.walletActionsEnabled===true&&data.allowedKinds?.includes('settle')===true&&!data.attempts?.settle&&!saved&&intent.stage!=='FINAL_SUCCEEDED'}]};
  }
  async function retrySettlementTransactionRecord(storeId,id){
    const generation=await ownerScope(storeId),scope=await supportScope();intentReference(id);
    const saved=journal['wallet-attempt:'+id+':settle'];
    if(saved?.wallet!==scope.address||!/^0x[0-9a-f]{64}$/.test(saved?.hash))throw fail('ORIGINAL_HASH_UNKNOWN','The original settlement hash is unknown. Do not send again.');
    await getSettlementIntent(storeId,id);checkEpoch(generation);
    const result=await request('POST','/v1/intents/'+id+'/wallet-transactions',{kind:'settle',transactionHash:saved.hash},{},{epoch:generation,retainKey:true});checkEpoch(generation);
    return {transactionHash:saved.hash,status:'PENDING',result};
  }
  async function sendSettlementTransaction(storeId,id){
    if(busy)throw fail('BUSY','A wallet request is already in progress.');busy=true;
    let admissionStarted=!!journal['wallet-attempt:'+id+':settle'];
    try{
      const generation=await ownerScope(storeId),scope=await supportScope(),data=await getSettlementWalletPreparation(storeId,id);checkEpoch(generation);
      if(data.actions[0]?.allowed!==true)throw fail('ORIGINAL_PAYMENT_PENDING','This settlement is unavailable or already attempted. Check its original progress.');
      const intent=await getSettlementIntent(storeId,id);checkEpoch(generation);const tx=preparedSettlement(data,scope.address,intent),key='wallet-attempt:'+id+':settle';
      admissionStarted=true;journal[key]={wallet:scope.address,hash:null};saveJournal();
      await request('POST','/v1/intents/'+id+'/wallet-attempts',{kind:'settle'},{},{epoch:generation,retainKey:true});checkEpoch(generation);
      await checkWallet(scope.wallet,scope.address);checkEpoch(generation);
      let hash;try{hash=await scope.wallet.request({method:'eth_sendTransaction',params:[{from:tx.from,to:tx.to,data:tx.data,value:'0x0',chainId:'0x279f'}]});}catch{throw fail('ORIGINAL_PAYMENT_UNKNOWN','The wallet request is unresolved. Check this original settlement; do not resend.');}
      if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw fail('ORIGINAL_HASH_UNKNOWN','The wallet did not return a valid settlement hash. Do not resend.');
      journal[key].hash=hash.toLowerCase();saveJournal();checkEpoch(generation);
      return await retrySettlementTransactionRecord(storeId,id);
    }catch(error){if(!admissionStarted&&error&&typeof error==='object')error.walletStepNotStarted=true;throw error;}
    finally{busy=false;}
  }

  async function createClaimReview({storeId,mealId}){
    const scope=await supportScope();
    if(!/^[0-9a-f]{64}$/.test(storeId)||!/^[0-9a-f]{64}$/.test(mealId))throw fail('INVALID_CLAIM','Choose an available public meal.');
    const data=await request('POST','/v1/claims/reviews',{store:storeId,meal:mealId},{},{epoch:scope.generation});checkEpoch(scope.generation);
    const r=data.review;intentReference(data.reviewId);
    if(data.store!==storeId||r?.mealId!=='0x'+mealId||!/^\d+$/.test(r.expectedUnitSeq)||!/^\d+$/.test(r.expectedNextGeneration)||!ID.test(r.expectedTermsHash)||!/^\d+$/.test(r.deadline))throw fail('CLAIM_REVIEW_MISMATCH','The original meal claim could not be verified.');
    return data;
  }
  async function confirmClaim(reviewId){
    const scope=await supportScope();intentReference(reviewId);
    const data=await request('POST','/v1/claims/intents',{reviewId},{},{epoch:scope.generation,retainKey:true});checkEpoch(scope.generation);
    if(data.action!=='issue')throw fail('CLAIM_INTENT_MISMATCH','The original claim response could not be verified.');intentReference(data.intentId??data.id);return data;
  }
  async function getClaimIntent(id){
    const scope=await supportScope(),data=await request('GET','/v1/intents/'+intentReference(id));checkEpoch(scope.generation);
    if(data.action!=='issue'||(data.intentId??data.id)!==id)throw fail('CLAIM_INTENT_MISMATCH','The original claim response could not be verified.');return data;
  }
  async function getClaimIntents(){const scope=await supportScope(),data=await request('GET','/v1/my/claims');checkEpoch(scope.generation);return data.items||[];}
  async function getMyVouchers(){const scope=await supportScope(),data=await request('GET','/v1/my/vouchers');checkEpoch(scope.generation);return data.items||[];}
  async function getVoucher(id){
    const scope=await supportScope(),data=await request('GET','/v1/vouchers/'+reference(id));checkEpoch(scope.generation);
    if((data.voucherId??data.id)!==id)throw fail('VOUCHER_MISMATCH','The original voucher could not be verified.');return data;
  }
  async function prepareVoucherDisplay(id){
    if(busy)throw fail('BUSY','Another account or wallet request is in progress.');busy=true;
    try{
      const scope=await supportScope();reference(id);let access=voucherAccess.get(id);
      if(!access){
        let recovered;
        try{recovered=await request('POST','/v1/vouchers/'+id+'/recover',{},{},{epoch:scope.generation});checkEpoch(scope.generation);}
        catch(error){invalidateSession();throw error;}
        if((recovered.voucherId??recovered.id)!==id)throw fail('VOUCHER_MISMATCH','The original voucher could not be verified.');
        if(recovered.replay){invalidateSession();throw fail('VOUCHER_RECOVERY_REQUIRED','Sign in again to recover this original voucher.');}
        if(recovered.redeemable!==true)return {...recovered,display:null,displayUrl:null};
        if(!/^[A-Za-z0-9_-]{43}$/.test(recovered.access??'')){invalidateSession();throw fail('VOUCHER_RECOVERY_REQUIRED','Sign in again to recover this original voucher.');}
        access=recovered.access;voucherAccess.set(id,access);
      }
      const data=await request('POST','/v1/vouchers/'+id+'/display',{access},{},{epoch:scope.generation});checkEpoch(scope.generation);
      if((data.voucherId??data.id)!==id||!/^[A-Za-z0-9_-]{43}$/.test(data.display??'')||!Number.isSafeInteger(Number(data.validUntil))||Number(data.validUntil)<=0)throw fail('VOUCHER_DISPLAY_UNAVAILABLE','The verification code could not be recovered. Check the original voucher.');
      return {...data,displayUrl:origin()+'/#verify?code='+encodeURIComponent(data.display)};
    }finally{busy=false;}
  }

  return {createMealPublishReview,confirmMealPublish,getMealPublishIntent,getMealPublishIntents,getPayouts,createSettlementReview,confirmSettlement,getSettlementIntent,getSettlementWalletPreparation,sendSettlementTransaction,retrySettlementTransactionRecord,checkVoucher,lockVoucher,getRedemptionIntent,getRedemptionCase,confirmHandover,createClaimReview,confirmClaim,getClaimIntent,getClaimIntents,getMyVouchers,getVoucher,prepareVoucherDisplay,getContext,invalidateSession,loginWithMetaMask,logout,getPublicLedger,saveRegistration,signRegistration,enableRegistration,getRegistration,listStores,getStoreMeals,getOwnerOverview,getOwnerMeals,getMealDraft,saveMealDraft,uploadMealImage,createSupportReview,confirmSupport,getSupportIntent,getSupportOrders,getSupportWalletPreparation,sendSupportTransaction,retrySupportTransactionRecord};
}
export const liveApi=createLiveApi();
