import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {verifiedSupabasePoolerTls} from './supabase-tls.mjs';

const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const sample=tls.rootCertificates[0];
const base64=Buffer.from(sample,'utf8').toString('base64');

test('verified TLS must load an explicit parseable fresh CA and pin exact Supabase pooler host',()=>{
 const config=verifiedSupabasePoolerTls({
  env:{T1C_SUPABASE_CA_B64:base64},host:HOST
 });
 assert.equal(config.servername,HOST);
 assert.equal(config.rejectUnauthorized,true);
 assert.ok(config.ca.includes('-----BEGIN CERTIFICATE-----'));
 assert.ok(Object.isFrozen(config));
 assert.throws(()=>verifiedSupabasePoolerTls({
  env:{T1C_SUPABASE_CA_B64:base64},host:'aws-1-ap-southeast-2.pooler.supabase.com'
 }),/T1_C_TLS_UNTRUSTED_HOST/);
});

test('missing, tampered, partial or incorrect CA is blocked before opening any database connection',()=>{
 assert.throws(()=>verifiedSupabasePoolerTls({env:{},host:HOST}),/T1_C_SUPABASE_CA_B64_REQUIRED/);
 assert.throws(()=>verifiedSupabasePoolerTls({
  env:{T1C_SUPABASE_CA_B64:'not-a-certificate'},host:HOST
 }),/T1_C_SUPABASE_CA_B64_REQUIRED/);
 assert.throws(()=>verifiedSupabasePoolerTls({
  env:{T1C_SUPABASE_CA_B64:Buffer.from('nonsense TLS content').toString('base64')},host:HOST
 }),/T1_C_SUPABASE_CA_B64_REQUIRED/);
 assert.throws(()=>verifiedSupabasePoolerTls({
  env:{T1C_SUPABASE_CA_B64:Buffer.from('X'.repeat(1000)).toString('base64')},host:HOST
 }),/T1_C_SUPABASE_CA_PEM_INVALID/);
});

test('public Base64 CA material never weakens TLS verification to encryption-only',()=>{
 const config=verifiedSupabasePoolerTls({env:{T1C_SUPABASE_CA_B64:base64}});
 assert.equal(config.rejectUnauthorized,true);
 assert.equal(config.servername,HOST);
 assert.equal(Object.prototype.hasOwnProperty.call(config,'checkServerIdentity'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(config,'sslmode'),false);
});
