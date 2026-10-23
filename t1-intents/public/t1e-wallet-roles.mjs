/** Public, immutable original T0 authority addresses. UI preflight ONLY:
 * server-side proofWallet is the final authorization boundary.
 */
export const REGISTERED_ROLES=Object.freeze({
 issuer:'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3',
 quote:'0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952',
 owner:'0xc4f8a468f10d5f98dcff3282516125e97f26433b',
 operator:'0x3dc9d4509062cba2cfcb8edd3a8d656839a50165',
 catalog:'0x41dcbfed391b79fac7b2951dd136c6b7e1384259'
});
const ADDR=/^0x[0-9a-fA-F]{40}$/;
const RESERVED=new Map(Object.entries(REGISTERED_ROLES).map(([role,address])=>
 [address.toLowerCase(),role]));
const ROLE_NAMES=Object.freeze({
 issuer:'Issuer 发行者',quote:'Quote 资助授权',
 owner:'Owner 店铺所有者',operator:'Operator 核销操作员',
 catalog:'Catalog 菜单管理员'
});
export function classifyT1EWallet(role,address){
 if(!['issuer','recipient'].includes(role)||typeof address!=='string'||!ADDR.test(address))
  return {ok:false,code:'WALLET_ADDRESS_INVALID',roleName:null,wallet:null};
 const wallet=address.toLowerCase();
 const reserved=RESERVED.get(wallet)||null;
 if(wallet==='0x'+'0'.repeat(40))
  return {ok:false,code:'ZERO_WALLET_DENIED',roleName:null,wallet};
 if(role==='issuer'&&reserved!=='issuer')
  return {ok:false,code:'ONLY_PINNED_ISSUER_ALLOWED',
   roleName:reserved?ROLE_NAMES[reserved]:'非注册发行者',wallet};
 if(role==='recipient'&&reserved)
  return {ok:false,code:'RECIPIENT_MUST_BE_INDEPENDENT',
   roleName:ROLE_NAMES[reserved],wallet};
 return {ok:true,code:'INDEPENDENT_WALLET_READY',
  roleName:reserved?ROLE_NAMES[reserved]:'独立受助者测试钱包',wallet};
}
export function walletSelectionHelp(result){
 if(result.ok)return '当前钱包符合 '+result.roleName+' 身份要求，可以继续签署本次无资金控制证明。';
 if(result.code==='RECIPIENT_MUST_BE_INDEPENDENT')
  return 'MetaMask 返回了项目权限钱包（'+result.roleName+'），不能用来模拟受助者。请在 MetaMask 选择另一个独立账户，或点击「重新选择账户」。';
 if(result.code==='ONLY_PINNED_ISSUER_ALLOWED')
  return 'MetaMask 当前不是链上注册的 Issuer 钱包。请切换到 0x9747…aA2B3，勿使用 Quote 或 Owner 代替。';
 return '请在 MetaMask 选择一个有效的测试钱包账户。';
}
