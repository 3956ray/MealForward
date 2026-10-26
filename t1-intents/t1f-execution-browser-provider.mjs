/* Fixture-only fake EIP1193 provider, absent from production static allowlist. */
const listeners=new Map();let account='0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';
globalThis.fixtureMode='ok';
globalThis.fixtureControl=mode=>fetch('/fixture/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode})});
globalThis.fixtureSwitch=()=>{account=account.endsWith('b3')?'0x'+'1'.repeat(40):'0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3';for(const fn of listeners.get('accountsChanged')||[])fn([account]);};
globalThis.ethereum={syntheticMealforwardFixture:true,isMetaMask:true,on(e,fn){listeners.set(e,[...(listeners.get(e)||[]),fn])},async request({method}){if(method==='wallet_requestPermissions')return [{parentCapability:'eth_accounts'}];if(method==='eth_accounts')return [account];if(method==='eth_chainId')return '0x279f';if(method==='personal_sign')return '0x'+'a'.repeat(130);if(method==='eth_sendTransaction'){if(globalThis.fixtureMode==='reject')throw Object.assign(Error('Synthetic rejection'),{code:4001});await fixtureControl('sent');return '0x'+'9'.repeat(64);}throw Error('FIXTURE_METHOD_DENIED')}};
