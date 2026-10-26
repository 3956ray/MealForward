import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {makeApprovalHttpHandler} from './t1f-approval-server.mjs';
import {APPROVAL_WALLETS} from './t1f-approval-protocol.mjs';
import {attestWalletV2Live,warmWalletV2Health} from './t1f-wallet-v2-live-smoke.mjs';

test('Wallet V2 live probe attests six exact assets and new root without durable write',async t=>{
 let reads=0,writes=0;
 const service={status:async()=>{reads++;return {noRelease:true,canIssue:false,chainId:10143,wallets:APPROVAL_WALLETS,roles:{owner:false,donor:false},serverTime:Math.floor(Date.now()/1000),status:'NO_ROUND',round:null}},submit:async()=>{writes++;throw Error('WRITE_FORBIDDEN')}};
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 server.on('request',makeApprovalHttpHandler({service,origin,testing:true}));
 t.after(()=>new Promise(r=>server.close(r)));
 const options={origin,fixture:true};
 assert.equal((await warmWalletV2Health(options)).status,'T1F_APPROVAL_HEALTH_READY');
 const result=await attestWalletV2Live(options);
 assert.equal(result.status,'T1F_WALLET_V2_PUBLIC_NO_ROUND_NEGATIVE_PASS');
 assert.equal(Object.keys(result.assetSha256).length,6);
 assert.equal(result.requests,33);
 assert.equal(result.durableWritesRequested,0);
 assert.equal(writes,0);assert.equal(reads,3);
});
