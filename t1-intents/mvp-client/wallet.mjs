// Adapted from Wallet V2's EIP-6963 adapter. No reconnect, signing or sending
// occurs during discovery; wagmi owns explicit connect, viem owns encoding.
import {createConfig, connect} from '@wagmi/core';
import {injected} from '@wagmi/connectors';
import {createWalletClient, custom, defineChain} from 'viem';

export const CHAIN_ID = 10143;
const chain = defineChain({id: CHAIN_ID, name: 'Monad Testnet', nativeCurrency: {name:'MON',symbol:'MON',decimals:18}, rpcUrls:{default:{http:['/']}}});
const address = x => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);
const fail = code => {throw Error('MVP_WALLET_' + code)};

export function createMvpWallet({view = globalThis.window, onChange = () => {}, onDiscovery = () => {}} = {}) {
  const choices = new Map();
  let selected = null, listening = null, generation = 0, selection = 0, disposed = false;
  const changed = () => {generation++; if (!disposed) onChange()};
  const events = ['accountsChanged','chainChanged','disconnect','connect'];
  function attach(provider) {
    if (listening === provider) return;
    for (const name of events) listening?.removeListener?.(name,changed);
    listening = provider;
    for (const name of events) listening?.on?.(name,changed);
  }
  function add(id,name,provider,rdns = null) {
    if (disposed || typeof provider?.request !== 'function') return;
    const duplicate = [...choices].find(([, entry]) => entry.provider === provider);
    if (duplicate) { const entry = duplicate[1]; if (rdns) { entry.name=name; entry.rdns=rdns; } onDiscovery(); return; }
    const previous = choices.get(id); choices.set(id,{name,provider,rdns});
    if (selected === id && previous?.provider !== provider) {selection++;generation++;attach(provider)}
    if (selected === id && previous?.provider !== provider) onChange();
    onDiscovery();
  }
  const announce = event => {
    const {info,provider} = event.detail || {};
    if (typeof info?.uuid === 'string' && /^[-\w]{1,80}$/.test(info.uuid) && typeof info.name === 'string') add(info.uuid,info.name.slice(0,80),provider, typeof info.rdns === "string" && /^[a-zA-Z0-9.-]{1,160}$/.test(info.rdns) ? info.rdns : null);
  };
  view.addEventListener('eip6963:announceProvider',announce);
  if (view.ethereum) add('injected','浏览器钱包',view.ethereum);
  view.dispatchEvent(new view.Event('eip6963:requestProvider'));
  function current() {if(disposed)fail('DISPOSED');return choices.get(selected)?.provider || fail('SELECT_PROVIDER')}
  function stable(provider,revision) {if(disposed || generation !== revision || current() !== provider)fail('CONTEXT_CHANGED')}
  async function observe(provider,revision) {
    const accounts = await provider.request({method:'eth_accounts'});stable(provider,revision);
    const network = await provider.request({method:'eth_chainId'});stable(provider,revision);
    if (typeof network !== 'string' || !/^0x[0-9a-f]+$/i.test(network))fail('NETWORK');
    return {account:Array.isArray(accounts)&&address(accounts[0])?accounts[0].toLowerCase():null,chainId:Number(BigInt(network))};
  }
  async function assertWallet(provider,revision,account) {
    if(!address(account))fail('ACCOUNT');
    const observed=await observe(provider,revision);
    if(observed.account!==account.toLowerCase()||observed.chainId!==CHAIN_ID)fail('ACCOUNT_OR_NETWORK');
  }
  async function action(account,method,invoke,assertCurrent = () => {}) {
    const provider=current(),revision=generation;
    await assertWallet(provider,revision,account);assertCurrent();
    const guarded={async request(args){
      stable(provider,revision);
      if(args.method===method){
        await assertWallet(provider,revision,account);
        stable(provider,revision);assertCurrent();
      } else if(!['eth_chainId','eth_accounts'].includes(args.method))fail('METHOD');
      return provider.request(args);
    }};
    const client=createWalletClient({account,chain,transport:custom(guarded,{retryCount:0})});
    // A hash/signature returned after account change must still reach the
    // caller for recovery; do not discard an already-broadcast hash here.
    return invoke(client);
  }
  return Object.freeze({
    providers:()=>[...choices].map(([id,{name,rdns}])=>({id,name,rdns})),
    select(id){if(!choices.has(id))fail('SELECT_PROVIDER');selected=id;selection++;generation++;attach(current());onChange()},
    inspect(){return observe(current(),generation)},
    async connect(){
      const provider=current(),selectedRevision=selection;
      const connector=injected({shimDisconnect:false,target:{id:selected,name:choices.get(selected).name,provider}});
      const config=createConfig({chains:[chain],connectors:[connector],transports:{[CHAIN_ID]:custom(provider,{retryCount:0})},storage:null,multiInjectedProviderDiscovery:false,ssr:true});
      await connect(config,{connector:config.connectors[0]});
      if(disposed||selection!==selectedRevision||current()!==provider)fail('CONTEXT_CHANGED');
      return observe(provider,generation);
    },
    signMessage(account,message,assertCurrent){
      if(typeof message!=='string'||message.length>8192)fail('MESSAGE');
      return action(account,'personal_sign',client=>client.signMessage({message}),assertCurrent);
    },
    signTypedData(account,typedData,assertCurrent){
      if(!typedData||Number(typedData.domain?.chainId)!==CHAIN_ID)fail('TYPED_DATA');
      return action(account,'eth_signTypedData_v4',client=>client.signTypedData(typedData),assertCurrent);
    },
    sendTransaction(account,tx,assertCurrent){
      if(!tx||tx.from?.toLowerCase()!==account.toLowerCase()||Number(tx.chainId)!==CHAIN_ID||!/^0x[0-9a-f]*$/i.test(tx.data||'')||tx.data.length%2!==0||BigInt(tx.value??0)!==0n)fail('TRANSACTION');
      if(tx.to!=null&&!address(tx.to))fail('TRANSACTION');
      const nonce=Number(BigInt(tx.nonce));if(!Number.isSafeInteger(nonce)||nonce<0)fail('TRANSACTION');
      return action(account,'eth_sendTransaction',client=>client.sendTransaction({account,chain,to:tx.to??undefined,data:tx.data,value:0n,nonce}),assertCurrent);
    },
    dispose(){disposed=true;generation++;view.removeEventListener('eip6963:announceProvider',announce);attach(null);choices.clear()}
  });
}
