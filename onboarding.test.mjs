import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registrationPresentation,validateDraft,renderRegistration,renderLiveCards,renderLiveKitchen,priceLabel,hasOwnedKitchen,renderLiveMealEditor,halfHourOptions,serviceHours,renderSupportFlow,renderClaimFlow,renderVerificationEntry,renderLiveStore} from './dist/onboarding-view.mjs';
test('deployment and publication remain distinct; unknown states fail closed',()=>{
 for(const state of ['DRAFT','PENDING','UNKNOWN','CONFIRMED','UNEXPECTED'])assert.notEqual(registrationPresentation({state,businessReady:false}).step,3);
 assert.equal(registrationPresentation({state:'CONFIRMED',businessReady:true}).step,3);
 assert.notEqual(registrationPresentation({state:'UNKNOWN',businessReady:true}).step,3);
});
test('first meal validates exact price, photo and non-overlapping Beijing-time periods',()=>{
 const input={storeName:'Kitchen',mealName:'Rice',description:'A bowl',price:'7.000001',photo:{type:'image/jpeg',size:500},windows:[[660,780],[1020,1140]]};
 assert.deepEqual(validateDraft(input),{});
 for(const price of ['0','-1','1e3','1.0000001',''])assert.ok(validateDraft({...input,price}).price);
 for(const windows of [[[720,660]],[[0,1441]],[[0,60],[59,90]],[[NaN,120]]])assert.ok(validateDraft({...input,windows}).windows);
 assert.deepEqual(validateDraft({...input,windows:[[1380,1440]]}),{});
 assert.ok(validateDraft({...input,photo:{size:6000000,type:'image/jpeg'}}).photo);
});
test('prices never round large base units through floating point',()=>{
 assert.equal(priceLabel('9007199254740993123456',6,'USDC'),'9007199254740993.123456 USDC');
 assert.equal(priceLabel('7000000',6,'USDC'),'7 USDC');assert.equal(priceLabel(undefined),'Price unavailable');
});
test('registration labels separate references and cannot render server HTML or false readiness',()=>{
 const html=renderRegistration({context:{session:{wallet:'0x123'},registration:{registrationId:'<img onerror=alert(1)>',state:'UNKNOWN',businessReady:true,transactionHash:'0x456',escrow:'0x789'}}});
 assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));assert.ok(!html.includes('Enter my kitchen'));
 for(const label of ['Registration reference','Original transaction hash','Kitchen contract'])assert.ok(html.includes(label));
 assert.ok(!html.includes('data-live-action="enable"'));assert.ok(!html.includes('id="registration-form"'));
});
test('owner and public views preserve true zero and never invent missing totals',()=>{
 const context={session:{wallet:'0x123',stores:['abc']},store:{id:'abc',name:'Test'},setup:{assetDecimals:6}};
 const html=renderLiveKitchen({context,overview:{financial:{counts:{F:0,A:0,R:0}}}});
 assert.match(html,/<h3>Meals supported<\/h3><strong>0/);
 assert.match(renderLiveKitchen({context}),/Kitchen totals are not available/);
 const cards=renderLiveCards([{id:'abc',name:'<b>Store</b>'}],{abc:[{listed:true,name:'Meal',unitPrice:'7000000',financial:{counts:{A:0}},windows:[[0,60]]}]});
 assert.ok(cards.includes('0 available'));assert.ok(cards.includes('&lt;b&gt;Store&lt;/b&gt;'));assert.ok(cards.includes('Beijing time (UTC+8)'));
});
test('residual public store never grants owner workspace access',()=>{
 const store={id:'abc',name:'Public kitchen'};
 for(const session of [null,{wallet:'visitor'},{wallet:'visitor',stores:[]},{wallet:'visitor',stores:['other']}]){
  const context={store,session};assert.equal(hasOwnedKitchen(context),false);
  const html=renderLiveKitchen({context,view:'meals',meals:[{id:'private',name:'Private draft'}]});
  assert.ok(!html.includes('Private draft'));assert.ok(!html.includes('meal-add'));assert.ok(html.includes('Public kitchen · View only'));
  if(session)assert.ok(html.includes('visitor'));
 }
 assert.equal(hasOwnedKitchen({store,session:{wallet:'owner',stores:['abc']}}),true);
});
test('owner meal list restores controls while unavailable writes remain explicit',()=>{
 const context={store:{id:'abc',name:'Kitchen'},session:{wallet:'owner',stores:['abc']}};
 const html=renderLiveKitchen({context,view:'meals',meals:[{id:'meal',name:'Rice',unitPrice:'7000000',listed:true,windows:[[660,780]]}]});
 for(const value of ['+ Add meal','Edit meal','Unlist meal','meal-edit','meal-listing'])assert.ok(html.includes(value));
 const editor=renderLiveMealEditor({creating:true,values:{name:'',description:'',price:'',windows:[[null,null]]},canSave:false,canPublish:false,reason:'LIVE_OPERATION_NOT_IMPLEMENTED'});
 assert.ok(editor.includes('LIVE_OPERATION_NOT_IMPLEMENTED'));assert.match(editor,/data-live-action="meal-save"[^>]*disabled/);assert.match(editor,/data-live-action="meal-publish"[^>]*disabled/);
 for(const value of ['Upload image','Description / content','Future unit price','Beijing time (UTC+8)','24:00','Add service time'])assert.ok(editor.includes(value));
 assert.ok(!editor.includes('data-action="save-draft"'));
});
test('private draft does not overwrite its published meal row or public listing semantics',()=>{
 const context={session:{wallet:'owner',stores:['abc']},store:{id:'abc',name:'Kitchen'}};
 const published={id:'meal',name:'Published rice',description:'Original recipe',unitPrice:'7000000',windows:[[660,780]],published:true,listed:true,draft:{name:'Private replacement',description:'Future recipe',unitPrice:'9000000',price:'9',windows:[[0,60]]}};
 const html=renderLiveKitchen({context,view:'meals',meals:[published]});assert.ok(html.includes('Published rice'));assert.ok(!html.includes('Private replacement'));assert.ok(html.includes('Future draft saved'));
 const privateHtml=renderLiveKitchen({context,view:'meals',meals:[{id:'draft',published:false,listed:false,draft:published.draft}]});assert.ok(privateHtml.includes('Private replacement'));assert.ok(privateHtml.includes('Draft · Not published'));
 const status=registrationPresentation({state:'CONFIRMED',listingConfirmed:true,businessReady:false});assert.equal(status.title,'Kitchen listed');assert.match(status.text,/temporarily not ready/);
});
test('actual owner loader clears all private results before accepting any sibling success on auth rejection',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
 const helpers=source.slice(source.indexOf('function checkLiveGeneration('),source.indexOf('async function liveTask('));
 const getLoader=new Function('live','hasOwnedKitchen',`const window={addEventListener(){}};const LIVE_MODE=true;const closeSupportFlow=()=>{live.support=null;};const closeWalletChooser=()=>{live.walletChooser=null;};const closeLiveMealEditor=()=>{live.mealEditor=null;};const renderLive=()=>{};const main={querySelector:()=>null};const liveMessage=error=>error.message;${helpers};return loadLiveKitchen;`);
 const errors=[{status:401},{status:403},...['OWNER_BINDING_CHANGED','OWNER_ACCESS_REQUIRED','PAYER_BINDING_CHANGED','REAUTH_REQUIRED','UNAUTHENTICATED'].map(code=>({code}))];
 for(const rejection of errors)for(const rejectedSide of [0,1]){
  const error=Object.assign(Error('Permission changed'),rejection),live={generation:0,context:{session:{wallet:'old',stores:['abc']},store:{id:'abc'}},ownerMealStoreId:'abc',ownerMeals:[{name:'cached private meal'}],overview:{private:'cached'},mealCapabilities:{edit:true},mealEditor:{},preview:'',api:{getOwnerMeals:()=>rejectedSide===0?Promise.reject(error):Promise.resolve({items:[{name:'fresh private meal'}],capabilities:{edit:true}}),getOwnerOverview:()=>rejectedSide===1?Promise.reject(error):Promise.resolve({private:'fresh'})}};
  await assert.rejects(getLoader(live,hasOwnedKitchen)(),err=>err===error);
  assert.deepEqual(live.ownerMeals,[]);assert.equal(live.overview,null);assert.equal(live.context.session,null);assert.equal(live.context.store,null);assert.equal(live.mealEditor,null);assert.deepEqual(live.mealCapabilities,{});
 }
 const transient={generation:0,context:{session:{wallet:'owner',stores:['abc']},store:{id:'abc'}},ownerMealStoreId:'abc',ownerMeals:[{name:'cached'}],overview:{private:'cached'},mealCapabilities:{edit:true},preview:'',api:{getOwnerMeals:async()=>({items:[{name:'fresh'}],capabilities:{edit:true}}),getOwnerOverview:async()=>{throw Error('Network unavailable');}}};
 await assert.rejects(getLoader(transient,hasOwnedKitchen)(),/could not be refreshed/);assert.equal(transient.context.session.wallet,'owner');assert.deepEqual(transient.mealCapabilities,{});assert.equal(transient.overview.private,'cached');
});
test('registration and actual private-draft validation reject reverse ordered service periods',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
 const validator=source.slice(source.indexOf('function liveMealValidation('),source.indexOf('async function saveLiveMealDraft('));
 const validate=new Function(`const live={context:{setup:{assetDecimals:6}}};${validator};return liveMealValidation;`)();
 const reversed=[[1020,1140],[660,780]],ordered=[[660,780],[1020,1140]],values={name:'Rice',description:'Recipe',price:'7',windows:reversed};
 assert.match(validate(values).windows,/start-time order/);assert.equal(validate({...values,windows:ordered}).windows,undefined);
 const registration={storeName:'Kitchen',mealName:'Rice',description:'Recipe',price:'7',photo:{type:'image/jpeg',size:500},windows:reversed};assert.match(validateDraft(registration).windows,/start-time order/);assert.equal(validateDraft({...registration,windows:ordered}).windows,undefined);
});
test('all time pickers share half-hour slots and preserve an explicit unrounded legacy value',async()=>{
 const starts=halfHourOptions(null),ends=halfHourOptions(null,true);
 const slots=html=>[...html.matchAll(/<option value="(\d+)"/g)].map(match=>Number(match[1]));
 assert.deepEqual(slots(starts),Array.from({length:48},(_,i)=>i*30));assert.deepEqual(slots(ends),Array.from({length:49},(_,i)=>i*30));
 for(const label of ['12:00','12:30','13:00','13:30'])assert.ok(starts.includes('>'+label+'</option>'));
 assert.ok(!starts.includes('>24:00</option>'));assert.ok(ends.includes('>24:00</option>'));
 const legacy=halfHourOptions(727);assert.match(legacy,/<option value="727" selected disabled>12:07/);assert.ok(legacy.includes('choose a 30-minute slot to save'));assert.equal(serviceHours([[727,793]]),'12:07–13:13');
 const registration=renderRegistration({context:{session:{wallet:'owner'},setup:{registrationEnabled:true}},draft:{windows:[[727,1440]]}});
 assert.match(registration,/<select id="register-start-0"/);assert.match(registration,/<option value="12:07" selected disabled>/);assert.match(registration,/<option value="24:00" selected>/);assert.ok(!registration.includes('type="time"'));
 const editor=renderLiveMealEditor({values:{name:'Meal',description:'Recipe',price:'7',windows:[[727,793]]},canSave:true});assert.ok(editor.includes('value="727" selected disabled'));assert.ok(editor.includes('value="793" selected disabled'));
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8'),original=source.split('\n').find(line=>line.startsWith('function timeOptions('));
 const demoOptions=new Function('halfHourOptions',`${original};return timeOptions;`)(halfHourOptions);assert.equal(demoOptions(727),legacy);assert.equal(demoOptions(null,true),ends);
});
test('registration, live draft and demo editor reject non-half-hour saves without changing historical values',async()=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
 const validator=source.slice(source.indexOf('function liveMealValidation('),source.indexOf('async function saveLiveMealDraft('));
 const validate=new Function(`const live={context:{setup:{assetDecimals:6}}};${validator};return liveMealValidation;`)();
 const values={name:'Rice',description:'Recipe',price:'7',windows:[[727,793]]},original=structuredClone(values);
 assert.match(validate(values).windows,/30-minute/);assert.deepEqual(values,original);
 const registration={storeName:'Kitchen',mealName:'Rice',description:'Recipe',price:'7',photo:{type:'image/jpeg',size:500},windows:values.windows};assert.match(validateDraft(registration).windows,/30-minute/);
 assert.equal(validate({...values,windows:[[720,810],[1380,1440]]}).windows,undefined);
 const demoValidator=source.split('\n').find(line=>line.startsWith('function validateEditor('));
 const demo=new Function('M','document',`${demoValidator};return validateEditor;`)({draftErrors:()=>({})},{querySelector:()=>({setAttribute(){}})});
 assert.throws(()=>demo({windows:[[727,793]]}),/highlighted/);assert.doesNotThrow(()=>demo({windows:[[720,810],[1380,1440]]}));
});

test('attempted confirmation copy does not assert successful submission',()=>{
 const html=renderSupportFlow({review:{review:{name:'Rice',quantity:1,unitPrice:'7000000',amount:'7000000',payer:'0x'+'1'.repeat(40)}},confirmAttempted:true},{assetDecimals:6,assetSymbol:'USDC'});
 assert.match(html,/confirmation was attempted; its outcome is not yet verified/);assert.match(html,/do not create a replacement/);assert.doesNotMatch(html,/confirmation was submitted/);
});

test('live service windows are labeled Beijing time without shifting minutes or absolute expiry',()=>{
 const windows=[[870,1140]],meal={id:'meal',name:'Rice',windows,listed:true,unitPrice:'7000000'},voucher={id:'voucher',store:'store',state:'R',expiresAt:'2000000000',terms:meal};
 const outputs=[renderLiveStore({id:'store'},[meal]),renderLiveKitchen({context:{session:{stores:['store']},store:{id:'store'}},view:'meals',meals:[meal]}),renderClaimFlow({voucher}),renderClaimFlow({review:{reviewId:'review',review:meal}}),renderVerificationEntry({checked:{...voucher,valid:true},records:[]})];
 for(const html of outputs){assert.ok(html.includes('14:30–19:00'));assert.ok(html.includes('Beijing time (UTC+8)'));assert.doesNotMatch(html,/ · UTC(?:<|\.|\x27)/);}
 const registration=renderRegistration({context:{session:{wallet:'owner'},setup:{registrationEnabled:true}},draft:{windows:[['14:30','19:00']]}});assert.ok(registration.includes('Service time · Beijing time (UTC+8)'));
 assert.ok(outputs[2].includes(new Date(2000000000*1000).toISOString()));assert.deepEqual(windows,[[870,1140]]);
});
