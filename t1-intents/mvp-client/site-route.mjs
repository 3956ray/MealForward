const paths={home:'home',catalog:'stores',orders:'mine/orders',vouchers:'mine/coupons',merchant:'merchant/meals',overview:'merchant/overview',fulfillment:'merchant/verify',payouts:'merchant/payouts',kitchen:'merchant/settings',ledger:'impact',about:'about'};
export const pageHash=page=>'#'+(paths[page]||'home');
export function readSiteRoute(hash=''){
 const value=hash.replace(/^#/,'');
 if(value.startsWith('voucher='))return {page:'vouchers'};
 if(value.startsWith('store/')){try{return {page:'store',storeId:decodeURIComponent(value.slice(6))};}catch{return {page:'missing'};}}
 if(value==='ledger')return {page:'ledger'};
 if(value==='how')return {page:'home',anchor:'how'};
 if(value==='register')return {page:'kitchen'};
 if(value==='contributions')return {page:'orders'};
 if(value==='mine')return {page:'vouchers'};
 if(value==='merchant')return {page:'overview'};
 return {page:Object.keys(paths).find(key=>paths[key]===value)||(value?'missing':'home')};
}
