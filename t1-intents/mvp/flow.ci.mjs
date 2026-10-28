/** Synthetic ONLY: disposable PG database plus an ephemeral Anvil process; no public RPC. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createServer as createHttpServer } from "node:http";
import { makeLocalMvpHttp } from "./http.mjs";
import { makeService } from "./service.mjs";
import { POLICY } from "./chain.mjs";
import { verifyRuntime, hash } from "./store.mjs";
const connectionString = process.env.MVP_TEST_DATABASE_URL;
assert(
  connectionString,
  "Set MVP_TEST_DATABASE_URL to disposable loopback PostgreSQL only",
);
const dbUrl = new URL(connectionString);
assert(
  ["127.0.0.1", "localhost"].includes(dbUrl.hostname),
  "Loopback PG required",
);
const root = new pg.Pool({ connectionString });
const database = "mvp_test_" + randomUUID().replaceAll("-", "");
let admin, pool, anvil, httpServer;
try {
  await root.query(`CREATE DATABASE ${database}`);
  const target = new URL(dbUrl);
  target.pathname = "/" + database;
  admin = new pg.Pool({ connectionString: target.href });
  let migration = readFileSync(
    new URL(
      "../supabase/migrations/20261028114053_mvp_business_flow.sql",
      import.meta.url,
    ),
    "utf8",
  );
  if (
    (await root.query("SELECT 1 FROM pg_roles WHERE rolname='mf_mvp_runtime'"))
      .rowCount
  )
    migration = migration.replace(
      "CREATE ROLE mf_mvp_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;",
      "",
    );
  await admin.query(migration);
  pool = new pg.Pool({
    connectionString: target.href,
    options: "-c role=mf_mvp_runtime",
  });
  await verifyRuntime(pool);
  const port = await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let rpcId = 0;
  async function local(method, params = []) {
    const r = await fetch(`http://127.0.0.1:${port}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const b = await r.json();
    if (b.error) throw Error(b.error.message);
    return b.result;
  }
  for (let i = 0; i < 100; i++) {
    try {
      await local("eth_chainId");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const accounts = await local("eth_accounts");
  const policy = {
    ...POLICY,
    chainId: 31337,
    owner: accounts[0],
    donor: accounts[1],
    issuer: accounts[2],
  };
  const rpc = { send: local };
  let time = Math.floor(Date.now() / 1000);
  const service = makeService({
    pool,
    rpc,
    policy,
    pepper: "synthetic-pepper-for-disposable-test-only",
    clock: () => time,
  });
  let httpApp;
  httpServer = createHttpServer((req, res) => httpApp.handle(req, res));
  await new Promise((r) => httpServer.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  httpApp = makeLocalMvpHttp({
    pool,
    rpc,
    policy,
    origin,
    pepper: "synthetic-pepper-for-disposable-test-only",
    enabled: true,
    writesEnabled: true,
    clock: () => time,
  });
  function client() {
    const jar = {};
    let csrf;
    return {
      jar,
      get csrf() {
        return csrf;
      },
      async request(path, body, extra = {}) {
        const response = await fetch(origin + "/v1/mvp" + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "x-mvp-bootstrap": "1",
            ...(csrf ? { "x-mvp-csrf": csrf } : {}),
            cookie: Object.entries(jar)
              .map(([k, v]) => k + "=" + v)
              .join("; "),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        for (const item of response.headers.getSetCookie()) {
          const [k, v] = item.split(";")[0].split("=");
          jar[k] = v;
        }
        const result = await response.json();
        if (result.csrf) csrf = result.csrf;
        return { status: response.status, body: result };
      },
      async ok(path, body) {
        const r = await this.request(path, body);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body;
      },
    };
  }
  const ownerClient = client();
  await ownerClient.ok("/auth/pre-session", {});
  const challenge = await ownerClient.ok("/identity/wallet/challenge", {
    address: policy.owner,
  });
  const loginSignature = await local("personal_sign", [
    "0x" + Buffer.from(challenge.message).toString("hex"),
    policy.owner,
  ]);
  await ownerClient.ok("/identity/wallet/login", {
    challengeId: challenge.challengeId,
    signature: loginSignature,
  });
  assert.equal((await ownerClient.ok("/setup")).role, "owner");
  assert.equal(
    (await ownerClient.request("/quote", {}, { "x-mvp-csrf": "x".repeat(43) }))
      .status,
    401,
  );
  const merchantSession = hash(ownerClient.jar["__Host-mf_mvp_session"]);
  async function execute(action, wallet, body = {}) {
    const op = await service.prepare(action, wallet, merchantSession, body);
    const again = await service.prepare(action, wallet, merchantSession, body);
    assert.deepEqual(op, again, "PREPARED stable");
    const results = await Promise.allSettled([
      service.attempt(op.id, wallet),
      service.attempt(op.id, wallet),
    ]);
    assert.equal(
      results.filter((x) => x.status === "fulfilled").length,
      1,
      "single attempt winner",
    );
    assert.equal(
      (await service.operation(op.id, wallet)).transaction,
      undefined,
    );
    const transaction = {
      ...op.transaction,
      gas: action === "escrow" ? "0xf00000" : "0x800000",
    };
    delete transaction.chainId;
    const txHash = await local("eth_sendTransaction", [transaction]);
    await local("anvil_mine", ["0x40"]);
    const unindexed = await service.bind(op.id, wallet, "0x" + "f".repeat(64));
    assert.equal(unindexed.txHash, null);
    await service.bind(op.id, wallet, txHash);
    await assert.rejects(
      service.bind(op.id, wallet, "0x" + "e".repeat(64)),
      /HASH_IMMUTABLE/,
    );
    const confirmed = await service.reconcile(op.id, wallet);
    assert.equal(confirmed.state, "CONFIRMED", action);
    return confirmed;
  }
  await execute("token", policy.owner);
  await execute("escrow", policy.owner);
  const draft = await service.quote(policy.owner, true);
  const signed = {
    ...draft.typedData,
    types: {
      ...draft.typedData.types,
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  };
  const signature = await local("eth_signTypedData_v4", [
    policy.owner,
    JSON.stringify(signed),
  ]);
  await service.signQuote(policy.owner, signature);
  await execute("approve", policy.donor);
  await execute("fund", policy.donor);
  await execute("issue", policy.issuer);
  const lostInvite = await service.invite(policy.issuer);
  const invite = await service.invite(policy.issuer, true);
  await assert.rejects(service.exchange(lostInvite.token), /INVITE_EXPIRED/);
  assert(
    !JSON.stringify(await service.setup(policy.issuer)).includes(invite.token),
  );
  const recipientClient = client();
  await recipientClient.ok("/recipient/exchange", { token: invite.token });
  await assert.rejects(
    service.invite(policy.issuer, true),
    /INVITE_ALREADY_OPENED/,
  );
  const old = await recipientClient.ok("/recipient/display", {});
  const oldCheck = await ownerClient.ok("/merchant/check", { code: old.code });
  const display = await recipientClient.ok("/recipient/display", {});
  assert.equal(
    (await ownerClient.request("/merchant/check", { qrToken: old.qrToken }))
      .body.error,
    "INVALID_DISPLAY",
  );
  assert.equal(
    (
      await ownerClient.request("/merchant/redeem/prepare", {
        checkToken: oldCheck.checkToken,
      })
    ).body.error,
    "CHECK_EXPIRED",
  );
  const checked = await ownerClient.ok("/merchant/check", {
    qrToken: display.qrToken,
  });
  const revisionBefore = (await service.store.read()).revision;
  await recipientClient.ok("/recipient/voucher");
  assert.equal(
    (await service.store.read()).revision,
    revisionBefore,
    "recipient polling does not invalidate business snapshot",
  );
  await execute("redeem", policy.owner, { checkToken: checked.checkToken });
  assert.equal(
    (await recipientClient.request("/recipient/display", {})).body.error,
    "REDEEM_ALREADY_PREPARED",
  );
  await assert.rejects(
    service.prepare("settle", policy.owner, merchantSession),
    /SETTLEMENT_WAIT/,
  );
  await local("evm_increaseTime", [180]);
  await local("anvil_mine", ["0x1"]);
  time += 180;
  await execute("settle", policy.owner);
  assert.equal((await service.setup(policy.owner)).state.phase, "SETTLED");
  await assert.rejects(
    pool.query("UPDATE mf_mvp.events SET kind=kind"),
    /permission denied/,
  );
  await assert.rejects(
    pool.query("DELETE FROM mf_mvp.operations"),
    /permission denied/,
  );
  console.log(
    "PASS: disposable PG + Anvil deployment, quote, approve, fund, issue, private invite/display refresh, merchant redeem, 180s settle, concurrent attempt and immutable audit",
  );
} finally {
  if (httpServer) await new Promise((r) => httpServer.close(r));
  anvil?.kill("SIGTERM");
  await pool?.end();
  await admin?.end();
  await root
    .query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
    .catch(() => {});
  await root.end();
}
