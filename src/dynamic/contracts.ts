import type { Provider } from '../wallet/controller.ts'

export const dynamicEnvironmentId = '7fe95f70-e5cc-4c3c-beed-a133e81268dc'
export type LoginRole = 'support' | 'partner' | 'owner'
export type InvalidationReason = 'token-changed' | 'subject-changed' | 'account-changed' | 'chain-changed' | 'logout' | 'session-rejected'
export interface WorkSession {
  actorId: string
  role: 'partner' | 'owner'
  partnerId: string | null
  shopId: string | null
  expiresAt: number
  csrfToken: string
}
export interface IdentityView {
  status: 'initializing' | 'signed-out' | 'email-pending' | 'authenticated' | 'error'
  // UI identity only. It never determines work role/scope.
  email?: string
  errorCode?: string
}
export interface DynamicAuthClient {
  getSnapshot(): IdentityView
  subscribe(listener: () => void): () => void
  initialize(): Promise<void>
  startEmail(email: string): Promise<void>
  verifyOtp(code: string): Promise<void>
  logout(): Promise<void>
  getAccessToken(): string | null // memory only, SDK client.token (not legacyToken)
  onInvalidate(listener: (reason: InvalidationReason) => void): () => void
  // Called only by explicit owner wallet UI. Never request connect/sign on initialization.
  getWalletProvider(): Promise<Provider | null>
}
export interface AuthApi {
  exchange(): Promise<WorkSession>
  session(): Promise<WorkSession>
  logout(): Promise<{ serverRevoked: boolean }>
  request<T>(path: string, body?: Record<string, unknown>): Promise<T>
  invalidate(reason: InvalidationReason): void
}
export interface AuthApiOptions {
  client: DynamicAuthClient
  onInvalidate: (reason: InvalidationReason) => void
  fetch?: typeof globalThis.fetch
}
export interface LoginProps {
  role: LoginRole
  client: DynamicAuthClient
  api: AuthApi
  onSession: (session: WorkSession) => void
  onIdentity?: (identity: IdentityView) => void
  onInvalidated: (reason: InvalidationReason) => void
}
