/* Formal Recovery v1 collection. Never sends a transaction; never persists browser secrets. */
const WALLETS=Object.freeze({owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',donor:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952'});
const DOMAIN={name:'MealForward T1F Recovery',version:'1',chainId:10143,verifyingContract:'0xcf0c8827c8610eeff1ecbd9719e559d805fafe58'};
const DOMAIN_FIELDS=[['name','string'],['version','string'],['chainId','uint256'],['verifyingContract','address']].map(([name,type])=>({name,type}));
const FIELDS=[['claimId','string'],['reviewId','string'],['slotId','string'],['voucherId','bytes32'],['originalOpId','bytes32'],['originalNonce','uint256'],['originalDeadline','uint256'],['originalDataHash','bytes32'],['newOpId','bytes32'],['newNonce','uint256'],['newDeadline','uint256'],['nonceDomain','bytes32'],['observedBlockNumber','uint256'],['observedBlockHash','bytes32'],['approvalExpiresAt','uint256']].map(([name,type])=>({name,type}));
const PINS={claimId:'fbab3b22-965d-44e2-b144-d7307b7aa8ea',voucherId:'0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605',originalOpId:'0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b',originalNonce:'0',originalDeadline:'1792765625',originalDataHash:'0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed',newNonce:'0'};
const check=x=>{if(!x)throw Error('APPROVAL_NOT_CONFIRMED_REFRESH_STATE')};
const keys=(o,k)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...k].sort().join(',');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x);
const bytes=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x)&&x!=='0x'+'0'.repeat(64);
export function validateApprovalState(s,{hashTypedData,now}){
 check(keys(s,['noRelease','canIssue','chainId','wallets','roles','serverTime','status','round'])&&s.noRelease===true&&s.canIssue===false&&s.chainId===10143&&Number.isSafeInteger(s.serverTime)&&Math.abs(s.serverTime-now)<=30);
 check(keys(s.wallets,['owner','donor'])&&Object.keys(WALLETS).every(k=>s.wallets[k]===WALLETS[k])&&keys(s.roles,['owner','donor'])&&Object.values(s.roles).every(v=>typeof v==='boolean'));
 if(s.round===null){check(s.status==='NO_ROUND'&&!s.roles.owner&&!s.roles.donor);return s}
 const r=s.round,t=r.typedData;
 check(keys(r,['id','digest','expiresAt','typedData'])&&uuid(r.id)&&bytes(r.digest)&&Number.isSafeInteger(r.expiresAt));
 check(keys(t,['domain','types','primaryType','message'])&&t.primaryType==='SuccessorIssueRelease'&&keys(t.domain,Object.keys(DOMAIN))&&Object.keys(DOMAIN).every(k=>t.domain[k]===DOMAIN[k]));
 check(keys(t.types,['EIP712Domain','SuccessorIssueRelease'])&&JSON.stringify(t.types.EIP712Domain)===JSON.stringify(DOMAIN_FIELDS)&&JSON.stringify(t.types.SuccessorIssueRelease)===JSON.stringify(FIELDS));
 check(keys(t.message,FIELDS.map(f=>f.name))&&Object.keys(PINS).every(k=>t.message[k]===PINS[k]));
 for(const f of FIELDS){const value=t.message[f.name];check(typeof value==='string');if(f.type==='bytes32')check(bytes(value));if(f.type==='uint256')check(/^(0|[1-9][0-9]{0,15})$/.test(value))}
 check(uuid(t.message.reviewId)&&uuid(t.message.slotId)&&t.message.newOpId!==PINS.originalOpId&&t.message.observedBlockNumber!=='0');
 check(Number(t.message.approvalExpiresAt)===r.expiresAt&&Number(t.message.newDeadline)===r.expiresAt+180&&r.expiresAt<=s.serverTime+300&&hashTypedData(t)===r.digest);
 const expected=s.serverTime>=r.expiresAt?'EXPIRED':s.roles.owner&&s.roles.donor?'COLLECTED_NO_RELEASE':'COLLECTING';check(s.status===expected);return s;
}
export function createApprovalClient({provider,request,hashTypedData,clock=()=>Math.floor(Date.now()/1000),render=()=>{}}){
 let revision=0,busy=false,state=null,csrf=null,sessionExpiry=0,needsRefresh=true;
 // Historical role proofs remain visible, but never look valid past the deadline.
 const snapshot=()=>({busy,state:state?.round&&clock()>=state.round.expiresAt?{...state,status:'EXPIRED'}:state,needsRefresh});const notify=()=>render(snapshot());
 const invalid=()=>{revision++;needsRefresh=true;notify()};
 for(const event of ['accountsChanged','chainChanged','disconnect'])provider?.on?.(event,invalid);
 const unchanged=version=>check(version===revision);
 const current=async(role,version)=>{
  check(Object.hasOwn(WALLETS,role)&&provider?.request);unchanged(version);
  const accounts=await provider.request({method:'eth_accounts'});unchanged(version);check(accounts?.[0]?.toLowerCase()===WALLETS[role]);
  const chain=await provider.request({method:'eth_chainId'});unchanged(version);check(BigInt(chain)===10143n);
 };
 const session=async()=>{const s=await request('/v1/approval/session','POST',{});check(keys(s,['csrf','expiresAt'])&&/^[0-9a-f]{64}$/.test(s.csrf)&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>clock());csrf=s.csrf;sessionExpiry=s.expiresAt};
 const read=async()=>validateApprovalState(await request('/v1/approval/state','GET',undefined,csrf),{hashTypedData,now:clock()});
 const eligible=(s,role)=>check(s&&s.status==='COLLECTING'&&!s.roles[role]&&s.round.expiresAt>clock());
 const action=async fn=>{check(!busy);busy=true;notify();try{return await fn()}catch{needsRefresh=true;throw Error('APPROVAL_NOT_CONFIRMED_REFRESH_STATE')}finally{busy=false;notify()}};
 return Object.freeze({snapshot,
  refresh:()=>action(async()=>{const v=revision;await session();unchanged(v);const next=await read();unchanged(v);state=next;needsRefresh=false}),
  connect:role=>action(async()=>{check(Object.hasOwn(WALLETS,role)&&provider?.request);await provider.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]});const v=revision;await current(role,v);needsRefresh=true}),
  sign:role=>action(async()=>{
   check(!needsRefresh);eligible(state,role);const v=revision,shownId=state.round.id,shownDigest=state.round.digest;
   await current(role,v);unchanged(v);
   if(!csrf||sessionExpiry<=clock()){await session();unchanged(v);await current(role,v);unchanged(v)}
   const fresh=await read();unchanged(v);eligible(fresh,role);check(fresh.round.id===shownId&&fresh.round.digest===shownDigest);state=fresh;
   await current(role,v);unchanged(v);eligible(fresh,role);
   // Only this explicit click path can open a wallet signature request.
   let signature=await provider.request({method:'eth_signTypedData_v4',params:[WALLETS[role],JSON.stringify(fresh.round.typedData)]});
   unchanged(v);await current(role,v);unchanged(v);eligible(fresh,role);
   check(typeof signature==='string'&&/^0x[0-9a-f]{130}$/i.test(signature));
   const body={role,roundId:fresh.round.id,digest:fresh.round.digest,signature};signature=null;
   let answer;try{answer=await request('/v1/approval/submit','POST',body,csrf)}finally{body.signature=null}
   unchanged(v);state=validateApprovalState(answer,{hashTypedData,now:clock()});needsRefresh=false;
  })
 });
}
export function approvalReviewText(state){
 if(!state?.round)return '尚无批准轮次。创建后会在这里展示双方必须核对的相同内容。';
 const {typedData,digest}=state.round;
 const labels={claimId:'原申领记录',reviewId:'独立审查记录',slotId:'恢复审查位置',voucherId:'餐券编号',originalOpId:'原操作编号',originalNonce:'原 Issuer Nonce',originalDeadline:'原截止时间（Unix 秒）',originalDataHash:'原调用摘要',newOpId:'候选操作编号',newNonce:'候选 Issuer Nonce',newDeadline:'候选截止时间（Unix 秒）',nonceDomain:'本轮唯一随机域',observedBlockNumber:'观察区块号',observedBlockHash:'观察区块哈希',approvalExpiresAt:'本轮批准到期时间（Unix 秒）'};
 const lines=['固定签名域',...Object.entries(typedData.domain).map(([name,value])=>name+': '+value),
  'primaryType: '+typedData.primaryType,'','双方相同的摘要 digest: '+digest,'','逐项签名内容'];
 for(const {name} of FIELDS)lines.push(labels[name]+' ('+name+')',typedData.message[name],'');
 return lines.join('\n');
}
async function browserRequest(path,method,body,csrf){
 const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Approval-CSRF':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(80000)});
 check(response.ok);return response.json();
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id);let client;
 function draw(){
  if(!client)return;const {state,busy,needsRefresh}=client.snapshot(),count=state?Number(state.roles.owner)+Number(state.roles.donor):0;
  $('status').textContent=(state?.status||'待核对')+' · '+count+'/2 · NO RELEASE';
  $('digest').textContent=state?.round?.digest||'尚无批准轮次';
  $('expires').textContent=state?.round?new Date(state.round.expiresAt*1000).toLocaleString():'—';
  $('manifest').textContent=approvalReviewText(state);
  $('refresh').disabled=busy;
  for(const role of Object.keys(WALLETS)){
   $(role+'-wallet').textContent=WALLETS[role];$(role+'-progress').textContent=state?.roles[role]?'已记录批准':'尚未记录';
   $(role+'-connect').disabled=busy;$(role+'-sign').disabled=busy||needsRefresh||state?.status!=='COLLECTING'||state.roles[role]||state.round.expiresAt<=Math.floor(Date.now()/1000);
  }
 }
 const act=async fn=>{try{$('message').textContent='处理中，请勿重复点击。';await fn();$('message').textContent='状态已核对。双人批准仍不释放或发送 Issue。'}catch{$('message').textContent='本次未确认。请先点击「刷新持久状态」核对结果；不会自动重试签名或提交。'}finally{draw()}};
 try{
  const {TypedDataEncoder}=await import('/approval-ethers-6.15.0.mjs');
  client=createApprovalClient({provider:window.ethereum?.isMetaMask===true?window.ethereum:null,request:browserRequest,hashTypedData:t=>TypedDataEncoder.hash(t.domain,{SuccessorIssueRelease:t.types.SuccessorIssueRelease},t.message),render:draw});
  $('refresh').addEventListener('click',()=>act(()=>client.refresh()));
  for(const role of Object.keys(WALLETS)){
   $(role+'-connect').addEventListener('click',()=>act(()=>client.connect(role)));
   $(role+'-sign').addEventListener('click',()=>act(()=>client.sign(role)));
  }
  setInterval(draw,1000);await act(()=>client.refresh());
 }catch{$('message').textContent='页面未就绪，请刷新。NO RELEASE';}
}
