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
import { Interface, keccak256 } from "ethers";
import { POLICY, makeChain, escrowInterface } from "./chain.mjs";
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
let admin, pool, anvil, httpServer, businessFailure;
async function dropDisposableDatabase(connection, name) {
  // Pool shutdown may finish just before PostgreSQL observes socket closure.
  // Never terminate a still-connected client: retry only database-in-use.
  for (let attempt = 0; ; attempt++) {
    try {
      await connection.query(`DROP DATABASE IF EXISTS ${name}`);
      return;
    } catch (error) {
      if (error.code !== "55006" || attempt >= 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
try {
  await root.query(`CREATE DATABASE ${database}`);
  const target = new URL(dbUrl);
  target.pathname = "/" + database;
  admin = new pg.Pool({ connectionString: target.href });
  let migration = readFileSync(
    new URL(
      "../supabase/migrations/20261028140155_mvp_existing_usdc.sql",
      import.meta.url,
    ),
    "utf8",
  );
  if (
    (await root.query("SELECT 1 FROM pg_roles WHERE rolname='mf_mvp_usdc_runtime'"))
      .rowCount
  )
    migration = migration.replace(
      "CREATE ROLE mf_mvp_usdc_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;",
      "",
    );
  await admin.query(migration);
  await admin.query(readFileSync(new URL("../supabase/migrations/20261029090000_mvp_sequential_businesses.sql", import.meta.url), "utf8"));
  pool = new pg.Pool({
    connectionString: target.href,
    options: "-c role=mf_mvp_usdc_runtime",
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
  // Fixture provisioning is outside the six-transaction business flow.
  const tokenArtifact = JSON.parse(readFileSync(new URL("../../mvp-contracts/artifacts/MvpTestToken.json", import.meta.url)));
  const deployment = await local("eth_sendTransaction", [{from: policy.owner, data: tokenArtifact.bytecode + new Interface(tokenArtifact.abi).encodeDeploy([policy.donor]).slice(2)}]);
  await local("anvil_mine", ["0x40"]);
  const tokenReceipt = await local("eth_getTransactionReceipt", [deployment]);
  policy.token = tokenReceipt.contractAddress;
  policy.tokenCodeHash = keccak256(await local("eth_getCode", [policy.token, "latest"]));
  await admin.query("UPDATE mf_mvp_usdc.state SET data=$1::jsonb WHERE id=1", [JSON.stringify({ phase: "TOKEN_READY", token: policy.token })]);
  const rpc = { send: local };
  let time = Math.floor(Date.now() / 1000);
  let service = makeService({
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
  function client(prefix = "") {
    const jar = {};
    let csrf;
    return {
      jar,
      get csrf() {
        return csrf;
      },
      async request(path, body, extra = {}) {
        const response = await fetch(origin + "/v1/mvp" + prefix + path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "sec-fetch-site": "same-origin",
            "x-mvp-usdc-bootstrap": "1",
            ...(csrf ? { "x-mvp-usdc-csrf": csrf } : {}),
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
    (await ownerClient.request("/quote", {}, { "x-mvp-usdc-csrf": "x".repeat(43) }))
      .status,
    401,
  );
  const merchantSession = hash(ownerClient.jar["__Host-mf_mvp_usdc_session"]);
  let maxReceiptCalls = 0;
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
    const beforeReceipt = rpcId;
    const confirmed = await service.reconcile(op.id, wallet);
    maxReceiptCalls = Math.max(maxReceiptCalls, rpcId - beforeReceipt);
    assert.equal(confirmed.state, "CONFIRMED", action);
    return confirmed;
  }
  assert.equal((await ownerClient.request("/setup/token/prepare", {})).status, 404);
  await assert.rejects(service.prepare("token", policy.owner), /INVALID_ACTION/);
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
  const firstService = service;
  const firstState = await firstService.store.read();
  const firstOperations = (await admin.query("SELECT * FROM mf_mvp_usdc.operations WHERE business_id='1' ORDER BY id")).rows;
  await assert.rejects(service.createBusiness(policy.donor), /OWNER_REQUIRED|ROLE_REQUIRED|ROLE_DENIED/);
  const creations = await Promise.all([ownerClient.request("/businesses", {}), ownerClient.request("/businesses", {})]);
  assert.deepEqual(creations.map(r => r.status).sort(), [200, 409], "one concurrent business creation wins");
  const created = creations.find(r => r.status === 200).body;
  assert.equal(created.business.id, "2");
  service = firstService.forBusiness("2");
  await assert.rejects(firstService.createBusiness(policy.owner), /ACTIVE_BUSINESS_EXISTS/);
  assert.equal((await service.store.read()).data.escrow, firstState.data.escrow);
  const draft2 = await service.quote(policy.owner, true);
  assert.notEqual(draft2.typedData.message.quoteId, draft.typedData.message.quoteId);
  const signature2 = await local("eth_signTypedData_v4", [policy.owner, JSON.stringify({ ...draft2.typedData,
    types: { ...draft2.typedData.types, EIP712Domain: signed.types.EIP712Domain } })]);
  await service.signQuote(policy.owner, signature2);
  // Synthetic token fixture has a fixed 7-token supply: recycle the first
  // payout to provision the next donation without deploying another asset.
  await local("eth_sendTransaction", [{ from: policy.owner, to: policy.token,
    data: new Interface(tokenArtifact.abi).encodeFunctionData("transfer", [policy.donor, 7000000n]) }]);
  await local("anvil_mine", ["0x40"]);
  await execute("approve", policy.donor);
  const secondFund = await execute("fund", policy.donor);
  assert.equal((await ownerClient.request("/operations/" + secondFund.id)).status, 404);
  assert.equal((await ownerClient.request("/businesses/1/operations/" + secondFund.id)).status, 404);
  const funded2 = (await service.store.read()).data;
  const chain = makeChain(rpc, policy);
  await assert.rejects(chain.build("issue", { ...funded2, unitSeq: 0 }, "0x" + "a".repeat(64), time), /CANDIDATE_CHANGED/);
  await assert.rejects(chain.build("issue", { ...funded2, quote: firstState.data.quote }, "0x" + "a".repeat(64), time), /BUSINESS_UNIT_MISMATCH/);
  const fundRow = (await admin.query("SELECT * FROM mf_mvp_usdc.operations WHERE id=$1", [secondFund.id])).rows[0];
  const corruptAccounting = makeChain({ send: async (method, params) => {
    if (method === "eth_call" && params[0].data === escrowInterface.encodeFunctionData("getAccounting"))
      return escrowInterface.encodeFunctionResult("getAccounting", [[2n, 14000000n, [2n,0n,0n,0n,0n], [14000000n,0n,0n,0n,0n], 14000000n]]);
    return local(method, params);
  } }, policy);
  await assert.rejects(corruptAccounting.receipt(fundRow, funded2), /ACCOUNTING_MISMATCH/);
  await assert.rejects(service.prepare("issue", policy.donor, merchantSession), /ROLE_REQUIRED|ROLE_DENIED|WRONG_ROLE/);
  await execute("issue", policy.issuer);
  const secondState = await service.store.read();
  assert.equal(secondState.data.unitSeq, 1);
  assert.notEqual(secondState.data.voucherId, firstState.data.voucherId);
  await assert.rejects(service.exchange(invite.token), /INVITE_EXPIRED/);
  const invite2 = await service.invite(policy.issuer);
  const recipient2 = client("/businesses/2");
  await recipient2.ok("/recipient/exchange", { token: invite2.token });
  const legacyRecipient = client();
  Object.assign(legacyRecipient.jar, recipient2.jar);
  assert.equal((await legacyRecipient.request("/recipient/voucher")).status, 401);
  const display2 = await recipient2.ok("/recipient/display", {});
  assert.notEqual((await ownerClient.request("/merchant/check", { code: display2.code })).status, 200);
  assert.notEqual((await ownerClient.request("/businesses/2/merchant/check", { code: "invalid" })).status, 200);
  const checked2 = await ownerClient.ok("/businesses/2/merchant/check", { qrToken: display2.qrToken });
  await execute("redeem", policy.owner, { checkToken: checked2.checkToken });
  await assert.rejects(service.prepare("settle", policy.owner, merchantSession), /SETTLEMENT_WAIT/);
  await local("evm_increaseTime", [180]);
  await local("anvil_mine", ["0x1"]);
  time += 180;
  await execute("settle", policy.owner);
  assert.equal((await service.setup(policy.owner)).state.phase, "SETTLED");
  assert.deepEqual(await firstService.store.read(), firstState, "original state remains immutable across next business");
  assert.deepEqual((await admin.query("SELECT * FROM mf_mvp_usdc.operations WHERE business_id='1' ORDER BY id")).rows,
    firstOperations, "original operation evidence preserved");

  await assert.rejects(
    pool.query("UPDATE mf_mvp_usdc.events SET kind=kind"),
    /permission denied/,
  );
  await assert.rejects(
    pool.query("DELETE FROM mf_mvp_usdc.operations"),
    /permission denied/,
  );
  assert(maxReceiptCalls + 8 * 3 < 80, "receipt RPC budget holds through tenth sequential business");
  console.log(`Receipt RPC maximum observed: ${maxReceiptCalls}; tenth-business upper bound: ${maxReceiptCalls + 8 * 3}`);
  console.log(
    "PASS: two sequential businesses sharing one escrow, preserved first record, isolation + disposable PG + Anvil deployment, quote, approve, fund, issue, private invite/display refresh, merchant redeem, 180s settle, concurrent attempt and immutable audit",
  );
} catch (error) {
  businessFailure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  const clean = async fn => {
    try { await fn(); } catch (error) { cleanupErrors.push(error); }
  };
  if (httpServer) await clean(() => new Promise((resolve, reject) => {
    httpServer.close(error => error ? reject(error) : resolve());
    httpServer.closeIdleConnections();
  }));
  anvil?.kill("SIGTERM");
  await clean(() => pool?.end());
  await clean(() => admin?.end());
  await clean(() => dropDisposableDatabase(root, database));
  await clean(() => root.end());
  if (cleanupErrors.length) {
    if (!businessFailure) throw new AggregateError(cleanupErrors, "Disposable MVP cleanup failed");
    // Preserve the business failure as primary, but never silently swallow cleanup failures.
    console.error("Disposable MVP cleanup also failed:", cleanupErrors.map(error => error.code || error.name).join(", "));
  }
}
