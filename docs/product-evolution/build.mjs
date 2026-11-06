import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Marked,Renderer} from 'marked';
const root=new URL('./',import.meta.url),require=createRequire(import.meta.url);
let chromium;
for(const path of [process.env.PLAYWRIGHT_MODULE,'../../t1-intents/mvp-client/node_modules/playwright/index.mjs',pathToFileURL(homedir()+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href].filter(Boolean)){
 try{({chromium}=await import(path));break;}catch{}
}
if(!chromium)throw Error('Install Playwright and Chromium, or set PLAYWRIGHT_MODULE to an installed module.');
const source=await readFile(new URL('mealforward-evolution.md',root),'utf8'),template=await readFile(new URL('template.html',root),'utf8');
const renderer=new Renderer(),diagrams=[],headings=[];
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
renderer.code=function(token){if(token.lang!=='mermaid')return Renderer.prototype.code.call(this,token);const id='mf-diagram-'+diagrams.length;diagrams.push({id,source:token.text});return `<div data-diagram="${id}"></div>`;};
renderer.heading=function(token){const content=this.parser.parseInline(token.tokens);if(token.depth===1)return '';const id=token.depth===2?'section-'+(headings.length+1):undefined;if(id)headings.push({id,text:token.text});return `<h${token.depth}${id?` id="${id}"`:''}>${content}</h${token.depth}>`;};
const front=source.match(/^---\n([\s\S]*?)\n---\n/);if(!front)throw Error('Document metadata is required.');
const meta=Object.fromEntries(front[1].split('\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1).trim()];}));
for(const key of ['updated','verified'])if(!/^\d{4}-\d{2}-\d{2}$/.test(meta[key]||''))throw Error('Invalid '+key);
for(const key of ['newKitchenTx','publishedMealTx','settlementDelay'])if(!/^\d+$/.test(meta[key]||''))throw Error('Invalid '+key);
if(!meta.status)throw Error('Status is required.');
let body=await new Marked({renderer,gfm:true}).parse(source.slice(front[0].length));
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.setContent('<!doctype html><html lang="zh-CN"><body></body></html>');
 await page.addScriptTag({path:require.resolve('mermaid/dist/mermaid.min.js')});
 await page.evaluate(()=>mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'Arial, PingFang SC, Microsoft YaHei, sans-serif',themeVariables:{fontSize:'16px',primaryColor:'#eef4ef',primaryTextColor:'#163b2e',primaryBorderColor:'#78a390',lineColor:'#668776',secondaryColor:'#f8f2e5',tertiaryColor:'#f4f5f0',clusterBkg:'#f8faf7',clusterBorder:'#cbdace'},flowchart:{htmlLabels:false,curve:'basis',nodeSpacing:28,rankSpacing:48,padding:18}}));
 for(const d of diagrams){
  const svg=await page.evaluate(async({id,source})=>(await mermaid.render(id,source)).svg,d);
  body=body.replace(`<div data-diagram="${d.id}"></div>`,`<figure class="diagram" data-zoom="1"><div class="diagram-toolbar"><span>可缩放图表 · 横向滚动查看</span><div><button type="button" data-scale="out" aria-label="缩小图表">−</button><button type="button" data-scale="reset">适配</button><button type="button" data-scale="in" aria-label="放大图表">＋</button></div></div><div class="diagram-scroll" tabindex="0" role="region" aria-label="${escape(headings.at(diagrams.indexOf(d)===0?1:2)?.text||'流程图')}">${svg}</div></figure>`);
 }
}finally{await browser.close();}
const nav=headings.map(h=>`<a href="#${h.id}">${escape(h.text)}</a>`).join('');
const license=await readFile(require.resolve('mermaid/LICENSE'),'utf8');
const markedLicense=await readFile(new URL('node_modules/marked/LICENSE.md',root),'utf8');
let html=template.replace('<!-- NAV -->',nav).replace('<!-- CONTENT -->',body);
for(const [key,value] of Object.entries({UPDATED:meta.updated,VERIFIED:meta.verified,UPDATED_DOT:meta.updated.replaceAll('-','.'),VERIFIED_DOT:meta.verified.replaceAll('-','.'),STATUS:meta.status,NEW_TX:meta.newKitchenTx,PUBLISHED_TX:meta.publishedMealTx,DELAY:meta.settlementDelay}))html=html.replaceAll('{{'+key+'}}',escape(value));
if(/\{\{[A-Z_]+\}\}/.test(html))throw Error('Unresolved template field.');
html=html.replace('<!-- LICENSES -->',`<!-- Mermaid 11.12.0\n${license.replaceAll('--','—')}\nMarked 16.4.1\n${markedLicense.replaceAll('--','—')} -->`);
await writeFile(new URL('index.html',root),html);
console.log(`Built offline HTML: ${diagrams.length} embedded SVG diagrams, ${headings.length} sections. Source: mealforward-evolution.md`);
