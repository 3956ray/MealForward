// SQL composition double extracted unchanged from runtime.test; not PG permission evidence.
import assert from 'node:assert/strict';import {emptyState} from './service.mjs';
export function memoryPool(role='mf_product_v2_runtime'){
 let db={pre:{},challenges:{},sessions:{},state:emptyState()},calls=[];const result=(rows=[])=>({rows:structuredClone(rows),rowCount:rows.length});
 function sql(d,q,p=[]){q=q.replace(/\s+/g,' ').trim();calls.push(q);assert.ok(!/mf_mvp|mcpay/.test(q),'legacy schema access');
 if(q.startsWith('SELECT current_user AS name,rolsuper'))return result([{name:role,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolinherit:false}]);
 if(q.startsWith('SELECT rolname FROM pg_roles'))return result();
 if(q.startsWith('SELECT nspowner='))return result([{owned:false,can_use:true,can_create:false,can_create_schema:false}]);
 if(q.startsWith('SELECT nspname FROM pg_namespace'))return result();
 if(q.startsWith('SELECT c.relname,c.relkind,c.relrowsecurity'))return result(['state','pre_sessions','challenges','sessions','schema_version'].map(relname=>({relname,relkind:'r',relrowsecurity:true,owned:false,can_select:true,can_insert:relname!=='schema_version',can_update:relname!=='schema_version',can_delete:false,can_truncate:false,can_reference:false,can_trigger:false})));
 if(q.includes('has_sequence_privilege')||q.includes('p.prosecdef'))return result();
 if(q.startsWith('SELECT p.proname FROM pg_proc'))return result();
 if(q==='SELECT id FROM mf_product_v2.state WHERE id=1')return result([{id:1}]);
 if(q==='SELECT current_user AS role')return result([{role}]);if(q.includes('schema_version'))return result([{version:1}]);
 if(q.startsWith('SELECT data FROM mf_product_v2.state')||q.startsWith('SELECT revision,data FROM mf_product_v2.state'))return result([{revision:0,data:d.state}]);if(q.startsWith('UPDATE mf_product_v2.state')){d.state=JSON.parse(p[0]);return result([{}]);}
 if(q.startsWith('INSERT INTO mf_product_v2.pre_sessions')){d.pre[p[0]]={csrf:p[1],expires:p[2],used:false};return result([{}]);}
 if(q.startsWith('SELECT pre_hash')){const r=d.pre[p[0]];return result(r&&!r.used&&r.csrf===p[1]&&r.expires>p[2]?[{pre_hash:p[0]}]:[]);}
 if(q.startsWith('SELECT count(*)'))return result([{n:Object.values(d.challenges).filter(c=>c.pre===p[0]).length}]);
 if(q.startsWith('INSERT INTO mf_product_v2.challenges')){if(d.challenges[p[0]])return result();d.challenges[p[0]]={pre:p[1],csrf:p[2],payload:JSON.parse(p[3]),expires:p[4],used:false};return result([{id:p[0]}]);}
 if(q.startsWith('SELECT x.payload')){const c=d.challenges[p[0]],r=d.pre[p[1]];return result(c&&r&&c.pre===p[1]&&c.csrf===p[2]&&r.csrf===p[2]&&!c.used&&!r.used&&c.expires>p[3]&&r.expires>p[3]?[{payload:c.payload}]:[]);}
 if(q.startsWith('UPDATE mf_product_v2.pre_sessions')){const r=d.pre[p[0]];if(!r||r.used||r.csrf!==p[1]||r.expires<=p[2])return result();r.used=true;return result([{pre_hash:p[0]}]);}
 if(q.startsWith('UPDATE mf_product_v2.challenges')){const c=d.challenges[p[0]];if(!c||c.used||c.pre!==p[1]||c.csrf!==p[2]||c.expires<=p[3]||JSON.stringify(c.payload)!==p[4])return result();c.used=true;return result([{id:p[0]}]);}
 if(q.startsWith('INSERT INTO mf_product_v2.sessions')){d.sessions[p[0]]={csrf:p[1],wallet:p[2],expires:p[3],revoked:false};return result([{}]);}
 if(q.startsWith('SELECT wallet')||q.startsWith('UPDATE mf_product_v2.sessions')){const r=d.sessions[p[0]],csrf=q.includes('csrf_hash=$2'),valid=r&&!r.revoked&&r.expires>(csrf?p[2]:p[1])&&(!csrf||r.csrf===p[1]);if(!valid)return result();if(q.startsWith('UPDATE'))r.revoked=true;return result([{wallet:r.wallet}]);}throw Error('Unsupported synthetic SQL');}
 return {calls,get state(){return db.state;},query:async(q,p)=>sql(db,q,p),connect:async()=>{let tx=null;return {query:async(q,p)=>{if(q==='BEGIN'){tx=structuredClone(db);return result();}if(q==='ROLLBACK'){tx=null;return result();}if(q==='COMMIT'){db=tx;tx=null;return result();}return sql(tx||db,q,p);},release(){}};}};
}

// Serialize synthetic BEGIN/COMMIT exactly like the production state row lock.
export function serializedMemoryPool(){const pool=memoryPool(),connect=pool.connect;let tail=Promise.resolve();pool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;const client=await connect();return {...client,release(){client.release();release();}};};return pool;}
