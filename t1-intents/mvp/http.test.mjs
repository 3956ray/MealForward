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
    headers: { cookie: "__Host-mf_mvp_usdc_session=" + "x".repeat(43) },
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
    sessionCookie: "__Host-mf_mvp_usdc_session",
    preCookie: "__Host-mf_mvp_usdc_pre",
    csrfHeader: "x-mvp-usdc-csrf",
    bootstrapHeader: "x-mvp-usdc-bootstrap",
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
  const isolated = await pre(ns, "/v1/mvp/auth/pre-session", "x-mvp-usdc-bootstrap");
  assert.equal(isolated.status, 200);
  assert.match(isolated.headers["Set-Cookie"], /^__Host-mf_mvp_usdc_pre=/);
  assert.equal(
    (await pre(ns, "/v1/mvp/auth/pre-session", "x-c1-bootstrap")).status,
    422,
  );
});

test("removed token route and currency status identify existing USDC", async () => {
  const a = app({enabled:true,writesEnabled:true});
  const s = await request(a, "/status");
  assert.deepEqual(s.content.currency, {address:"0x534b2f3a21130d7a60830c2df862319e593943a3",symbol:"USDC",decimals:6,existing:true});
  assert.equal((await request(a, "/setup/token/prepare", {method:"POST",headers:{origin}})).status,404);
});
test("currency rejects wrong address, runtime, decimals and insufficient funds before building writes", async () => {
  const {makeChain,POLICY,tokenInterface} = await import("./chain.mjs");
  const {keccak256} = await import("ethers");
  let decimals=6n, balance=84500000n;
  const policy={...POLICY,tokenCodeHash:keccak256("0x1234")};
  const chain=makeChain({async send(method,params){
    if(method==="eth_chainId") return "0x279f";
    if(method==="eth_getBlockByNumber") return {number:"0x10"};
    if(method==="eth_getCode") return "0x1234";
    if(method==="eth_call") { const fn=tokenInterface.parseTransaction({data:params[0].data});return tokenInterface.encodeFunctionResult(fn.name,[fn.name==="decimals"?decimals:balance]); }
    throw Error("UNEXPECTED_RPC");
  }},policy);
  await assert.rejects(chain.currency({token:POLICY.owner}),/WRONG_TOKEN/);
  assert.equal((await chain.currency({token:policy.token})).donorBalance,"84500000");
  policy.tokenCodeHash=keccak256("0x12");
  await assert.rejects(chain.currency({token:policy.token}),/TOKEN_CODE_MISMATCH/);
  policy.tokenCodeHash=keccak256("0x1234");decimals=18n;
  await assert.rejects(chain.currency({token:policy.token}),/TOKEN_DECIMALS_MISMATCH/);
  decimals=6n;balance=6999999n;
  await assert.rejects(chain.build("approve",{token:policy.token},"0x",0),/INSUFFICIENT_USDC/);
});

test("business routes preserve auth, write kill, recovery and strict path boundaries", async () => {
  const a = app({ enabled: true });
  assert.equal((await request(a, "/businesses")).status, 401);
  assert.equal((await request(a, "/businesses/2/setup")).status, 401);
  assert.equal((await request(a, "/businesses/2/recipient/voucher")).status, 401);
  assert.equal((await request(a, "/businesses", { method: "POST", headers: { origin } })).content.error, "WRITES_DISABLED");
  assert.equal((await request(a, "/businesses/2/quote", { method: "POST", headers: { origin } })).content.error, "WRITES_DISABLED");
  assert.equal((await request(a, "/businesses/2/operations/00000000-0000-0000-0000-000000000000/reconcile", { method: "POST", headers: { origin } })).status, 401);
  for (const path of ["/businesses/01/setup", "/businesses/0/setup", "/businesses/2/auth/pre-session", "/businesses/2/status", "/businesses/2/me"]) {
    assert.equal((await request(a, path)).status, 404);
  }
});

test("legacy operation URLs cannot access second business even for same wallet", async () => {
  const { POLICY } = await import("./chain.mjs");
  const operation = { id: "00000000-0000-0000-0000-000000000002", business_id: 2, wallet: POLICY.owner, state: "CONFIRMED", action: "settle" };
  const p = { async query(sql, params) {
    if (sql.includes("FROM mf_mvp_usdc.sessions")) return { rows: [{ wallet: POLICY.owner }] };
    if (sql.includes("FROM mf_mvp_usdc.operations")) {
      assert.match(sql, /business_id=\$2/);
      return { rows: params[1] === "2" ? [operation] : [] };
    }
    throw Error("unexpected query");
  } };
  const a = app({ pool: p, enabled: true });
  const headers = { cookie: "__Host-mf_mvp_usdc_session=" + "x".repeat(43) };
  assert.equal((await request(a, `/operations/${operation.id}`, { headers })).status, 404);
  assert.equal((await request(a, `/businesses/1/operations/${operation.id}`, { headers })).status, 404);
  const own = await request(a, `/businesses/2/operations/${operation.id}`, { headers });
  assert.equal(own.status, 200);
  assert.equal(own.content.businessId, "2");
});

test("recipient credentials are bound to business while legacy credentials remain first-only", async () => {
  const { makeService } = await import("./service.mjs");
  let recipient = { expiresAt: 200, invite: "same-hash", csrfHash: "csrf" };
  const p = { async query(sql) {
    if (sql.includes("credentials")) return { rows: [{data: recipient}] };
    if (sql.includes("state")) return { rows: [{revision: "0", data: {invite: "same-hash"}}] };
    throw Error("unexpected query");
  } };
  const service = makeService({ pool: p, rpc: {async send(){throw Error("unexpected RPC");}}, pepper: "test-private-pepper-at-least-32bytes", clock: () => 100 });
  await service.recipient("hash", "csrf");
  await assert.rejects(service.forBusiness("2").recipient("hash", "csrf"), /RECIPIENT_UNAUTHENTICATED/);
  recipient = {...recipient, businessId: "2"};
  await assert.rejects(service.recipient("hash", "csrf"), /RECIPIENT_UNAUTHENTICATED/);
  await service.forBusiness("2").recipient("hash", "csrf");
});

test("business list stops at the contract limit and creation fails before inserting", async () => {
  const { makeService } = await import("./service.mjs");
  const { POLICY } = await import("./chain.mjs");
  const rows = Array.from({length:10}, (_, i) => ({id:i+1, data:{phase:"SETTLED",token:POLICY.token,escrow:POLICY.owner,termsHash:"0x"+"1".repeat(64)}}));
  const c = { async query(sql) {
    if (sql.includes("revision,data")) return {rows:[{revision:"0",data:rows[0].data}]};
    if (sql.includes("SELECT id,data")) return {rows};
    if (sql.includes("SELECT 1 FROM")) return {rows:[],rowCount:0};
    if (sql.includes("INSERT")) throw Error("unexpected insert");
    return {rows:[]};
  },release(){} };
  const s = makeService({pool:{query:c.query,async connect(){return c;}},rpc:{async send(){throw Error("unexpected RPC");}},pepper:"test-private-pepper-at-least-32bytes"});
  const list = await s.businesses(POLICY.owner);
  assert.equal(list.canCreate,false);
  assert.equal(list.disabledReason,"BUSINESS_LIMIT");
  await assert.rejects(s.createBusiness(POLICY.owner),/BUSINESS_LIMIT/);
});
