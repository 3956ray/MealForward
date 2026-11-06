const $=id=>document.getElementById(id), key='mealforward-product-v3-deployment-46d42d61';
let config, wallet, connected=false, busy=false;
const status=text=>{$('status').textContent=text;};
function saved(){return JSON.parse(localStorage.getItem(key)||'null');}
function buttons(){ $('deploy').disabled=!connected||!config||busy||!!saved()||!!config.attempt;for(const id of ['connect','refresh','verify'])$(id).disabled=busy; }
async function api(path){const res=await fetch(path,{cache:'no-store'}),body=await res.json();if(!res.ok)throw Error(body.error);return body;}
async function walletCheck(expected=config,provider=wallet){
  const accounts=await provider.request({method:'eth_accounts'}),chain=await provider.request({method:'eth_chainId'});
  if(BigInt(chain)!==BigInt(expected.chainId))throw Error('请切换到 Monad Testnet（10143）');
  if(accounts[0]?.toLowerCase()!==expected.deployer.toLowerCase())throw Error('请切换到指定部署钱包 0xC4F8…6433b');
}
async function refresh(){
  config=undefined;buttons();config=await api('/preflight');
  $('review').textContent=`网络：${config.chainId === 10143 ? "Monad Testnet" : "本机测试链"} · ${config.chainId} · V3\n部署钱包：${config.deployer}\n平台领取：${config.claimAuthority}\n验券签名：${config.redemptionAuthority}\n餐款资产：${config.asset}\n领取间隔 / 券有效期：2 小时\n本次部署费用上限：${config.maximumMon} MON\n部署 nonce：${Number(BigInt(config.nonce))}\n独立合约：ProductEscrowV3（代码已固定审核）\n部署数据指纹：${config.dataHash}`;
  const previous=saved();if(previous||config.attempt){$('hash').value=previous?.hash||'';status('已记录一次部署请求。请仅核验原交易；本页不会再次发送。');}
  buttons();
}
async function run(fn){if(busy)return;busy=true;buttons();try{await fn();}catch(e){status(e.message||'操作未完成，请查询原交易。');}finally{busy=false;buttons();}}
$('connect').onclick=()=>run(async()=>{
  wallet=window.ethereum?.providers?.find(p=>p.isMetaMask)||window.ethereum;
  if(!wallet?.isMetaMask)throw Error('请在安装 MetaMask 的 Chrome 中打开本页');
  await wallet.request({method:'eth_requestAccounts'});await walletCheck();connected=true;
  wallet.on?.('accountsChanged',()=>{connected=false;buttons();status('钱包已变化，请重新连接核对。');});
  wallet.on?.('chainChanged',()=>{connected=false;buttons();status('网络已变化，请重新连接核对。');});
  status('钱包已核对。请检查角色、费用上限，再点击部署。');
});
$('refresh').onclick=()=>run(refresh);
$('deploy').onclick=()=>run(async()=>{
  if(saved()||config?.attempt)throw Error('已有部署请求，请只查询原交易');
  const reviewed=Object.freeze({...config}),provider=wallet;
  await walletCheck(reviewed,provider);
  const current=await api('/preflight');
  if(Date.now()-reviewed.checkedAt>300000||current.nonce!==reviewed.nonce||BigInt(current.gas)>BigInt(reviewed.gas)||BigInt(current.gasPrice)>BigInt(reviewed.gasPrice)||current.dataHash!==reviewed.dataHash)throw Error('链上状态或费用已变化，请点击重新核对后再操作');
  await walletCheck(reviewed,provider);
  // Persist BEFORE invoking the wallet. Even a rejection/transport error cannot silently enable replay.
  if(saved())throw Error('另一窗口已开始部署，请查询原交易');
  localStorage.setItem(key,JSON.stringify({nonce:reviewed.nonce,dataHash:reviewed.dataHash,state:'UNKNOWN'}));
  const reservation=await fetch('/reserve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce:reviewed.nonce,dataHash:reviewed.dataHash,gas:reviewed.gas,gasPrice:reviewed.gasPrice})});
  if(!reservation.ok)throw Error('部署请求未获准或已有请求，请查询原交易，不能再次部署');
  await walletCheck(reviewed,provider);
  status('等待你在 MetaMask 中确认。若结果未知，请查询原交易。');
  const hash=await provider.request({method:'eth_sendTransaction',params:[{from:reviewed.deployer,chainId:'0x'+BigInt(reviewed.chainId).toString(16),data:reviewed.data,value:'0x0',nonce:reviewed.nonce,gas:reviewed.gas,gasPrice:reviewed.gasPrice}]});
  localStorage.setItem(key,JSON.stringify({nonce:reviewed.nonce,dataHash:reviewed.dataHash,state:'SENT',hash}));
  $('hash').value=hash;status('已取得原交易 Hash。待确认后点击“核验原交易”。');
});
$('verify').onclick=()=>run(async()=>{
  const hash=$('hash').value.trim();if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('请填入完整交易 Hash');
  const result=await api('/verify?hash='+encodeURIComponent(hash));
  localStorage.setItem(key,JSON.stringify({state:'VERIFIED',hash}));
  $('result').hidden=false;$('result').textContent=JSON.stringify(result,null,2);
  status('已核验最终链上部署、合约代码和权限。下方仅为待审批部署清单，尚未加入允许列表或上线。');
});
window.addEventListener('storage',buttons);
await run(refresh);
