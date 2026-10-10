// Regression adapted from the independent 185493b TSX/App counterexample.
// Actual component handlers, synthetic hooks/SDK/fetch; no DOM/network.
// Run: node tests/cp29_work_component_regression.cjs "$PWD"
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2];
const ts = require(path.join(root, 'node_modules/typescript'));
const tick = () => new Promise(resolve => setImmediate(resolve));
let active;
const react = {
  useState(initial) {
    const h = active, i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
    return [h.slots[i], value => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value; }];
  },
  useRef(initial) { const h = active, i = h.cursor++; return h.slots[i] ||= {current: initial}; },
  useEffect(fn) { const h = active, i = h.cursor++; if (!(i in h.slots)) {h.slots[i] = true; h.effects.push(fn);} },
  useSyncExternalStore(sub, snapshot) {return snapshot();},
  lazy() {return 'Lazy';}, Suspense: 'Suspense',
};
const jsx = (type, props) => ({type, props});
function load(relative, deps) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'Fragment'};
    if (name in deps) return deps[name];
    throw Error('Unexpected import ' + name);
  }, module, module.exports);
  return module.exports;
}
function render(Component, props, hooks, effects = true) {
  active = hooks; hooks.cursor = 0;
  const result = Component(props);
  if (effects) hooks.effects.splice(0).forEach(fn => {const cleanup=fn(); if(cleanup)(hooks.cleanups ||= []).push(cleanup);});
  return result;
}
function nodes(tree, predicate, result = []) {
  if (Array.isArray(tree)) tree.forEach(n => nodes(n, predicate, result));
  else if (tree && typeof tree === 'object') {
    if (predicate(tree)) result.push(tree);
    nodes(tree.props?.children, predicate, result);
  }
  return result;
}
const ok = value => new Response(JSON.stringify(value), {status: 200});
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};
async function scenario(kind) {
  const {WorkSessions} = load('manual-business-harness/work-session.ts', {});
  const pendingLogin=deferred(),pendingRestore=deferred();
  const session={role:'owner',actorId:'cp29-owner',csrfToken:'synthetic',expiresAt:Date.now()/1000+100};
  const workSessions = new WorkSessions(async url => {
    if (String(url).endsWith('/logout')) {
      if (!kind.startsWith('sdk-')) throw Error('synthetic cleanup failure');
      return ok({loggedOut:true});
    }
    if (kind==='ambiguous-login') throw Error('synthetic lost response after cookie commit');
    if (kind==='malformed-success') return ok({role:'owner'});
    if (kind==='malformed-json') return new Response('not-json',{status:200});
    if (kind==='server-error') return new Response('{}',{status:503});
    if (kind==='late-login') return pendingLogin.promise;
    return ok(session);
  });
  const client = {subscribe:()=>()=>{},getSnapshot:()=>({status:'authenticated'}),
    getAccessToken:()=> 'synthetic',onInvalidate:()=>()=>{},logout:()=>{
      if(kind==='sdk-sync')throw Error('synthetic SDK sync failure');
      return kind==='sdk-async'?Promise.reject(Error('synthetic SDK failure')):Promise.resolve();
    }};
  const Work = load('manual-business-harness/WorkDynamicLogin.tsx', {
    '../src/dynamic/client':{createDynamicAuthClient:()=>client},'./work-session':{workSessions},
  }).default;
  const App=load('manual-business-harness/App.tsx',{
    'qrcode.react':{QRCodeSVG:'QR'},'./wallet':{Wallet:class{}},'./Scanner':{Scanner:'Scanner'},'./style.css':{},
  }).default;
  global.location={hash:'#/owner'};
  const calls=[];
  global.fetch=async url=>{
    calls.push(url);
    if(url.endsWith('/session'))return pendingRestore.promise;
    if(url.endsWith('/status'))return ok({runtimeAuthorized:true,identityConfigured:true,missing:[]});
    return ok({});
  };
  const hooks={slots:[],cursor:0,effects:[]},wh={slots:[],cursor:0,effects:[]};
  render(App,{},hooks,false);
  hooks.slots[3]={runtimeAuthorized:true,identityConfigured:true,missing:[],identityMode:'single-operator-testnet'};
  let app=render(App,{},hooks,false);
  const props=nodes(app,n=>n.props?.onCleanupError)[0].props;
  let reports=0;
  const report=props.onCleanupError;
  props.onCleanupError=message=>{reports++;report(message);};
  const button=(view,label)=>nodes(view,n=>n.type==='button'&&n.props.children===label)[0];
  let view=render(Work,props,wh);
  try {
    button(view,'使用此身份登录业务工作台').props.onClick();
    await tick();await tick();
    if(kind==='late-login') {
      wh.cleanups.splice(0).forEach(fn=>fn());
      pendingLogin.resolve(ok(session));
      await tick();await tick();
    } else if(!['ambiguous-login','malformed-success','malformed-json','server-error'].includes(kind)) {
      if(kind==='late-session') {
        app=render(App,{},hooks,false);
        button(app,'查看当前工作状态').props.onClick();
        await tick();assert(calls.includes('/api/cp28/owner/session'));
      }
      view=render(Work,props,wh);
      button(view,kind==='repeat-login'?'使用此身份登录业务工作台':'退出当前身份').props.onClick();
      await tick();await tick();
    }
    assert(reports>0,kind+': blocked authority must reach App');
    assert.equal(workSessions.isBlocked(),true);
    if(kind==='late-session') {
      pendingRestore.resolve(ok({csrfToken:'restored-synthetic'}));
      await tick();await tick();
      assert(!calls.includes('/api/cp28/owner/state'),'late session must not proceed to state');
    }
    app=render(App,{},hooks,false);
    const restore=button(app,'查看当前工作状态');
    assert.equal(restore.props.disabled,true,'recovery button must share the authority barrier');
    const before=calls.length;
    // Calling a captured handler directly must be blocked even without DOM disabled protection.
    restore.props.onClick();await tick();await tick();
    assert.equal(calls.length,before,'blocked recovery must not reach HTTP');
    props.onAuthenticated({...session,csrfToken:'restored-synthetic'});
    assert(!hooks.slots.some(s=>s?.current?.owner),'neither late callback nor fetch may restore CSRF');
    view=render(Work,props,wh);
    assert.equal(button(view,'使用此身份登录业务工作台').props.disabled,true);
    console.log('PASS '+kind+': App notified, login/recovery disabled, HTTP and late CSRF restoration blocked');
  } finally {
    (wh.cleanups||[]).splice(0).forEach(fn=>fn());
    await tick();await tick();
  }
}
(async()=>{
  for(const kind of ['ambiguous-login','explicit-logout','malformed-success','malformed-json','server-error','sdk-async','sdk-sync','repeat-login','late-login','late-session'])await scenario(kind);
  console.log('10 actual TSX/App integration regressions PASS (synthetic hook runner, no browser)');
})().catch(e=>{console.error(e);process.exitCode=1;});
