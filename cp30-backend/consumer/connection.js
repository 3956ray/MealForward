import {request,notify,openReview,sessionEstablished,revokeCommittedLogin} from './consumer.js';
import {prepareApprove,prepareFund,prepareSettle,priceUnits,priceDisplay,validateWalletLoginChallenge,signWalletLoginMessage} from './assets/wallet.js';

const node=id=>document.getElementById(id);
const connection={setup:null,registration:null,signature:null,walletRequest:null,attempted:new Set(),generation:0,identitySetup:null,identityClient:null,identityBusy:false,identityRetry:false,walletLoginBusy:false,walletLoginGeneration:0,walletLoginChallenge:null};
const text=(tag,value)=>{const element=document.createElement(tag);element.textContent=value;return element;};
const identityErrors={OTP_REJECTED:'验证码暂未验证成功。请确认使用本页最近收到的新码；之前校准用过的验证码不能重复使用。',INVALID_OTP:'请先在本页发送验证码，再输入收到的完整数字验证码。',AUTH_BUSY:'正在处理登录，请等待当前步骤完成后再操作。'};
const action=fn=>async event=>{event?.preventDefault();const button=event?.submitter || event?.currentTarget;if(button)button.disabled=true;try{await fn();}catch(error){notify(identityErrors[error.code || error.message] || error.message || 'This action is unavailable.');}finally{if(button)button.disabled=false;applyControls();}};
const identityAction=fn=>action(async()=>{if(connection.identityBusy || connection.walletLoginBusy)throw Error('AUTH_BUSY');connection.identityBusy=true;applyControls();try{await fn();}finally{connection.identityBusy=false;applyControls();}});
const walletLoginReady=()=>connection.identitySetup?.walletLoginEnabled===true && connection.identitySetup.walletLoginChainId===10143 && connection.identitySetup.walletLoginOrigin===window.location.origin;
const walletLoginHint=()=>walletLoginReady()?'已启用。点击后会请求钱包连接，并签署本次登录信息。':'独立钱包登录尚未启用，或本站地址与登录配置不一致。';
function applyControls(){
  const ready=connection.identitySetup?.sdkLoginEnabled===true,busy=connection.identityBusy || connection.walletLoginBusy;
  node('send-email-code').disabled=!ready || busy;
  node('verify-email-code').disabled=!ready || busy || connection.identityClient?.getSnapshot().status!=='email-pending';
  node('retry-business-login').disabled=!ready || busy || !connection.identityRetry || connection.identityClient?.getSnapshot().status!=='authenticated';
  node('wallet-login').disabled=!walletLoginReady() || busy;
  node('bind-owner-wallet').disabled=connection.identitySetup?.walletProofEnabled!==true || busy;
  node('register-store-button').disabled=connection.setup?.registrationEnabled!==true;
  node('sign-registration').disabled=!connection.registration || connection.registration.state!=='DRAFT' || connection.registration.walletActionsEnabled!==true;
  node('enable-registration').disabled=!connection.signature || connection.registration?.walletActionsEnabled!==true;
}
async function loadSetup(){
  connection.setup=await request('GET','/v1/connection');
  window.dispatchEvent(new CustomEvent('c1-connection-setup',{detail:connection.setup}));
  connection.identitySetup=await request('GET','/v1/identity/setup');
  node('wallet-login-status').textContent=walletLoginHint();
  node('identity-setup').replaceChildren(...(connection.identitySetup.missing || []).map(item=>text('p',item)));
  node('bind-owner-wallet').disabled=connection.identitySetup.walletProofEnabled!==true;
  node('connection-setup').replaceChildren(text('p',connection.setup.status==='NOT_CONFIGURED'?'Real registration and wallet payments are not configured yet.':'Reviewed connection settings are available. Each original wallet action requires its server authorization.'));
  for(const item of connection.setup.missing || [])node('connection-setup').append(text('p',item));
  node('registration-price-label').textContent='Meal price'+(connection.setup.assetSymbol?' ('+connection.setup.assetSymbol+')':'');applyControls();
}
function clearConnections(){connection.generation++;connection.walletLoginGeneration++;connection.walletLoginChallenge=null;connection.signature=null;connection.registration=null;connection.walletRequest=null;connection.identityRetry=false;if(connection.identityClient)connection.identityClient.logout().catch(()=>{});node('real-email-otp').reset();node('registration-result').replaceChildren();node('wallet-description').replaceChildren();node('wallet-login-status').textContent=walletLoginHint();applyControls();}
window.addEventListener('c1-session-cleared',clearConnections);
window.addEventListener('c1-session-established',()=>{connection.generation++;connection.walletLoginChallenge=null;connection.signature=null;connection.registration=null;connection.walletRequest=null;node('wallet-description').replaceChildren();node('wallet-login-status').textContent=walletLoginHint();applyControls();});
window.addEventListener('pagehide',clearConnections);
async function explicitWallet(account,chainId){
  const provider=window.ethereum;
  if(!provider?.request)throw Error('Open this page with your wallet available.');
  const accounts=await provider.request({method:'eth_requestAccounts'});
  const chain=await provider.request({method:'eth_chainId'});
  if(!Number.isSafeInteger(chainId) || BigInt(chain)!==BigInt(chainId) || accounts[0]?.toLowerCase()!==account.toLowerCase())throw Error('Choose the original registered wallet and configured network, then try again.');
  return provider;
}
function walletTypedData(typed){
  const domain=typed?.domain,domainTypes=[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}];
  if(!domain || Object.keys(domain).length!==domainTypes.length || domainTypes.some(field=>!Object.hasOwn(domain,field.name)) || typeof domain.name!=='string' || !domain.name || typeof domain.version!=='string' || !domain.version || !Number.isSafeInteger(domain.chainId) || domain.chainId<=0 || !/^0x[0-9a-fA-F]{40}$/.test(domain.verifyingContract) || !typed.types || (Object.hasOwn(typed.types,'EIP712Domain') && JSON.stringify(typed.types.EIP712Domain)!==JSON.stringify(domainTypes)))throw Error('签名域信息不匹配，请重新读取原请求。');
  return {...typed,domain:{...domain},types:{...typed.types,EIP712Domain:domainTypes}};
}
function showRegistration(data){
  connection.registration=data;node('registration-reference').elements.registrationId.value=data.registrationId;
  const messages={DRAFT:'Your real first-meal draft is private. Sign the store authorization, then explicitly enable automatic deployment.',PENDING:'Automatic deployment was requested. Confirmation is still pending.',UNKNOWN:'The original deployment is uncertain. Check this registration; do not create a replacement.',CONFIRMED:'The original store deployment has been verified.'};
  node('registration-result').replaceChildren(text('p',messages[data.state] || 'Check the original registration.'),text('p','Keep your registration reference: '+data.registrationId));
  if(data.transactionHash)node('registration-result').append(text('p','Original transaction: '+data.transactionHash));
  if(data.ready && !data.businessReady)node('registration-result').append(text('p','Public listing and support are awaiting the real business projection. A deployment confirmation alone does not enable payments.'));
  if(data.businessReady)node('registration-result').append(text('p','The verified store and original first meal are ready for public listing.'));
  if(data.businessReady){const view=text('button','View verified stores');view.type='button';view.addEventListener('click',action(showVerifiedStores));node('registration-result').append(view);}
  applyControls();
}
async function showVerifiedStores(){
  const data=await request('GET','/v1/registered-stores');node('verified-stores').replaceChildren();
  for(const store of data.items){const card=document.createElement('article');card.append(text('h2',store.name),text('h3',store.firstMeal.name),text('p',store.firstMeal.description),text('p',priceDisplay(store.firstMeal.unitPrice,connection.setup.assetDecimals,connection.setup.assetSymbol)),text('p','Original store contract: '+store.escrow),text('p','Wallet support requires a verified original quote and activated payment connection.'));const photo=document.createElement('img');photo.src='/v1/registered-store-images/'+store.firstMeal.imageDigest;photo.alt=store.firstMeal.name;card.append(photo);node('verified-stores').append(card);}
}
const minute=value=>{const [hour,minute]=value.split(':').map(Number);return hour*60+minute;};
node('register-store').addEventListener('submit',action(async()=>{
  if(connection.setup?.registrationEnabled!==true)throw Error('Complete the connection setup first.');
  const generation=connection.generation,originalSetup=connection.setup,form=new FormData(node('register-store')),file=form.get('image');
  if(!file || file.size<=0 || file.size>5*1024*1024)throw Error('Choose a meal photo up to 5 MB.');
  const saved=await request('PUT','/v1/store-registration-images',file);
  if(generation!==connection.generation)return;
  const fresh=await request('GET','/v1/connection');
  if(generation!==connection.generation)return;
  const profileFields=['mode','assetVerified','assetDecimals','assetSymbol','storeLimit'],firstRunFields=['stores','meals','testAssets'];
  if(fresh.registrationEnabled!==true || !Number.isSafeInteger(fresh.serverTime) || fresh.serverTime<=0 || fresh.serverTime>Number.MAX_SAFE_INTEGER-600 || !Number.isInteger(fresh.assetDecimals) || fresh.assetDecimals<0 || fresh.assetDecimals>36 || profileFields.some(key=>fresh[key]!==originalSetup[key]) || firstRunFields.some(key=>fresh.firstRun?.[key]!==originalSetup.firstRun?.[key]))throw Error('注册配置已变化或服务端时间无效，请重新检查连接设置后保存。');
  const windows=[[minute(form.get('start')),form.get('midnight')?1440:minute(form.get('end'))]];
  const body={name:form.get('storeName'),deadline:String(fresh.serverTime+600),firstMeal:{name:form.get('name'),description:form.get('description'),unitPrice:priceUnits(form.get('price'),fresh.assetDecimals),imageRef:saved.imageRef,windows}};
  const data=await request('POST','/v1/store-registrations',body);
  if(generation!==connection.generation)return;connection.signature=null;showRegistration(data);
}));
node('registration-reference').addEventListener('submit',action(async()=>{
  const id=new FormData(node('registration-reference')).get('registrationId').trim();
  if(!/^0x[0-9a-f]{64}$/.test(id))throw Error('Enter your original registration reference.');
  const generation=connection.generation,data=await request('GET','/v1/store-registrations/'+id);
  if(generation!==connection.generation)return;connection.signature=null;showRegistration(data);
}));
node('sign-registration').addEventListener('click',action(async()=>{
  const current=connection.registration,generation=connection.generation;
  if(current?.walletActionsEnabled!==true)throw Error('Wallet authorization is not activated.');
  const typed=walletTypedData(current.typedData),provider=await explicitWallet(typed.message.owner,typed.domain.chainId);
  const signature=await provider.request({method:'eth_signTypedData_v4',params:[typed.message.owner,JSON.stringify(typed)]});
  if(generation!==connection.generation || connection.registration!==current)return;
  connection.signature=signature;notify('Authorization signed. Review and enable automatic deployment separately.');applyControls();
}));
node('enable-registration').addEventListener('click',action(async()=>{
  const current=connection.registration,signature=connection.signature,generation=connection.generation;
  if(!signature || current?.walletActionsEnabled!==true)throw Error('Sign the original store authorization first.');
  openReview('Enable automatic store deployment',{name:'Original store registration'},async()=>{
    const data=await request('POST','/v1/store-registrations/'+current.registrationId+'/enable',{ownerSignature:signature});
    if(generation===connection.generation){connection.signature=null;showRegistration(data);}
  },'The platform registrar deploys the store using your original first meal. Your authorization does not pay deployment gas or establish confirmation.');
}));
node('load-connection-setup').addEventListener('click',action(loadSetup));

function prepareClient(data){
  const material=data.material,wallet={chainId:material.binding.chainId,account:material.expectedAccount};
  if(material.kind==='fund')return [prepareApprove({binding:material.binding,wallet,payer:material.signedQuote.quote.payer,amount:material.signedQuote.quote.amount}),prepareFund({binding:material.binding,wallet,signedQuote:material.signedQuote,now:data.now})];
  if(material.kind==='settle')return [prepareSettle({binding:material.binding,wallet,...material.operation})];
  throw Error('This original request cannot use a wallet.');
}
async function sendOriginal(id,data,prepared){
  if(connection.walletRequest?.id!==id || connection.walletRequest.data!==data)throw Error('Review this request again with your current sign-in.');
  if(data.walletActionsEnabled!==true)throw Error('Wallet payments are not activated.');
  const correlation=id+':'+prepared.functionName;
  if(connection.attempted.has(correlation))throw Error('Check the original transaction. Do not send it again.');
  const provider=await explicitWallet(prepared.from,prepared.chainId);
  await request('POST','/v1/intents/'+encodeURIComponent(id)+'/wallet-attempts',{kind:prepared.functionName});
  // Block another send before handing the request to the wallet. Missing hash is UNKNOWN.
  connection.attempted.add(correlation);
  let hash;
  try{hash=await provider.request({method:'eth_sendTransaction',params:[{from:prepared.from,to:prepared.to,data:prepared.data,value:'0x0',chainId:'0x'+prepared.chainId.toString(16)}]});}
  catch{notify('The original wallet request may be unresolved. Check its original result before any further action.');return;}
  await request('POST','/v1/intents/'+encodeURIComponent(id)+'/wallet-transactions',{kind:prepared.functionName,transactionHash:hash.toLowerCase()});
  notify('Original transaction recorded as pending. Mining alone does not establish the final business result.');
}
async function reviewWallet(id){
  const generation=connection.generation;
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Enter the original request reference.');
  const data=await request('GET','/v1/intents/'+encodeURIComponent(id)+'/wallet-preparation');
  if(generation!==connection.generation)return;
  connection.walletRequest={id,data};node('wallet-description').replaceChildren(text('p','Prepared from the original authenticated request. Nothing has been sent.'));
  for(const prepared of prepareClient(data)){
    const card=document.createElement('article');card.append(text('h3',prepared.functionName==='approve'?'Allow the original meal contribution':prepared.functionName==='fund'?'Support the original meal':'Settle the original collected meal'),text('p','Wallet: '+prepared.from),text('p','Destination: '+prepared.to));
    const amount=data.material.kind==='fund'?data.material.signedQuote.quote.amount:data.material.amount;
    if(amount!==undefined)card.append(text('p',priceDisplay(amount,connection.setup.assetDecimals,connection.setup.assetSymbol)));
    const send=text('button','Review wallet request');send.type='button';send.disabled=data.walletActionsEnabled!==true || !data.allowedKinds?.includes(prepared.functionName);
    send.addEventListener('click',action(async()=>openReview('Review original wallet request',{name:prepared.functionName},()=>sendOriginal(id,data,prepared),'Your wallet signs and sends this one original request. Confirmation and final accounting are checked separately by the backend.')));
    card.append(send);node('wallet-description').append(card);
  }
}
node('wallet-request').addEventListener('submit',action(async()=>reviewWallet(new FormData(node('wallet-request')).get('intent').trim())));
window.addEventListener('c1-wallet-review',event=>reviewWallet(event.detail.id).catch(error=>notify(error.message)));
loadSetup().catch(()=>notify('Connection setup is currently unavailable. Real registration and wallet actions remain closed.'));

node('wallet-login').addEventListener('click',action(async()=>{
  if(!walletLoginReady())throw Error('独立钱包登录尚未启用，请先检查连接配置。');
  if(connection.identityBusy || connection.walletLoginBusy)throw Error('AUTH_BUSY');
  connection.walletLoginBusy=true;connection.walletLoginChallenge=null;applyControls();
  const generation=connection.generation,walletGeneration=connection.walletLoginGeneration,provider=window.ethereum;
  const current=()=>generation===connection.generation && walletGeneration===connection.walletLoginGeneration;
  const requireCurrent=()=>{if(!current())throw Error('钱包或登录状态已变化，本次登录已停止。请重新点击登录。');};
  const changed=()=>{connection.walletLoginGeneration++;connection.walletLoginChallenge=null;if(generation===connection.generation)node('wallet-login-status').textContent='钱包账户或网络已变化，本次登录已停止。请重新点击登录。';};
  let watching=false,loginCommitted=false,committedCsrf=null;
  try{
    if(!provider?.request || typeof provider.on!=='function' || typeof provider.removeListener!=='function')throw Error('请在支持账户与网络变化通知的浏览器钱包中打开此页面。');
    const accounts=await provider.request({method:'eth_requestAccounts'}),chain=await provider.request({method:'eth_chainId'});requireCurrent();
    if(!Array.isArray(accounts) || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0]) || typeof chain!=='string' || !/^0x[0-9a-fA-F]+$/.test(chain) || BigInt(chain)!==10143n)throw Error('请在钱包中自行选择 Monad 测试网和本次登录账户。');
    const address=accounts[0].toLowerCase(),context=()=>({address,chainId:10143,origin:window.location.origin,now:Math.floor(Date.now()/1000)});
    provider.on('accountsChanged',changed);provider.on('chainChanged',changed);watching=true;
    const checkWallet=async()=>{
      const currentAccounts=await provider.request({method:'eth_accounts'}),currentChain=await provider.request({method:'eth_chainId'});requireCurrent();
      if(!Array.isArray(currentAccounts) || currentAccounts[0]?.toLowerCase()!==address || typeof currentChain!=='string' || !/^0x[0-9a-fA-F]+$/.test(currentChain) || BigInt(currentChain)!==10143n)throw Error('钱包账户或网络已变化，请重新点击登录。');
    };
    node('wallet-login-status').textContent='正在获取本次登录信息，请核对钱包中的登录签名。';
    await request('POST','/v1/auth/pre-session',{}, {'X-C1-Bootstrap':'1'});requireCurrent();
    const challenge=await request('POST','/v1/identity/wallet/challenge',{address});requireCurrent();
    connection.walletLoginChallenge=challenge;validateWalletLoginChallenge(challenge,context());await checkWallet();requireCurrent();
    const signature=await signWalletLoginMessage(provider,challenge,context());requireCurrent();await checkWallet();requireCurrent();
    if(connection.walletLoginChallenge!==challenge)throw Error('本次登录请求已失效，请重新点击登录。');
    if(typeof signature!=='string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))throw Error('钱包返回的登录签名格式不匹配。');
    validateWalletLoginChallenge(challenge,context());
    const loginResponse=await request('POST','/v1/identity/wallet/login',{challengeId:challenge.challengeId,signature});
    loginCommitted=true;committedCsrf=loginResponse?.csrf;requireCurrent();
    connection.walletLoginChallenge=null;
    if(await sessionEstablished({isCurrent:current})===false)throw Error('钱包或登录状态已变化，本次登录已停止。');
    if(walletGeneration!==connection.walletLoginGeneration)throw Error('钱包账户或网络已变化，请核对当前账户后重新登录。');
    node('wallet-login-status').textContent='已使用独立测试钱包登录：'+address;notify('钱包登录已完成。每个钱包同时只能持有一张有效餐券。');
  }catch(error){
    if(loginCommitted){
      let outcome;try{outcome=await revokeCommittedLogin(committedCsrf);}catch{}
      // A newer session owns the page; the older attempt must not change its status.
      if(outcome?.superseded===true)return;
      if(outcome?.revoked!==true){
        node('wallet-login-status').textContent='本次登录会话的撤销尚未确认，请先检查登录状态。';
        throw Error('本次登录会话的撤销尚未确认，暂时不要继续操作。');
      }
      node('wallet-login-status').textContent='本次钱包登录已取消，原登录会话已撤销。请核对钱包后重新登录。';
    }else node('wallet-login-status').textContent='本次钱包登录未完成，请核对页面提示后重新点击登录。';
    throw error;
  }finally{
    if(watching){provider.removeListener('accountsChanged',changed);provider.removeListener('chainChanged',changed);}
    connection.walletLoginChallenge=null;connection.walletLoginBusy=false;applyControls();
  }
}));

node('real-email-login').addEventListener('submit',identityAction(async()=>{
  if(connection.identitySetup?.sdkLoginEnabled!==true)throw Error('Verified email login is not configured.');
  const {createDynamicAuthClient}=await import('./assets/identity.js');
  if(!connection.identityClient){connection.identityClient=createDynamicAuthClient();connection.identityClient.subscribe(applyControls);}await connection.identityClient.initialize();
  connection.identityRetry=false;await connection.identityClient.logout();
  await connection.identityClient.startEmail(String(new FormData(node('real-email-login')).get('email') || '').trim());
  node('real-email-otp').reset();notify('验证码已发送，请输入本页这次收到的新码。');
}));
node('real-email-otp').addEventListener('submit',identityAction(async()=>{
  if(connection.identitySetup?.sdkLoginEnabled!==true || connection.identityClient?.getSnapshot().status!=='email-pending')throw Error('INVALID_OTP');
  await connection.identityClient.verifyOtp(String(new FormData(node('real-email-otp')).get('otp') || '').trim());
  await exchangeBusinessLogin();
}));
async function exchangeBusinessLogin(){
  connection.identityRetry=false;
  let accessToken=connection.identityClient.getAccessToken();
  try{
    if(!accessToken)throw Error();
    await request('POST','/v1/auth/pre-session',{}, {'X-C1-Bootstrap':'1'});
    await request('POST','/v1/identity/login',{accessToken});await sessionEstablished();notify('Verified email session established. Wallet binding is checked separately.');
  }catch(error){
    const code=typeof error.code==='string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?error.code:'BUSINESS_LOGIN_UNAVAILABLE';
    const status=Number.isInteger(error.status) && error.status>=400 && error.status<=599?' / '+error.status:'';
    if(['DYNAMIC_PROFILE_EDGE_ACCESS_DENIED_1010','DYNAMIC_PROFILE_EDGE_ACCESS_DENIED'].includes(code)){
      connection.identityRetry=false;
      throw Error('验证码已通过，但 Dynamic 的站点防护拒绝服务器访问'+(code==='DYNAMIC_PROFILE_EDGE_ACCESS_DENIED_1010'?'（1010）':'')+'。需要 Dynamic 放行合法后端客户端后才能继续。诊断：'+code+status);
    }
    const invalidToken=['DYNAMIC_TOKEN_REJECTED','IDENTITY_BINDING_REJECTED','UNAUTHENTICATED'].includes(code);
    if(invalidToken || !accessToken)await connection.identityClient.logout().catch(()=>{});
    connection.identityRetry=!invalidToken && !!connection.identityClient.getAccessToken();
    throw Error('验证码已通过，但业务登录未完成（'+code+status+'）。'+(connection.identityRetry?'可点击“重试业务登录”，无需重输验证码。':'请重新发送本页登录码。'));
  }finally{accessToken=null;node('real-email-otp').reset();}
}
node('retry-business-login').addEventListener('click',identityAction(async()=>{
  if(!connection.identityRetry || connection.identityClient?.getSnapshot().status!=='authenticated')throw Error('INVALID_OTP');
  await exchangeBusinessLogin();
}));
node('bind-owner-wallet').addEventListener('click',action(async()=>{
  if(connection.identityBusy || connection.walletLoginBusy)throw Error('AUTH_BUSY');
  if(connection.identitySetup?.walletProofEnabled!==true)throw Error('Wallet control verification is not activated.');
  const provider=window.ethereum;if(!provider?.request)throw Error('Open this page with your wallet available.');
  const accounts=await provider.request({method:'eth_requestAccounts'}),chain=await provider.request({method:'eth_chainId'});
  if(BigInt(chain)!==BigInt(connection.identitySetup.walletProofChainId))throw Error('Choose the configured network in your wallet.');
  const generation=connection.generation,challenge=await request('POST','/v1/identity/wallet-challenges',{wallet:accounts[0]});
  if(generation!==connection.generation)return;
  const typed=walletTypedData(challenge.typed_data);
  const signature=await provider.request({method:'eth_signTypedData_v4',params:[challenge.wallet,JSON.stringify(typed)]});
  if(generation!==connection.generation)return;
  await request('POST','/v1/identity/wallet-proofs',{challengeId:challenge.challenge_id,signature});
  notify('Wallet control verified. Store permissions follow your verified original deployment.');
}));
