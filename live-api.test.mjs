import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveApi,walletTypedData,metaMaskProvider} from './dist/live-api.mjs';
const id='0x'+'1'.repeat(64),owner='0x'+'2'.repeat(40);
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
const response=(value,status=200)=>({ok:status<400,status,json:async()=>value});
const config={registrationEnabled:true,assetDecimals:6,assetSymbol:'USDC',serverTime:1700000000};
const identity={walletLoginEnabled:true,walletLoginChainId:10143,walletLoginOrigin:'https://localhost:16443'};
const typed={domain:{name:'StoreFactory',version:'1',chainId:10143,verifyingContract:'0x'+'3'.repeat(40)},types:{Registration:[{name:'owner',type:'address'}]},primaryType:'Registration',message:{owner,deadline:"4102444800"}};
test('wallet signing adds the explicit domain without changing server typed data',()=>{
  const before=JSON.stringify(typed),data=walletTypedData(typed);
  assert.equal(data.types.EIP712Domain.length,4);assert.equal(JSON.stringify(typed),before);
  assert.throws(()=>walletTypedData({...typed,domain:{...typed.domain,chainId:1}}));
});
test('response loss reuses original registration and idempotency key after reload',async()=>{
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');
  const requests=[];let attempts=0,images=0;
  const fetchImpl=async(path,options)=>{
    if(path==='/v1/connection')return response(config);
    if(path==='/v1/identity/setup')return response(identity);
    if(path==='/v1/me')return response({walletAddress:owner});
    if(path==='/v1/store-registration-images'){images++;return response({imageRef:id});}
    if(path==='/v1/store-registrations'){
      requests.push(options);if(++attempts===1)throw Error('response lost');
      return response({registrationId:id,state:'DRAFT'});
    }
    throw Error('unexpected path');
  };
  const args={storage,fetchImpl,origin:()=>identity.walletLoginOrigin};
  const form={storeName:'Kitchen',mealName:'Meal',description:'Fresh',price:'7.25',photo:new Blob(['png'],{type:'image/png'}),windows:[[600,720]]};
  await assert.rejects(createLiveApi(args).saveRegistration(form),{code:'CONNECTION_UNAVAILABLE'});
  const result=await createLiveApi(args).saveRegistration(form);
  assert.equal(result.state,'DRAFT');assert.equal(images,1);
  assert.equal(requests[0].body,requests[1].body);
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  assert.equal(JSON.parse(requests[1].body).firstMeal.unitPrice,'7250000');
});
test('original progress comes from authenticated list and public projection',async()=>{
  const store=id.slice(2),registration={registrationId:id,storeId:id,state:'CONFIRMED',businessReady:true};
  const fetchImpl=async path=>response({'/v1/connection':config,'/v1/identity/setup':identity,'/v1/me':{walletAddress:owner},'/v1/store-registrations':{items:[registration]},'/v1/stores':{items:[{id:store,name:'Kitchen'}]},['/v1/stores/'+store+'/meals']:{items:[{listed:true}]}}[path]);
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');
  const result=await createLiveApi({storage,fetchImpl,origin:()=>identity.walletLoginOrigin}).getContext();
  assert.equal(result.session.wallet,owner);assert.equal(result.registration.registrationId,id);assert.equal(result.store.id,store);
});
test('authorization never persists the signature or emits deployment without explicit enable',async()=>{
  const storage=memory(),signed='0x'+'a'.repeat(130);let enabled=0;
  const provider={on(){},removeListener(){},async request({method}){return method==='eth_accounts'?[owner]:method==='eth_chainId'?'0x279f':signed;}};
  const fetchImpl=async(path,options)=>{
    if(path==='/v1/connection')return response(config);
    if(path==='/v1/identity/setup')return response(identity);
    if(path==='/v1/me')return response({walletAddress:owner});
    if(path.endsWith('/enable')){enabled++;assert.equal(JSON.parse(options.body).ownerSignature,signed);return response({state:'PENDING'});}
    return response({registrationId:id,state:'DRAFT',walletActionsEnabled:true,typedData:typed});
  };
  const api=createLiveApi({storage,fetchImpl,provider:()=>provider,origin:()=>identity.walletLoginOrigin});
  await api.signRegistration({registrationId:id});assert.equal(enabled,0);
  await api.enableRegistration(id);assert.equal(enabled,1);
  assert.ok(!JSON.stringify([...storage.data]).includes(signed));
  await assert.rejects(api.enableRegistration(id),{code:'SIGNATURE_REQUIRED'});
});
test('foreign wallet cannot authorize a store; offline site never returns synthetic success',async()=>{
  const api=createLiveApi({storage:memory(),origin:()=>identity.walletLoginOrigin,fetchImpl:async path=>response(path==='/v1/connection'?config:path==='/v1/identity/setup'?identity:path==='/v1/me'?{walletAddress:'0x'+'4'.repeat(40)}:{registrationId:id,state:'DRAFT',walletActionsEnabled:true,typedData:typed})});
  await assert.rejects(api.signRegistration({registrationId:id}),{code:'OWNER_MISMATCH'});
  await assert.rejects(createLiveApi({storage:memory(),fetchImpl:async()=>{throw Error('offline');}}).getContext(),{code:'CONNECTION_UNAVAILABLE'});
});

function loginFixture({changeOnMe=false,failOnMe=false,loginAddress=owner,serverAddress=loginAddress,available=[owner],onMe=()=>{},nativeReject=false,connectedAccounts=available,chain='0x279f'}={}){
  const storage=memory(),listeners=new Map(),calls=[],flow=[];
  const wallet={isMetaMask:true,on:(event,fn)=>listeners.set(event,fn),removeListener:event=>listeners.delete(event),async request({method}){
    flow.push('wallet:'+method);
    if(method==='eth_requestAccounts'){if(nativeReject)throw Object.assign(Error('User rejected'),{code:4001});return connectedAccounts;}
    return method==='eth_accounts'?available:method==='eth_chainId'?chain:'0x'+'a'.repeat(130);
  }};
  const now=Math.floor(Date.now()/1000),nonce='b'.repeat(64),challengeId='11111111-1111-4111-8111-111111111111';
  const challenge={challengeId,address:loginAddress,chainId:10143,nonce,domain:'localhost:16443',uri:identity.walletLoginOrigin,issuedAt:now,expiresAt:now+180};
  challenge.message=`localhost:16443 wants you to sign in with your Ethereum account:\n${loginAddress}\n\nSign in to MealForward with your test wallet.\n\nURI: ${challenge.uri}\nVersion: 1\nChain ID: 10143\nNonce: ${nonce}\nIssued At: ${new Date(now*1000).toISOString()}\nExpiration Time: ${new Date((now+180)*1000).toISOString()}\nRequest ID: ${challengeId}`;
  const fetchImpl=async(path,options)=>{
    calls.push({path,options});flow.push('api:'+path);
    if(path==='/v1/connection')return response(config);
    if(path==='/v1/identity/setup')return response(identity);
    if(path==='/v1/auth/pre-session')return response({csrf:'pre-csrf'});
    if(path==='/v1/identity/wallet/challenge')return response(challenge);
    if(path==='/v1/identity/wallet/login')return response({csrf:'original-login-csrf'});
    if(path==='/v1/me'){onMe();
      if(changeOnMe)listeners.get('accountsChanged')?.(['0x'+'9'.repeat(40)]);
      if(failOnMe)throw Error('network');
      return response({walletAddress:serverAddress});
    }
    if(path==='/v1/store-registrations'||path==='/v1/stores')return response({items:[]});
    if(path==='/v1/auth/logout')return response({ok:true});
    throw Error('unexpected request');
  };
  return {api:createLiveApi({storage,fetchImpl,provider:()=>wallet,origin:()=>identity.walletLoginOrigin}),calls,flow,wallet};
}
test('MetaMask native connection completes signed login without a site account picker',async()=>{
  const {api,calls,flow}=loginFixture();assert.equal((await api.loginWithMetaMask()).session.wallet,owner);
  assert.equal(flow[0],'wallet:eth_requestAccounts');assert.equal(flow.filter(e=>e==='wallet:eth_requestAccounts').length,1);
  assert.equal(flow.some(e=>e==='wallet:wallet_requestPermissions'),false);
  assert.equal(calls.filter(c=>c.path.endsWith('/logout')).length,0);
});
for(const mode of ['changeOnMe','failOnMe'])test(`post-commit ${mode} revokes only original login authorization`,async()=>{
  const {api,calls}=loginFixture({[mode]:true});await assert.rejects(api.loginWithMetaMask());
  const revoked=calls.find(c=>c.path==='/v1/auth/logout');assert.ok(revoked);
  assert.equal(revoked.options.headers['X-C1-CSRF'],'original-login-csrf');
  assert.equal(revoked.options.headers['X-C1-Preserve-Session-Cookie'],'1');
});
test('occupied one-store MVP blocks new saves before image upload or deployment',async()=>{
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');let writes=0;
  const fetchImpl=async(path,options)=>{
    if(options.method!=='GET')writes++;
    return response(path==='/v1/connection'?{...config,firstRun:{stores:1}}:path==='/v1/identity/setup'?identity:path==='/v1/me'?{walletAddress:owner}:path==='/v1/stores'?{items:[{id:id.slice(2)}]}:{items:[]});
  };
  const api=createLiveApi({storage,fetchImpl,origin:()=>identity.walletLoginOrigin});
  assert.equal((await api.getContext()).setup.registrationEnabled,false);
  await assert.rejects(api.saveRegistration({}),{code:'REGISTRATION_UNAVAILABLE'});assert.equal(writes,0);
});
test('anonymous 401 preserves enabled wallet login even when the one-store slot is occupied',async()=>{
  const fetchImpl=async path=>path==='/v1/me'?response({error:'UNAUTHENTICATED',setup:null},401):response(path==='/v1/connection'?{...config,firstRun:{stores:1}}:path==='/v1/identity/setup'?identity:{items:[{id:id.slice(2)}]});
  const result=await createLiveApi({storage:memory(),fetchImpl,origin:()=>identity.walletLoginOrigin}).getContext();
  assert.equal(result.session,null);assert.equal(result.setup.walletLoginEnabled,true);assert.equal(result.setup.registrationEnabled,false);
});
test('wallet change clears old session access, persists relogin across reload, and rejects late owner responses',async()=>{
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');
  const handlers=new Map();let address=owner,events=0,release,privateReads=0;
  const wallet={on:(name,fn)=>{const set=handlers.get(name)||new Set();set.add(fn);handlers.set(name,set);},removeListener:(name,fn)=>handlers.get(name)?.delete(fn),request:async({method})=>method==='eth_accounts'?[address]:'0x279f'};
  const registration={registrationId:id,storeId:id,state:'CONFIRMED',businessReady:true};
  const fetchImpl=async path=>{
    if(path.endsWith('/workbench'))return new Promise(resolve=>{release=()=>resolve(response({store:id.slice(2)}));});
    if(path==='/v1/me')privateReads++;
    return response({'/v1/connection':config,'/v1/identity/setup':identity,'/v1/me':{walletAddress:owner},'/v1/store-registrations':{items:[registration]},'/v1/stores':{items:[{id:id.slice(2)}]},['/v1/stores/'+id.slice(2)+'/meals']:{items:[{listed:true}]}}[path]);
  };
  const args={storage,fetchImpl,provider:()=>wallet,origin:()=>identity.walletLoginOrigin,onSessionInvalidated:()=>events++};
  const api=createLiveApi(args);assert.equal((await api.getContext()).session.wallet,owner);
  const pending=api.getOwnerOverview(id.slice(2));await Promise.resolve();address='0x'+'9'.repeat(40);
  for(const fn of handlers.get('accountsChanged'))fn([address]);
  release();await assert.rejects(pending,{code:'SESSION_CHANGED'});
  const context=await api.getContext();assert.equal(context.session,null);assert.equal(context.registrations.length,0);assert.equal(events,1);
  await assert.rejects(api.getRegistration(id),{code:'LOGIN_REQUIRED'});
  assert.equal((await createLiveApi(args).getContext()).session,null);assert.equal(privateReads,1);
});
test('reload with a different connected wallet does not recover the old cookie owner',async()=>{
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');let events=0;
  const wallet={on(){},removeListener(){},request:async({method})=>method==='eth_accounts'?['0x'+'9'.repeat(40)]:'0x279f'};
  const fetchImpl=async path=>response(path==='/v1/connection'?config:path==='/v1/identity/setup'?identity:{walletAddress:owner});
  const context=await createLiveApi({storage,fetchImpl,provider:()=>wallet,origin:()=>identity.walletLoginOrigin,onSessionInvalidated:()=>events++}).getContext();
  assert.equal(context.session,null);assert.equal(context.registration,null);assert.equal(events,1);
});

test('published meal remains recoverable while business services are not ready',async()=>{
  const registration={registrationId:id,storeId:id,state:'CONFIRMED',businessReady:false};
  const fetchImpl=async path=>response({'/v1/connection':config,'/v1/identity/setup':identity,'/v1/me':{walletAddress:owner},'/v1/store-registrations':{items:[registration]},['/v1/store-registrations/'+id]:registration,'/v1/stores':{items:[{id:id.slice(2)}]},['/v1/stores/'+id.slice(2)+'/meals']:{items:[{listed:true}]}}[path]);
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');
  const api=createLiveApi({storage,fetchImpl,origin:()=>identity.walletLoginOrigin});
  const context=await api.getContext();
  assert.equal(context.registration.listingConfirmed,true);assert.equal(context.registration.businessReady,false);assert.equal(context.store.id,id.slice(2));
  assert.equal((await api.getRegistration(id)).listingConfirmed,true);
});

test('owner menu requires authenticated ownership and a backend workbench grant',async()=>{
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');let owned=true,denied=false,workbenchReads=0;
  const registration={registrationId:id,storeId:id,state:'CONFIRMED',businessReady:true};
  const meal={id:'a'.repeat(64),name:'Meal',unitPrice:'7000000',listed:true};
  const fetchImpl=async path=>{
    if(path.endsWith('/drafts'))return response({error:'LIVE_OPERATION_NOT_IMPLEMENTED'},503);
    if(path.endsWith('/workbench')){workbenchReads++;return denied?response({error:'OWNER_BINDING_CHANGED'},403):response({items:[{...meal,listed:undefined}]});}
    const routes={'/v1/connection':config,'/v1/identity/setup':identity,'/v1/me':{walletAddress:owner},'/v1/store-registrations':{items:owned?[registration]:[]},'/v1/stores':{items:[{id:id.slice(2)}]},['/v1/stores/'+id.slice(2)+'/meals']:{items:[meal]}};
    assert.ok(Object.hasOwn(routes,path),path);return response(routes[path]);
  };
  const api=createLiveApi({storage,fetchImpl,origin:()=>identity.walletLoginOrigin});
  await assert.rejects(api.getOwnerMeals(id.slice(2)),{code:'OWNER_ACCESS_REQUIRED'});assert.equal(workbenchReads,0);
  await api.getContext();const result=await api.getOwnerMeals(id.slice(2));assert.equal(result.items[0].listed,true);assert.ok(Object.values(result.capabilities).every(v=>v===false));
  denied=true;await assert.rejects(api.getOwnerMeals(id.slice(2)),{code:'OWNER_BINDING_CHANGED'});
  owned=false;const context=await api.getContext();assert.equal(context.store,null);assert.deepEqual(context.session.stores,[]);
  await assert.rejects(api.getOwnerMeals(id.slice(2)),{code:'OWNER_ACCESS_REQUIRED'});assert.equal(workbenchReads,2);
});

test('private meal drafts preserve published content, exact prices and retry identity',async()=>{
  const storage=memory();storage.setItem('mealforward-live-csrf-v1','csrf');const requests=[];
  const meal='a'.repeat(64),newId='11111111-1111-4111-8111-111111111111';let failSave=true,failImage=true;
  const dto={id:meal,meal,draftRevision:2,revision:2,saved:true,publicationState:'PRIVATE_DRAFT',draft:{name:'Future',description:'Private',price:'7250001',windows:[[600,720]],imageDigest:null,hasImage:false,imageUrl:null}};
  const publicMeal={id:meal,name:'Published',description:'Public',unitPrice:'7000000',listed:true};
  const fetchImpl=async(path,options)=>{
    if(path.endsWith('/workbench'))return response({items:[publicMeal]});
    if(path.endsWith('/drafts'))return response({items:[dto],capabilities:{create:true,edit:true,upload:true,publish:false,listing:false}});
    if(path.endsWith('/drafts/'+newId)&&options.method==='PUT'){requests.push(options);if(failSave){failSave=false;throw Error('lost');}return response({...dto,id:newId,meal:newId});}
    if(path.endsWith('/image')&&options.method==='PUT'){requests.push(options);if(failImage){failImage=false;throw Error('lost');}return response({...dto,id:newId,meal:newId,draftRevision:3});}
    if(path.endsWith('/drafts/'+meal))return response(dto);
    const routes={'/v1/connection':config,'/v1/identity/setup':identity,'/v1/me':{walletAddress:owner},'/v1/store-registrations':{items:[{registrationId:id,storeId:id,state:'CONFIRMED',businessReady:true}]},'/v1/stores':{items:[{id:id.slice(2)}]},['/v1/stores/'+id.slice(2)+'/meals']:{items:[publicMeal]}};
    assert.ok(Object.hasOwn(routes,path),path);return response(routes[path]);
  };
  const args={storage,fetchImpl,origin:()=>identity.walletLoginOrigin};let api=createLiveApi(args);await api.getContext();
  const menu=await api.getOwnerMeals(id.slice(2));assert.equal(menu.items[0].name,'Published');assert.equal(menu.items[0].draft.name,'Future');assert.equal(menu.items[0].draft.price,'7.250001');assert.equal(menu.capabilities.edit,true);assert.equal(menu.capabilities.publish,false);
  assert.equal((await api.getMealDraft(id.slice(2),meal)).draft.unitPrice,'7250001');
  const input={name:'Future',description:'Private',price:'7.250001',windows:[[600,720]],expectedRevision:0};
  await assert.rejects(api.saveMealDraft(id.slice(2),newId,input),{code:'CONNECTION_UNAVAILABLE'});
  api=createLiveApi(args);await api.getContext();await api.saveMealDraft(id.slice(2),newId,input);
  assert.equal(JSON.parse(requests[0].body).price,'7250001');assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  const file=new Blob(['photo'],{type:'image/png'});await assert.rejects(api.uploadMealImage(id.slice(2),newId,file,{expectedRevision:2}),{code:'CONNECTION_UNAVAILABLE'});
  await api.uploadMealImage(id.slice(2),newId,file,{expectedRevision:2});
  assert.equal(requests[2].headers['Idempotency-Key'],requests[3].headers['Idempotency-Key']);assert.equal(requests[3].headers['X-C1-Draft-Revision'],'2');
});

test('MetaMask active account is used instead of an old cached account',async()=>{
 const second='0x'+'9'.repeat(40),{api,calls}=loginFixture({loginAddress:second,serverAddress:second,available:[second,owner]});
 const result=await api.loginWithMetaMask();assert.equal(result.session.wallet,second);assert.equal(result.store,null);
 const challenge=calls.find(c=>c.path.endsWith('/wallet/challenge'));assert.equal(JSON.parse(challenge.options.body).address,second);
});
test('native rejection cannot fall back to a previously connected wallet',async()=>{
 const {api,calls,flow}=loginFixture({nativeReject:true});await assert.rejects(api.loginWithMetaMask(),{code:4001});
 assert.deepEqual(flow,['wallet:eth_requestAccounts']);assert.equal(calls.length,0);
});
test('MetaMask native response without an account never creates a login challenge',async()=>{
 const {api,calls}=loginFixture({connectedAccounts:[]});await assert.rejects(api.loginWithMetaMask(),{code:'ACCOUNT_NOT_CONNECTED'});
 assert.equal(calls.some(c=>c.path.endsWith('/wallet/challenge')),false);
});
test('wallet account changed between connect and signature is rejected',async()=>{
 const second='0x'+'9'.repeat(40),{api,calls}=loginFixture({connectedAccounts:[second,owner],available:[owner,second]});
 await assert.rejects(api.loginWithMetaMask(),{code:'WALLET_CHANGED'});
 assert.equal(calls.some(c=>c.path.endsWith('/wallet/challenge')),false);
});
test('wrong Monad chain is blocked before the login challenge',async()=>{
 const {api,calls}=loginFixture({chain:'0x1'});await assert.rejects(api.loginWithMetaMask(),{code:'WALLET_CHANGED'});
 assert.equal(calls.some(c=>c.path.endsWith('/wallet/challenge')),false);
});
test('server returning a different authenticated wallet triggers explicit logout',async()=>{
 const second='0x'+'9'.repeat(40),{api,calls}=loginFixture({loginAddress:second,serverAddress:owner,available:[second,owner]});
 await assert.rejects(api.loginWithMetaMask(),{code:'SESSION_CHANGED'});
 assert.ok(calls.some(c=>c.path==='/v1/auth/logout'));assert.equal((await api.getContext()).session,null);
});
test('provider resolver selects MetaMask rather than Phantom in a multi-wallet browser',()=>{
 const prior=globalThis.ethereum,phantom={isPhantom:true,isMetaMask:true},metamask={isMetaMask:true};
 try{globalThis.ethereum={providers:[phantom,metamask]};assert.equal(metaMaskProvider(),metamask);
  globalThis.ethereum=phantom;assert.equal(metaMaskProvider(),null);
  globalThis.ethereum=metamask;assert.equal(metaMaskProvider(),metamask);
 }finally{globalThis.ethereum=prior;}
});

test('UI cancellation revokes a late committed sign-in and keeps reload anonymous',async()=>{
 let api;const f=loginFixture({onMe:()=>api.invalidateSession()});api=f.api;
 await assert.rejects(api.loginWithMetaMask(),{code:'SESSION_CHANGED'});
 assert.ok(f.calls.some(c=>c.path==='/v1/auth/logout'));assert.equal((await api.getContext()).session,null);
});
