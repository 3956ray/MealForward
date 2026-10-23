import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const html=read('./public/t1f-issuer-proof.html');
const ui=read('./public/t1f-issuer-proof-ui.mjs');
const server=read('./read-only-server.mjs');
const policy=read('./static-fetch-policy.mjs');
test('issuer wallet proof page is explicit no-funds, role-pinned and self-hosted',()=>{
 assert.match(html,/T1-F/);
 assert.match(html,/0x9747D93d9F8C2e1202b4d922a4916fcF634aA2B3/i);
 assert.match(html,/不发行餐券/);
 assert.match(html,/不触发区块链交易/);
 assert.match(html,/t1f-ethers\.umd\.min\.js/);
 assert.match(html,/t1f-issuer-proof-ui\.mjs/);
 assert.match(html,/原 T1-D 资助记录/);
 assert.match(html,/NO ISSUE \/ NO SETTLE/);
 assert.ok(!html.includes('http://'));
 assert.ok(!html.includes('cdn.'));
});
test('issuer page only asks for plain EIP191 personal_sign and never sends signature',()=>{
 assert.match(ui,/personal_sign/);
 assert.match(ui,/verifyIssuerControlChallenge/);
 assert.match(ui,/getRandomValues/);
 assert.match(ui,/revision===epoch/);
 assert.match(ui,/accountsChanged/);
 assert.match(ui,/chainChanged/);
 assert.match(ui,/credentials:'omit'/);
 for(const forbidden of [
  'eth_sendTransaction','eth_sendRawTransaction','eth_signTypedData_v4',
  'wallet_sendCalls','personalSignToBackend','localStorage','sessionStorage',
  'privateKeyToAccount','fetch(ISSUER_ORIGIN'
 ])assert.ok(!ui.includes(forbidden),forbidden);
 assert.ok(!/method:\s*'POST'/.test(ui));
});
test('origin-pinned T1-F assets are gated to the established funding server',()=>{
 assert.match(server,/if\(cfg\.funding\)exposedFiles\.push/);
 assert.match(server,/t1f-issuer-proof\.html/);
 assert.match(server,/t1f-issuer-proof-ui\.mjs/);
 assert.match(server,/t1f-issuer-control\.mjs/);
 assert.match(server,/node_modules\/ethers\/dist\/ethers\.umd\.min\.js/);
 assert.match(policy,/t1f-issuer-proof\.html/);
 assert.ok(!server.includes('T1F_SERVER_SIGNING_KEY'));
 assert.ok(!server.includes('RECIPIENT_OWNER_BYPASS'));
});
