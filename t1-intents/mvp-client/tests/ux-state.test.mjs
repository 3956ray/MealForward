import test from 'node:test';
import assert from 'node:assert/strict';
import {filterMeals,errorText} from '../ux-state.mjs';
test('claim filter keeps funded unlisted meals; support excludes closed or expired meals',()=>{
 const catalog={stores:[{id:'s',name:'温暖厨房'}],meals:[{id:'a',storeId:'s',name:'热饭',listed:false,claimable:'2',remaining:'5',fundingDeadline:200},{id:'b',storeId:'s',listed:true,claimable:'0',remaining:'5',fundingDeadline:90}]};
 assert.equal(filterMeals(catalog,'温暖','claim',null,100)[0].id,'a');
 assert.equal(filterMeals(catalog,'','support',null,100).length,0);
 assert.equal(filterMeals(catalog,'missing','all',null,100).length,0);
 assert.match(errorText(Error('WALLET_OPERATION_PENDING')),/原操作/);
});
