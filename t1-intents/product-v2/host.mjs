import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {makeProductRuntime} from './runtime.mjs';

/** Explicit standalone host. Caller supplies a reviewed adapter and dedicated
 * pool; importing this file never listens, migrates, signs, or starts a worker.
 * No path to the old MVP is mounted. */
export async function makeProductHost(options){
  const localWallet=options.localWallet;
  if(localWallet&&!(options.profile==='local-acceptance'&&/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(options.origin)))throw Error('LOCAL_WALLET_HOST_REJECTED');
  const runtime=await makeProductRuntime(options);
  const publicDirectory=new URL('../public/product-v2/',import.meta.url);
  const files=new Map([['index.html','text/html; charset=utf-8'],['catalog.mjs','text/javascript; charset=utf-8'],['source.css','text/css; charset=utf-8'],['product.css','text/css; charset=utf-8'],['catalog.css','text/css; charset=utf-8'],['THIRD_PARTY_NOTICES.txt','text/plain; charset=utf-8']]);
  const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,options.origin);
      if(req.headers.host!==new URL(options.origin).host||url.origin!==options.origin){res.writeHead(403,security);res.end();return;}
      if(localWallet&&await localWallet.handler(req,res))return;
      if(await runtime.handler(req,res))return;
      if(!['GET','HEAD'].includes(req.method)||url.search){res.writeHead(404,security);res.end();return;}
      if(url.pathname==='/'||url.pathname==='/product-v2'||url.pathname==='/product-v2/'){res.writeHead(303,{...security,Location:'/product-v2/index.html'});res.end();return;}
      if(localWallet&&url.pathname==='/product-v2/local-wallet.mjs'){res.writeHead(200,{...security,'Content-Type':'text/javascript; charset=utf-8'});res.end(req.method==='HEAD'?undefined:localWallet.frontendSource);return;}
      const name=url.pathname.slice('/product-v2/'.length);
      if(!url.pathname.startsWith('/product-v2/')||!files.has(name)){res.writeHead(404,security);res.end();return;}
      let bytes=await readFile(new URL(name,publicDirectory));
      if(localWallet&&name==='index.html')bytes=Buffer.from(bytes.toString().replace('<script type="module"', '<script src="./local-wallet.mjs"></script><script type="module"'));
      res.writeHead(200,{...security,'Content-Type':files.get(name)});res.end(req.method==='HEAD'?undefined:bytes);
    }catch{if(!res.headersSent)res.writeHead(503,{...security,'Content-Type':'application/json'});res.end('{"error":"PRODUCT_UNAVAILABLE"}');}
  });
  return {server,tickClaims:runtime.tickClaims};
}
