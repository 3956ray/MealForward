export const CHAIN = 10143
export const CHAIN_HEX = '0x279f'
export const CONTRACT = '0x724EaB33ff67B06716913Ceb1c03581f4bBA9721'
export const BATCH = '0x49d1be5e541373cf963d09f5d24de2f8a1976597e5d6ee5ddeb5da4f3d56e854'
export const OPERATOR = '0xc23581f5656247057213bfafd279732993728c80'
export const PRICE = '1000000000000000'
export const MAX_FEE = 200_000_000_000n
export const MAX_TIP = 2_000_000_000n
export const GAS_CAP = 250000
export const statuses = ['PREPARED','BROADCAST','INCLUDED_SUCCESS','INCLUDED_REVERT','FINALIZED_SUCCESS','FINALIZED_REVERT','ACCOUNTING_VERIFIED','HALTED','RESTORE_QUARANTINE'] as const
export type Status = typeof statuses[number]
export interface Config { chainId: 10143; contract: string; ruleVersion: string; priceWei: string; testOnly: true; configured: boolean; partnerLabel?: string }
export interface ReceiptFact { status: 0|1; blockNumber: number; blockHash: string; gasFeeWei: string }
export interface Operation { issuanceId: string; operationId: string; batchId: string; voucherId: string; partnerLabel: string; recipientRef: string; status: Status; txHash: string|null; errorCode: string|null; receiptBlock: number|null; receiptBlockHash: string|null; finalizedBlock: number|null; gasFeeWei: string|null; scanThrough: number|null; budgetViolation: boolean; finalizedReceipt: ReceiptFact|null; receiptConflict: ReceiptFact|null }
export interface Intent { chainId: 10143; to: string; data: string; valueWei: '0'; quantity: 1; gasLimitCap: 250000; maxFeePerGasCapWei: string }
export interface Accounting { F: string; A: string; R: string; H: string; S: string; liabilityWei: string; contractBalanceWei: string; totalFundedWei: string; blockNumber: number; blockHash: string }
export interface View { operation: Operation; intent: Intent; accounting: Accounting|null }
export class IssuanceError extends Error { constructor(code: string) { super(code); this.name = 'IssuanceError' } }
function check(ok: unknown): asserts ok { if (!ok) throw new IssuanceError('INVALID_RESPONSE') }
function record(v: unknown, keys: string): Record<string, unknown> { check(v && typeof v === 'object' && !Array.isArray(v)); const r = v as Record<string,unknown>; const expected=keys.split(' '); check(Object.keys(r).length===expected.length && expected.every(k=>Object.hasOwn(r,k))); return r }
function hash(v: unknown): v is string { return typeof v==='string' && /^0x[0-9a-fA-F]{64}$/.test(v) }
function label(v: unknown): v is string { return typeof v==='string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v) }
function decimal(v: unknown): v is string { return typeof v==='string' && /^(0|[1-9][0-9]{0,77})$/.test(v) }
function number(v: unknown): v is number { return typeof v==='number' && Number.isSafeInteger(v) && v>=0 }
function nullable(v: unknown, test: (x:unknown)=>boolean) { return v===null || test(v) }
// Selector of issue(bytes32,bytes32,bytes32[]) = keccak("issue(bytes32,bytes32,bytes32[])")[:4].
const ISSUE_SELECTOR = '0xc532ff9b'
function word(v: string) { return v.slice(2).toLowerCase().padStart(64,'0') }
export function issueData(operationId: string, batchId: string, voucherId: string) {
  return ISSUE_SELECTOR+word(operationId)+word(batchId)+'60'.padStart(64,'0')+'1'.padStart(64,'0')+word(voucherId)
}
export function parseConfig(value: unknown): Config {
  const v=value as Record<string,unknown>
  check(v && typeof v==='object' && !Array.isArray(v))
  const configured=v.configured===true
  check(configured || v.configured===false)
  const c=record(value,'chainId contract ruleVersion priceWei testOnly configured'+(configured?' partnerLabel':''))
  check(c.chainId===CHAIN && c.contract===CONTRACT && hash(c.ruleVersion) && c.priceWei===PRICE && c.testOnly===true)
  if(configured) check(label(c.partnerLabel))
  return c as unknown as Config
}
export function parseView(value: unknown): View {
  const v=record(value,'operation intent accounting')
  const o=record(v.operation,'issuanceId operationId batchId voucherId partnerLabel recipientRef status txHash errorCode receiptBlock receiptBlockHash finalizedBlock gasFeeWei scanThrough budgetViolation finalizedReceipt receiptConflict')
  check(hash(o.issuanceId) && hash(o.operationId) && o.batchId===BATCH && hash(o.voucherId) && label(o.partnerLabel) && label(o.recipientRef) && statuses.includes(o.status as Status))
  check(nullable(o.txHash,hash) && nullable(o.errorCode,x=>typeof x==='string' && /^[A-Z0-9_]{1,80}$/.test(x)) && nullable(o.receiptBlock,number) && nullable(o.receiptBlockHash,hash) && nullable(o.finalizedBlock,number) && nullable(o.gasFeeWei,decimal) && nullable(o.scanThrough,number))
  check(typeof o.budgetViolation==='boolean')
  for(const key of ['finalizedReceipt','receiptConflict']) if(o[key]!==null) { const f=record(o[key],'status blockNumber blockHash gasFeeWei'); check((f.status===0 || f.status===1) && number(f.blockNumber) && hash(f.blockHash) && decimal(f.gasFeeWei)) }
  if(o.status==='PREPARED') check(o.txHash===null)
  else if(!['HALTED','RESTORE_QUARANTINE'].includes(o.status as string)) check(o.txHash!==null)
  const i=record(v.intent,'chainId to data valueWei quantity ruleVersion gasLimitCap maxFeePerGasCapWei')
  check(i.chainId===CHAIN && i.to===CONTRACT && i.data===issueData(o.operationId as string,o.batchId as string,o.voucherId as string) && i.valueWei==='0' && i.quantity===1 && typeof i.ruleVersion==='string' && hash(i.ruleVersion) && i.gasLimitCap===GAS_CAP && decimal(i.maxFeePerGasCapWei) && BigInt(i.maxFeePerGasCapWei)>0n && BigInt(i.maxFeePerGasCapWei)<=MAX_FEE)
  const view=v as unknown as View
  if(v.accounting!==null) {
    const a=record(v.accounting,'F A R H S liabilityWei contractBalanceWei totalFundedWei blockNumber blockHash')
    for(const k of ['F','A','R','H','S','liabilityWei','contractBalanceWei','totalFundedWei']) check(decimal(a[k]))
    check(number(a.blockNumber) && hash(a.blockHash))
    check(BigInt(a.F as string)===BigInt(a.A as string)+BigInt(a.R as string)+BigInt(a.H as string)+BigInt(a.S as string))
  }
  if(o.status==='ACCOUNTING_VERIFIED') { const a=view.accounting; check(a && a.F===PRICE && a.A==='0' && a.R===PRICE && a.H==='0' && a.S==='0' && a.liabilityWei===PRICE && a.totalFundedWei==='2000000000000000' && a.contractBalanceWei===PRICE && o.finalizedBlock!==null && a.blockNumber<=(o.finalizedBlock as number) && o.receiptBlock!==null && a.blockNumber>=(o.receiptBlock as number) && o.txHash!==null && o.receiptBlockHash!==null) }
  return view
}
export function assertOriginal(previous: View, next: View) {
  for(const key of ['issuanceId','operationId','batchId','voucherId','partnerLabel','recipientRef'] as const) check(previous.operation[key]===next.operation[key])
  check(previous.intent.data===next.intent.data)
  check(previous.operation.txHash===null || next.operation.txHash===previous.operation.txHash)
}
