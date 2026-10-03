import type { DynamicClient, DynamicCoreConfig } from '@dynamic-labs-sdk/client'
import { dynamicEnvironmentId, type DynamicAuthClient, type IdentityView, type InvalidationReason } from './contracts.ts'
import type { Provider } from '../wallet/controller.ts'

type Sdk = typeof import('@dynamic-labs-sdk/client')
const failure = (code: string) => Object.assign(new Error(code), { code })

export function createDynamicAuthClient(): DynamicAuthClient {
  let sdk: Sdk | undefined
  let raw: DynamicClient | undefined
  let initializing: Promise<void> | undefined
  let stopSdkEvents: (() => void)[] = []
  let snapshot: IdentityView = { status: 'initializing' }
  let otp: Awaited<ReturnType<Sdk['sendEmailOTP']>> | undefined
  let disabled = false
  let allowToken = false
  let generation = 0
  let busy = false
  let previousToken: string | null = null
  let previousSubject: string | undefined
  let removeDiscovery: (() => void) | undefined
  const providerCache = new WeakMap<object, Provider>()
  const memory = new Map<string, string>()
  const listeners = new Set<() => void>()
  const invalidators = new Set<(reason: InvalidationReason) => void>()
  const invalidate = (reason: InvalidationReason) => { for (const listener of invalidators) listener(reason) }
  const publish = (next: IdentityView) => { snapshot = next; for (const listener of listeners) listener() }
  const assertMemoryAuth = () => {
    const security = raw?.projectSettings?.security
    if (security?.auth?.storage?.some(value => String(value).toLowerCase() === 'cookie') || security?.externalAuth?.cookieName) throw failure('COOKIE_AUTH_UNSUPPORTED')
  }
  const complete = () => {
    const scopes = raw?.user?.scope?.split(/\s+/) ?? []
    return !!raw?.token && scopes.includes('user:basic') && !scopes.some(scope => /requires|pending|device|step.?up/i.test(scope))
  }
  const sync = () => {
    if (raw?.token !== previousToken) { previousToken = raw?.token ?? null; invalidate('token-changed') }
    if (raw?.user?.id !== previousSubject) { previousSubject = raw?.user?.id; invalidate('subject-changed') }
    if (disabled) return
    if (allowToken && complete()) publish({ status: 'authenticated', email: raw?.user?.email ?? undefined })
    else if (allowToken && (raw?.token || raw?.user)) publish({ status: 'error', errorCode: 'ADDITIONAL_AUTH_REQUIRED' })
    else publish({ status: otp ? 'email-pending' : 'signed-out', email: otp?.email })
  }
  const initialize = () => initializing ??= (async () => {
    try {
      sdk = await import('@dynamic-labs-sdk/client')
      const noop = () => {}
      // Drop all SDK log arguments and broadcast payloads; credentials stay in memory.
      const logger: NonNullable<DynamicCoreConfig['logger']> = {
        debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false,
        on: (() => logger) as unknown as NonNullable<DynamicCoreConfig['logger']>['on'],
        off: (() => logger) as unknown as NonNullable<DynamicCoreConfig['logger']>['off'],
      }
      raw = sdk.createDynamicClient({ environmentId: dynamicEnvironmentId, autoInitialize: false, instrumentation: { enabled: false }, coreConfig: {
        logger,
        // Vendor cookies must not provide a persistence path around the memory adapter.
        fetch: (input, init) => globalThis.fetch(input, { ...init, credentials: 'omit', redirect: 'error' }),
        storageAdapter: {
          getItem: async (key, { storageTier }) => memory.get(`${storageTier}:${key}`) ?? null,
          setItem: async (key, value, { storageTier }) => { if (!disabled) memory.set(`${storageTier}:${key}`, value) },
          removeItem: async (key, { storageTier }) => { memory.delete(`${storageTier}:${key}`) },
        },
        crossTabBroadcast: { on: noop, off: noop, send: noop },
      } })
      stopSdkEvents = [
        sdk.onEvent({ event: 'tokenChanged', listener: sync }, raw),
        sdk.onEvent({ event: 'userChanged', listener: sync }, raw),
      ]
      await sdk.initializeClient(raw)
      assertMemoryAuth()
      sync()
    } catch {
      stopSdkEvents.forEach(stop => stop()); stopSdkEvents = []
      initializing = undefined
      raw = undefined
      memory.clear()
      publish({ status: 'error', errorCode: 'SDK_INITIALIZATION_FAILED' })
      throw failure('SDK_INITIALIZATION_FAILED')
    }
  })()
  const run = async (action: () => Promise<void>) => {
    if (busy) throw failure('AUTH_BUSY')
    busy = true
    try { await action() } finally { busy = false }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    onInvalidate: listener => { invalidators.add(listener); return () => { invalidators.delete(listener) } },
    initialize,
    getAccessToken: () => disabled || !allowToken || !complete() ? null : raw?.token ?? null,
    startEmail: email => run(async () => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw failure('INVALID_EMAIL')
      await initialize()
      assertMemoryAuth()
      disabled = false
      allowToken = false
      const version = ++generation
      otp = undefined
      invalidate('subject-changed')
      try {
        const result = await sdk!.sendEmailOTP({ email }, raw)
        if (version !== generation) throw failure('AUTH_CHANGED')
        otp = result
        publish({ status: 'email-pending', email })
      } catch { if (version === generation) publish({ status: 'error', errorCode: 'EMAIL_SEND_FAILED' }); throw failure('EMAIL_SEND_FAILED') }
    }),
    verifyOtp: code => run(async () => {
      if (!otp || !/^\d{4,10}$/.test(code)) throw failure('INVALID_OTP')
      assertMemoryAuth()
      const version = generation
      try {
        await sdk!.verifyOTP({ otpVerification: otp, verificationToken: code }, raw)
        if (version !== generation || disabled) throw failure('AUTH_CHANGED')
        otp = undefined
        allowToken = true
        sync()
        if (!complete()) throw failure('ADDITIONAL_AUTH_REQUIRED')
      } catch {
        if (version === generation && !disabled) publish({ status: otp ? 'email-pending' : 'error', email: otp?.email, errorCode: otp ? 'OTP_REJECTED' : 'ADDITIONAL_AUTH_REQUIRED' })
        throw failure(otp ? 'OTP_REJECTED' : 'ADDITIONAL_AUTH_REQUIRED')
      }
    }),
    async logout() {
      disabled = true
      allowToken = false
      generation++
      otp = undefined
      memory.clear()
      invalidate('logout')
      publish({ status: 'signed-out' })
      try { if (sdk && raw) await sdk.logout(raw) } catch { throw failure('SDK_LOGOUT_UNCONFIRMED') }
      finally { memory.clear() }
    },
    async getWalletProvider() {
      await initialize()
      if (disabled || !allowToken || !complete()) throw failure('AUTH_REQUIRED')
      const { addEIP6963Extension } = await import('@dynamic-labs-sdk/evm/eip6963')
      const { getWalletProviders } = await import('@dynamic-labs-sdk/client/core')
      removeDiscovery ??= addEIP6963Extension(raw!)
      const providers = getWalletProviders(raw!).filter(p => p.chain === 'EVM' && 'request' in p)
      if (providers.length > 1) throw failure('WALLET_SELECTION_REQUIRED')
      const selected = providers[0] as (typeof providers[number] & { request: (args: { method: string; params: unknown[] }) => Promise<unknown> }) | undefined
      if (!selected) return null
      const cached = providerCache.get(selected)
      if (cached) return cached
      selected.events?.on('accountsChanged', () => invalidate('account-changed'))
      selected.events?.on('networkChanged', () => invalidate('chain-changed'))
      selected.events?.on('disconnected', () => invalidate('account-changed'))
      const provider: Provider = { request: args => {
        if (disabled || !allowToken || !complete()) return Promise.reject(failure('AUTH_REQUIRED'))
        return selected.request({ ...args, params: args.params ?? [] })
      } }
      providerCache.set(selected, provider)
      return provider
    },
  }
}
