// Public OFF-CHAIN live smoke against independently isolated Worker/D1 staging.
// Creates marked synthetic records, never wallet signatures or blockchain tx.
import assert from 'node:assert/strict';
const base='https://mealforward-d1-offchain-staging.mealforward-lab-3956ray.workers.dev';
const request=async(path,method='GET',data,token)=>{
 const response=await fetch(base+path,{
  method,redirect:'error',
  headers:{'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
  ...(data?{body:JSON.stringify(data)}:{})
 });
 let body;try{body=await response.json()}catch{throw Error('NON_JSON_'+path+'_'+response.status)}
 return {status:response.status,body};
};
const requireSuccess=(result,label,status=200)=>{
 assert.equal(result.status,status,label+':'+JSON.stringify(result.body));
 return result.body;
};
const site=await fetch(base+'/',{redirect:'error'});assert.equal(site.status,200);
assert.match(site.headers.get('content-type')||'',/text\/html/);
const homepage=await site.text();
for(const landmark of ['STAGING · OFF-CHAIN ONLY','My Contributions','My Meals','data-role="merchant"','data-role="donor"','data-role="recipient"','id="settle"']){
 assert.ok(homepage.includes(landmark),'missing visible UI '+landmark);
}
const walletPage=await fetch(base+'/wallet-preflight',{redirect:'error'});
assert.equal(walletPage.status,200);
const walletHtml=await walletPage.text();
for(const item of ['Monad Testnet 钱包预检','id="connect"','id="switch"','id="gas"','id="token"','不会调用 approve 或 transfer']){
 assert.ok(walletHtml.includes(item),'wallet page missing '+item);
}
const health=requireSuccess(await request('/health'),'health');
assert.equal(health.mode,'OFFCHAIN_PERSISTENT_D1');
assert.equal(health.chainTransactions,false);
async function identity(role){
 const data=requireSuccess(await request('/api/identities','POST',{role}),role,201);
 assert.equal(data.identity.role,role);return{...data.identity,token:data.token};
}
const [merchant,donor,recipient,stranger]=await Promise.all(
 [identity('merchant'),identity('donor'),identity('recipient'),identity('merchant')]);
for(const user of [merchant,donor,recipient]){
 const res=requireSuccess(await request('/api/me','GET',null,user.token),'identity');
 assert.equal(res.id,user.id);
}
assert.equal((await request('/api/overview')).status,401);
assert.equal((await request('/api/kitchens','POST',{name:'bad',mealName:'bad',price:7},donor.token)).status,403);
const kitchen=requireSuccess(await request('/api/kitchens','POST',{
 name:'CI Staging Kitchen',mealName:'Test rice',price:7
},merchant.token),'new-kitchen',201);
const order=requireSuccess(await request('/api/orders','POST',{
 kitchenId:kitchen.id,quantity:1
},donor.token),'fund',201);
assert.equal(order.status,'SIMULATED_FUND');
const voucher=requireSuccess(await request('/api/vouchers','POST',{
 orderId:order.id
},recipient.token),'issue',201);
assert.equal(voucher.state,'ISSUED');
const second=await request('/api/vouchers','POST',{orderId:order.id},recipient.token);
assert.equal(second.status,409,'over-issue must fail');
const path='/api/vouchers/'+voucher.id+'/';
assert.equal((await request(path+'lock','POST',{},merchant.token)).status,409);
assert.equal((await request(path+'check','POST',{},stranger.token)).status,403);
const stages=[['check','CHECKED'],['lock','LOCKED'],['report','REPORTED'],['settle','SETTLED']];
for(const [step,status] of stages){
 const result=requireSuccess(await request(path+step,'POST',{},merchant.token),step);
 assert.equal(result.state,status);
}
assert.equal((await request(path+'settle','POST',{},merchant.token)).status,409);
const overview=requireSuccess(await request('/api/overview','GET',null,recipient.token),'overview');
assert.equal(overview.vouchers.find(v=>v.id===voucher.id)?.state,'SETTLED');
assert.equal(overview.orders.find(o=>o.id===order.id)?.remaining,0);
assert.equal(overview.kitchens.find(k=>k.id===kitchen.id)?.owner,merchant.id);
// Concurrency negative E2E: exactly one claim for one available meal.
const raceKitchen=requireSuccess(await request('/api/kitchens','POST',{
 name:'CI Race Kitchen',mealName:'One Remaining Meal',price:5
},merchant.token),'race-kitchen',201);
const raceOrder=requireSuccess(await request('/api/orders','POST',{
 kitchenId:raceKitchen.id,quantity:1
},donor.token),'race-order',201);
const claimants=await Promise.all(Array.from({length:6},()=>identity('recipient')));
const racing=await Promise.all(claimants.map(x=>request('/api/vouchers','POST',{
 orderId:raceOrder.id
},x.token)));
assert.equal(racing.filter(x=>x.status===201).length,1,'D1 issued too many vouchers');
const afterRace=requireSuccess(await request('/api/overview','GET',null,donor.token),'race-read');
assert.equal(afterRace.orders.find(x=>x.id===raceOrder.id)?.remaining,0);
assert.equal(afterRace.vouchers.filter(x=>x.order_id===raceOrder.id).length,1);

console.log(JSON.stringify({status:'PASS',mode:'OFFCHAIN_ONLY',stages:['Kitchen','Fund simulated','Issue simulated','Check','Lock','Report','Settle simulated'],persistentD1:true,walletFunded:false,realChainTransactions:0}));
