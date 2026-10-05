import { IssuanceError, parseConfig, parseView, type Config, type View } from './contracts.ts'
export interface IssuanceApi {
  config(): Promise<Config>
  operation(cached?: boolean): Promise<View>
}
export function createIssuanceApi(fetcher: typeof fetch = fetch): IssuanceApi {
  async function request(path: string): Promise<unknown> {
    const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),35000)
    try {
      const response=await fetcher('/api/v1/testnet-issuance/'+path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal})
      if(!response.ok) { let code='REQUEST_FAILED'; try { const data=await response.json(); if(typeof data?.code==='string' && /^[A-Z0-9_]{1,80}$/.test(data.code)) code=data.code } catch { /* Never expose response bodies. */ } throw new IssuanceError(code) }
      return await response.json()
    } catch(error) { if(error instanceof IssuanceError) throw error; throw new IssuanceError('CONNECTION_UNAVAILABLE') }
    finally { clearTimeout(timeout) }
  }
  return {config:async()=>parseConfig(await request('config')),operation:async(cached=false)=>parseView(await request('operation'+(cached?'?cached=1':'')))}
}
