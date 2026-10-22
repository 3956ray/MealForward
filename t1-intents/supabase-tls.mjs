/**
 * Load the Supabase-issued root CA (PUBLIC trust certificate) for the
 * OWNER-APPROVED Session Pooler. Never globally disable TLS validation.
 *
 * The CA certificate is downloaded from the exact project's official
 * Supabase Database Settings > SSL Configuration > Download Certificate
 * and placed in the Render service environment as base64 text.
 *
 * No DATABASE URL, password or private key is processed by this module.
 */
import {X509Certificate} from 'node:crypto';

const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const stop=(ok,code)=>{if(!ok)throw Error(code)};

export function verifiedSupabasePoolerTls({env=process.env,host=HOST}={}){
 stop(host===HOST,'T1_C_TLS_UNTRUSTED_HOST');
 const b64=env?.T1C_SUPABASE_CA_B64;
 stop(typeof b64==='string'&&b64.length>=200&&b64.length<=40000&&
  /^[A-Za-z0-9+/]+={0,2}$/.test(b64),
  'T1_C_SUPABASE_CA_B64_REQUIRED');
 const data=Buffer.from(b64,'base64');
 stop(data.length>=200&&data.length<=24000&&
  data.toString('base64')===b64,
  'T1_C_SUPABASE_CA_B64_INVALID');
 const text=data.toString('utf8');
 const certs=text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[];
 stop(certs.length>=1&&certs.length<=4&&
  text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim()==='',
  'T1_C_SUPABASE_CA_PEM_INVALID');
 try{
  const now=Date.now();
  for(const p of certs){
   const cert=new X509Certificate(p);
   stop(Number.isFinite(new Date(cert.validFrom).getTime())&&
    now>=new Date(cert.validFrom).getTime()&&
    now<new Date(cert.validTo).getTime(),
   'T1_C_SUPABASE_CA_EXPIRED_OR_NOT_YET_VALID');
  }
 }catch(e){
  if(/^T1_C_SUPABASE_CA_/.test(e?.message||''))throw e;
  throw Error('T1_C_SUPABASE_CA_CERT_INVALID');
 }
 return Object.freeze({
  ca:text,
  rejectUnauthorized:true,
  servername:HOST
 });
}
