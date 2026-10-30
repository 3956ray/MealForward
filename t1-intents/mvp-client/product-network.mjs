// Product-only network policy. Legacy wallet.mjs and guards.mjs remain unchanged.
// Discovery is passive; permission/sign/send require explicit caller actions.
import {createConfig, connect} from '@wagmi/core';
import {injected} from '@wagmi/connectors';
import {createWalletClient, custom, defineChain} from 'viem';

export const PRODUCT_USDC='0x534b2f3a21130d7a60830c2df862319e593943a3';
const nonzero=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&BigInt(x)!==0n;
export function validateProductConfiguration(configuration,origin=globalThis.location?.origin){
 const reject=()=>{throw Object.assign(Error('PRODUCT_CONFIGURATION_UNVERIFIED'),{code:'PRODUCT_CONFIGURATION_UNVERIFIED'});};
 if(configuration?.verified!==true||!nonzero(configuration.asset)||!nonzero(configuration.escrow))reject();
 const profile=configuration.profile??'monad-testnet';
 if(profile==='local-acceptance'){
  if(typeof origin!=='string'||!/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(origin)||Number(origin.split(':').at(-1))>65535||configuration.chainId!==31337)reject();
 }else if(profile!=='monad-testnet'||configuration.chainId!==10143||configuration.asset.toLowerCase()!==PRODUCT_USDC)reject();
 return Object.freeze({...configuration,profile,asset:configuration.asset.toLowerCase(),escrow:configuration.escrow.toLowerCase()});
}
const chainFor=configuration=>defineChain({id:configuration.chainId,name:configuration.chainId===31337?'MealForward Local Acceptance':'Monad Testnet',nativeCurrency:{name:configuration.chainId===31337?'Ether':'MON',symbol:configuration.chainId===31337?'ETH':'MON',decimals:18},rpcUrls:{default:{http:['/']}}});
const address = x => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);
const fail = code => {throw Error('PRODUCT_WALLET_' + code)};

export function createProductWallet({view = globalThis.window, configuration=null, onChange = () => {}, onDiscovery = () => {}} = {}) {
  let configured=configuration?validateProductConfiguration(configuration,view?.location?.origin):null;
  const policy=()=>{if(!configured)fail('CONFIGURATION_REQUIRED');return validateProductConfiguration(configured,view?.location?.origin);};
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
    const chainId=Number(BigInt(network));if(!Number.isSafeInteger(chainId)||chainId<=0)fail('NETWORK');
    return {account:Array.isArray(accounts)&&address(accounts[0])?accounts[0].toLowerCase():null,chainId};
  }
  async function assertWallet(provider,revision,account) {
    if(!address(account))fail('ACCOUNT');
    const observed=await observe(provider,revision);
    if(observed.account!==account.toLowerCase()||observed.chainId!==policy().chainId)fail('ACCOUNT_OR_NETWORK');
  }
  async function action(account,method,invoke,assertCurrent = () => {}) {
    const chain=chainFor(policy()),provider=current(),revision=generation;
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
    configure(next){if(disposed)fail('DISPOSED');const accepted=validateProductConfiguration(next,view?.location?.origin);const changedTarget=!configured||['profile','chainId','asset','escrow','redemptionAuthority'].some(k=>configured[k]!==accepted[k]);configured=accepted;if(changedTarget)changed();return configured;},
    providers:()=>[...choices].map(([id,{name,rdns}])=>({id,name,rdns})),
    select(id){if(!choices.has(id))fail('SELECT_PROVIDER');selected=id;selection++;generation++;attach(current());onChange()},
    inspect(){return observe(current(),generation)},
    async connect(){
      const chain=chainFor(policy()),provider=current(),selectedRevision=selection;
      const connector=injected({shimDisconnect:false,target:{id:selected,name:choices.get(selected).name,provider}});
      const config=createConfig({chains:[chain],connectors:[connector],transports:{[chain.id]:custom(provider,{retryCount:0})},storage:null,multiInjectedProviderDiscovery:false,ssr:true});
      await connect(config,{connector:config.connectors[0]});
      if(disposed||selection!==selectedRevision||current()!==provider)fail('CONTEXT_CHANGED');
      return observe(provider,generation);
    },
    signMessage(account,message,assertCurrent){
      if(typeof message!=='string'||message.length>8192)fail('MESSAGE');
      return action(account,'personal_sign',client=>client.signMessage({message}),assertCurrent);
    },
    signTypedData(account,typedData,assertCurrent){
      if(!typedData||Number(typedData.domain?.chainId)!==policy().chainId)fail('TYPED_DATA');
      return action(account,'eth_signTypedData_v4',client=>client.signTypedData(typedData),assertCurrent);
    },
    sendTransaction(account,tx,assertCurrent){
      if(!tx||tx.from?.toLowerCase()!==account.toLowerCase()||Number(tx.chainId)!==policy().chainId||!/^0x[0-9a-f]*$/i.test(tx.data||'')||tx.data.length%2!==0||BigInt(tx.value??0)!==0n)fail('TRANSACTION');
      if(!address(tx.to)||![policy().asset,policy().escrow].includes(tx.to.toLowerCase()))fail('TRANSACTION');
      const chain=chainFor(policy());
      const nonce=Number(BigInt(tx.nonce));if(!Number.isSafeInteger(nonce)||nonce<0)fail('TRANSACTION');
      return action(account,'eth_sendTransaction',client=>client.sendTransaction({account,chain,to:tx.to??undefined,data:tx.data,value:0n,nonce}),assertCurrent);
    },
    sendCancellationTransaction(account,tx,assertCurrent){
      if(!tx||Object.keys(tx).sort().join()!=='chainId,data,from,nonce,to,value'||!address(account)||tx.from?.toLowerCase()!==account.toLowerCase()||tx.to?.toLowerCase()!==account.toLowerCase()||Number(tx.chainId)!==policy().chainId||tx.data!=='0x'||tx.value!=='0x0'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(tx.nonce))fail('CANCELLATION_TRANSACTION');
      const nonce=Number(BigInt(tx.nonce));if(!Number.isSafeInteger(nonce)||nonce<0)fail('CANCELLATION_TRANSACTION');
      const chain=chainFor(policy());return action(account,'eth_sendTransaction',client=>client.sendTransaction({account,chain,to:account,data:'0x',value:0n,nonce}),assertCurrent);
    },
    dispose(){disposed=true;generation++;view.removeEventListener('eip6963:announceProvider',announce);attach(null);choices.clear()}
  });
}
