export type WorkRole = 'partner'|'owner'
export type WorkSession = {actorId:string; role:WorkRole; csrfToken:string; expiresAt:number}
type Lease = {role:WorkRole; generation:number; closed:boolean; session:WorkSession|null}
const unconfirmed = () => new Error('工作会话清理未确认，已关闭工作登录；请维护者核对后重新打开。')

// One queue for all role mounts. Do not abort a login: its response is needed
// to revoke a session that the server may already have committed.
export class WorkSessions {
  private queue:Promise<unknown> = Promise.resolve()
  private blocked = false
  private fetcher:typeof fetch
  private now:()=>number
  constructor(fetcher:typeof fetch = (input, init)=>fetch(input, init), now:()=>number = Date.now) {
    this.fetcher=fetcher; this.now=now
  }
  open(role:WorkRole):Lease {return {role,generation:0,closed:false,session:null}}
  isBlocked():boolean {return this.blocked}
  private serial<T>(action:()=>Promise<T>):Promise<T> {
    const result=this.queue.then(action)
    this.queue=result.catch(()=>{})
    return result
  }
  private async revoke(lease:Lease) {
    if(!lease.session)return
    const response=await this.fetcher(`/api/cp28/${lease.role}/logout`,{
      method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json','X-CSRF-Token':lease.session.csrfToken},body:'{}'})
    // 401 means this cookie has no usable work authority (expired/revoked).
    if(response.status!==401 && (!response.ok || (await response.json()).loggedOut!==true))throw unconfirmed()
    lease.session=null
  }
  login(lease:Lease, token:string, current:()=>boolean):Promise<WorkSession> {
    const generation=lease.generation
    return this.serial(async()=>{
      if(this.blocked)throw unconfirmed()
      if(lease.closed||lease.generation!==generation||!current())throw new Error('工作身份已变化，请重新登录。')
      let response:Response
      try {
        await this.revoke(lease)
        response=await this.fetcher(`/api/cp28/${lease.role}/login`,{
          method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'})
      } catch {this.blocked=true;throw unconfirmed()}
      if(!response.ok) {
        if(response.status===0||response.status===408||response.status>=500){this.blocked=true;throw unconfirmed()}
        throw new Error('当前身份未获此角色授权，或本轮授权已失效。')
      }
      let session:WorkSession
      try {
        session=await response.json()
        if(session.role!==lease.role||typeof session.actorId!=='string'||
          typeof session.csrfToken!=='string'||!session.csrfToken||
          !Number.isFinite(session.expiresAt))throw unconfirmed()
      } catch {this.blocked=true;throw unconfirmed()}
      lease.session=session
      if(lease.closed||lease.generation!==generation||!current()||session.expiresAt*1000<=this.now()) {
        try {await this.revoke(lease)}catch {this.blocked=true;throw unconfirmed()}
        throw new Error('工作身份已变化，迟到的工作会话已清理。')
      }
      return session
    })
  }
  invalidate(lease:Lease, sdkLogout?:()=>Promise<void>, close=false):Promise<void> {
    lease.generation++
    if(close)lease.closed=true
    // SDK logout disables its local token synchronously, even during initialization.
    let sdk:Promise<Error|null>
    try {sdk = sdkLogout ? sdkLogout().then(()=>null,()=>unconfirmed()) : Promise.resolve(null)}
    catch {sdk = Promise.resolve(unconfirmed())}
    return this.serial(async()=>{
      let failed=false
      try {await this.revoke(lease)}catch {failed=true}
      if(await sdk)failed=true
      if(failed){this.blocked=true;throw unconfirmed()}
    })
  }
}

export const workSessions = new WorkSessions()
