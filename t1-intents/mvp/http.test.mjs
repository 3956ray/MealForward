import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { makeMvpHttp } from "./http.mjs";
import { normalizedRuntime, artifacts } from "./chain.mjs";
const origin = "http://127.0.0.1:18080";
const pool = {
  async query() {
    throw Error("private detail must never escape");
  },
};
async function request(
  app,
  path,
  { method = "GET", headers = {}, body = {} } = {},
) {
  let status, content, receivedHeaders;
  const req = Readable.from(
    method === "POST" ? [Buffer.from(JSON.stringify(body))] : [],
  );
  Object.assign(req, {
    url: "/v1/mvp" + path,
    method,
    headers: {
      host: "127.0.0.1:18080",
      "content-type": "application/json",
      ...headers,
    },
    socket: { remoteAddress: "127.0.0.1" },
  });
  await app.handle(req, {
    writeHead(s, h) {
      status = s;
      receivedHeaders = h;
    },
    end(x) {
      content = JSON.parse(x);
    },
  });
  return { status, content, headers: receivedHeaders };
}
const app = (opts) =>
  makeMvpHttp({
    pool,
    origin,
    pepper: "new-private-test-pepper-at-least32bytes",
    ...opts,
  });
test("default disabled, capabilities sanitized, no-store", async () => {
  const r = await request(app(), "/status");
  assert.equal(r.status, 200);
  assert.equal(r.content.enabled, false);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal((await request(app(), "/setup")).content.error, "MVP_DISABLED");
});
test("exact host and origin denied before storage", async () => {
  assert.equal(
    (
      await request(app({ enabled: true }), "/setup", {
        headers: { host: "evil.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app({ enabled: true }), "/quote", {
        method: "POST",
        headers: { origin: "https://evil.invalid" },
      })
    ).status,
    403,
  );
});
test("write kill and missing session fail closed, recovery still authenticated", async () => {
  const a = app({ enabled: true });
  assert.equal(
    (await request(a, "/quote", { method: "POST", headers: { origin } }))
      .content.error,
    "WRITES_DISABLED",
  );
  assert.equal((await request(a, "/setup")).status, 401);
  assert.equal(
    (
      await request(
        a,
        "/operations/00000000-0000-0000-0000-000000000000/reconcile",
        { method: "POST", headers: { origin } },
      )
    ).status,
    401,
  );
});
test("raw database exceptions not disclosed", async () => {
  const r = await request(app({ enabled: true }), "/setup", {
    headers: { cookie: "__Host-mf_mvp_session=" + "x".repeat(43) },
  });
  assert.equal(r.status, 503);
  assert.deepEqual(r.content, { error: "SERVICE_UNAVAILABLE" });
});
test("runtime normalization changes only compiler-declared immutable slots", () => {
  const a = artifacts.MvpStoreEscrow;
  const normalized = normalizedRuntime(a.deployedBytecode, a);
  const [range] = Object.values(a.immutableReferences).flat();
  let edited =
    a.deployedBytecode.slice(0, 2 + range.start * 2) +
    "f".repeat(range.length * 2) +
    a.deployedBytecode.slice(2 + (range.start + range.length) * 2);
  assert.equal(normalizedRuntime(edited, a), normalized);
  edited = "0x00" + a.deployedBytecode.slice(4);
  assert.notEqual(normalizedRuntime(edited, a), normalized);
});

test("legacy auth defaults and MVP namespace use isolated cookies and headers", async () => {
  const { makePilotHandler } = await import("../auth/core.mjs");
  const store = { async createPre() {} };
  const ns = {
    prefix: "/v1/mvp",
    sessionCookie: "__Host-mf_mvp_session",
    preCookie: "__Host-mf_mvp_pre",
    csrfHeader: "x-mvp-csrf",
    bootstrapHeader: "x-mvp-bootstrap",
  };
  async function pre(namespace, path, header) {
    let result;
    const handler = makePilotHandler({
      store,
      siwe: {},
      origin,
      ...(namespace ? { namespace } : {}),
    });
    const req = Readable.from([Buffer.from("{}")]);
    Object.assign(req, {
      url: path,
      method: "POST",
      headers: {
        host: "127.0.0.1:18080",
        origin,
        "content-type": "application/json",
        [header]: "1",
      },
    });
    await handler(req, {
      writeHead(status, headers) {
        result = { status, headers };
      },
      end() {},
    });
    return result;
  }
  const old = await pre(null, "/v1/auth/pre-session", "x-c1-bootstrap");
  assert.equal(old.status, 200);
  assert.match(old.headers["Set-Cookie"], /^__Host-mcpay_c1_pre=/);
  const isolated = await pre(ns, "/v1/mvp/auth/pre-session", "x-mvp-bootstrap");
  assert.equal(isolated.status, 200);
  assert.match(isolated.headers["Set-Cookie"], /^__Host-mf_mvp_pre=/);
  assert.equal(
    (await pre(ns, "/v1/mvp/auth/pre-session", "x-c1-bootstrap")).status,
    422,
  );
});
