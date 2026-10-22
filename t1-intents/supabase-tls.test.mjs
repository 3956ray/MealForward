import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';

const SHA='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const FP='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
test('bundled user-provided Supabase trust cert equals exact external uploaded SHA and X509 fingerprint',()=>{
 const buf=readFileSync(new URL('./trust/supabase-root-2021-ca.pem',import.meta.url));
 assert.equal(createHash('sha256').update(buf).digest('hex'),SHA);
 const c=new X509Certificate(buf);
 assert.equal(c.fingerprint256.replaceAll(':','').toLowerCase(),FP);
 assert.equal(c.ca,true);
});
test('the pinned Supabase Root CA supports strict TLS verification with exactly approved host',()=>{
 const tls=verifiedSupabasePoolerTls({host:HOST});
 assert.equal(tls.servername,HOST);
 assert.equal(tls.rejectUnauthorized,true);
 assert.equal(Object.isFrozen(tls),true);
 assert.match(tls.ca,/-----BEGIN CERTIFICATE-----/);
});
test('misdirected pooler hostname, expired CA and missing SSL shortcuts are rejected',()=>{
 assert.throws(()=>verifiedSupabasePoolerTls({host:'aws-1-ap-southeast-2.pooler.supabase.com'}),/T1_C_TLS_UNTRUSTED_HOST/);
 assert.throws(()=>verifiedSupabasePoolerTls({now:new Date('2040-01-01').valueOf()}),/T1_C_SUPABASE_PINNED_CA_EXPIRED/);
 const x=verifiedSupabasePoolerTls();
 assert.equal(x.rejectUnauthorized,true);
 assert.equal(Object.prototype.hasOwnProperty.call(x,'checkServerIdentity'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(x,'sslmode'),false);
});
