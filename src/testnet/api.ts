import { batchId, contractAddress, type Ledger, type PublicEvent } from './contracts.ts'
const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 78
const hash = (v: unknown) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
const height = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0
const date = (v: unknown) => typeof v === 'string' && v.endsWith('Z') && Number.isFinite(Date.parse(v))
export function parseLedger(input: unknown): Ledger {
  const d = input as Ledger
  if (!d || d.batchId !== batchId || !d.sync || !['SYNCING','HALTED','STALE','UNAVAILABLE','HISTORY_SYNCING','VERIFIED'].includes(d.sync.state)
      || !height(d.sync.scannedThrough) || (d.sync.verifiedThrough !== null && !height(d.sync.verifiedThrough))
      || (d.sync.targetBlock !== null && !height(d.sync.targetBlock))
      || !['HALTED','VERIFIED','STALE','UNAVAILABLE'].includes(d.sync.accountingState) || !['HALTED','COMPLETE','SYNCING'].includes(d.sync.eventsState)
      || (d.sync.lastAttemptAt !== null && !date(d.sync.lastAttemptAt))
      || (d.sync.lastErrorCode !== null && (typeof d.sync.lastErrorCode !== 'string' || !/^[A-Z_]{1,64}$/.test(d.sync.lastErrorCode)))) throw Error('INVALID_DATA')
  if (d.amounts !== null) {
    if (!d.source || d.source.chainId !== 10143 || d.source.contract !== contractAddress || d.source.finality !== 'finalized'
        || !height(d.source.blockNumber) || d.source.blockNumber !== d.sync.verifiedThrough || !hash(d.source.blockHash) || !date(d.source.checkedAt)
        || !['F','A','R','H','S'].every(k => uint(d.amounts![k as keyof typeof d.amounts]))
        || !uint(d.contractBalanceWei) || !uint(d.liabilityWei)) throw Error('INVALID_DATA')
    if (BigInt(d.amounts.F) !== BigInt(d.amounts.A)+BigInt(d.amounts.R)+BigInt(d.amounts.H)+BigInt(d.amounts.S)) throw Error('INVALID_DATA')
  } else if (d.source !== null || d.contractBalanceWei !== null || d.liabilityWei !== null) throw Error('INVALID_DATA')
  if (d.sync.state === 'VERIFIED' && (d.amounts === null || d.sync.accountingState !== 'VERIFIED' || d.sync.eventsState !== 'COMPLETE' || d.sync.verifiedThrough === null || d.sync.scannedThrough < d.sync.verifiedThrough)) throw Error('INVALID_DATA')
  if (d.sync.state === 'HALTED' && d.amounts !== null) throw Error('INVALID_DATA')
  return { batchId, amounts: d.amounts === null ? null : Object.fromEntries(['F','A','R','H','S'].map(k => [k,d.amounts![k as keyof typeof d.amounts]])) as Ledger['amounts'],
    contractBalanceWei: d.contractBalanceWei, liabilityWei: d.liabilityWei,
    source: d.source === null ? null : {chainId:10143,contract:contractAddress,blockNumber:d.source.blockNumber,blockHash:d.source.blockHash,finality:'finalized',checkedAt:d.source.checkedAt},
    sync: {state:d.sync.state,accountingState:d.sync.accountingState,eventsState:d.sync.eventsState,scannedThrough:d.sync.scannedThrough,verifiedThrough:d.sync.verifiedThrough,targetBlock:d.sync.targetBlock,lastAttemptAt:d.sync.lastAttemptAt,lastErrorCode:d.sync.lastErrorCode} }
}
export function mon(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (!uint(value)) throw Error('INVALID_AMOUNT')
  const n=BigInt(value), unit=10n**18n, fraction=(n%unit).toString().padStart(18,'0').replace(/0+$/,'')
  return `${n/unit}${fraction ? '.'+fraction : ''}`
}
export const states: Record<Ledger['sync']['state'], string> = { SYNCING:'正在读取测试网餐账', HALTED:'数据核验冲突，已暂停更新', STALE:'上次已核结果，更新失败', UNAVAILABLE:'暂时无法读取，请稍后刷新', HISTORY_SYNCING:'金额已核验；历史记录同步中', VERIFIED:'本次核验完成' }
async function request(path: string, signal: AbortSignal) {
  const response=await fetch(path,{credentials:'omit',redirect:'error',cache:'no-store',signal})
  if (response.status===429) throw Error('检查过于频繁，请60秒后手动刷新。')
  if (![200,202,503].includes(response.status)) throw Error('暂时无法读取，请稍后刷新。')
  return response.json() as Promise<unknown>
}
export async function loadLedger(signal: AbortSignal, cached=false) {
  return parseLedger(await request(`/api/v1/testnet/batches/${batchId}${cached?'?cached=1':''}`,signal))
}
export async function loadEvents(signal: AbortSignal): Promise<PublicEvent[]> {
  const d=await request(`/api/v1/testnet/batches/${batchId}/events`,signal) as {events?: PublicEvent[]}
  if (!Array.isArray(d.events) || d.events.length>20) throw Error('历史记录暂不可用。')
  return d.events.map(e => {
    if (!['Funded','Issued','Locked','Reported','Settled'].includes(e.kind) || !hash(e.transactionHash) || !hash(e.blockHash)
        || !height(e.blockNumber) || !height(e.logIndex) || (e.amountWei!==null && !uint(e.amountWei)) || e.source!=='CONTROLLED_TEST_CLIENT') throw Error('历史记录暂不可用。')
    return {kind:e.kind,amountWei:e.amountWei,transactionHash:e.transactionHash,blockNumber:e.blockNumber,blockHash:e.blockHash,logIndex:e.logIndex,source:e.source}
  })
}
