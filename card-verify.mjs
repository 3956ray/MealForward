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


async function claimClearance({fresh,go,images,state,evidence,fallbackStyle}){
 const before=process.env.MEALFORWARD_UI09_BASELINE==='1',phase=before?'before':'after',records=[],failures=[];
 const cases=[1440,801,768,390,320].flatMap(width=>['all','veg'].map(filter=>({width,filter,fallback:false})));cases.push({width:1440,filter:'veg',fallback:true},{width:390,filter:'veg',fallback:true});
 for(const item of cases){
  const {page,context}=await fresh(item.width,state,false,{deviceScaleFactor:2});await go(page,'stores');await page.getByRole('button',{name:item.filter==='veg'?'Vegetables':'All kitchens',exact:true}).click();if(item.fallback)await page.addStyleTag({content:fallbackStyle});await images(page);await page.mouse.move(0,0);
  const cards=page.locator('.store-card');
  for(let i=0;i<await cards.count();i++){
   const card=cards.nth(i),claim=card.locator('[data-action="claim"]');await page.locator('#main').focus();await claim.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
   const measure=()=>claim.evaluate(el=>{const card=el.closest('.store-card'),body=el.closest('.store-body'),row=body.querySelector('.store-bottom'),support=row.querySelector('[data-action="support"]'),price=row.querySelector('.price'),r=el.getBoundingClientRect(),b=body.getBoundingClientRect(),c=card.getBoundingClientRect(),p=price.getBoundingClientRect(),s=support.getBoundingClientRect(),rr=row.getBoundingClientRect(),style=getComputedStyle(el),cs=getComputedStyle(card),rowBottom=Math.max(rr.bottom,p.bottom,s.bottom);const rect=x=>({x:x.x+scrollX,y:x.y+scrollY,width:x.width,height:x.height,right:x.right+scrollX,bottom:x.bottom+scrollY});const points=[[.5,r.height/2],[r.width-.5,r.height/2],[r.width/2,.5],[r.width/2,r.height-.5],[2,2],[r.width-2,2],[2,r.height-2],[r.width-2,r.height-2]].map(([x,y])=>({x:r.x+x,y:r.y+y,own:document.elementFromPoint(r.x+x,r.y+y)?.closest('button')===el}));return {store:card.querySelector('.store-photo').getAttribute('href'),target:rect(r),card:rect(c),body:rect(b),row:rect(rr),price:rect(p),support:rect(s),gap:r.top-rowBottom,bottomGap:c.bottom-parseFloat(cs.borderBottomWidth)-r.bottom,bodyBottomGap:b.bottom-r.bottom,relativeTop:r.top-c.top,paddingBottom:getComputedStyle(body).paddingBottom,borders:Object.fromEntries(['Top','Right','Bottom','Left'].map(side=>[side.toLowerCase(),{width:style['border'+side+'Width'],style:style['border'+side+'Style'],color:style['border'+side+'Color']}])),radius:style.borderRadius,outline:{width:style.outlineWidth,offset:style.outlineOffset,style:style.outlineStyle,visible:el.matches(':focus-visible')},hitPoints:points,clip:{x:Math.floor(Math.min(rr.x,r.x)-8),y:Math.floor(rr.y-8),width:Math.ceil(Math.max(rr.right,r.right)-Math.floor(Math.min(rr.x,r.x)-8)+8),height:Math.ceil(b.bottom-Math.floor(rr.y-8)+8)},viewport:{x:r.x,y:r.y,width:r.width,height:r.height}};});
   const normal=await measure(),buffer=await page.screenshot({clip:normal.clip});
   if(item.filter==='veg'&&!item.fallback)await writeFile(evidence+'/ui09-'+phase+'-actions-'+item.width+'-'+i+'.png',buffer);
   const issues=[];if(normal.gap<23.9)issues.push('Claim gap below whole preceding row is '+normal.gap+'px; final target24px');if(normal.bottomGap<23.9||normal.bodyBottomGap<23.9)issues.push('Bottom clearance below24px');if(normal.target.height<44||normal.target.width<44)issues.push('Touch target below44px');if(normal.hitPoints.some(p=>!p.own))issues.push('Border/corner inset hit point is not Claim');for(const [side,border]of Object.entries(normal.borders)){if(border.width!=='1px'||border.style!=='solid'||border.color!=='rgb(35, 76, 61)')issues.push(side+' border is '+JSON.stringify(border));}
   await claim.hover();const hover=await measure();assert.deepEqual(hover.target,normal.target);await page.mouse.move(0,0);await page.keyboard.press('Tab');await claim.focus();const focus=await measure();assert.deepEqual(focus.target,normal.target);assert.ok(focus.outline.visible&&focus.outline.style==='solid');const ring=parseFloat(focus.outline.width)+parseFloat(focus.outline.offset);assert.ok(focus.gap-ring>=9&&focus.bottomGap-ring>=16,'Focus ring has clear room from row/card boundary');await page.locator('#main').focus();
   records.push({...item,index:i,normal,hover,focus});failures.push(...issues.map(issue=>({...item,store:normal.store,issue})));
  }
  if(item.filter==='veg'&&!item.fallback){const grid=page.locator('.store-grid'),height=await grid.evaluate(el=>Math.ceil(el.getBoundingClientRect().height));await page.setViewportSize({width:item.width,height:Math.max(1024,height+100)});await page.locator('#main').focus();await page.mouse.move(0,0);await grid.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.activeElement.id),'main');await grid.screenshot({path:evidence+'/ui09-'+phase+'-cards-'+item.width+'.png'});}
  await context.close();
 }
 await writeFile(evidence+'/ui09-'+phase+'-clearance.json',JSON.stringify({phase,cases,records,failures,note:'Actual unmodified browser screenshots, computed styles and inset hit-testing; preceding row bottom includes wrapper, price and Support. Fallback is simulated in Chrome.'},null,2));
 assert.equal(failures.length,0,'Claim clearance/borders: '+JSON.stringify(failures.slice(0,2)));
 if(!before){const original=JSON.parse(await readFile(evidence+'/ui09-before-clearance.json','utf8'));const deltas=records.map(rec=>{const old=original.records.find(x=>x.width===rec.width&&x.filter===rec.filter&&x.fallback===rec.fallback&&x.normal.store===rec.normal.store);const move=rec.normal.relativeTop-old.normal.relativeTop;assert.ok(move>=6.9,'Claim actually moves down from accepted baseline');return {width:rec.width,filter:rec.filter,fallback:rec.fallback,store:rec.normal.store,beforeGap:old.normal.gap,afterGap:rec.normal.gap,downFromCardTop:move,beforeBottom:old.normal.bottomGap,afterBottom:rec.normal.bottomGap,beforeBorders:old.normal.borders,afterBorders:rec.normal.borders};});await writeFile(evidence+'/ui09-before-after-deltas.json',JSON.stringify(deltas,null,2));}
}

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
 await claimClearance({fresh,go,images,state,evidence,fallbackStyle});if(process.env.MEALFORWARD_UI09_ONLY==='1'||process.env.MEALFORWARD_UI09_BASELINE==='1')return;
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
