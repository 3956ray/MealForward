export type Actor = 'supporter' | 'partner' | 'staff_a' | 'staff_b' | 'settler' | 'admin' | 'recipient'

export interface Operation {
  id: string
  actor: string
  action: string
  intent_key: string
  status: string
  target: string | null
  outcome: string | null
  created_at: number
}

export interface Batch {
  id: string
  price: number
  F: number
  A: number
  R: number
  H: number
  S: number
  X: number
  L: number
  available: number
  rule_version: string
  paused: number
  updated_at: number
}

export interface Shop {
  id: string
  name: string
  partner: string
  meal: string
  hours: string
  contact: string
  address: string
}

export interface Recipient {
  ref: string
  eligible: number
  quota_remaining: number
  channel_verified: number
  rule_version: string
  reason: string
}

export interface PartnerVoucher {
  id: string
  recipient_ref: string
  status: string
  delivery_status: string
  delivery_method: string | null
  delivery_actor: string | null
  delivery_at: number | null
  created_at: number
}

export interface Redemption {
  id: string
  status: string
  delivery_status: string
  lock_actor: string | null
  lock_operation: string | null
  lock_confirmed: number
  handoff_declared: number
  report_operation: string | null
  settlement_operation: string | null
  created_at: number
}

export interface Payable {
  voucher_id: string
  status: string
  report_operation: string | null
  settlement_operation: string | null
  settlement_status: 'SUCCESS' | 'FAILED' | 'UNKNOWN' | null
  created_at: number
}

export interface Issuance {
  operation: Operation
  request: { recipient_ref: string; quantity: number; batch_id: string; quote_price: number; rule_version: string }
  vouchers: PartnerVoucher[]
}
export interface ProcessingGroup {
  id: string
  created_at: number
  items: Array<{ voucher_id: string; status: string; owned: boolean; lock_confirmed: boolean }>
}

export interface Work {
  actor: Actor
  role: string
  operations?: Operation[]
  issuances?: Issuance[]
  groups?: ProcessingGroup[]
  recipients?: Recipient[]
  vouchers?: PartnerVoucher[]
  redemptions?: Redemption[]
  payables?: Payable[]
  cases?: Array<Record<string, unknown>>
  destination?: string
  can_settle?: boolean
  pause?: { paused: boolean; reason: string; scope: string; old_balances_retained: boolean }
}

export interface State {
  brand: { name: string; english: string; slogan: string }
  shop: Shop
  batch: Batch
  events: Array<{ kind: string; amount: number; source: string; created_at: number }>
  paused: boolean
  simulation: string
  work: Work | null
}

export interface VoucherView {
  id: string
  shop: string
  meal: string
  hours: string
  status: string
  delivery_status: string
  code: string | null
  code_expires: number | null
  cases: Array<{ id: string; kind: string; stage: string; created_at: number }>
  note: string
}

export interface ActionResult {
  message: string
  operation?: Operation
  issuance?: Issuance
  voucher?: { id: string; secret: string }
  check?: { voucher_id: string; meal: string; shop: string; status: string; code: string }
  case?: { id: string; stage: string }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, token: string | null, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal,
    })
  } catch {
    throw new ApiError(0, 'OFFLINE', '无法连接本机模拟服务。请先启动 Python API（127.0.0.1:8765），再刷新。')
  }
  let data: Record<string, unknown>
  try {
    data = await response.json() as Record<string, unknown>
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', '本机模拟服务未返回有效 JSON。请检查 API 是否已启动。')
  }
  if (!response.ok) {
    throw new ApiError(response.status, String(data.code ?? 'API_ERROR'), String(data.error ?? '请求未完成。'))
  }
  return data as T
}

export function intentKey(): string {
  return `ui_${crypto.randomUUID().replaceAll('-', '')}`
}
