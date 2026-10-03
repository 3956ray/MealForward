import { FundingError, address, CHAIN_HEX } from './contracts.ts'
export interface Provider { request(args:{method:string;params?:unknown[]}):Promise<unknown>; on?(event:string,listener:(...args:unknown[])=>void):void; removeListener?(event:string,listener:(...args:unknown[])=>void):void; isMetaMask?:boolean; providers?:Provider[]; isBraveWallet?:boolean; isCoinbaseWallet?:boolean; isRabby?:boolean }
// A browser may inject several providers. Never fall back to the first wallet.
export function selectMetaMask(injected?: Provider): Provider {
  const candidates=[...new Set(injected?.providers ?? (injected?[injected]:[]))].filter(p=>p.isMetaMask===true && !p.isBraveWallet && !p.isCoinbaseWallet && !p.isRabby)
  if(candidates.length!==1) throw new FundingError(candidates.length?'WALLET_AMBIGUOUS':'METAMASK_NOT_FOUND')
  const selected=candidates[0]
  if(!selected.on || !selected.removeListener) throw new FundingError('WALLET_EVENTS_UNAVAILABLE')
  return selected
}
export function firstAccount(value: unknown): string { if(!Array.isArray(value) || value.length===0 || !address(value[0])) throw new FundingError('WALLET_NOT_CONNECTED'); return value[0] }
export async function walletContext(provider: Provider) { const account=firstAccount(await provider.request({method:'eth_accounts'})); const chain=await provider.request({method:'eth_chainId'}); if(chain!==CHAIN_HEX) throw new FundingError('WRONG_CHAIN'); return account }
