/** CP13 C0: single shared ABI and wallet/local-chain contract. No private keys. */
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToHex, type Address, type Hex } from 'viem'

export const LOCAL_CHAIN_ID = 31337 as const
export const LOCAL_RPC_URL = 'http://127.0.0.1:18545'
export const LOCAL_PRICE_WEI = 1_000_000_000_000_000n
export const LOCAL_FUNDING_CAP_WEI = 100_000_000_000_000_000n
export const LOCAL_MAX_QUANTITY = 20
export const LOCAL_RULE_VERSION = keccak256(stringToHex('mealforward-cp13-local-v1'))
export const LOCAL_ASSET_LABEL = '本地链测试单位'
export const LOCAL_LIMITATIONS = '仅本地链，非 Monad 测试网；无真实供餐。无退款、补券、释锁或收款恢复，测试余额可能永久锁定。'

export const mealForwardAbi = parseAbi([
  'function fund(bytes32 intentId, uint256 quantity, bytes32 ruleVersion) payable returns (bytes32 batchId)',
  'function issue(bytes32 operationId, bytes32 batchId, bytes32[] voucherIds)',
  'function lock(bytes32 operationId, bytes32 voucherId, bytes32 lockId)',
  'function report(bytes32 operationId, bytes32 voucherId, bytes32 lockId)',
  'function settle(bytes32 operationId, bytes32 voucherId)',
  'function setPaused(bool value)',
  'function paused() view returns (bool)',
  'function merchant() view returns (address)',
  'function priceWei() view returns (uint256)',
  'function fundingCapWei() view returns (uint256)',
  'function maxQuantity() view returns (uint256)',
  'function totalFunded() view returns (uint256)',
  'function ruleVersion() view returns (bytes32)',
  'function recoveryEnabled() pure returns (bool)',
  'function fundedBatch(address payer, bytes32 intentId) view returns (bytes32)',
  'function getBatch(bytes32 batchId) view returns (uint256 F, uint256 A, uint256 R, uint256 H, uint256 S, uint256 X, uint256 L)',
  'function getVoucher(bytes32 voucherId) view returns (bytes32 batchId, uint8 status, bytes32 lockId)',
  'function getOperation(uint8 action, bytes32 operationId) view returns (bytes32 payloadHash, bytes32 resultId)',
  'function liability() view returns (uint256)',
  'function unallocated() view returns (uint256)',
  'function grantRole(bytes32 role, address account)',
  'function revokeRole(bytes32 role, address account)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function SUPPORTER_ROLE() view returns (bytes32)',
  'function ISSUER_ROLE() view returns (bytes32)',
  'function OPERATOR_ROLE() view returns (bytes32)',
  'function SETTLER_ROLE() view returns (bytes32)',
  'event Funded(bytes32 indexed batchId, address indexed payer, bytes32 indexed intentId, uint256 amount)',
  'event Issued(bytes32 indexed operationId, bytes32 indexed batchId, bytes32[] voucherIds)',
  'event Locked(bytes32 indexed operationId, bytes32 indexed voucherId, bytes32 lockId)',
  'event Reported(bytes32 indexed operationId, bytes32 indexed voucherId, bytes32 lockId)',
  'event Settled(bytes32 indexed operationId, bytes32 indexed voucherId, address merchant, uint256 amount)',
  'event PauseChanged(bool paused)',
  'error InvalidInput()', 'error InvalidValue()', 'error InvalidRule()',
  'error LimitExceeded()', 'error Paused()', 'error UnknownBatch()',
  'error InvalidVoucherState()', 'error DuplicateId()',
  'error AlreadyProcessed()', 'error IntentConflict()', 'error PaymentFailed()',
  'error LocalChainOnly()',
])

// Voucher 0 NONE, 1 ACTIVE, 2 LOCKED, 3 REPORTED, 4 SETTLED.
// Work action IDs: 1 issue, 2 lock, 3 report, 4 settle. fund uses payer+intent.
export type ChainOperationStatus = 'PREPARED' | 'SUBMISSION_UNKNOWN' | 'BROADCAST'
  | 'INCLUDED_SUCCESS' | 'INCLUDED_REVERT' | 'FINALIZED_SUCCESS' | 'FINALIZED_REVERT' | 'NOT_SUBMITTED'
export type RetryPolicy = 'REVIEW_ONLY' | 'READ_ORIGINAL_ONLY' | 'COMPLETE'
export interface PreparedSupportIntent {
  operationId: Hex
  intentId: Hex
  batchId: Hex
  account: Address
  chainId: typeof LOCAL_CHAIN_ID
  contract: Address
  quantity: number
  ruleVersion: Hex
  data: Hex
  valueWei: string
  quoteExpiresAt: number // Unix milliseconds. UI review only, NOT an on-chain deadline.
}
export interface ChainOperation {
  intent: PreparedSupportIntent
  status: ChainOperationStatus
  retryPolicy: RetryPolicy
  txHash?: Hex
  receiptBlock?: string
  receiptBlockHash?: Hex
  finalizedBlock?: string
  lastCheckedAt?: number
  errorCode?: string
}
export interface LocalDeployment {
  mode: 'localchain'
  chainId: typeof LOCAL_CHAIN_ID
  rpcUrl: string
  contractAddress: Address
  deploymentBlock: string
  codeHash: Hex
  supporter: Address // public test address only; never a key
  merchant: Address
  ruleVersion: Hex
  priceWei: string
  fundingCapWei: string
}

export function assertLocalRpc(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('CP13 requires a loopback HTTP RPC without credentials, query or path')
  }
}

export function prepareSupportIntent(input: {
  account: Address; contract: Address; intentId: Hex; quantity: number; now?: number
}): PreparedSupportIntent {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > LOCAL_MAX_QUANTITY
      || !/^0x[0-9a-fA-F]{64}$/.test(input.intentId) || /^0x0{64}$/.test(input.intentId)) {
    throw new Error('Invalid local support intent')
  }
  const batchId = keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
    [BigInt(LOCAL_CHAIN_ID), input.contract, input.account, input.intentId],
  ))
  return {
    operationId: input.intentId, intentId: input.intentId, batchId,
    account: input.account, chainId: LOCAL_CHAIN_ID, contract: input.contract,
    quantity: input.quantity, ruleVersion: LOCAL_RULE_VERSION,
    data: encodeFunctionData({ abi: mealForwardAbi, functionName: 'fund', args: [input.intentId, BigInt(input.quantity), LOCAL_RULE_VERSION] }),
    valueWei: (BigInt(input.quantity) * LOCAL_PRICE_WEI).toString(),
    quoteExpiresAt: (input.now ?? Date.now()) + 120_000,
  }
}
