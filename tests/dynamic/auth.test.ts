import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthApi } from '../../src/dynamic/auth.ts'
import { createDynamicAuthClient } from '../../src/dynamic/client.ts'
import type { DynamicAuthClient, InvalidationReason } from '../../src/dynamic/contracts.ts'

const work = { actorId: 'owner-fixture', role: 'owner', partnerId: null, shopId: 'shop-fixture', expiresAt: Math.floor(Date.now() / 1000) + 600, csrfToken: 'fixture-csrf' }
const response = (body: unknown = work, status = 200) => new Response(JSON.stringify(body), { status })
function fixture(transport: typeof fetch) {
  let token: string | null = 'fixture-token'
  const events = new Set<(reason: InvalidationReason) => void>()
  const invalidated: InvalidationReason[] = []
  const client: DynamicAuthClient = {
    getSnapshot: () => ({ status: 'authenticated' }), subscribe: () => () => {},
    initialize: async () => {}, startEmail: async () => {}, verifyOtp: async () => {},
    logout: async () => { token = null; throw new Error('SDK failure with sensitive diagnostic') },
    getAccessToken: () => token,
    onInvalidate: listener => { events.add(listener); return () => { events.delete(listener) } }, getWalletProvider: async () => null,
  }
  return { api: createAuthApi({ client, fetch: transport, onInvalidate: reason => invalidated.push(reason) }), invalidated,
    change() { token = 'refreshed-fixture'; events.forEach(listener => listener('token-changed')) },
    clearToken() { token = null },
  }
}

test('factory/import is lazy and does not perform network or persistence', () => {
  const client = createDynamicAuthClient()
  assert.equal(client.getAccessToken(), null)
  assert.equal(client.getSnapshot().status, 'initializing')
})
test('exchange/read/write use current Bearer, cookies and write CSRF without retries', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const f = fixture(async (url, init) => { calls.push({ url: String(url), init: init! }); return response() })
  await f.api.exchange()
  await f.api.request('/owner/work')
  await f.api.request('/owner/lock', { code: 'synthetic' })
  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, '/api/v1/auth/dynamic/exchange')
  assert.equal(calls[0].init.body, '{}')
  for (const c of calls) {
    assert.equal(c.init.credentials, 'same-origin')
    assert.equal(c.init.redirect, 'error')
    assert.equal((c.init.headers as Record<string, string>).Authorization, 'Bearer fixture-token')
  }
  assert.equal((calls[2].init.headers as Record<string, string>)['X-CSRF-Token'], 'fixture-csrf')
  f.change()
  await assert.rejects(f.api.request('/owner/work'), /AUTH_REQUIRED/)
  await f.api.exchange()
  assert.equal((calls.at(-1)!.init.headers as Record<string, string>).Authorization, 'Bearer refreshed-fixture')
})
test('rejects absolute, protocol relative, encoded, traversal and auth bypass paths before fetch', async () => {
  let calls = 0
  const f = fixture(async () => { calls++; return response() })
  await f.api.exchange()
  for (const path of ['https://other.test', '//other.test', '/%2f%2fevil', '/x/../logout', '/api/v1/auth/logout', '/auth/logout', '/x\\evil', '/x#fragment']) await assert.rejects(f.api.request(path), /INVALID_API_PATH/)
  assert.equal(calls, 1)
})
test('logout failure locks locally even when SDK logout also fails; no automatic exchange', async () => {
  let calls = 0
  const f = fixture(async () => { if (++calls === 1) return response(); throw new Error('secret body') })
  await f.api.exchange()
  assert.deepEqual(await f.api.logout(), { serverRevoked: false })
  await assert.rejects(f.api.request('/owner/lock', {}), /AUTH_REQUIRED/)
  await assert.rejects(f.api.session(), /AUTH_REQUIRED/)
  assert.equal(calls, 2)
  assert.ok(f.invalidated.includes('logout'))
})
test('logout permits missing bearer and still sends cached CSRF', async () => {
  let headers: Record<string, string> = {}
  const f = fixture(async (_url, init) => { headers = init!.headers as Record<string, string>; return response() })
  await f.api.exchange(); f.clearToken()
  assert.deepEqual(await f.api.logout(), { serverRevoked: true })
  assert.equal(headers.Authorization, undefined)
  assert.equal(headers['X-CSRF-Token'], 'fixture-csrf')
})
test('late exchange cannot restore permissions after logout', async () => {
  let finish: (r: Response) => void = () => {}
  const f = fixture(async url => String(url).endsWith('/exchange') ? new Promise<Response>(resolve => { finish = resolve }) : response({}))
  const pending = f.api.exchange()
  await f.api.logout(); finish(response())
  await assert.rejects(pending, /AUTH_CHANGED/)
  await assert.rejects(f.api.request('/owner/work'), /AUTH_REQUIRED/)
})
test('mutation failure sanitized and attempted only once', async () => {
  let calls = 0
  const f = fixture(async () => ++calls === 1 ? response() : response({ error: { code: 'PRIVATE_BODY token' } }, 403))
  await f.api.exchange()
  await assert.rejects(f.api.request('/owner/lock', {}), /AUTH_REQUEST_FAILED/)
  await assert.rejects(f.api.request('/owner/lock', {}), /AUTH_REQUIRED/)
  assert.equal(calls, 2)
})
test('late read discarded after token invalidation', async () => {
  let finish: (r: Response) => void = () => {}
  const f = fixture(async url => String(url).endsWith('/exchange') ? response() : new Promise<Response>(resolve => { finish = resolve }))
  await f.api.exchange()
  const pending = f.api.request('/owner/work')
  f.change(); finish(response({ private: 'fixture' }))
  await assert.rejects(pending, /AUTH_CHANGED/)
})
test('missing bearer and expired server session never authorize private work', async () => {
  let calls = 0
  const f = fixture(async () => { calls++; return response({ ...work, expiresAt: 1 }) })
  await assert.rejects(f.api.exchange(), /INVALID_SESSION/)
  await assert.rejects(f.api.request('/owner/work'), /AUTH_REQUIRED/)
  f.clearToken()
  await assert.rejects(f.api.exchange(), /AUTH_REQUIRED/)
  assert.equal(calls, 1)
})
test('204 logout confirms server revocation without a JSON body', async () => {
  const f = fixture(async url => String(url).endsWith('/logout') ? new Response(null, { status: 204 }) : response())
  await f.api.exchange()
  assert.deepEqual(await f.api.logout(), { serverRevoked: true })
  await assert.rejects(f.api.request('/owner/work'), /AUTH_REQUIRED/)
})

test('deployment read scope denial clears no work identity but other denials invalidate', async () => {
  const f = fixture(async url => String(url).endsWith('/exchange') ? response() : response({code:'TESTNET_SCOPE_DENIED'},403))
  await f.api.exchange();const before=f.invalidated.length
  await assert.rejects(f.api.request('/work/testnet-context'),/TESTNET_SCOPE_DENIED/)
  assert.equal(f.invalidated.length,before)
  await assert.rejects(f.api.request('/owner/work'),/TESTNET_SCOPE_DENIED/)
  assert.equal(f.invalidated.length,before+1)
})
