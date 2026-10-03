export const CHAIN = 10143
export const CHAIN_HEX = '0x279f'
export const CONTRACT = '0x724EaB33ff67B06716913Ceb1c03581f4bBA9721'
export const RULE = '0x5281a766c67b94209702620ff559de451e9c0389a4b79ad543c30d7787c13c06'
export const PRICE = '1000000000000000'
export const MAX_FEE = 200_000_000_000n
export const MAX_TIP = 2_000_000_000n
export const statuses = ['PREPARED','SUBMISSION_UNKNOWN','BROADCAST','INCLUDED_SUCCESS','INCLUDED_REVERT','FINALIZED_SUCCESS','FINALIZED_REVERT','ACCOUNTING_VERIFIED','HALTED','RESTORE_QUARANTINE'] as const
export type Status = typeof statuses[number]
export interface Config { chainId: 10143; contract: string; ruleVersion: string; priceWei: string; testOnly: true; configured: boolean }
export interface WalletTransaction { from: string; to: string; chainId: '0x279f'; nonce: string; data: string; value: string; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; type: '0x2' }
export interface ReceiptFact { status: 0|1; blockNumber: number; blockHash: string; gasFeeWei: string }
export interface Operation { budgetViolation: boolean; finalizedReceipt: ReceiptFact|null; receiptConflict: ReceiptFact|null; id: string; intentId: string; batchId: string; payer: string; status: Status; txHash: string|null; errorCode: string|null; submitted: boolean; receiptBlock: number|null; receiptBlockHash: string|null; finalizedBlock: number|null; gasFeeWei: string|null; scanThrough: number|null }
export interface Intent { chainId: 10143; to: string; data: string; valueWei: string; quantity: 1; ruleVersion: string; gasLimitCap: 250000; maxFeePerGasCapWei: string }
export interface Review { id: string; expiresAt: number; transaction: WalletTransaction }
export interface Accounting { F: string; A: string; R: string; H: string; S: string; liabilityWei: string; contractBalanceWei: string; totalFundedWei: string; blockNumber: number; blockHash: string }
export interface View { operation: Operation; intent: Intent; review: Review|null; accounting: Accounting|null }
export interface SubmittedView extends View { transaction: WalletTransaction }
export class FundingError extends Error { constructor(code: string) { super(code); this.name = 'FundingError' } }
function check(ok: unknown): asserts ok { if (!ok) throw new FundingError('INVALID_RESPONSE') }
function record(v: unknown, keys: string): Record<string, unknown> { check(v && typeof v === 'object' && !Array.isArray(v)); const r = v as Record<string,unknown>; const expected=keys.split(' '); check(Object.keys(r).length===expected.length && expected.every(k=>Object.hasOwn(r,k))); return r }
function str(v: unknown): v is string { return typeof v==='string' && v.length>0 && v.length<=256 }
export function address(v: unknown): v is string { return typeof v==='string' && /^0x[0-9a-fA-F]{40}$/.test(v) }
export function hash(v: unknown): v is string { return typeof v==='string' && /^0x[0-9a-fA-F]{64}$/.test(v) }
function decimal(v: unknown): v is string { return typeof v==='string' && /^(0|[1-9][0-9]{0,77})$/.test(v) }
function number(v: unknown): v is number { return typeof v==='number' && Number.isSafeInteger(v) && v>=0 }
function nullable(v: unknown, test: (x:unknown)=>boolean) { return v===null || test(v) }
export function same(a: string, b: string) { return a.toLowerCase()===b.toLowerCase() }
export function fundData(intentId: string) { return '0xa0e5eb41'+intentId.slice(2).toLowerCase()+'1'.padStart(64,'0')+RULE.slice(2) }
export function parseConfig(value: unknown): Config {
  const c=record(value,'chainId contract ruleVersion priceWei testOnly configured')
  check(c.chainId===CHAIN && address(c.contract) && same(c.contract,CONTRACT) && c.ruleVersion===RULE && c.priceWei===PRICE && c.testOnly===true && typeof c.configured==='boolean')
  return c as unknown as Config
}
export function parseTransaction(value: unknown, view: View): WalletTransaction {
  const t=record(value,'from to chainId nonce data value gas maxFeePerGas maxPriorityFeePerGas type')
  check(address(t.from) && same(t.from,view.operation.payer) && address(t.to) && same(t.to,CONTRACT) && t.chainId===CHAIN_HEX && t.type==='0x2')
  for(const k of ['nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas']) check(typeof t[k]==='string' && /^0x(0|[1-9a-f][0-9a-f]{0,63})$/i.test(t[k] as string))
  check(typeof t.data==='string' && same(t.data,view.intent.data))
  const tx=t as unknown as WalletTransaction
  check(BigInt(tx.value)===BigInt(PRICE) && BigInt(tx.gas)>0n && BigInt(tx.gas)<=250000n && BigInt(tx.maxFeePerGas)>0n && BigInt(tx.maxFeePerGas)<=BigInt(view.intent.maxFeePerGasCapWei) && BigInt(tx.maxPriorityFeePerGas)<=MAX_TIP && BigInt(tx.maxPriorityFeePerGas)<=BigInt(tx.maxFeePerGas))
  return tx
}
export function parseView(value: unknown, submitted=false): View|SubmittedView {
  const v=record(value,'operation intent review accounting'+(submitted?' transaction':''))
  const o=record(v.operation,'id intentId batchId payer status txHash errorCode submitted receiptBlock receiptBlockHash finalizedBlock gasFeeWei scanThrough budgetViolation finalizedReceipt receiptConflict')
  check(str(o.id) && hash(o.intentId) && hash(o.batchId) && address(o.payer) && statuses.includes(o.status as Status) && typeof o.submitted==='boolean')
  check(nullable(o.txHash,hash) && nullable(o.errorCode,x=>typeof x==='string' && /^[A-Z0-9_]{1,80}$/.test(x)) && nullable(o.receiptBlock,number) && nullable(o.receiptBlockHash,hash) && nullable(o.finalizedBlock,number) && nullable(o.gasFeeWei,decimal) && nullable(o.scanThrough,number))
  check(typeof o.budgetViolation==='boolean')
  for(const key of ['finalizedReceipt','receiptConflict']) if(o[key]!==null) { const f=record(o[key],'status blockNumber blockHash gasFeeWei'); check((f.status===0 || f.status===1) && number(f.blockNumber) && hash(f.blockHash) && decimal(f.gasFeeWei)) }
  check(o.status!=='PREPARED' || o.submitted===false)
  check(!['SUBMISSION_UNKNOWN','BROADCAST','INCLUDED_SUCCESS','INCLUDED_REVERT','FINALIZED_SUCCESS','FINALIZED_REVERT','ACCOUNTING_VERIFIED'].includes(o.status as string) || o.submitted===true)
  const i=record(v.intent,'chainId to data valueWei quantity ruleVersion gasLimitCap maxFeePerGasCapWei')
  check(i.chainId===CHAIN && address(i.to) && same(i.to,CONTRACT) && i.data===fundData(o.intentId as string) && i.valueWei===PRICE && i.quantity===1 && i.ruleVersion===RULE && i.gasLimitCap===250000 && decimal(i.maxFeePerGasCapWei) && BigInt(i.maxFeePerGasCapWei)>0n && BigInt(i.maxFeePerGasCapWei)<=MAX_FEE)
  const view=v as unknown as View
  if(v.review!==null) { const r=record(v.review,'id expiresAt transaction'); check(str(r.id) && number(r.expiresAt)); parseTransaction(r.transaction,view) }
  if(v.accounting!==null) {
    const a=record(v.accounting,'F A R H S liabilityWei contractBalanceWei totalFundedWei blockNumber blockHash')
    for(const k of ['F','A','R','H','S','liabilityWei','contractBalanceWei','totalFundedWei']) check(decimal(a[k]))
    check(number(a.blockNumber) && hash(a.blockHash))
    check(BigInt(a.F as string)===BigInt(a.A as string)+BigInt(a.R as string)+BigInt(a.H as string)+BigInt(a.S as string))
  }
  if(o.status==='ACCOUNTING_VERIFIED') { const a=view.accounting; check(a && a.F===PRICE && a.A===PRICE && a.R==='0' && a.H==='0' && a.S==='0' && o.finalizedBlock!==null && a.blockNumber<=(o.finalizedBlock as number) && o.receiptBlock!==null && a.blockNumber>=(o.receiptBlock as number) && o.txHash!==null && o.receiptBlockHash!==null) }
  if(submitted) { check(o.submitted===true && o.status==='SUBMISSION_UNKNOWN'); parseTransaction(v.transaction,view) }
  return view
}
export function assertOriginal(previous: View, next: View) {
  check(previous.operation.id===next.operation.id)
  for(const key of ['intentId','batchId','payer'] as const) check(same(previous.operation[key],next.operation[key]))
  for(const key of Object.keys(previous.intent) as (keyof Intent)[]) check(previous.intent[key]===next.intent[key])
  check(!previous.operation.submitted || next.operation.submitted)
  check(previous.operation.txHash===null || next.operation.txHash===previous.operation.txHash)
}
export function assertSameTransaction(a: WalletTransaction,b: WalletTransaction) { for(const key of Object.keys(a) as (keyof WalletTransaction)[]) check(same(a[key],b[key])) }
