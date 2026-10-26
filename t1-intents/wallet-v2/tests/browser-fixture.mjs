/** Loopback-only synthetic browser fixture. No DB, RPC, key or real provider. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {makeApprovalHttpHandler} from '../../t1f-approval-server.mjs';
import {APPROVAL_WALLETS} from '../../t1f-approval-protocol.mjs';

if(process.argv.length>3||process.argv[2]&&!/^--port=\d{2,5}$/.test(process.argv[2]))throw Error('FIXTURE_ARGUMENT');
const port=process.argv[2]?Number(process.argv[2].slice(7)):0;
if(port<0||port>65535)throw Error('FIXTURE_PORT');
let pending=false,releasePending=[];
const service={async status(){if(pending)await new Promise(resolve=>releasePending.push(resolve));return {noRelease:true,canIssue:false,chainId:10143,wallets:APPROVAL_WALLETS,roles:{owner:false,donor:false},serverTime:Math.floor(Date.now()/1000),status:'NO_ROUND',round:null}},async submit(){throw Error('SYNTHETIC_WRITE_DENIED')}};
const source=new URL('../../public/wallet-v2.html',import.meta.url);
const providerSource=new URL('./browser-fixture-provider.mjs',import.meta.url);
const controls=`<aside id="fixture-controls" aria-label="Synthetic fixture controls" style="border:2px solid #b43;padding:1rem;background:#fffbe8;color:#111"><strong>Synthetic fixture · no real wallet, RPC or database</strong><div class="actions"><button id="fixture-owner" type="button">Owner</button><button id="fixture-donor" type="button">Donor</button><button id="fixture-other" type="button">Other account</button><button id="fixture-unauthorized" type="button">Unauthorized</button><button id="fixture-wrong-chain" type="button">Wrong chain</button></div><label><input id="fixture-api-pending" type="checkbox"> Hold API state response</label><p id="fixture-status" role="status">Loading synthetic provider</p><p id="fixture-api-status" role="status">API pending: false</p></aside>`;
const headers={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; script-src 'self'; style-src 'self'",'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const server=http.createServer();
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
const origin='http://127.0.0.1:'+server.address().port;
const realHandler=makeApprovalHttpHandler({service,origin,testing:true});
server.on('request',async(req,res)=>{
 try{
  if(req.method==='GET'&&(req.url==='/'||req.url==='/wallet-v2.html')){
   const html=(await readFile(source,'utf8')).replace('<script type="module" src="/wallet-v2-bootstrap.mjs"></script>','<script type="module" src="/fixture-provider.mjs"></script><script type="module" src="/wallet-v2-bootstrap.mjs"></script>').replace('<main>',`<main>${controls}`);
   res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
  }
  if(req.method==='GET'&&req.url==='/fixture-provider.mjs'){
   res.writeHead(200,{...headers,'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(providerSource));return;
  }
  if(req.method==='POST'&&req.url==='/fixture/pending'){
   if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403,headers);res.end();return}
   const chunks=[];for await(const chunk of req){chunks.push(chunk);if(Buffer.concat(chunks).length>100){res.writeHead(400,headers);res.end();return}}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(typeof value.pending!=='boolean'||Object.keys(value).length!==1)throw Error('CONTROL');
   pending=value.pending;if(!pending){for(const resolve of releasePending)resolve();releasePending=[]}
   res.writeHead(204,headers);res.end();return;
  }
  await realHandler(req,res);
 }catch{if(!res.headersSent){res.writeHead(400,headers);res.end()}}
});
process.stdout.write(`WALLET_V2_SYNTHETIC_URL=${origin}/\n`);
process.stdout.write('Stop with Ctrl-C; fixture binds 127.0.0.1 only.\n');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
