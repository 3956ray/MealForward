export const batchId = '0xd1ee3460e4a128a2ab297da62c9c3ee2878f55c4801a163afd06aab42529d1e5'
export const contractAddress = '0x724EaB33ff67B06716913Ceb1c03581f4bBA9721'
export const merchant = '0x25E9c5a3FBEBa88b7DD38689489D7EdfC4afb12F'
export const ledgerRoute = `#/testnet/b/${batchId}`
export type SyncState = 'SYNCING' | 'HALTED' | 'STALE' | 'UNAVAILABLE' | 'HISTORY_SYNCING' | 'VERIFIED'
export interface Ledger {
  batchId: string
  amounts: Record<'F' | 'A' | 'R' | 'H' | 'S', string> | null
  contractBalanceWei: string | null
  liabilityWei: string | null
  source: { chainId: 10143; contract: string; blockNumber: number; blockHash: string; finality: 'finalized'; checkedAt: string } | null
  sync: { state: SyncState; accountingState: string; eventsState: string; scannedThrough: number; verifiedThrough: number | null; targetBlock: number | null; lastAttemptAt: string | null; lastErrorCode: string | null }
}
export interface PublicEvent { kind: string; amountWei: string | null; transactionHash: string; blockNumber: number; blockHash: string; logIndex: number; source: 'CONTROLLED_TEST_CLIENT' }
