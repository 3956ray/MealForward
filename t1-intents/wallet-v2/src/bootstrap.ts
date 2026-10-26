// This entry has no static imports. DOM handlers exist before any dependency loads.
type ModuleLoaders={
 loadWallet:()=>Promise<any>;
 loadValidation:()=>Promise<any>;
 loadController:()=>Promise<any>;
 loadApi:()=>Promise<any>;
 reportMs?:number;
 promptMs?:number;
 signingEnabled?:boolean;
};
const asset={wallet:'/wallet-v2-wallet.mjs',validation:'/wallet-v2-validation.mjs',controller:'/wallet-v2-controller.mjs'};
const defaults:ModuleLoaders={
 loadWallet:()=>import(asset.wallet),
 loadValidation:()=>import(asset.validation),
 loadController:()=>import(asset.controller),
 loadApi:()=>import(asset.controller),
 reportMs:10000,
 promptMs:30000,
 signingEnabled:false
};
export function mountWalletV2(document:Document,options:Partial<ModuleLoaders>={}){
 const loaders={...defaults,...options};
 const text=(id:string,value:string)=>{const element=document.getElementById(id);if(element)element.textContent=value};
 const button=(id:string)=>document.getElementById(id) as HTMLButtonElement;
 const select=document.getElementById('provider-select') as HTMLSelectElement;
 let controller:any=null;
 let validation:any=null;
 let liveWallet:any=null;
 let liveApi:any=null;
 let queuedInspect=false,queuedRefresh=false;
 let walletFailure=false,validationFailure=false,apiFailure=false;
 const start=Date.now();
 function render(snapshot:any){
  const wallet=snapshot.wallet,backend=snapshot.backend,round=snapshot.round;
  const old=select.value;
  select.replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent='请选择钱包提供方';select.append(empty);
  for(const choice of wallet.providers){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.name;select.append(option)}
  if(wallet.providers.some((choice:any)=>choice.id===old))select.value=old;
  text('wallet-progress',walletFailure?'钱包依赖加载失败，请重新载入页面':!liveWallet?'钱包依赖正在加载；服务读取可继续':wallet.progress+(wallet.code?` · ${wallet.code}`:''));
  text('wallet-account',wallet.account||'未授权或未连接');
  text('wallet-chain',wallet.chainId===null?'尚未读取':wallet.chainId===10143?'Monad Testnet · 10143':`错误网络 · ${wallet.chainId}`);
  text('wallet-role',wallet.role==='owner'?'Owner':wallet.role==='donor'?'Donor':wallet.account?'账户不匹配':'尚未确认');
  text('backend-progress',apiFailure?'服务依赖加载失败，请重新载入页面':backend.progress+(backend.code?` · ${backend.code}`:''));
  const state=round.state;
  text('round-status',round.reason==='EXPIRED'?'EXPIRED':state?.status||round.reason);
  text('round-id',state?.round?.id||'—');
  text('round-expiry',state?.round?new Date(state.round.expiresAt*1000).toLocaleString('zh-CN'):'—');
  text('round-digest',state?.round?.digest||'—');
  text('round-payload',state?.round?JSON.stringify(state.round.typedData,null,2):'尚无内容');
  text('sign-progress',validationFailure?'签名校验组件加载失败，请重新载入':round.progress+` · ${round.reason}`);
  button('sign-button').disabled=!validation||!round.canSign;
  const recordPrefix=backend.phase==='ready'?'':'上次读取 · ';
  text('owner-record',`Owner：${state?recordPrefix+(state.roles.owner?'服务已记录':'未记录'):'尚未读取'}`);
  text('donor-record',`Donor：${state?recordPrefix+(state.roles.donor?'服务已记录':'未记录'):'尚未读取'}`);
  text('release-status','NO RELEASE');
  text('diagnostic',snapshot.diagnostic);
 }
 select.addEventListener('change',()=>{if(controller&&select.value)controller.selectProvider(select.value)});
 button('inspect-button').addEventListener('click',()=>{
  text('wallet-progress','正在检查钱包；等待组件加载或账户响应');
  if(controller&&liveWallet)void controller.inspect();else queuedInspect=true;
 });
 button('connect-button').addEventListener('click',()=>{
  text('wallet-progress',controller&&liveWallet?'正在请求钱包连接许可':'钱包组件正在加载，请稍后再点击连接');
  if(controller&&liveWallet)void controller.connect();
 });
 button('refresh-button').addEventListener('click',()=>{
  text('backend-progress','正在刷新服务状态');
  if(controller&&validation&&liveApi)void controller.refresh();else queuedRefresh=true;
 });
 button('sign-button').addEventListener('click',()=>{text('sign-progress','正在核对轮次与钱包');if(controller&&validation)void controller.sign()});
 button('copy-diagnostic').addEventListener('click',()=>{const summary=document.getElementById('diagnostic')?.textContent||'';void document.defaultView?.navigator.clipboard?.writeText(summary)});
 const timer=setTimeout(()=>{
  if(!liveWallet&&!walletFailure)text('wallet-progress','钱包依赖仍在加载；服务读取可继续');
  if(!validation&&!validationFailure)text('sign-progress','签名校验依赖仍在加载；钱包检查可继续');
  if(!liveApi&&!apiFailure)text('backend-progress','服务依赖仍在加载；钱包检查可继续');
  if(!controller||!liveWallet||!validation||!liveApi)text('diagnostic',`build=wallet-v2 phase=dependencies elapsed=${Math.floor((Date.now()-start)/1000)}s code=WAITING`);
 },loaders.reportMs);
 void Promise.resolve().then(loaders.loadWallet).then(module=>{
  liveWallet=module.createWalletPort({changed:()=>controller?.walletChanged()});
  controller?.walletChanged();
  if(queuedInspect&&controller){queuedInspect=false;void controller.inspect()}
 }).catch(()=>{walletFailure=true;text('wallet-progress','钱包依赖加载失败，请重新载入页面');text('diagnostic','build=wallet-v2 phase=wallet-load code=DEPENDENCY_WALLET')});
 const controllerModule=Promise.resolve().then(loaders.loadController).catch(()=>{text('wallet-progress','控制器依赖加载失败，请重新载入页面');text('diagnostic','build=wallet-v2 phase=controller-load code=DEPENDENCY_CONTROLLER');return null});
 void Promise.resolve().then(loaders.loadApi).then(module=>{
  liveApi=module.createApprovalApi({});
  if(controller&&validation){queuedRefresh=false;void controller.refresh()}
 }).catch(()=>{apiFailure=true;text('backend-progress','服务依赖加载失败，请重新载入页面');text('diagnostic','build=wallet-v2 phase=api-load code=DEPENDENCY_API')});
 void Promise.resolve().then(loaders.loadValidation).then(module=>{
  validation=module;
  text('sign-progress','签名校验组件已加载；等待有效轮次');
  if(controller&&liveApi){void controller.refresh();queuedRefresh=false}
 }).catch(()=>{validationFailure=true;text('sign-progress','签名校验依赖加载失败；钱包检查仍可使用，请重新载入页面')});
 void controllerModule.then(core=>{
  if(!core)return;
  const port={providers:()=>liveWallet?.providers()||[],select:(id:string)=>{if(!liveWallet)throw Error('WALLET_UNAVAILABLE');liveWallet.select(id)},inspect:()=>liveWallet?liveWallet.inspect():Promise.reject(Error('WALLET_UNAVAILABLE')),connect:()=>liveWallet?liveWallet.connect():Promise.reject(Error('WALLET_UNAVAILABLE')),sign:(typedData:unknown,account:string)=>liveWallet?liveWallet.sign(typedData,account):Promise.reject(Error('WALLET_UNAVAILABLE')),dispose:()=>liveWallet?.dispose()};
  const api={read:(signal?:AbortSignal)=>liveApi?liveApi.read(signal):Promise.reject(Error('API_UNAVAILABLE')),submit:(input:unknown,signal?:AbortSignal)=>liveApi?liveApi.submit(input,signal):Promise.reject(Error('API_UNAVAILABLE'))};
  controller=core.createController({wallet:port,api,validate:(value:unknown,now:number)=>{
   if(!validation)throw Error('VALIDATION_UNAVAILABLE');
   return validation.validateState(value,now);
  },render,signingEnabled:loaders.signingEnabled,reportMs:loaders.reportMs,promptMs:loaders.promptMs,buildId:'wallet-v2'});
  if(liveWallet)text('wallet-progress','选择钱包提供方，然后检查当前账户');
  if(queuedInspect&&liveWallet){queuedInspect=false;void controller.inspect()}
  if(validation&&liveApi){queuedRefresh=false;void controller.refresh()}
 }).catch(()=>{text('wallet-progress','初始化失败，请重新载入页面');text('backend-progress','初始化失败，请重新载入页面');text('diagnostic','build=wallet-v2 phase=init code=INIT_FAILED')});
 return {controller:()=>controller};
}
if(typeof document!=='undefined'&&document.getElementById('inspect-button'))mountWalletV2(document);
