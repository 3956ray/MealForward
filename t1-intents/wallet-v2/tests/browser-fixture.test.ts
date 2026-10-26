import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('fixture serves wrapping stylesheet under its unchanged self-only CSP',async()=>{
 const child=spawn(process.execPath,[new URL('./browser-fixture.mjs',import.meta.url).pathname],{stdio:['ignore','pipe','pipe']});
 const stopped=once(child,'exit');
 try{
  const origin=await new Promise<string>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('FIXTURE_START_TIMEOUT')),5000);
   child.once('error',error=>{clearTimeout(timeout);reject(error)});
   child.stdout.on('data',chunk=>{const match=String(chunk).match(/WALLET_V2_SYNTHETIC_URL=(http:\/\/127\.0\.0\.1:\d+)\//);if(match){clearTimeout(timeout);resolve(match[1])}});
  });
  const response=await fetch(origin,{signal:AbortSignal.timeout(5000)});const html=await response.text();
  assert.equal(response.status,200);assert.match(html,/<link rel="stylesheet" href="\/fixture.css">/);
  assert.doesNotMatch(html,/\sstyle=/);
  const csp=response.headers.get('content-security-policy');assert.match(csp!,/style-src 'self'/);assert.doesNotMatch(csp!,/unsafe-inline/);
  const stylesheet=await fetch(origin+'/fixture.css',{signal:AbortSignal.timeout(5000)});
  assert.equal(stylesheet.status,200);assert.match(stylesheet.headers.get('content-type')!,/^text\/css/);
  assert.equal(stylesheet.headers.get('content-security-policy'),csp);
  const css=await stylesheet.text();assert.match(css,/#fixture-controls/);assert.match(css,/overflow-wrap: anywhere/);assert.match(css,/min-width: 0/);
 }finally{child.kill('SIGTERM');await stopped}
});
