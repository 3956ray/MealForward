import type { AuthApi, AuthApiOptions, InvalidationReason, WorkSession } from './contracts.ts'

const error = (code: string) => Object.assign(new Error(code), { code })
export function createAuthApi({ client, onInvalidate, fetch: transport = globalThis.fetch }: AuthApiOptions): AuthApi {
  let current: WorkSession | null = null
  let csrf: string | null = null
  let epoch = 0
  let loggedOut = false
  const invalidate = (reason: InvalidationReason) => {
    current = null
    epoch++
    onInvalidate(reason)
  }
  client.onInvalidate(invalidate)
  const pathFor = (path: string) => {
    // No URL parser normalization, escapes, fragments or traversal may redirect credentials.
    if (!/^\/[A-Za-z0-9/_?=&.-]+$/.test(path) || path.startsWith('//') || path.includes('..') || path.startsWith('/api/')) throw error('INVALID_API_PATH')
    return `/api/v1${path}`
  }
  const call = async <T,>(path: string, body?: Record<string, unknown>, logout = false): Promise<T> => {
    const url = pathFor(path)
    const token = client.getAccessToken()
    if (!logout && (loggedOut || !token)) throw error('AUTH_REQUIRED')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token && !logout) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      if (csrf) headers['X-CSRF-Token'] = csrf
    }
    let response: Response
    try {
      response = await transport(url, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store' })
    } catch { throw error('NETWORK_UNCONFIRMED') }
    if (logout && response.status === 204) return undefined as T
    let data: unknown
    try { data = await response.json() } catch { throw error('INVALID_API_RESPONSE') }
    if (!response.ok) {
      const candidate = (data as { error?: { code?: unknown }; code?: unknown })?.error?.code ?? (data as { code?: unknown })?.code
      const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate) ? candidate : 'AUTH_REQUEST_FAILED'
      const scopedTestnetDenial = response.status === 403 && code === 'TESTNET_SCOPE_DENIED' && (path === '/work/testnet-context' || path.startsWith('/work/testnet-voucher'))
      if (response.status === 401 || (response.status === 403 && !scopedTestnetDenial)) invalidate('session-rejected')
      throw error(code)
    }
    return data as T
  }
  const establish = async (exchange: boolean) => {
    if (exchange) { loggedOut = false; invalidate('session-rejected') }
    const version = epoch
    try {
      const result = await call<WorkSession>(exchange ? '/auth/dynamic/exchange' : '/auth/session', exchange ? {} : undefined)
      if (version !== epoch || loggedOut) throw error('AUTH_CHANGED')
      if (!result || !['owner', 'partner'].includes(result.role) || typeof result.actorId !== 'string' || typeof result.csrfToken !== 'string' || !result.csrfToken || !Number.isFinite(result.expiresAt) || result.expiresAt * 1000 <= Date.now()) throw error('INVALID_SESSION')
      current = result
      csrf = result.csrfToken
      return result
    } catch (failure) { invalidate('session-rejected'); throw failure }
  }
  return {
    exchange: () => establish(true), session: () => establish(false), invalidate,
    async request<T>(path: string, body?: Record<string, unknown>) {
      pathFor(path)
      if (path.startsWith('/auth/')) throw error('INVALID_API_PATH')
      if (!current || loggedOut || current.expiresAt * 1000 <= Date.now()) throw error('AUTH_REQUIRED')
      const version = epoch
      const result = await call<T>(path, body)
      if (version !== epoch) throw error('AUTH_CHANGED')
      return result
    },
    async logout() {
      loggedOut = true
      invalidate('logout')
      let serverRevoked = false
      try { await call('/auth/logout', {}, true); serverRevoked = true } catch { /* Local access remains disabled. */ }
      finally {
        csrf = null
        try { await client.logout() } catch { /* SDK failure must never restore local access. */ }
      }
      return { serverRevoked }
    },
  }
}
