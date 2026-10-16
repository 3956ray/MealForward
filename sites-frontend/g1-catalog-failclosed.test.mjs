// Validate that unreadable backend menus cannot remain actionable from cache.
// UI handlers are evaluated in a pure deterministic adapter; no DOM, wallet,
// browser or network is needed, and no original CP30 runtime is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
const start=code.indexOf('async function loadLiveCatalog(');
const end=code.indexOf('async function loadPublicLedger(',start);
assert.ok(start>0&&end>start,'Original catalog loader not found.');
const part=code.slice(start,end);
const STORE1='a'.repeat(64),STORE2='b'.repeat(64);
const A={id:STORE1,name:'One'}, B={id:STORE2,name:'Two'};

function harness({authPilot=false}={}){
 const calls=[];
 const live={generation:0,context:{setup:{authPilot}},stores:[{id:'old',name:'STALE'}],meals:{old:[{listed:true,available:99}]},catalogError:''};
 const currentLiveResult=async (promise,generation)=>{const value=await promise;if(generation!==live.generation)throw Error('SESSION_CHANGED');return value;};
 const load=new Function('live','currentLiveResult',part+';return loadLiveCatalog;')(live,currentLiveResult);
 return {live,calls,load,api(api){live.api={
  listStores:async()=>{calls.push('list');return api.stores();},
  getStoreMeals:async id=>{calls.push('meals:'+id);return api.meals(id);}
 }}};
}
test('successful read replaces all prior stores and publishes only fresh menus',async()=>{
 const f=harness();f.api({stores:()=>[A,B],meals:id=>[{id:'fresh-'+id,listed:true}]});
 await f.load();
 assert.deepEqual(f.live.stores,[A,B]);
 assert.equal(f.live.meals[STORE1][0].id,'fresh-'+STORE1);
 assert.equal(f.live.meals[STORE2][0].id,'fresh-'+STORE2);
 assert.equal(Object.hasOwn(f.live.meals,'old'),false);
 assert.equal(f.live.catalogError,'');
});
test('one failed menu removes every previous actionable listing and shows explicit error',async()=>{
 const f=harness();
 f.api({stores:()=>[A,B],meals:id=>id===STORE2?Promise.reject(Error('503')):[{id:'fresh',listed:true}]});
 await f.load();
 assert.deepEqual(f.live.stores,[]);
 assert.deepEqual(f.live.meals,{});
 assert.match(f.live.catalogError,/not be fully verified/);
 assert.doesNotMatch(JSON.stringify(f.live.meals),/STALE|99|fresh/);
});
test('failed public catalog read cannot leave old stores or stale quantities in memory',async()=>{
 const f=harness();f.api({stores:()=>Promise.reject(Error('network interrupted')),meals:()=>{throw Error('should not run')}});
 await assert.rejects(f.load(),/network interrupted/);
 assert.deepEqual(f.live.stores,[]);
 assert.deepEqual(f.live.meals,{});
});
test('auth-only mode does not poll original catalog or show its empty pilot list as real data',async()=>{
 const f=harness({authPilot:true});f.api({stores:()=>{throw Error('do not query pilot stores')},meals:()=>{throw Error('do not query meals')}});
 await f.load();
 assert.deepEqual(f.calls,[]);
 assert.deepEqual(f.live.stores,[]);
 assert.match(f.live.catalogError,/not connected/);
});
test('a legitimate verified empty catalog remains distinguishable from a read failure',async()=>{
 const f=harness();f.api({stores:()=>[],meals:()=>{throw Error('should not run')}});
 await f.load();
 assert.deepEqual(f.live.stores,[]);
 assert.equal(f.live.catalogError,'');
});
test('wallet generation change stops late reads from restoring earlier business data',async()=>{
 const f=harness();
 let done;
 const delayed=new Promise(resolve=>done=resolve);
 f.api({stores:()=>delayed,meals:()=>[]});
 const task=f.load();
 f.live.generation++;
 done([A]);
 await assert.rejects(task,/SESSION_CHANGED/);
 assert.deepEqual(f.live.stores,[]);
 assert.deepEqual(f.live.meals,{});
});
