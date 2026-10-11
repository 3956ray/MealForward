import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

const fields=['.store-photo','.store-heading','.store-description','.meal-name','.store-time','.progress-heading','.progress','.pill','.price','[data-action="support"]','[data-action="claim"]'];
async function capture(page){return page.locator('.store-card').evaluateAll((cards,fields)=>cards.map(card=>{
 const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,right:r.right+scrollX,bottom:r.bottom+scrollY};};
 const badge=card.querySelector('.store-body>.pill'),range=document.createRange();range.selectNodeContents(badge);const style=getComputedStyle(badge);
 return {store:card.querySelector('.store-photo').getAttribute('href'),card:rect(card),body:rect(card.querySelector('.store-body')),fields:Object.fromEntries(fields.map(s=>[s,rect(card.querySelector(s))])),badge:{text:badge.textContent,width:badge.getBoundingClientRect().width,contentWidth:range.getBoundingClientRect().width,padding:parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth)},cardTransform:getComputedStyle(card).transform};
}),fields);}
function changes(before,after){const changed=[];for(let i=0;i<before.length;i++)for(const key of ['card',...fields]){const a=key==='card'?before[i].card:before[i].fields[key],b=key==='card'?after[i].card:after[i].fields[key];for(const axis of ['x','y','width','height'])if(Math.abs(a[axis]-b[axis])>.25)changed.push({store:before[i].store,field:key,axis,delta:b[axis]-a[axis]});}return changed;}
function badges(snap){return snap.flatMap(c=>Math.abs(c.badge.width-c.badge.contentWidth-c.badge.padding)>2?[{store:c.store,text:c.badge.text,width:c.badge.width,expected:c.badge.contentWidth+c.badge.padding}]:[]);}
async function cardViewport(page,overflow){const viewport=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,regions:[...document.querySelectorAll('.store-grid,.store-card,.filters')].map(el=>{const r=el.getBoundingClientRect();return {kind:el.className,left:r.left+scrollX,right:r.right+scrollX};})}));for(const r of viewport.regions)assert.ok(r.left>=-.25&&r.right<=viewport.width+.25,'Public card/filter region fits viewport: '+r.kind);if(viewport.width!==1152)await overflow(page);else assert.ok(viewport.documentWidth<=viewport.width+2,'Only known baseline hero stamp overflow is excluded from card scope');return viewport;}
function aligned(snap,fallback=false){for(const c of snap){const row=snap.filter(x=>Math.abs(x.card.y-c.card.y)<1);for(const key of fallback?['.store-photo','.price','[data-action="support"]','[data-action="claim"]']:fields){for(const axis of ['y','bottom'])assert.ok(Math.max(...row.map(x=>x.fields[key][axis]))-Math.min(...row.map(x=>x.fields[key][axis]))<1.1,'Same-row '+key+' '+axis);}assert.ok(Math.max(...row.map(x=>x.card.bottom))-Math.min(...row.map(x=>x.card.bottom))<1.1,'Same-row card bottoms');}}
async function contentFits(page){assert.ok(await page.locator('.store-card').evaluateAll(cards=>cards.every(card=>{
 const overlap=(a,b)=>a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5;
 const support=card.querySelector('[data-action="support"]').getBoundingClientRect(),claim=card.querySelector('[data-action="claim"]').getBoundingClientRect(),price=card.querySelector('.price').getBoundingClientRect();
 if(overlap(support,claim)||overlap(price,support)||card.getBoundingClientRect().height>1100)return false;
 return [...card.querySelectorAll('.store-description,.meal-name,.store-time,.pill,.price,.button')].every(el=>{const s=getComputedStyle(el);return el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1&&s.textOverflow!=='ellipsis'&&s.webkitLineClamp==='none';});
})),'Readable full content and separate actions without clipping/huge card height');}

export async function verifyPublicCards({fresh,go,images,overflow,fixture,M,evidence}){
 const baseline=process.env.MEALFORWARD_UI08_BASELINE==='1',matrix=[],motions=[];
 if(baseline){
  const {page,context}=await fresh(1440);await page.getByRole('button',{name:'Vegetables',exact:true}).click();await images(page);await page.mouse.move(0,0);await page.waitForTimeout(180);
  const before=await capture(page),badgeFailures=badges(before),movements=[];
  for(let i=0;i<2;i++)for(const target of ['.store-photo','.meal-name','[data-action="support"]','[data-action="claim"]']){
   await page.locator('.store-card').nth(i).locator(target).hover();await page.waitForTimeout(180);movements.push({card:i,target,changes:changes(before,await capture(page))});await page.mouse.move(0,0);await page.waitForTimeout(180);
  }
  const result={kind:'Baseline actual geometry; synthetic browser only',baseline:before,badgeFailures,movements,hoverRegressionFails:movements.some(x=>x.changes.length),badgeRegressionFails:badgeFailures.length>0};
  result.assertionFailures=[];for(const [name,fn]of [['Hover stability',()=>assert.equal(result.hoverRegressionFails,false)],['Badge content width',()=>assert.deepEqual(badgeFailures,[])]]){try{fn();}catch{result.assertionFailures.push(name);}}
  await writeFile(evidence+'/ui08-baseline-geometry.json',JSON.stringify(result,null,2));await context.close();
  assert.deepEqual(result.assertionFailures,[],'Baseline must meet hover and badge regressions');return;
 }
 const state=fixture();for(const [i,store]of M.STORES.entries()){M.signIn(state,store.id+'.owner@mealforward.invalid');M.saveDraft(state,store.id,{meal:i===1?'Seasonal roasted vegetables, hearty grains and warm herbs for our neighborhood':'Grain bowl '+store.id,description:'Synthetic meal content.',price:[6,9.25,12.5][i],image:store.image,windows:i===1?[[691,809],[1023,1440]]:[[720,840]]});M.publish(state,store.id);}M.signOut(state);
 const sizes=[320,390,580,768,800,801,1024,1440].map(width=>({width,dpr:2,mode:'DPR2'}));sizes.push({width:1440,dpr:1,mode:'DPR1'},{width:1152,dpr:2.5,mode:'1440 physical pixels at125% zoom-equivalent'},{width:960,dpr:3,mode:'1440 physical pixels at150% zoom-equivalent'});
 const fallbackStyle=(await readFile('dist/styles.css','utf8')).match(/@supports not \(grid-template-rows:subgrid\)\{([\s\S]*?)\}\s*\/\* UI08 fallback end \*\//)?.[1];
 assert.ok(fallbackStyle,'Scoped natural-height fallback exists');
 for(const size of sizes){
  const {page,context}=await fresh(size.width,state,false,{deviceScaleFactor:size.dpr});assert.equal(await page.evaluate(()=>devicePixelRatio),size.dpr);assert.ok(await page.evaluate(()=>CSS.supports('grid-template-rows','subgrid')));
  for(const route of ['home','stores'])for(const [filter,label,count]of [['all','All kitchens',3],['veg','Vegetables',2],['meat','Home-style',1]]){
   await go(page,route);await page.getByRole('button',{name:label,exact:true}).click();await images(page);await page.mouse.move(0,0);await page.evaluate(()=>document.querySelector('#main').focus());const viewport=await cardViewport(page,overflow);
   assert.equal(await page.locator('.store-card').count(),count);assert.equal(await page.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
   const before=await capture(page);if(filter==='veg')assert.deepEqual(before.map(c=>c.store),['#store/shiguang','#store/nuanxiang']);assert.deepEqual(badges(before),[]);aligned(before);await contentFits(page);
   const key={...size,route,filter,count};matrix.push({...key,viewport,snapshot:before});
   for(let i=0;i<count;i++){
    const card=page.locator('.store-card').nth(i);
    for(const target of ['.store-photo','.meal-name','[data-action="support"]','[data-action="claim"]']){
     await card.locator(target).hover();const during=await capture(page);assert.deepEqual(changes(before,during),[],JSON.stringify({...key,card:i,target}));await page.mouse.move(0,0);const after=await capture(page);assert.deepEqual(changes(before,after),[]);motions.push({...key,card:i,state:'hover',target,during,after});
    }
    for(const target of ['.store-photo','.store-heading a','[data-action="support"]','[data-action="claim"]']){
     const control=card.locator(target);if(await control.isDisabled())continue;await page.keyboard.press('Tab');await control.focus();assert.ok(await control.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle==='solid'));const during=await capture(page);assert.deepEqual(changes(before,during),[],JSON.stringify({...key,card:i,target,focus:true}));await page.locator('#main').focus();assert.deepEqual(changes(before,await capture(page)),[]);motions.push({...key,card:i,state:'focus',target,during});
    }
   }
   const screenshot=(size.mode==='DPR2'&&route==='stores'&&filter==='veg'&&[1440,801,390].includes(size.width))||(size.width===960&&route==='stores'&&filter==='all');
   if(screenshot){await page.locator('.store-grid').scrollIntoViewIfNeeded();await page.locator('.store-card').first().locator('[data-action="support"]').hover();await page.locator('.store-grid').screenshot({path:evidence+'/ui08-cards-'+size.width+'-'+filter+'.png'});await page.mouse.move(0,0);}
  }
  await context.close();
 }
 for(const width of [390,1440]){
  const varied=structuredClone(state);M.getMeal(varied,'shiguang').active=false;varied.configs.nuanxiang.paused=true;M.validate(varied);
  const {page,context}=await fresh(width,varied,false,{deviceScaleFactor:2});await go(page,'stores');await images(page);await page.mouse.move(0,0);const snapshot=await capture(page);assert.deepEqual(snapshot.map(c=>c.badge.text),['Listed','Unlisted','Safety pause']);assert.deepEqual(badges(snapshot),[]);aligned(snapshot);await contentFits(page);await overflow(page);matrix.push({width,dpr:2,mode:'All three status texts',route:'stores',filter:'all',snapshot});await context.close();
  const f=await fresh(width,state,false,{deviceScaleFactor:2});await go(f.page,'stores');await f.page.getByRole('button',{name:'Vegetables',exact:true}).click();await f.page.addStyleTag({content:fallbackStyle});await images(f.page);await f.page.mouse.move(0,0);const snap=await capture(f.page);assert.deepEqual(badges(snap),[]);aligned(snap,true);await contentFits(f.page);await overflow(f.page);await f.page.locator('.store-card').first().locator('[data-action="support"]').hover();assert.deepEqual(changes(snap,await capture(f.page)),[]);matrix.push({width,dpr:2,mode:'Simulated unsupported-subgrid fallback, not actual WebKit',route:'stores',filter:'veg',snapshot:snap});await f.context.close();
 }
 await writeFile(evidence+'/ui08-card-matrix.json',JSON.stringify({engine:'Installed Chrome',sizes,matrix,motions,baselineChecks:'Same hover-stability and badge-content assertions fail accepted baseline',otherEngines:'Playwright WebKit and Firefox binaries unavailable; no installation; fallback explicitly simulated'},null,2));
}
