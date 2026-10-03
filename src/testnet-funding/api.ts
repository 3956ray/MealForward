import { FundingError, parseConfig, parseView, type Config, type View, type SubmittedView } from './contracts.ts'
export interface FundingApi {
  config(): Promise<Config>; operation(): Promise<View>; session(): Promise<View>
  review(account: string): Promise<View>; submitStart(reviewId: string): Promise<SubmittedView>
  transaction(txHash: string): Promise<View>; reconcile(): Promise<View>
}
export function createFundingApi(fetcher: typeof fetch = fetch): FundingApi {
  async function request(path: string, body?: object): Promise<unknown> {
    const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),35000)
    try {
      const response=await fetcher('/api/v1/testnet-funding/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal,...(body?{headers:{'Content-Type':'application/json','X-CP21-Request':'1'},body:JSON.stringify(body)}:{})})
      if(!response.ok) { let code='REQUEST_FAILED'; try { const data=await response.json(); if(typeof data?.code==='string' && /^[A-Z0-9_]{1,80}$/.test(data.code)) code=data.code } catch { /* Never expose response bodies. */ } throw new FundingError(code) }
      return await response.json()
    } catch(error) { if(error instanceof FundingError) throw error; throw new FundingError('CONNECTION_UNAVAILABLE') }
    finally { clearTimeout(timeout) }
  }
  const view=async(path: string,body?:object)=>parseView(await request(path,body)) as View
  return {config:async()=>parseConfig(await request('config')),operation:()=>view('operation'),session:()=>view('session',{}),review:account=>view('review',{account,chainId:10143}),submitStart:async reviewId=>parseView(await request('submit-start',{reviewId}),true) as SubmittedView,transaction:txHash=>view('transaction',{txHash}),reconcile:()=>view('reconcile',{})}
}
