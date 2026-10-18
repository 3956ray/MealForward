import {
  createPublicClient,createWalletClient,custom,http,defineChain,
  getAddress,isAddress,formatUnits,parseUnits,parseEventLogs
} from 'viem';
import contracts from './contract.generated.json';
import {matchesDeployedRuntime} from './runtime-verify.js';

const CHAIN=defineChain({
 id:10143,
 name:'Monad Testnet',
 nativeCurrency:{name:'MON',symbol:'MON',decimals:18},
 rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz']}},
 blockExplorers:{default:{name:'MonadVision',url:'https://testnet.monadvision.com'}}
});
const RPC='https://testnet-rpc.monad.xyz';
const EXPLORER='https://testnet.monadvision.com';
const ZERO='0x0000000000000000000000000000000000000000';
const BYTES32='0x'+'0'.repeat(64);
const abi=contracts.MealForwardPilot.abi;
const tokenAbi=contracts.PilotMealCredit.abi;
const publicClient=createPublicClient({chain:CHAIN,transport:http(RPC,{timeout:12000,retryCount:1})});
const initial=new URL(location.href).searchParams.get('pilot')||localStorage.getItem('mf_pilot_escrow_v1')||'';
const state={
 pilot:isAddress(initial)?getAddress(initial):null,
 token:null,account:null,chainId:null,balance:0n,allowance:0n,minted:false,
 kitchens:[],selected:1,vouchers:{},contributions:{},
 qty:1,busy:false,txHash:null,history:[],message:'',
 qr:null,scanInput:'',scanned:null,loading:true
};
let toastTimer=null,scanStream=null,scanTimer=null,refreshCounter=0;
const root=document.getElementById('main');
const $=selector=>document.querySelector(selector);
const htmlEscape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=x=>x?x.slice(0,7)+'…'+x.slice(-5):'—';
const fmt=x=>formatUnits(BigInt(x||0),6).replace(/\.0+$/,'');
const txUrl=x=>EXPLORER+'/tx/'+x;
const addressUrl=x=>EXPLORER+'/address/'+x;
const wallet=()=>window.ethereum;
const validBytes=x=>/^0x[0-9a-fA-F]{64}$/.test(x||'');
const validSig=x=>/^0x[0-9a-fA-F]{130}$/.test(x||'');
function info(message){
 const t=$('#toast');if(!t)return;
 t.textContent=message;t.classList.add('show');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),5500);
}
function describeError(error){
 const str=String(error?.shortMessage||error?.cause?.shortMessage||error?.message||error||'发生错误');
 const clean=str.replace(/(0x[a-fA-F0-9]{130,})/g,'[签名已隐藏]');
 if(/User rejected|rejected the request|User denied|user rejected/i.test(clean))return '钱包请求已取消，没有重新发送交易。';
 if(/WrongChain|wrong chain|chain mismatch/i.test(clean))return '请切换到 Monad Testnet（10143）。';
 if(/Insufficient funds|insufficient funds/i.test(clean))return '测试 MON 不足，请从 Monad 官方 Faucet 领取少量 Gas。';
 if(/execution reverted|revert/i.test(clean))return '合约拒绝了本次操作。请检查钱包身份、餐券状态或权限，详情可在区块浏览器查看。';
 return clean.slice(0,230);
}
function storedKey(type){return 'mf_pilot_'+type+'_'+String(state.pilot||'').toLowerCase()+'_'+String(state.account||'').toLowerCase();}
function savePilot(address){
 const url=new URL(location.href);url.searchParams.set('pilot',address);
 history.replaceState(null,'',url.pathname+url.search+url.hash);
 localStorage.setItem('mf_pilot_escrow_v1',address);
 state.pilot=address;
}
function shareUrl(){const u=new URL(location.origin+'/');u.searchParams.set('pilot',state.pilot);return u.href;}
function selectedKitchen(){return state.kitchens.find(x=>x.id===state.selected)||state.kitchens[0]||null;}
function selectedVoucher(){return selectedKitchen()?state.vouchers[selectedKitchen().id]:null;}
function cardHeader(n,heading,explanation){
 return '<div class="meta"><span class="pill">STEP '+n+'</span></div><h3>'+htmlEscape(heading)+'</h3><p>'+htmlEscape(explanation)+'</p>';
}
function button(action,text,variant='',attrs=''){
 return '<button class="btn '+variant+'" data-action="'+action+'" '+(state.busy?'disabled ':'')+attrs+'>'+text+'</button>';
}
function sectionTitle(overline,title,description){
 return '<div class="section-head"><div><span class="eyebrow">'+overline+'</span><h2>'+title+'</h2></div><p>'+description+'</p></div>';
}
function statusBadge(done,disabled){
 return '<span class="pill '+(done?'ok':disabled?'block':'wait')+'">'+(done?'✓ 链上确认':disabled?'等待上一步':'待测试')+'</span>';
}
function progress(){
 const k=selectedKitchen();const v=selectedVoucher()||state.scanned;
 return [
  {label:'部署隔离 Pilot',detail:'Monad Testnet 合约',done:!!state.token},
  {label:'建立真实餐馆',detail:'商家钱包注册',done:state.kitchens.length>0},
  {label:'资助真实链上餐食',detail:'Approve + Fund',done:!!k&&k.totalFunded>0n},
  {label:'领取者申请餐券',detail:'Issue Voucher',done:!!k&&k.issued>0n},
  {label:'商家验券并锁定',detail:'签名授权 → Reserve',done:!!v&&v.status>=2},
  {label:'确认交餐并结算',detail:'Handover → Settle',done:!!v&&v.status===4}
 ];
}
function progressHtml(){
 const p=progress(),count=p.filter(x=>x.done).length;
 return '<section class="shell" id="journey">'+sectionTitle('TEST JOURNEY','按真实区块链回执，一步步完成','这是独立 Monad Testnet 测试合约，不连接旧 CP30 资金或数据库。')+
 '<div class="grid"><div class="card half"><div class="meta"><strong>当前里程碑</strong><span class="pill ok">'+count+'/'+p.length+'</span></div>'+
 '<div class="progress">'+p.map(x=>'<span class="'+(x.done?'filled':'')+'"></span>').join('')+'</div>'+
 '<div class="steps">'+p.map((x,i)=>'<div class="flowline"><span class="flowstep '+(x.done?'done':i===count?'current':'')+'">'+(x.done?'✓':i+1)+'</span><div class="flowcopy"><strong>'+x.label+'</strong><small>'+x.detail+'</small></div>'+statusBadge(x.done,i>count)+'</div>').join('')+
 '</div></div><div class="card half callout"><span class="eyebrow">WHAT COUNTS AS SUCCESS?</span><h3>有交易记录，才算完成。</h3><p>每次操作都需要 MetaMask 明确签名。只有区块链回执成功并读取到新状态，才会更新此页。取消交易或请求超时不会自动重复发送。</p>'+
 '<div class="tile-actions"><a class="btn gold" href="/test-guide.html">打开三钱包测试清单 ↗</a><a class="btn secondary" href="https://faucet.monad.xyz" target="_blank" rel="noopener noreferrer">领取测试 MON ↗</a></div>'+
 '<hr class="divider"><p class="subtle" style="color:#ccdbd0">测试 mMEAL 没有任何实际价值。商家“交餐确认”是测试角色的手动声明，不能代替真实线下交餐证明。</p></div></div></section>';
}
function deployHtml(){
 if(state.pilot)return '';
 return '<section class="shell" id="setup">'+sectionTitle('ISOLATED DEPLOYMENT','先部署一份全新的测试合约','用你自己的 MetaMask 在 Monad Testnet 上部署一次；不会重置旧资金和账本。')+
 '<div class="grid"><div class="card half">'+cardHeader('0','部署独立测试环境','一次部署会生成免费 mMEAL 测试代币与待用餐状态合约；你只需支付测试 MON Gas。')+
 '<div class="notice warning"><strong>不使用真实 USDC。</strong> 这里的资金和餐券只用于验收钱包签名、区块链状态和商家结算。</div>'+
 '<div class="tile-actions">'+button('deploy','由 MetaMask 部署新 Pilot','')+'</div></div>'+
 '<div class="card half">'+cardHeader('0B','已有其他测试人的链接？','将商家分享给你的 Pilot 合约地址粘贴这里，即可与另一台设备读取同一份真实链上数据。')+
 '<label class="field-label" for="contract-input">独立 Pilot 合约地址（0x…）</label><input id="contract-input" class="field" placeholder="0x…" autocomplete="off">'+
 '<div class="tile-actions">'+button('attach','连接已有 Pilot','secondary')+'</div></div></div></section>';
}
function deployedHtml(){
 if(!state.pilot)return '';
 return '<section class="status-bar" aria-label="链上连接状态"><div><span class="pill ok">● MONAD TESTNET</span> <strong>独立 Pilot：</strong> <a href="'+addressUrl(state.pilot)+'" target="_blank" rel="noopener">'+htmlEscape(short(state.pilot))+' ↗</a> <span class="subtle">与原 CP30 完全隔离</span></div>'+
 '<div class="copyrow">'+button('share','复制跨设备共享链接','small secondary')+button('refresh','刷新链上数据','small secondary')+'</div></section>';
}
function kitchenHtml(){
 if(!state.pilot)return '';
 const kitchens=state.kitchens;
 const cards=kitchens.map(k=>{
  const selected=k.id===state.selected?'border-color:#6ba58a;box-shadow:0 8px 35px #28643a1b;':'';
  return '<article class="card third" style="'+selected+'"><div class="kitchen-illustration">🍚</div>'+
  '<div class="meta"><span class="pill">KITCHEN #'+k.id+'</span><span class="pill '+(k.available>0n?'ok':'wait')+'">'+(k.available>0n?'可领取':'等待资助')+'</span></div>'+
  '<h3>'+htmlEscape(k.name)+'</h3><p class="mono">商家：'+htmlEscape(short(k.owner))+'</p>'+
  '<div class="stat-line"><div><strong>'+htmlEscape(fmt(k.unitPrice))+'</strong><span> mMEAL／餐</span></div><div><strong>'+k.available.toString()+'</strong><span> 份待领</span></div></div>'+
  '<div class="stat-line"><div><span>已资助 '+htmlEscape(fmt(k.totalFunded))+' mMEAL</span></div><div><span>已结算 '+k.settled.toString()+' 份</span></div></div>'+
  button('select','选择这家餐馆','small '+(selected?'':'secondary'),'data-id="'+k.id+'"')+
  '</article>';
 }).join('');
 const k=selectedKitchen(),own=!!k&&!!state.account&&k.owner.toLowerCase()===state.account.toLowerCase();
 const create='<div class="card half">'+cardHeader('1','商家注册餐品','商家钱包在此创建自己的餐馆，测试价格以免费 mMEAL 计。')+
 '<label class="field-label" for="kitchen-name">餐馆名称</label><input id="kitchen-name" class="field" maxlength="64" value="清和食堂" autocomplete="off">'+
 '<label class="field-label" for="kitchen-price">单份价格 (mMEAL)</label><input id="kitchen-price" type="number" min="1" max="20" step="1" class="field" value="5">'+
 '<div class="tile-actions">'+button('register','商家签名 · 上链注册')+'</div></div>';
 const donate='<div class="card half">'+cardHeader('2','支持者资助一份餐食','资助由捐赠钱包执行。领取免费的 mMEAL 后先 Approve，再 Fund；这是两次不同的链上交易。')+
 (!state.account?'<div class="notice warning">先连接 MetaMask 查看当前钱包余额。</div>':
 '<div class="token-panel"><span class="token-amount">'+htmlEscape(fmt(state.balance))+'</span><span>mMEAL 可用</span><span class="pill">'+(state.minted?'已领过免费信用':'尚未领取免费信用')+'</span></div>')+
 (k?'<p>选择餐馆：<strong>'+htmlEscape(k.name)+'</strong>，单价 '+htmlEscape(fmt(k.unitPrice))+' mMEAL。</p>'+
 (state.account?'<p class="notice"><strong>我的链上资助累计：</strong>'+htmlEscape(fmt(state.contributions[k.id]||0n))+' mMEAL（来自合约，不是浏览器模拟订单）</p>':''):'<p>请先建立至少一家餐馆。</p>')+
 '<label class="field-label" for="fund-quantity">资助份数 (每次 1–5)</label><select id="fund-quantity" class="field">'+[1,2,3,4,5].map(n=>'<option value="'+n+'" '+(state.qty===n?'selected':'')+'>'+n+' 份</option>').join('')+'</select>'+
 (k?'<p class="subtle">合计 '+htmlEscape(fmt(k.unitPrice*BigInt(state.qty)))+' mMEAL；当前授权额度 '+htmlEscape(fmt(state.allowance))+' mMEAL。</p>':'')+
 '<div class="tile-actions">'+
 button('faucet',state.minted?'免费代币已领取':'领取 100 免费 mMEAL','small secondary',state.minted?'disabled':'')+
 button('approve','① Approve 授权','small secondary',!k?'disabled':'')+
 button('fund','② Fund 真正资助','small',!k?'disabled':'')+
 '</div></div>';
 return '<section class="shell" id="kitchens">'+sectionTitle('PUBLIC KITCHENS','一份善意，从一家小店开始','每家餐馆和数量来自真实合约读取。选择一间厨房，然后在下方使用不同钱包测试三个角色。')+
 '<div class="grid">'+(cards||'<div class="card full empty">还没有真实上链的餐馆。请在下方用商家钱包注册。</div>')+'</div>'+
 '<div class="grid" style="margin-top:18px">'+create+donate+'</div></section>';
}
function voucherStatus(v){
 return ['不存在','已领取 · 待使用','已验券锁定','已确认交餐','已结算'][v?.status??0]||'未知';
}
function receiptRow(hash,name){
 return '<li><span>'+htmlEscape(name)+'</span><a href="'+txUrl(hash)+'" target="_blank" rel="noopener noreferrer" class="mono">'+htmlEscape(short(hash))+' ↗</a></li>';
}
function recipientHtml(){
 if(!state.pilot)return '';
 const k=selectedKitchen(),voucher=selectedVoucher();
 let status=voucher?'<div class="notice"><strong>我的链上餐券</strong><br><span class="mono">'+htmlEscape(voucher.id)+'</span><br><span class="pill '+(voucher.status===4?'ok':voucher.status===1?'wait':'')+'">'+voucherStatus(voucher)+'</span></div>':
 '<div class="empty">当前钱包尚未在选中的餐馆领取过餐券。领取后刷新页面，仍可从链上找回原 Voucher ID。</div>';
 return '<section class="shell section-contrast" id="recipient">'+sectionTitle('RECIPIENT','领一餐，留一份温暖','Claim 是一笔真实链上交易。QR 需要由领取者钱包额外签署短时授权消息，但签名本身不扣除代币。')+
 '<div class="grid"><div class="card half">'+cardHeader('3','领取者：我的餐券','请切换到与资助者不同的 MetaMask 钱包，更容易验证身份隔离。')+
 '<p>选择厨房：<strong>'+(k?htmlEscape(k.name):'无')+'</strong></p>'+
 status+'<div class="tile-actions">'+
 button('claim','领取一餐 · Claim','',(!k||!!voucher||k.available===0n)?'disabled':'')+
 (voucher&&voucher.status===1?button('qr','生成 120 秒授权 QR','secondary'):'')+
 '</div></div>'+
 '<div class="card half">'+cardHeader('3B','出示你的动态授权码','这里的二维码包含领取者对特定 Voucher、商家和到期时间的签名，商家不能用其他钱包替领取者签名。')+
 '<ul class="mini-list"><li>由真正的领取者钱包签名，不要把私钥给商家。</li><li>签名最长有效 120 秒；超时需要重新签。</li><li>用户需要把完整授权码交给商家，浏览器之间不会共享私钥或本地状态。</li><li>扫码 ≠ 已经交餐，商家仍需独立确认。</li></ul></div></div></section>';
}
function merchantHtml(){
 if(!state.pilot)return '';
 const k=selectedKitchen(),own=!!k&&!!state.account&&k.owner.toLowerCase()===state.account.toLowerCase();
 const last=state.scanned;
 const timeLeft=last?.handoverAt?Math.max(0,Number(last.handoverAt)+30-Math.floor(Date.now()/1000)):0;
 return '<section class="shell" id="merchant">'+sectionTitle('MERCHANT WORKSPACE','商家验券、交餐与结算','所有操作必须由创建厨房的商家钱包发起；非店主不能代替签名或领取餐费。')+
 '<div class="grid"><div class="card half">'+cardHeader('4','核对领取者授权','领取者出示 QR 后用相机扫描（支持的手机浏览器）或粘贴完整授权码。验券并不自动扣款。')+
 '<div class="notice '+(own?'':'warning')+'">'+(own?'已连接当前餐馆的商家钱包。':'当前钱包不是这家餐馆的 owner。请切换至创建餐馆的 MetaMask 钱包。')+'</div>'+
 '<label class="field-label" for="merchant-code">领取者 QR / 授权字符串</label><textarea id="merchant-code" rows="3" class="field" placeholder="MFP1|10143|0x合约|0x餐券|到期时间|0x签名">'+htmlEscape(state.scanInput)+'</textarea>'+
 '<div class="tile-actions">'+button('verify-code','检查授权码','small secondary')+
 button('camera','手机扫描 QR','small secondary')+
 button('reserve','商家锁券 · Reserve','small',(!own||!state.scanned||state.scanned.status!==1)?'disabled':'')+'</div>'+
 (last?'<div class="pending"><strong>当前验券对象</strong><p class="mono">'+htmlEscape(short(last.id))+'</p><span class="pill">'+voucherStatus(last)+'</span><p class="subtle">只能由该餐馆 owner 确认交餐及结算。</p></div>':'')+
 '</div><div class="card half">'+cardHeader('5','确认交餐及支付商家','锁券与实际交餐是两回事。必须先明确点击已交餐，链上记录 Handover，至少 30 秒后才能由商家结算。')+
 (!last?'<div class="empty">请先扫描或粘贴一张领取者的真实授权码。</div>':
 '<p>餐券状态：<strong>'+voucherStatus(last)+'</strong></p>'+
 '<div class="stat-line"><div><strong>'+htmlEscape(fmt(k?.unitPrice??0n))+'</strong><span> mMEAL／份</span></div><div><strong>'+htmlEscape(String(timeLeft))+'</strong><span> 秒后可结算</span></div></div>'+
 '<div class="tile-actions">'+
 button('handover','⑤ 已交餐 · Handover','',(!own||last.status!==2)?'disabled':'')+
 button('settle','⑥ 结算到商家钱包','gold',(!own||last.status!==3||timeLeft>0)?'disabled':'')+'</div>')+
 '<div class="subline"></div><p class="subtle">本 Pilot 仅转移免费 mMEAL，不使用真实 USDC。链上 Confirm Handover 仍只代表商家的声明，无法独立证明现实世界交餐。</p></div></div></section>';
}
function render(){
 const count=progress().filter(x=>x.done).length;
 $('#wallet-button').textContent=state.account?short(state.account):'连接 MetaMask';
 const contractNotice=state.pilot?deployedHtml():'';
 root.innerHTML=contractNotice+
 '<section class="hero"><div class="hero-inner"><span class="eyebrow">MONAD TESTNET · REAL TRANSACTIONS</span>'+
 '<h1>留一份餐，<br><em>把善意真正送上链。</em></h1>'+
 '<p>不是模拟点击，也不是原 CP30 的旧资金。这里是一套隔离的测试合约：从免费测试信用、资助、领券、QR 授权到商家结算，每一步都能获得真实 Monad Testnet 交易回执。</p>'+
 '<div class="hero-actions"><a class="btn gold" href="'+(state.pilot?'#kitchens':'#setup')+'">'+(state.pilot?'开始三角色测试 →':'部署独立测试合约 →')+'</a>'+
 '<a class="btn secondary" href="/test-guide.html">查看完整测试清单 ↗</a></div>'+
 '<div class="hero-tags"><span>✓ 不接触旧 CP30</span><span>✓ 真实钱包确认</span><span>✓ 测试代币无价值</span><span>✓ 跨浏览器共用链上数据</span></div>'+
 '<p class="brandline">留一膳，待一人，是为善。 · 一膳之微，亦可为善。</p></div></section>'+
 (state.message?'<div class="shell"><div class="notice warning">'+htmlEscape(state.message)+'</div></div>':'')+
 deployHtml()+progressHtml()+kitchenHtml()+recipientHtml()+merchantHtml()+
 '<section class="shell"><div class="grid"><div class="card full"><div class="section-head"><div><span class="eyebrow">PROOF, NOT PROMISES</span><h2>交易证据</h2></div><p>真实区块浏览器链接。没有链上交易回执，便不算完成。</p></div>'+
 (state.history.length?'<ul class="receipt-list">'+state.history.map(x=>receiptRow(x.hash,x.name)).join('')+'</ul>':
 '<div class="empty">当前浏览器尚未执行过确认成功的 Pilot 交易。完成一次操作后，这里会显示链上 Tx Hash。</div>')+
 (state.txHash?'<div class="pending"><strong>交易待核对：</strong><a class="mono secondary-link" href="'+txUrl(state.txHash)+'" target="_blank" rel="noopener noreferrer">'+htmlEscape(state.txHash)+'</a><p>刷新不会自动重新发起交易。先在 Explorer 检查这笔交易。</p></div>':'')+
 '</div></div></section>';
}
async function readPilot(address){
 const code=await publicClient.getCode({address});
 if(!matchesDeployedRuntime(code,contracts.MealForwardPilot))
  throw Error('合约代码与审核过的免费测试 Pilot 不一致，拒绝连接。请不要向陌生合约授权任何代币。');
 const token=await publicClient.readContract({address,abi,functionName:'credit'});
 if(!isAddress(token))throw Error('无法确认 Pilot 测试信用代币地址。');
 const creditCode=await publicClient.getCode({address:token});
 if(!matchesDeployedRuntime(creditCode,contracts.PilotMealCredit))
  throw Error('此合约使用的不是审核过的免费 mMEAL 测试代币，拒绝 Approve。');
 const chain=await publicClient.getChainId();
 if(chain!==10143)throw Error('公共 RPC 链 ID 不正确。');
 return getAddress(token);
}
async function refresh(){
 const id=++refreshCounter; state.loading=true;
 try{
  if(state.pilot){
   const token=await readPilot(state.pilot);
   if(id!==refreshCounter)return;
   const count=Number(await publicClient.readContract({address:state.pilot,abi,functionName:'kitchenCount'}));
   if(count>12)throw Error('餐馆数量超出独立 Pilot 规则上限。');
   const kitchens=await Promise.all(Array.from({length:count},async(_,i)=>{
    const id=i+1;
    const k=await publicClient.readContract({address:state.pilot,abi,functionName:'getKitchen',args:[BigInt(id)]});
    return {...k,id};
   }));
   if(id!==refreshCounter)return;
   state.token=token;state.kitchens=kitchens;
   if(!kitchens.find(k=>k.id===state.selected))state.selected=kitchens[0]?.id??1;
   state.vouchers={};state.contributions={};state.balance=0n;state.allowance=0n;state.minted=false;
   if(state.account){
    const results=await Promise.all([
     publicClient.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[state.account]}),
     publicClient.readContract({address:token,abi:tokenAbi,functionName:'allowance',args:[state.account,state.pilot]}),
     publicClient.readContract({address:token,abi:tokenAbi,functionName:'hasMinted',args:[state.account]}),
     ...kitchens.map(async k=>{
      const [voucherId,donated]=await Promise.all([
       publicClient.readContract({address:state.pilot,abi,functionName:'voucherOf',args:[BigInt(k.id),state.account]}),
       publicClient.readContract({address:state.pilot,abi,functionName:'contributions',args:[BigInt(k.id),state.account]})
      ]);
      return [k.id,voucherId,donated];
     })
    ]);
    if(id!==refreshCounter)return;
    state.balance=results[0];state.allowance=results[1];state.minted=results[2];
    for(const pair of results.slice(3)){
     state.contributions[pair[0]]=pair[2];
     if(pair[1]!==BYTES32){
      const v=await publicClient.readContract({address:state.pilot,abi,functionName:'getVoucher',args:[pair[1]]});
      state.vouchers[pair[0]]={id:pair[1],status:Number(v.status),recipient:v.recipient,kitchenId:Number(v.kitchenId),reservedAt:v.reservedAt,handoverAt:v.handedOverAt};
     }
    }
    if(id!==refreshCounter)return;
   }
   const recentId=localStorage.getItem(storedKey('merchant_voucher'));
   if(recentId&&validBytes(recentId)){
    try{
     const v=await publicClient.readContract({address:state.pilot,abi,functionName:'getVoucher',args:[recentId]});
     if(id===refreshCounter&&v.recipient!==ZERO)state.scanned={id:recentId,kitchenId:Number(v.kitchenId),status:Number(v.status),recipient:v.recipient,reservedAt:v.reservedAt,handedOverAt:v.handedOverAt,...(state.scanned?.id===recentId?{deadline:state.scanned.deadline,signature:state.scanned.signature}:{})};
    }catch{}
   }
  }
  state.message='';
 }catch(error){state.message='链上读取受阻：'+describeError(error);}
 finally{if(id===refreshCounter){state.loading=false;render()}}
}
async function connect(){
 if(!wallet())throw Error('未发现 MetaMask。请在支持 EVM 的钱包浏览器中打开此网站，或在桌面浏览器安装 MetaMask。');
 let chain=await wallet().request({method:'eth_chainId'});
 if(chain!=='0x279f'){
  try{await wallet().request({method:'wallet_switchEthereumChain',params:[{chainId:'0x279f'}]})}
  catch(e){
   if(e?.code===4902)await wallet().request({method:'wallet_addEthereumChain',params:[{
     chainId:'0x279f',chainName:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},
     rpcUrls:[RPC],blockExplorerUrls:[EXPLORER]
   }]});
   else throw e;
  }
  chain=await wallet().request({method:'eth_chainId'});
 }
 if(chain!=='0x279f')throw Error('当前网络不是 Monad Testnet 10143。');
 const accounts=await wallet().request({method:'eth_requestAccounts'});
 if(!accounts?.[0]||!isAddress(accounts[0]))throw Error('MetaMask 没有授权可用的钱包账户。');
 const changed=!state.account||state.account.toLowerCase()!==accounts[0].toLowerCase();
 state.account=getAddress(accounts[0]);state.chainId=10143;
 if(changed){state.qr=null;state.scanned=null;}
 render();return state.account;
}
async function tx(name,fn,{deployment=false}={}){
 if(state.busy)throw Error('还有一个钱包操作没有完成，请勿重复发送。');
 const account=await connect();
 state.busy=true;state.message='';render();
 let hash=null;
 try{
  const wc=createWalletClient({chain:CHAIN,transport:custom(wallet())});
  hash=await fn(wc,account);
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('钱包没有返回有效的交易 Hash。');
  state.txHash=hash;
  sessionStorage.setItem(storedKey('pending'),JSON.stringify({name,hash}));
  info('交易已发送，正在确认真实区块回执…');
  const receipt=await publicClient.waitForTransactionReceipt({hash,confirmations:2,timeout:120000});
  if(receipt.status!=='success')throw Error('交易回执显示 REVERT。请检查 Explorer，不要自动重发。');
  if(deployment){
   if(!receipt.contractAddress)throw Error('部署回执缺少合约地址。');
   const newAddress=getAddress(receipt.contractAddress);
   const verified=await readPilot(newAddress);
   if(!verified)throw Error('部署合约未通过独立代币验证。');
   savePilot(newAddress);
  }
  state.txHash=null;
  sessionStorage.removeItem(storedKey('pending'));
  state.history.unshift({name,hash});
  state.history=state.history.slice(0,14);
  localStorage.setItem('mf_pilot_history_'+state.pilot,JSON.stringify(state.history));
  info(name+' · 真实链上交易已确认');
  await refresh();
  return receipt;
 }catch(error){
  const text=describeError(error);
  if(hash)state.message='已发送的交易需要人工核对（未自动重发）：'+text;
  else state.message=text;
  info(text);throw error;
 }finally{state.busy=false;render()}
}
async function callContract(name,fn,args,address=state.pilot,contractAbi=abi){
 return tx(name,(client,account)=>client.writeContract({address,abi:contractAbi,functionName:fn,args,account}));
}
async function getQr(){
 const account=await connect();
 const k=selectedKitchen(),v=selectedVoucher();
 if(!k||!v||v.status!==1||v.recipient.toLowerCase()!==account.toLowerCase())throw Error('当前账户没有可用的本人餐券。');
 const block=await publicClient.getBlock({blockTag:'latest'});
 const deadline=block.timestamp+115n;
 const digest=await publicClient.readContract({address:state.pilot,abi,functionName:'credentialDigest',args:[v.id,deadline]});
 const wc=createWalletClient({chain:CHAIN,transport:custom(wallet())});
 const signature=await wc.signMessage({account,message:{raw:digest}});
 if(!validSig(signature))throw Error('MetaMask 没有返回可用的授权签名。');
 const encoded=['MFP1','10143',state.pilot,v.id,deadline.toString(),signature].join('|');
 state.qr={code:encoded,expiry:Number(deadline),id:v.id};
 const body=$('#qr-body');
 body.innerHTML='<p class="eyebrow">RECIPIENT AUTHORIZATION</p><h2 id="qr-title">出示这一份餐券</h2><p class="subtle">最多约 115 秒有效 · 商家扫描或复制完整码</p><div id="qr-content"></div><div class="code-box" id="qr-code-text"></div><div class="tile-actions"><button class="btn wide" data-action="copy-qr">复制完整授权码</button></div><p class="subtle">这是签名，不是转账。商家必须用自己的钱包 Reserve，再确认实际交餐。</p>';
 $('#qr-code-text').textContent=encoded;
 try{
  if(window.QRCode)new window.QRCode($('#qr-content'),{text:encoded,width:220,height:220,colorDark:'#183b33',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.M});
  else $('#qr-content').textContent='QR 渲染暂不可用，请复制下方授权码。';
 }catch{$('#qr-content').textContent='QR 渲染失败，请复制下方授权码。'}
 $('#qr-dialog').showModal();
}
function closeQr(){if($('#qr-dialog').open)$('#qr-dialog').close();state.qr=null;}
function parseCredential(text){
 const parts=String(text||'').trim().split('|');
 if(parts.length!==6||parts[0]!=='MFP1'||parts[1]!=='10143'||
   !isAddress(parts[2])||parts[2].toLowerCase()!==String(state.pilot).toLowerCase()||
   !validBytes(parts[3])||!/^[1-9][0-9]{0,15}$/.test(parts[4])||!validSig(parts[5]))
   throw Error('授权码格式、网络或合约地址不正确。');
 return {id:parts[3],deadline:BigInt(parts[4]),signature:parts[5]};
}
async function verifyCode(){
 const raw=$('#merchant-code')?.value||state.scanInput;
 const parsed=parseCredential(raw);
 const v=await publicClient.readContract({address:state.pilot,abi,functionName:'getVoucher',args:[parsed.id]});
 if(!v.recipient||v.recipient===ZERO||Number(v.status)===0)throw Error('链上查不到这张餐券。');
 const digest=await publicClient.readContract({address:state.pilot,abi,functionName:'credentialDigest',args:[parsed.id,parsed.deadline]});
 const block=await publicClient.getBlock({blockTag:'latest'});
 if(parsed.deadline<=block.timestamp||parsed.deadline>block.timestamp+120n)throw Error('授权已过期，或时间过长。请领取者重新生成。');
 state.scanned={...parsed,kitchenId:Number(v.kitchenId),status:Number(v.status),recipient:v.recipient,reservedAt:v.reservedAt,handedOverAt:v.handedOverAt,digest};
 state.scanInput=raw;
 localStorage.setItem(storedKey('merchant_voucher'),parsed.id);
 state.selected=Number(v.kitchenId);
 render();info('已核对链上 Voucher ID；点击 Reserve 后合约会验证领取者签名。');
}
async function openCamera(){
 if(!navigator.mediaDevices?.getUserMedia||!window.BarcodeDetector)throw Error('当前浏览器暂不支持直接扫码，请从领取者设备复制完整授权码粘贴。');
 const dialog=$('#qr-dialog'),body=$('#qr-body');
 body.innerHTML='<p class="eyebrow">SCAN VOUCHER</p><h2 id="qr-title">扫描领取者 QR</h2><video id="camera-video" playsinline autoplay muted style="width:100%;border-radius:16px;max-height:330px;background:#1d3029"></video><p class="subtle">扫码只在本机处理，不上传视频。</p>';
 dialog.showModal();
 scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
 const video=$('#camera-video');video.srcObject=scanStream;
 await video.play();
 const detector=new window.BarcodeDetector({formats:['qr_code']});
 const scan=async()=>{
  if(!scanStream||!dialog.open)return;
  try{
   const found=await detector.detect(video);
   if(found?.[0]?.rawValue){
    state.scanInput=found[0].rawValue;
    const field=$('#merchant-code');if(field)field.value=state.scanInput;
    closeCamera();await verifyCode();return;
   }
  }catch{}
  scanTimer=setTimeout(scan,420);
 };
 scanTimer=setTimeout(scan,500);
}
function closeCamera(){
 clearTimeout(scanTimer);scanTimer=null;
 if(scanStream){for(const track of scanStream.getTracks())track.stop();scanStream=null;}
 closeQr();
}
async function action(name,node){
 if(state.busy)return;
 try{
  switch(name){
   case 'connect':await connect();await refresh();break;
   case 'deploy':await tx('独立测试合约部署',(client,account)=>client.deployContract({abi,bytecode:contracts.MealForwardPilot.bytecode,args:[],account}),{deployment:true});break;
   case 'attach':{
    const value=$('#contract-input')?.value.trim();
    if(!isAddress(value))throw Error('请输入有效的测试 Pilot 合约地址。');
    const addr=getAddress(value);await readPilot(addr);savePilot(addr);await refresh();info('已连接真实测试合约');break;
   }
   case 'share':await navigator.clipboard.writeText(shareUrl());info('跨设备分享链接已复制');break;
   case 'refresh':await refresh();info('已重新读取链上状态');break;
   case 'register':{
    await connect();
    const title=String($('#kitchen-name')?.value||'').trim();
    const price=Number($('#kitchen-price')?.value);
    if(title.length<2||title.length>64||!Number.isInteger(price)||price<1||price>20)throw Error('餐馆名称 2–64 字，价格 1–20 mMEAL/份。');
    await callContract('商家注册','registerKitchen',[title,parseUnits(String(price),6)]);break;
   }
   case 'select':state.selected=Number(node.dataset.id);state.scanned=null;state.scanInput='';await refresh();location.hash='#kitchens';break;
   case 'faucet':await callContract('领取免费测试信用','faucet',[],state.token,tokenAbi);break;
   case 'approve':{
    const k=selectedKitchen();if(!k)throw Error('请先选择餐馆。');
    const amt=k.unitPrice*BigInt(state.qty);
    if(state.balance<amt)throw Error('免费测试 mMEAL 余额不足，请先领取测试信用。');
    await callContract('Approve 测试信用授权','approve',[state.pilot,amt],state.token,tokenAbi);break;
   }
   case 'fund':{
    const k=selectedKitchen();if(!k)throw Error('请先选择餐馆。');
    const amt=k.unitPrice*BigInt(state.qty);
    if(state.allowance<amt)throw Error('授权额度不足，请先完成 Approve。');
    if(state.balance<amt)throw Error('余额不足，请先领取免费信用。');
    await callContract('Fund 真实测试资助','fund',[BigInt(k.id),BigInt(state.qty)]);break;
   }
   case 'claim':{
    const k=selectedKitchen();if(!k||k.available===0n)throw Error('暂无可领取的真实链上餐食。');
    await callContract('Claim 链上领取','claim',[BigInt(k.id)]);break;
   }
   case 'qr':await getQr();break;
   case 'close-qr':closeCamera();break;
   case 'copy-qr':if(!state.qr)throw Error('授权码已失效，请重新生成。');await navigator.clipboard.writeText(state.qr.code);info('授权码已复制，请在有效期内交给商家');break;
   case 'verify-code':await verifyCode();break;
   case 'camera':await openCamera();break;
   case 'reserve':{
    const v=state.scanned;if(!v||!v.signature||!v.deadline)throw Error('请先验证新鲜的领取者授权。');
    const k=selectedKitchen();if(!k||k.id!==v.kitchenId||k.owner.toLowerCase()!==String(state.account).toLowerCase())throw Error('只有对应厨房 owner 可以锁券。');
    await callContract('Reserve 商家锁券','reserve',[v.id,v.deadline,v.signature]);break;
   }
   case 'handover':{
    const v=state.scanned,k=selectedKitchen();
    if(!v||v.status!==2||k.owner.toLowerCase()!==String(state.account).toLowerCase())throw Error('只有真实商家可确认已锁定的餐券。');
    await callContract('Handover 商家已交餐确认','confirmHandover',[v.id]);break;
   }
   case 'settle':{
    const v=state.scanned,k=selectedKitchen();
    if(!v||v.status!==3||k.owner.toLowerCase()!==String(state.account).toLowerCase())throw Error('只有商家可结算已交餐的餐券。');
    const latest=await publicClient.getBlock();
    if(latest.timestamp<v.handoverAt+30n)throw Error('链上延迟结算时间未达到，稍后重试。');
    await callContract('Settle 商家测试信用结算','settle',[v.id]);break;
   }
  }
 }catch(error){
  state.message=describeError(error);
  info(state.message);
  render();
 }
}
document.addEventListener('click',e=>{
 const node=e.target.closest('[data-action]');
 if(node){e.preventDefault();action(node.dataset.action,node)}
});
document.addEventListener('change',e=>{
 if(e.target?.id==='fund-quantity'){state.qty=Number(e.target.value);render();}
});
$('#qr-dialog').addEventListener('close',()=>{
 if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}
 clearTimeout(scanTimer);
});
if(wallet()?.on){
 wallet().on('accountsChanged',accounts=>{
  state.account=accounts?.[0]&&isAddress(accounts[0])?getAddress(accounts[0]):null;
  state.qr=null;state.scanned=null;closeCamera();
  info('钱包已切换，已清除上一身份的二维码和私有状态。');
  refresh();
 });
 wallet().on('chainChanged',chain=>{
  state.chainId=parseInt(chain,16);
  state.qr=null;state.scanned=null;closeCamera();
  if(state.chainId!==10143){state.account=null;state.message='钱包网络已变化，请切回 Monad Testnet 10143。';render();}
  else refresh();
 });
}
(async()=>{
 try{
  const pending=state.pilot&&sessionStorage.getItem(storedKey('pending'));
  if(pending){const p=JSON.parse(pending);if(/^0x[0-9a-fA-F]{64}$/.test(p.hash))state.txHash=p.hash;}
  const stored=state.pilot&&localStorage.getItem('mf_pilot_history_'+state.pilot);
  if(stored)state.history=JSON.parse(stored).filter(x=>/^0x[0-9a-fA-F]{64}$/.test(x.hash)).slice(0,14);
  if(wallet()){
   const accounts=await wallet().request({method:'eth_accounts'});
   const chain=await wallet().request({method:'eth_chainId'});
   if(chain==='0x279f'&&accounts?.[0]&&isAddress(accounts[0]))state.account=getAddress(accounts[0]);
  }
 }catch{}
 await refresh();
})();
