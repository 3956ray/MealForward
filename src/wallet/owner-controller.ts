import { decodeFunctionData, encodeFunctionData, keccak256, stringToHex, type Hex } from 'viem'
import { mealForwardAbi } from '../chain-contract.ts'
import type { Provider, Store } from './controller.ts'

export interface OwnerDeployment {
  mode: string; chainId: number; deploymentId: string; contractAddress: string
  codeHash: string; genesisHash: string; merchant: string; priceWei: string; ownerWalletMode: boolean
}
export interface OwnerIntent {
  operationId: string; from: string; to: string; chainId: number; data: Hex; value: string
  merchant: string; amountWei: string; gasSeparate: boolean; reviewExpiresAt: number; submissionStarted: boolean
}
export interface OwnerView {
  operation: { id: string; action: string; target: string; status: string; txHash?: string | null }
  intent: OwnerIntent
}
export interface OwnerJournal {
  redemptionId: string; intentKey: string; startAttempted: boolean; view?: OwnerView; txHash?: string
}
export interface OwnerApi { request<T>(path: string, body?: Record<string, unknown>): Promise<T> }
export type OwnerLock = <T>(name: string, action: () => Promise<T>) => Promise<T>
export const ownerBrowserLock: OwnerLock = async (name, action) => {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('Browser cross-tab locking unavailable')
  return await navigator.locks.request(name, action)
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const terminal = (value?: OwnerView) => value && ['FINALIZED_SUCCESS', 'FINALIZED_REVERT'].includes(value.operation.status)
const identityPrefix = 'Mealforward owner identity only; no transaction or settlement authorization.\n'

/** Same-origin cookie/CSRF transport. Credentials and proof signatures are never stored. */
export function ownerHttpApi(csrf: () => string): OwnerApi {
  return { async request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path')
    const response = await fetch('/api/v1' + path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Owner API unavailable (${response.status}); retain the original operation`)
    return response.status === 204 ? undefined as T : await response.json() as T
  } }
}

/** A durable send guard and backend DTO cache, not a second settlement state machine. */
export class OwnerWalletController {
  readonly deployment: OwnerDeployment
  readonly provider: Provider
  readonly api: OwnerApi
  readonly store: Store
  readonly storageKey: string
  readonly origin: string
  readonly actorId: string
  account?: string
  verified = false
  reviewed = false
  revocationFailed = false
  private epoch = 0
  private reviewedSnapshot?: string
  private proofExpires = 0
  private revocation: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()
  private attached = false
  private lock: OwnerLock
  private now: () => number
  constructor(options: { deployment: OwnerDeployment; provider: Provider; api: OwnerApi; store: Store;
    origin: string; actorId: string; lock?: OwnerLock; now?: () => number }) {
    if (!options.provider.on || !options.provider.removeListener) throw new Error('EIP1193 account and chain events required')
    this.deployment = options.deployment; this.provider = options.provider; this.api = options.api; this.store = options.store
    this.origin = options.origin; this.actorId = options.actorId; this.lock = options.lock ?? ownerBrowserLock
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    const url = new URL(this.origin)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.origin !== this.origin
        || !['http:', 'https:'].includes(url.protocol)) throw new Error('Loopback origin required')
    const d = this.deployment
    if (d.mode !== 'localchain' || d.chainId !== 31337 || !d.ownerWalletMode) throw new Error('Local owner deployment required')
    this.storageKey = `mealforward.cp16.owner.${encodeURIComponent(this.origin)}.${encodeURIComponent(d.deploymentId)}.${encodeURIComponent(this.actorId)}`
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed() { for (const listener of this.listeners) listener() }
  attach() {
    if (this.attached) return
    this.attached = true
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) this.provider.on?.(event, this.invalidate)
    if (typeof window !== 'undefined') window.addEventListener('storage', this.storageChanged)
  }
  detach() {
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) this.provider.removeListener?.(event, this.invalidate)
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.storageChanged)
    this.attached = false
    this.invalidateReview()
  }
  private storageChanged = (event: StorageEvent) => { if (event.key === this.storageKey) { this.invalidateReview(); this.changed() } }
  invalidateReview = () => { this.epoch++; this.reviewed = false; this.reviewedSnapshot = undefined; this.changed() }
  invalidate = () => {
    this.invalidateReview(); this.account = undefined; this.verified = false; this.proofExpires = 0
    this.revocation = this.revocation.catch(() => {}).then(async () => {
      try { await this.api.request('/work/wallet/logout', {}); this.revocationFailed = false }
      catch { this.revocationFailed = true }
      this.changed()
    })
    this.changed()
  }
  async logout() { this.invalidate(); await this.revocation; if (this.revocationFailed) throw new Error('Proof revocation unconfirmed; reconnect and revoke again') }
  load(): OwnerJournal | undefined {
    const text = this.store.getItem(this.storageKey)
    if (!text) return
    const value = JSON.parse(text) as OwnerJournal
    if (!value || typeof value.redemptionId !== 'string' || typeof value.intentKey !== 'string'
        || typeof value.startAttempted !== 'boolean') throw new Error('Original record unreadable; do not create a replacement')
    if (value.view) this.validateView(value.view)
    return value
  }
  private save(value: OwnerJournal) { this.store.setItem(this.storageKey, JSON.stringify(value)); this.changed(); return value }
  private snapshot(view: OwnerView) {
    const { reviewExpiresAt: _expiry, submissionStarted: _started, ...intent } = view.intent
    return JSON.stringify(intent)
  }
  private validateView(view: OwnerView) {
    const i = view.intent, d = this.deployment
    if (!i || view.operation.action !== 'settle' || view.operation.id !== i.operationId
        || i.chainId !== 31337 || !same(i.from, d.merchant) || !same(i.merchant, d.merchant)
        || !same(i.to, d.contractAddress) || i.value !== '0' || i.amountWei !== d.priceWei || i.gasSeparate !== true
        || !Number.isSafeInteger(i.reviewExpiresAt) || typeof i.submissionStarted !== 'boolean') throw new Error('Settlement intent mismatch')
    const decoded = decodeFunctionData({ abi: mealForwardAbi, data: i.data })
    if (decoded.functionName !== 'settle' || decoded.args[0] !== i.operationId || decoded.args[1] !== view.operation.target
        || encodeFunctionData({ abi: mealForwardAbi, functionName: 'settle', args: [i.operationId as Hex, view.operation.target as Hex] }) !== i.data)
      throw new Error('Settlement calldata mismatch')
  }
  private async guard(epoch: number, account = this.account) {
    const chain = await this.provider.request({ method: 'eth_chainId' })
    const accounts = await this.provider.request({ method: 'eth_accounts' }) as string[]
    const code = await this.provider.request({ method: 'eth_getCode', params: [this.deployment.contractAddress, 'latest'] }) as Hex
    const genesis = await this.provider.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }) as { hash: string }
    if (epoch !== this.epoch) throw new Error('Wallet changed; review again')
    if (BigInt(chain as string) !== 31337n || !account || !accounts[0] || !same(accounts[0], account)
        || !same(account, this.deployment.merchant) || code === '0x' || keccak256(code) !== this.deployment.codeHash || !same(genesis.hash, this.deployment.genesisHash)) {
      this.invalidate(); throw new Error('Bound account, local chain or contract changed')
    }
  }
  async connect() {
    // Only invoked by an explicit click, never by construction, effects or recovery.
    await this.logout()
    const epoch = this.epoch
    const accounts = await this.provider.request({ method: 'eth_requestAccounts' }) as string[]
    await this.guard(epoch, accounts[0]); this.account = accounts[0]; this.changed(); return this.account
  }
  async verifyIdentity() {
    await this.revocation
    if (this.revocationFailed) throw new Error('Previous proof revocation unconfirmed')
    this.invalidateReview(); this.verified = false; this.proofExpires = 0; const epoch = this.epoch
    await this.guard(epoch)
    const challenge = await this.api.request<{ challengeId: string; message: string; address: string; expiresAt: number }>('/work/wallet/challenge', {})
    if (!challenge.message.startsWith(identityPrefix)) throw new Error('Identity-only message required')
    const fields = JSON.parse(challenge.message.slice(identityPrefix.length))
    if (fields.origin !== this.origin || fields.chainId !== 31337 || fields.deploymentId !== this.deployment.deploymentId
        || !same(fields.contract, this.deployment.contractAddress) || !same(fields.address, this.deployment.merchant)
        || fields.actorId !== this.actorId || fields.shopId !== 'shop-local' || fields.challengeId !== challenge.challengeId
        || fields.expiresAt !== challenge.expiresAt || challenge.expiresAt <= this.now() || !same(challenge.address, this.account!))
      throw new Error('Wallet challenge domain mismatch')
    await this.guard(epoch)
    const signature = await this.provider.request({ method: 'personal_sign', params: [stringToHex(challenge.message), this.account] })
    if (epoch !== this.epoch || challenge.expiresAt <= this.now()) throw new Error('Identity review changed')
    if (typeof signature !== 'string' || !/^0x[\da-fA-F]{130}$/.test(signature)) throw new Error('Invalid identity signature')
    const proof = await this.api.request<{ verified: boolean; address: string; expiresAt: number }>('/work/wallet/verify', { challengeId: challenge.challengeId, signature })
    if (epoch !== this.epoch) { await this.logout(); throw new Error('Identity review changed') }
    if (!proof.verified || !same(proof.address, this.account!) || proof.expiresAt <= this.now()) throw new Error('Owner proof unavailable')
    this.verified = true; this.proofExpires = proof.expiresAt; this.changed()
  }
  async review(redemptionId: string) {
    if (!redemptionId.trim() || redemptionId.length > 128) throw new Error('Original payable required')
    this.invalidateReview(); const epoch = this.epoch
    return this.lock(this.storageKey, async () => {
      await this.guard(epoch)
      if (!this.verified || this.proofExpires <= this.now()) throw new Error('Verify owner identity first')
      let journal = this.load()
      if (journal && !terminal(journal.view) && (journal.startAttempted || journal.view?.intent.submissionStarted || journal.redemptionId !== redemptionId))
        throw new Error('Query the original operation only')
      if (!journal || terminal(journal.view)) journal = { redemptionId, intentKey: crypto.randomUUID(), startAttempted: false }
      this.save(journal) // A lost prepare response can be recovered by this exact key.
      const view = await this.api.request<OwnerView>(`/work/payables/${encodeURIComponent(redemptionId)}/settle`, { intentKey: journal.intentKey })
      this.validateView(view)
      this.save({ ...journal, view, startAttempted: journal.startAttempted || view.intent.submissionStarted })
      await this.guard(epoch)
      if (view.operation.status !== 'PREPARED' || view.intent.submissionStarted || view.intent.reviewExpiresAt <= this.now()) throw new Error('Original operation is query-only')
      this.reviewedSnapshot = this.snapshot(view); this.reviewed = true; this.changed(); return this.load()!
    })
  }
  async send() {
    return this.lock(this.storageKey, async () => {
      let journal = this.load()
      if (!journal?.view || journal.startAttempted || journal.view.intent.submissionStarted || !this.reviewed
          || this.reviewedSnapshot !== this.snapshot(journal.view)) throw new Error('Explicit review required; query any started operation')
      const epoch = this.epoch, snapshot = this.reviewedSnapshot
      await this.guard(epoch)
      if (!this.verified || this.proofExpires <= this.now() || journal.view.intent.reviewExpiresAt <= this.now()) throw new Error('Proof or review expired')
      if (JSON.stringify(this.load()) !== JSON.stringify(journal)) throw new Error('Original record changed')
      journal = this.save({ ...journal, startAttempted: true })
      this.reviewed = false; this.reviewedSnapshot = undefined; this.changed()
      try {
        const started = await this.api.request<OwnerView & { maySubmit: boolean }>(`/work/operations/${journal.view!.operation.id}/submission-start`, {})
        this.validateView(started)
        if (this.snapshot(started) !== snapshot) throw new Error('Started intent changed')
        const { maySubmit, ...viewAfterStart } = started
        journal = this.save({ ...journal, view: viewAfterStart })
        if (maySubmit !== true || !started.intent.submissionStarted || started.operation.status !== 'SUBMISSION_UNKNOWN') return journal
        await this.guard(epoch)
        if (started.intent.reviewExpiresAt <= this.now()) return journal
        const i = started.intent
        const hash = await this.provider.request({ method: 'eth_sendTransaction', params: [{ from: i.from, to: i.to, chainId: '0x7a69', data: i.data, value: '0x0' }] })
        if (typeof hash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(hash)) return journal
        journal = this.save({ ...journal, txHash: hash })
        // Association is best effort. The durable known hash is never replaced.
        const view = await this.api.request<OwnerView>(`/work/operations/${i.operationId}/transaction`, { txHash: hash })
        this.validateView(view)
        if (this.snapshot(view) !== snapshot) throw new Error('Original intent changed')
        return this.save({ ...journal, view })
      } catch {
        // Includes 4001, lost start response, disconnect and storage/HTTP failures.
        // The backend status remains authoritative; startAttempted forbids resend.
        return this.load() ?? journal
      }
    })
  }
  async recover() {
    return this.lock(this.storageKey, async () => {
      const journal = this.load()
      if (!journal) throw new Error('No saved original operation')
      const path = journal.view ? `/operations/${journal.view.operation.id}` : `/work/operations/by-intent/settle/${encodeURIComponent(journal.intentKey)}`
      const view = await this.api.request<OwnerView>(path)
      this.validateView(view)
      if (journal.view && this.snapshot(view) !== this.snapshot(journal.view)) throw new Error('Original intent changed')
      this.invalidateReview()
      return this.save({ ...journal, view, startAttempted: journal.startAttempted || view.intent.submissionStarted })
    })
  }
  async associateKnownHash() {
    return this.lock(this.storageKey, async () => {
      const journal = this.load()
      if (!journal?.view || !journal.txHash || !journal.startAttempted) throw new Error('No original known hash')
      const view = await this.api.request<OwnerView>(`/work/operations/${journal.view.operation.id}/transaction`, { txHash: journal.txHash })
      this.validateView(view)
      if (this.snapshot(view) !== this.snapshot(journal.view)) throw new Error('Original intent changed')
      return this.save({ ...journal, view })
    })
  }
}
