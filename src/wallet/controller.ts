import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem'
import { assertLocalRpc, LOCAL_CHAIN_ID, LOCAL_PRICE_WEI, LOCAL_RULE_VERSION, mealForwardAbi, prepareSupportIntent, type ChainOperation, type LocalDeployment } from '../chain-contract.ts'

export interface Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, callback: (...args: unknown[]) => void): void
  removeListener?(event: string, callback: (...args: unknown[]) => void): void
}
export interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const STORAGE_KEY = 'mealforward.cp13.original-operation.v1'
const zero = `0x${'0'.repeat(64)}`
export function rpcProvider(url: string): Provider {
  assertLocalRpc(url)
  return { async request({ method, params = [] }) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) })
    const result = await response.json()
    if (!response.ok || result.error) throw new Error(result.error?.message ?? 'RPC unavailable')
    return result.result
  } }
}
export class WalletController {
  deployment: LocalDeployment
  provider: Provider
  rpc: Provider
  store: Store
  account?: Address
  reviewed = false
  private reviewedIntentId?: Hex
  constructor(deployment: LocalDeployment, provider: Provider, store: Store, rpc = rpcProvider(deployment.rpcUrl)) {
    this.deployment = deployment; this.provider = provider; this.store = store; this.rpc = rpc
  }
  load(): ChainOperation | undefined {
    const raw = this.store.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as ChainOperation : undefined
  }
  save(operation: ChainOperation) { this.store.setItem(STORAGE_KEY, JSON.stringify(operation)); return operation }
  invalidate = () => { this.reviewed = false; this.account = undefined }
  async guard(checkWallet = false) {
    const d = this.deployment
    assertLocalRpc(d.rpcUrl)
    if (d.mode !== 'localchain' || d.chainId !== LOCAL_CHAIN_ID || d.ruleVersion !== LOCAL_RULE_VERSION || d.priceWei !== LOCAL_PRICE_WEI.toString()) throw new Error('Invalid local deployment')
    if (BigInt(await this.rpc.request({ method: 'eth_chainId' }) as string) !== BigInt(LOCAL_CHAIN_ID)) throw new Error('Wrong RPC chain')
    const code = await this.rpc.request({ method: 'eth_getCode', params: [d.contractAddress, 'latest'] }) as Hex
    if (code === '0x' || keccak256(code) !== d.codeHash) throw new Error('Contract code mismatch')
    if (checkWallet && BigInt(await this.provider.request({ method: 'eth_chainId' }) as string) !== BigInt(LOCAL_CHAIN_ID)) throw new Error('Wrong wallet chain; explicitly switch first')
  }
  async connect() {
    await this.guard()
    const accounts = await this.provider.request({ method: 'eth_requestAccounts' }) as Address[]
    this.account = accounts[0]; this.reviewed = false
    if (!this.account) throw new Error('No account')
    return this.account
  }
  async switchChain() {
    await this.guard()
    await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(LOCAL_CHAIN_ID) }] })
    this.invalidate()
  }
  async review(quantity: number) { return this.exclusive(() => this.reviewOriginal(quantity)) }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (typeof window !== 'undefined') {
      if (!navigator.locks) throw new Error('Browser storage locking unavailable')
      return navigator.locks.request(STORAGE_KEY, action)
    }
    return action()
  }
  private async reviewOriginal(quantity: number) {
    this.reviewed = false
    await this.guard(true)
    const accounts = await this.provider.request({ method: 'eth_accounts' }) as Address[]
    if (!this.account || accounts[0]?.toLowerCase() !== this.account.toLowerCase()) throw new Error('Account changed; connect again')
    const previous = this.load()
    if (previous && !['PREPARED', 'NOT_SUBMITTED', 'FINALIZED_SUCCESS', 'FINALIZED_REVERT'].includes(previous.status)) throw new Error('Resolve original operation first')
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const intentId = `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}` as Hex
    const intent = prepareSupportIntent({ account: this.account, contract: this.deployment.contractAddress, intentId, quantity })
    const operation = this.save({ intent, status: 'PREPARED', retryPolicy: 'REVIEW_ONLY' })
    this.reviewed = true
    this.reviewedIntentId = intent.intentId
    return operation
  }
  async send() { return this.exclusive(() => this.sendOriginal()) }
  private async sendOriginal() {
    const operation = this.load()
    if (!operation || operation.status !== 'PREPARED' || !this.reviewed || this.reviewedIntentId !== operation.intent.intentId) throw new Error('Review required')
    await this.guard(true)
    const accounts = await this.provider.request({ method: 'eth_accounts' }) as Address[]
    if (!this.reviewed || accounts[0]?.toLowerCase() !== operation.intent.account.toLowerCase() || Date.now() >= operation.intent.quoteExpiresAt) { this.reviewed = false; throw new Error('Account or quote changed; review again') }
    // Re-read after asynchronous checks. Another tab may already have submitted this intent.
    if (JSON.stringify(this.load()) !== JSON.stringify(operation)) throw new Error('Original operation changed')
    this.reviewed = false
    this.save({ ...operation, status: 'SUBMISSION_UNKNOWN', retryPolicy: 'READ_ORIGINAL_ONLY' })
    try {
      const hash = await this.provider.request({ method: 'eth_sendTransaction', params: [{ from: operation.intent.account, to: operation.intent.contract, data: operation.intent.data, value: toHex(BigInt(operation.intent.valueWei)) }] }) as Hex
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Missing transaction hash')
      return this.save({ ...operation, txHash: hash, status: 'BROADCAST', retryPolicy: 'READ_ORIGINAL_ONLY' })
    } catch (error) {
      const rejected = (error as { code?: number }).code === 4001
      return this.save({ ...operation, status: rejected ? 'NOT_SUBMITTED' : 'SUBMISSION_UNKNOWN', retryPolicy: rejected ? 'REVIEW_ONLY' : 'READ_ORIGINAL_ONLY', errorCode: rejected ? 'USER_REJECTED' : 'RESPONSE_UNKNOWN' })
    }
  }
  async recover() { return this.exclusive(() => this.recoverOriginal()) }
  private async recoverOriginal() {
    await this.guard()
    let operation = this.load()
    if (!operation) throw new Error('No original operation')
    const i = operation.intent
    if (i.chainId !== LOCAL_CHAIN_ID || i.contract.toLowerCase() !== this.deployment.contractAddress.toLowerCase()) throw new Error('Original deployment differs; retain original record')
    if (!operation.txHash) {
      const data = encodeFunctionData({ abi: mealForwardAbi, functionName: 'fundedBatch', args: [i.account, i.intentId] })
      const raw = await this.rpc.request({ method: 'eth_call', params: [{ to: i.contract, data }, 'latest'] }) as Hex
      const batch = decodeFunctionResult({ abi: mealForwardAbi, functionName: 'fundedBatch', data: raw })
      if (batch === zero) return operation // Absence is never proof of no submission.
      if (batch !== i.batchId) throw new Error('Original batch mismatch')
      const logs = await this.rpc.request({ method: 'eth_getLogs', params: [{ address: i.contract, fromBlock: toHex(BigInt(this.deployment.deploymentBlock)), toBlock: 'latest' }] }) as Array<{ data: Hex; topics: [Hex, ...Hex[]]; transactionHash: Hex }>
      const matched = logs.find(log => this.matches(log, operation!))
      if (!matched) throw new Error('Funded mapping without matching event')
      operation = { ...operation, txHash: matched.transactionHash, status: 'BROADCAST', retryPolicy: 'READ_ORIGINAL_ONLY' }
    }
    const receipt = await this.rpc.request({ method: 'eth_getTransactionReceipt', params: [operation.txHash] }) as null | { status: Hex; blockNumber: Hex; blockHash: Hex; logs: Array<{ address: Address; data: Hex; topics: [Hex, ...Hex[]] }> }
    if (!receipt) return this.save({ ...operation, status: 'BROADCAST', retryPolicy: 'READ_ORIGINAL_ONLY' })
    const success = BigInt(receipt.status) === 1n
    if (success && !receipt.logs.some(log => log.address.toLowerCase() === i.contract.toLowerCase() && this.matches(log, operation!))) throw new Error('Receipt lacks original Funded event')
    operation = this.save({ ...operation, status: success ? 'INCLUDED_SUCCESS' : 'INCLUDED_REVERT', retryPolicy: 'READ_ORIGINAL_ONLY', receiptBlock: BigInt(receipt.blockNumber).toString(), receiptBlockHash: receipt.blockHash, lastCheckedAt: Date.now() })
    const canonical = await this.rpc.request({ method: 'eth_getBlockByNumber', params: [receipt.blockNumber, false] }) as { hash: Hex } | null
    if (canonical?.hash !== receipt.blockHash) return this.save({ ...operation, status: 'SUBMISSION_UNKNOWN', errorCode: 'CANONICAL_MISMATCH' })
    const finalized = await this.rpc.request({ method: 'eth_getBlockByNumber', params: ['finalized', false] }) as { number: Hex } | null
    if (finalized && BigInt(finalized.number) >= BigInt(receipt.blockNumber)) operation = this.save({ ...operation, status: success ? 'FINALIZED_SUCCESS' : 'FINALIZED_REVERT', retryPolicy: 'COMPLETE', finalizedBlock: BigInt(finalized.number).toString() })
    return operation
  }
  matches(log: { data: Hex; topics: [Hex, ...Hex[]] }, operation: ChainOperation) {
    try {
      const event = decodeEventLog({ abi: mealForwardAbi, eventName: 'Funded', ...log })
      return event.args.batchId === operation.intent.batchId && event.args.intentId === operation.intent.intentId && event.args.payer.toLowerCase() === operation.intent.account.toLowerCase() && event.args.amount === BigInt(operation.intent.valueWei)
    } catch { return false }
  }
}
