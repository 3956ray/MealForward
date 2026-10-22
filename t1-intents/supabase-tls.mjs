/**
 * A PUBLIC TRUST ANCHOR, downloaded by the MealForward owner directly
 * from the authorized Supabase project's Database Settings.
 * No token, password, connection URL, signer, credential or private key.
 *
 * Strict TLS verification stays mandatory. This anchored certificate
 * avoids fragile base64 string copying from terminal to Render.
 */
import {createHash,X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';

const HOST='aws-0-ap-southeast-2.pooler.supabase.com';
const PEM_SHA256='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const CERT_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const ROOT_PATH=new URL('./trust/supabase-root-2021-ca.pem',import.meta.url);
const stop=(ok,code)=>{if(!ok)throw Error(code)};
export function verifiedSupabasePoolerTls({host=HOST,now=Date.now()}={}){
 stop(host===HOST,'T1_C_TLS_UNTRUSTED_HOST');
 const certText=readFileSync(ROOT_PATH,'utf8');
 stop(createHash('sha256').update(certText).digest('hex')===PEM_SHA256,
  'T1_C_SUPABASE_PINNED_CA_HASH_MISMATCH');
 stop(/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(certText),
  'T1_C_SUPABASE_PINNED_CA_FORMAT_INVALID');
 const c=new X509Certificate(certText);
 stop(c.fingerprint256.replace(/:/g,'').toLowerCase()===CERT_FINGERPRINT,
  'T1_C_SUPABASE_PINNED_CA_FINGERPRINT_MISMATCH');
 stop(Number.isFinite(now)&&now>=new Date(c.validFrom).getTime()&&
  now<new Date(c.validTo).getTime(),'T1_C_SUPABASE_PINNED_CA_EXPIRED');
 stop(c.subject.includes('CN=Supabase Root 2021 CA') &&
  c.issuer.includes('CN=Supabase Root 2021 CA')&&c.ca===true,
  'T1_C_SUPABASE_PINNED_CA_WRONG_SUBJECT');
 return Object.freeze({
  ca:certText,servername:HOST,rejectUnauthorized:true
 });
}
