import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPublicLedger,verifiedLedgerRows} from './dist/ledger-view.mjs';
const item=(overrides={})=>({store:'abc1',funded:'4',financial:{counts:{F:'4',A:'1',R:'1',H:'1',S:'1',X:'0'},F:'4000000',H:'1000000',S:'1000000',liability:'3000000'},...overrides});
test('renders real aggregate counts and base-unit USDC values',()=>{
 const html=renderPublicLedger({items:[item()],stores:[{id:'abc1',name:'Warm Kitchen'}],setup:{assetDecimals:6,assetSymbol:'test USDC'}});
 assert.match(html,/Warm Kitchen/);assert.match(html,/4/);assert.match(html,/4 test USDC/);assert.match(html,/3 test USDC/);
 assert.match(html,/F = A \+ R \+ H \+ S \+ X/);assert.doesNotMatch(html,/voucher.*access token/i);
});
test('missing data is not silently projected as zero',()=>{
 const data=item({financial:{counts:{F:'2',A:'1'}}}),html=renderPublicLedger({items:[data]});
 assert.equal(verifiedLedgerRows([data])[0].valid,false);
 assert.match(html,/needs verification/);assert.match(html,/Not available/);
 assert.doesNotMatch(html,/Total funded value/);
});
test('inconsistent accounting refuses to render false totals',()=>{
 const bad=item({funded:'7'}),html=renderPublicLedger({items:[item(),bad]});
 assert.match(html,/Aggregate totals are withheld/);assert.equal((html.match(/Not available/g)||[]).length,6);
});
test('untrusted public store names are escaped and private fields never displayed',()=>{
 const html=renderPublicLedger({items:[{...item(),recipientEmail:'victim@example.invalid',secret:'private123'}],stores:[{id:'abc1',name:'<script>alert(1)</script>'}]});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/private123|victim@example/);
});
test('empty, loading and unavailable states are distinct and honest',()=>{
 assert.match(renderPublicLedger({loading:true}),/Checking the public meal ledger/);
 assert.match(renderPublicLedger({error:'OFFLINE',items:[item()]}),/OFFLINE/);
 assert.doesNotMatch(renderPublicLedger({error:'OFFLINE',items:[item()]}),/4 test USDC/);
 assert.match(renderPublicLedger({items:[]}),/No verified kitchen accounting yet/);
});
test('invalid store ID or accounting shape never creates an unsafe hyperlink',()=>{
 const html=renderPublicLedger({items:[item({store:'../../private'})]});
 assert.doesNotMatch(html,/href="#store\/\.\./);assert.match(html,/needs verification/);
});
