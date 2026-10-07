import {VoucherApiError,parseDisplay,parseSession,type VoucherDisplay,type VoucherSession} from './contracts.ts'
function failure(code:string){return new VoucherApiError(/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'REQUEST_FAILED')}
async function json(response:Response){try{return await response.json() as unknown}catch{throw failure('INVALID_RESPONSE')}}
async function request(path:string,init?:RequestInit){
  let response:Response
  try{response=await fetch('/api/v1/testnet-voucher'+path,{credentials:'same-origin',redirect:'error',cache:'no-store',...init})}catch{throw failure('CONNECTION_UNAVAILABLE')}
  if(!response.ok){const body=await json(response);const code=(body as {code?:unknown})?.code;throw failure(typeof code==='string'?code:'REQUEST_FAILED')}
  return json(response)
}
export async function exchangeVoucher(secret:string):Promise<VoucherSession>{return parseSession(await request('/exchange',{method:'POST',headers:{'Content-Type':'application/json','X-MealForward-Voucher':'1'},body:JSON.stringify({secret})}))}
export async function resumeVoucher():Promise<VoucherSession>{return parseSession(await request('/session'))}
export async function createVoucherDisplay(csrfToken:string):Promise<VoucherDisplay>{return parseDisplay(await request('/display',{method:'POST',headers:{'Content-Type':'application/json','X-MealForward-Voucher':'1','X-CSRF-Token':csrfToken},body:'{}'}))}
export async function logoutVoucher(){try{await fetch('/api/v1/testnet-voucher/logout',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','X-MealForward-Voucher':'1'},body:'{}'})}catch{/* local UI stays logged out */}}
