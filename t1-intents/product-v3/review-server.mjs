// Loopback operator UI only. A reservation prevents a second deployment after any wallet outcome.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,FetchRequest} from 'ethers';
import {makeReview,reserveReview,reviewConfiguration} from './deployment-review.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code);};
export async function startReview({port=0,provider:injected,artifact:provided,profile='monad-testnet',localTarget,attemptPath}={}){
 check(['monad-testnet','local-acceptance'].includes(profile),'INVALID_REVIEW_PROFILE');
 attemptPath??=new URL(profile==='local-acceptance'?'../../.local-product-acceptance/product-v3-local-deployment-attempt.json':'../../.local-product-acceptance/product-v3-deployment-attempt.json',import.meta.url);
 const artifact=provided||JSON.parse(await readFile(new URL('../../mvp-contracts/out/ProductEscrowV3.sol/ProductEscrowV3.json',import.meta.url),'utf8'));
 check(profile!=='local-acceptance'||!!injected,'LOCAL_PROVIDER_REQUIRED');
 const rpc=new FetchRequest('https://testnet-rpc.monad.xyz');rpc.timeout=15000;
 const provider=injected||new JsonRpcProvider(rpc,undefined,{batchMaxCount:1,cacheTimeout:-1});
 let review;
 try{review=await makeReview(provider,artifact,{profile,localTarget});}catch(e){if(!injected)provider.destroy();throw e;}
 const html=await readFile(new URL('./deployment-review.html',import.meta.url));
 const js=await readFile(new URL('./deployment-review-client.mjs',import.meta.url));
 await mkdir(new URL('./',attemptPath),{recursive:true});
 const getAttempt=async()=>{try{return JSON.parse(await readFile(attemptPath,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 let origin;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const finish=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return finish(403,'{}');
  try{
   const url=new URL(req.url,origin);
   if(req.method==='POST'&&url.pathname==='/reserve'&&req.headers.origin===origin&&req.headers['content-type']==='application/json'&&!url.search){
    check(!await getAttempt(),'ORIGINAL_REVIEW_EXISTS');let body='';for await(const chunk of req){body+=chunk;check(Buffer.byteLength(body)<=512,'BODY_TOO_LARGE');}
    const requested=JSON.parse(body);check(Object.keys(requested).sort().join() === 'dataHash,gas,gasPrice,nonce','INVALID_RESERVATION');
    const fresh=await review.preflight();
    check(requested.nonce===fresh.nonce&&requested.dataHash===fresh.dataHash&&BigInt(requested.gas)>=BigInt(fresh.gas)&&BigInt(requested.gasPrice)>=BigInt(fresh.gasPrice),'REVIEW_CHANGED');
    const attempt={nonce:fresh.nonce,dataHash:fresh.dataHash,gas:requested.gas,gasPrice:requested.gasPrice,createdAt:new Date().toISOString()};review.restore(attempt);
    await reserveReview(attemptPath,attempt);return finish(200,'{"reserved":true}');
   }
   if(req.method!=='GET')return finish(405,'{}');
   if(url.pathname==='/'&&!url.search)return finish(200,html,'text/html; charset=utf-8');
   if(url.pathname==='/client.mjs'&&!url.search)return finish(200,js,'text/javascript; charset=utf-8');
   if(url.pathname==='/preflight'&&!url.search)return finish(200,JSON.stringify(await reviewConfiguration(review,await getAttempt())));
   if(url.pathname==='/verify'&&[...url.searchParams.keys()].join()==='hash')return finish(200,JSON.stringify(await review.verify(url.searchParams.get('hash'),await getAttempt())));
   return finish(404,'{}');
  }catch(e){return finish(409,JSON.stringify({error:/^[A-Z_]+$/.test(e.message)?e.message:'READ_CHECK_FAILED'}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
 return {server,provider,origin,stop:async()=>{await new Promise(resolve=>server.close(resolve));if(!injected)provider.destroy();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url))startReview().then(x=>{console.log(JSON.stringify({reviewUrl:x.origin,contractVersion:3,mode:'USER_WALLET_MANUAL_DEPLOYMENT'}));const stop=()=>x.stop().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);}).catch(()=>{console.error('V3_DEPLOYMENT_REVIEW_START_FAILED');process.exitCode=1;});
