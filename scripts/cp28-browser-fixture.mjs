// Synthetic same-origin native-fetch/provider evidence. Never opens a real wallet or RPC.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.argv[2] || 15288)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Loopback port required')
const wallet = ts.transpileModule(fs.readFileSync(path.join(root, 'manual-business-harness/wallet.ts'), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
}).outputText
const starts = new Set()
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CP28 synthetic native fetch</title>
<style>body{font:18px system-ui;max-width:850px;margin:50px auto;padding:20px}li{margin:16px 0}button{padding:14px}</style>
<h1>CP28 浏览器原生请求验证</h1><p>合成 provider / loopback HTTP，无真实钱包、无实网 RPC。</p><button id="run">运行合成故障验证</button><ol id="results"></ol>
<script type="module">
import {Wallet} from '/wallet.js';
const account='0x'+'11'.repeat(20), list=document.querySelector('#results');
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;const results=[];
 for(const mode of ['success','denied','4001','nohash','lost-start','account-change']){
  const methods=[];let changed=false;const listeners=new Map();
  const review={operationId:mode,kind:'fund',maySign:true,configDigest:'synthetic',expiresAt:Math.floor(Date.now()/1000)+120,transaction:{from:account,to:'0x'+'22'.repeat(20),data:'0x12345678',value:1000000000000000,chainId:10143,nonce:0,gas:50000,maxFeePerGas:2,maxPriorityFeePerGas:1}};
  const provider={on:(e,f)=>listeners.set(e,f),removeListener:e=>listeners.delete(e),request:async({method})=>{
   methods.push(method);if(method==='eth_chainId')return '0x279f';
   if(method==='eth_accounts')return [changed?'0x'+'33'.repeat(20):account];
   if(method==='eth_sendTransaction'){if(mode==='4001')throw {code:4001};return mode==='nohash'?undefined:'0x'+'44'.repeat(32)};
   throw new Error('Unexpected provider method');}};
  const api=async(path,body)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review,...body})});if(!r.ok)throw new Error('Runtime denied');const data=await r.json();if(mode==='account-change'&&path.endsWith('/start')){changed=true;listeners.get('accountsChanged')?.([account])}return data};
  const wallet=new Wallet(provider,api);let first='',second='';
  try{first=await wallet.send(review)}catch(e){first=e.message}
  try{second=await wallet.send(review)}catch(e){second=e.message}
  wallet.dispose();const count=methods.filter(x=>x==='eth_sendTransaction').length;
  const expected=['success','4001','nohash'].includes(mode)?1:0;
  const pass=count===expected&&(!['4001','nohash','lost-start','account-change'].includes(mode)||first.includes('未知'))&&listeners.size===0;
  const result={mode,pass,sends:count,expected,first,second};results.push(result);
  const li=document.createElement('li');li.textContent=(pass?'PASS':'FAIL')+' · '+mode+' · provider send '+count+' / '+expected;list.append(li);
 }
 await fetch('/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'synthetic-native-fetch',results})});
 const p=document.createElement('p');p.textContent=results.every(r=>r.pass)?'ALL PASS — 无真实钱包测试':'FAILED';document.body.append(p);
};</script></html>`
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET' && req.url === '/mobile') {res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<h1>390px responsive fixture — synthetic BLOCKED state</h1><iframe title="390px business preview" src="/preview" width="390" height="844" style="border:1px solid #ccc"></iframe>')}
  if (req.method === 'GET' && req.url === '/preview') {res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(root,'manual-business-harness/dist/index.html')))}
  if (req.method === 'GET' && /^\/assets\/[A-Za-z0-9_.-]+$/.test(req.url)) {const file=path.join(root,'manual-business-harness/dist',req.url);res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(file))}
  if (req.method === 'GET' && req.url === '/api/cp28/status') {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({status:'BLOCKED',missing:['合成移动视口：身份、新部署与运行授权未配置'],runId:'responsive-synthetic',sourceSha:'synthetic',runtimeAuthorized:false,message:'完整手动业务测试尚未就绪'}))}
  if (req.method === 'GET' && req.url === '/api/cp28/public') {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({batch:null,operations:[],priceWei:'1000000000000000',ruleVersion:null}))}
  if (req.method === 'GET' && req.url === '/') {res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html)}
  if (req.method === 'GET' && req.url === '/wallet.js') {res.setHeader('Content-Type', 'text/javascript'); return res.end(wallet)}
  if (req.method !== 'POST' || req.headers.origin !== `http://127.0.0.1:${port}`) {res.writeHead(403); return res.end()}
  let raw=''; for await (const part of req) {raw+=part;if(raw.length>16384){res.writeHead(413);return res.end()}}
  try {
    const body=JSON.parse(raw);res.setHeader('Content-Type','application/json')
    if(req.url==='/evidence') {fs.mkdirSync(path.join(root,'evidence/cp28'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/cp28/native-fetch.json'),JSON.stringify(body,null,2));return res.end('{}')}
    const mode=body.review?.operationId
    if(!['success','denied','4001','nohash','lost-start','account-change'].includes(mode)){res.writeHead(400);return res.end('{}')}
    if(req.url.endsWith('/start')) {
      if(mode==='denied'){res.writeHead(409);return res.end('{}')}
      const maySubmit=!starts.has(mode);starts.add(mode)
      if(mode==='lost-start'&&maySubmit){req.socket.destroy();return}
      return res.end(JSON.stringify({...body.review,maySubmit}))
    }
    res.end('{}')
  } catch {res.writeHead(400);res.end('{}')}
})
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic browser fixture http://127.0.0.1:${port}`))
