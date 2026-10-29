import { AsyncLocalStorage } from "node:async_hooks";
import { boundedExecutionRpc } from "../t1f-execution-rpc.mjs";
import { randomUUID, randomBytes, randomInt } from "node:crypto";
import {
  makeStore,
  hash,
  token,
  codeHash,
  check,
  event as baseEvent,
  putCredential as basePutCredential,
  credential as baseCredential,
  json,
} from "./store.mjs";
import {
  POLICY,
  MEAL,
  AMOUNT,
  makeChain,
  typedQuote,
  verifyQuote,
} from "./chain.mjs";
const prerequisites = {
  escrow: "TOKEN_READY",
  approve: "READY",
  fund: "APPROVED",
  issue: "FUNDED",
  redeem: "ISSUED",
  settle: "HANDED_OVER",
};
export const actionRole = {
  escrow: "owner",
  approve: "donor",
  fund: "donor",
  issue: "issuer",
  redeem: "owner",
  settle: "owner",
};
export const dto = (o) => ({
  id: o.id,
  businessId: String(o.business_id ?? 1),
  action: o.action,
  state: o.state,
  txHash: o.tx_hash,
  candidateHash: o.candidate_hash,
  receipt: o.receipt,
  ...(o.state === "PREPARED" ? { transaction: o.immutable.transaction } : {}),
});
export function makeService({
  pool,
  businessId = "1",
  currencyState = {},
  rpc,
  pepper,
  policy = POLICY,
  clock = () => Math.floor(Date.now() / 1000),
}) {
  check(
    typeof pepper === "string" && Buffer.byteLength(pepper) >= 32,
    "NEW_PEPPER_REQUIRED",
    503,
  );
  const context = new AsyncLocalStorage();
  const store = makeStore(pool, businessId),
    chain = makeChain(
      { send: (...args) => (context.getStore() || rpc).send(...args) },
      policy,
    );
  const event = (c, kind, id = null) => baseEvent(c, kind, id, businessId);
  const putCredential = (c, kind, key, data) => basePutCredential(c, kind, key, { ...data, businessId });
  const credential = async (c, kind, key) => {
    const data = await baseCredential(c, kind, key);
    return data && String(data.businessId ?? "1") === businessId ? data : undefined;
  };
  const summary = row => ({ id: String(row.id), phase: row.data.phase, token: row.data.token, escrow: row.data.escrow, completedCount: row.data.completedCount ?? 0 });
  async function businesses(wallet) {
    check(role(wallet), "ROLE_DENIED", 403);
    const rows = (await pool.query("SELECT id,data FROM mf_mvp_usdc.state ORDER BY id")).rows;
    const complete = rows.length > 0 && rows.every(r => r.data.phase === "SETTLED");
    return { businesses: rows.map(summary), canCreate: role(wallet) === "owner" && complete && rows.length < 10,
      disabledReason: role(wallet) !== "owner" ? "OWNER_REQUIRED" : !complete ? "ACTIVE_BUSINESS_EXISTS" : rows.length >= 10 ? "BUSINESS_LIMIT" : null };
  }
  async function createBusiness(wallet) {
    requireRole(wallet, "owner");
    // Lock the permanent first row to serialize creation across processes.
    const firstStore = makeStore(pool);
    return firstStore.transaction(async (c) => {
      const rows = (await c.query("SELECT id,data FROM mf_mvp_usdc.state ORDER BY id FOR UPDATE")).rows;
      check(rows.length && rows.every(r => r.data.phase === "SETTLED"), "ACTIVE_BUSINESS_EXISTS");
      check(!(await c.query("SELECT 1 FROM mf_mvp_usdc.operations WHERE state IN ('PREPARED','SEND_UNKNOWN','HASH_BOUND') LIMIT 1")).rowCount, "PENDING_OPERATION_EXISTS");
      check(rows.length < 10, "BUSINESS_LIMIT");
      const first = rows[0].data, previous = rows.at(-1);
      check(first.token === policy.token && first.escrow && first.termsHash, "ESCROW_REQUIRED");
      const id = String(Number(previous.id) + 1);
      check(/^[1-9][0-9]{0,8}$/.test(id), "BUSINESS_LIMIT");
      const data = { phase: "READY", token: first.token, escrow: first.escrow, termsHash: first.termsHash, completedCount: rows.length };
      await c.query("INSERT INTO mf_mvp_usdc.state(id,data) VALUES($1,$2::jsonb)", [id, json(data)]);
      await baseEvent(c, "BUSINESS_CREATED", null, id);
      return { business: summary({id,data}) };
    });
  }
  const role = (wallet) =>
    Object.entries({
      owner: policy.owner,
      donor: policy.donor,
      issuer: policy.issuer,
    }).find(([, v]) => v === wallet)?.[0];
  const requireRole = (wallet, want) =>
    check(role(wallet) === want, "ROLE_DENIED", 403);
  const owned = async (id, wallet) => {
    const o = await store.operation(id);
    check(o && o.wallet === wallet, "OPERATION_NOT_FOUND", 404);
    return o;
  };
  async function currencyStatus(state) {
    if (currencyState.cache && Date.now() - currencyState.cache.at < 30000) return currencyState.cache.value;
    if (!currencyState.pending) currencyState.pending = chain.currency(state).then(value => {
      currencyState.cache = { at: Date.now(), value }; return value;
    }).finally(() => { currencyState.pending = null; });
    return currencyState.pending;
  }
  async function setup(wallet) {
    check(role(wallet), "ROLE_DENIED", 403);
    const s = (await store.read()).data;
    const ops = (
      await pool.query(
        "SELECT * FROM mf_mvp_usdc.operations WHERE wallet=$1 AND business_id=$2 ORDER BY nonce",
        [wallet, businessId],
      )
    ).rows;
    let settleEnabled = false,
      chainTime = null;
    if (s.phase === "HANDED_OVER") {
      const block = await chain.send("eth_getBlockByNumber", ["latest", false]);
      chainTime = Number(BigInt(block.timestamp));
      settleEnabled = chainTime >= s.settlementAvailableAt;
    }
    const nextAction =
      Object.keys(prerequisites).find((k) => prerequisites[k] === s.phase) ||
      null;
    return {
      businessId,
      currency: await currencyStatus(s),
      role: role(wallet),
      settleEnabled,
      chainTime,
      state: {
        phase: s.phase,
        token: s.token,
        escrow: s.escrow,
        voucherId: s.voucherId,
        expiresAt: s.expiresAt,
        settlementAvailableAt: s.settlementAvailableAt,
      },
      invitationCreated: !!s.invite,
      invitationOpened: s.invite
        ? !!(await credential(pool, "invite", s.invite))?.opened
        : false,
      quote: s.quote
        ? { verified: !!s.quote.signature, deadline: s.quote.message.deadline }
        : null,
      operations: ops.map(dto),
      nextAction,
      allowedAction:
        nextAction && actionRole[nextAction] === role(wallet)
          ? nextAction
          : null,
      disabledReason: !nextAction
        ? "COMPLETE"
        : actionRole[nextAction] !== role(wallet)
          ? "OTHER_ROLE_REQUIRED"
          : nextAction === "fund" && !s.quote?.signature
            ? "QUOTE_REQUIRED"
            : nextAction === "redeem"
              ? "MERCHANT_CHECK_REQUIRED"
              : nextAction === "settle" && !settleEnabled
                ? "SETTLEMENT_WAIT"
                : null,
    };
  }
  async function prepare(action, wallet, sessionHash, body = {}) {
    check(Object.hasOwn(actionRole, action), "INVALID_ACTION", 422);
    requireRole(wallet, actionRole[action]);
    let existing = await store.action(action);
    if (existing) return dto(existing);
    const snapshot = await store.read(),
      state = snapshot.data;
    check(state.phase === prerequisites[action], "PREREQUISITE_REQUIRED");
    const opId = "0x" + randomBytes(32).toString("hex"),
      id = randomUUID();
    const immutable = await chain.build(action, state, opId, clock());
    return store.transaction(async (c, row) => {
      const prior = (
        await c.query("SELECT * FROM mf_mvp_usdc.operations WHERE action=$1 AND business_id=$2", [
          action, businessId,
        ])
      ).rows[0];
      if (prior) return dto(prior);
      check(row.revision === snapshot.revision, "STALE_STATE");
      if (action === "redeem") {
        const checked = await credential(
          c,
          "check",
          hash(body.checkToken || ""),
        );
        check(
          checked &&
            checked.sessionHash === sessionHash &&
            !checked.used &&
            checked.expiresAt > clock() &&
            checked.display === row.data.display,
          "CHECK_EXPIRED",
        );
        const display = await credential(c, "display", checked.display);
        check(
          display && !display.used && display.expiresAt > clock(),
          "DISPLAY_EXPIRED",
        );
        checked.used = true;
        display.used = true;
        await putCredential(c, "check", hash(body.checkToken), checked);
        await putCredential(c, "display", checked.display, display);
      }
      const inserted = (
        await c.query(
          `INSERT INTO mf_mvp_usdc.operations(id,action,wallet,nonce,immutable,state,business_id) VALUES($1,$2,$3,$4,$5::jsonb,'PREPARED',$6) RETURNING *`,
          [
            id,
            action,
            wallet,
            BigInt(immutable.transaction.nonce).toString(),
            json(immutable),
            businessId,
          ],
        )
      ).rows[0];
      await event(c, "PREPARED", id);
      return dto(inserted);
    });
  }
  async function attempt(id, wallet) {
    const original = await owned(id, wallet);
    check(original.state === "PREPARED", "ALREADY_ATTEMPTED");
    await chain.currency((await store.read()).data, ["approve", "fund"].includes(original.action));
    const pending = await chain.send("eth_getTransactionCount", [
      wallet,
      "pending",
    ]);
    check(BigInt(pending) === BigInt(original.nonce), "WALLET_NONCE_CHANGED");
    return store.transaction(async (c) => {
      const o = (
        await c.query(
          "SELECT * FROM mf_mvp_usdc.operations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      check(o.state === "PREPARED", "ALREADY_ATTEMPTED");
      check(
        !o.immutable.deadline || o.immutable.deadline > clock(),
        "PREPARED_EXPIRED",
      );
      const r = (
        await c.query(
          "UPDATE mf_mvp_usdc.operations SET state='SEND_UNKNOWN' WHERE id=$1 RETURNING *",
          [id],
        )
      ).rows[0];
      await event(c, "SEND_ATTEMPTED", id);
      return { allowed: true, operation: dto(r) };
    });
  }
  async function bind(id, wallet, txHash) {
    check(/^0x[0-9a-fA-F]{64}$/.test(txHash), "INVALID_HASH", 422);
    txHash = txHash.toLowerCase();
    let o = await owned(id, wallet);
    check(o.state !== "PREPARED", "ATTEMPT_REQUIRED");
    await store.transaction(async (c) => {
      const r = (
        await c.query(
          "SELECT * FROM mf_mvp_usdc.operations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      check(!r.tx_hash || r.tx_hash === txHash, "HASH_IMMUTABLE");
      await c.query(
        "UPDATE mf_mvp_usdc.operations SET candidate_hash=$2 WHERE id=$1",
        [id, txHash],
      );
    });
    o = await owned(id, wallet);
    if (o.tx_hash) return dto(o);
    if (!(await chain.identity(o, txHash))) return dto(o);
    return store.transaction(async (c) => {
      const r = (
        await c.query(
          "UPDATE mf_mvp_usdc.operations SET tx_hash=$2,candidate_hash=$2,state='HASH_BOUND' WHERE id=$1 AND state='SEND_UNKNOWN' RETURNING *",
          [id, txHash],
        )
      ).rows[0];
      if (r) await event(c, "HASH_VERIFIED", id);
      return dto(r || (await owned(id, wallet)));
    });
  }
  async function reconcile(id, wallet) {
    let o = await owned(id, wallet);
    if (o.state === "CONFIRMED" || o.state === "REVERTED") return dto(o);
    if (!o.tx_hash && o.candidate_hash) {
      await bind(id, wallet, o.candidate_hash);
      o = await owned(id, wallet);
    }
    if (!o.tx_hash) return dto(o);
    const snapshot = await store.read();
    const result = await chain.receipt(o, snapshot.data);
    if (!result) return dto(o);
    return store.transaction(async (c, row) => {
      const current = (
        await c.query(
          "SELECT * FROM mf_mvp_usdc.operations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (["CONFIRMED", "REVERTED"].includes(current.state))
        return dto(current);
      check(row.revision === snapshot.revision, "STALE_STATE");
      Object.assign(row.data, result.patch);
      const updated = (
        await c.query(
          "UPDATE mf_mvp_usdc.operations SET state=$2,receipt=$3::jsonb WHERE id=$1 RETURNING *",
          [id, result.state, json(result.receipt)],
        )
      ).rows[0];
      await event(c, result.state, id);
      return dto(updated);
    });
  }
  async function quote(wallet, create = false) {
    check(role(wallet), "ROLE_DENIED", 403);
    if (!create) {
      const s = (await store.read()).data;
      return s.quote
        ? {
            typedData: typedQuote(policy, s, s.quote.message),
            verified: !!s.quote.signature,
          }
        : null;
    }
    requireRole(wallet, "owner");
    return store.transaction(async (c, row) => {
      check(["READY", "APPROVED"].includes(row.data.phase), "QUOTE_UNAVAILABLE");
      check(row.data.escrow, "ESCROW_REQUIRED");
      if (
        row.data.quote &&
        Number(row.data.quote.message.deadline) <= clock()
      ) {
        check(
          !(
            await c.query("SELECT 1 FROM mf_mvp_usdc.operations WHERE action='fund' AND business_id=$1", [businessId])
          ).rowCount,
          "FUND_ALREADY_PREPARED",
        );
        row.data.quote = null;
      }
      if (!row.data.quote) {
        const message = {
          quoteId: "0x" + randomBytes(32).toString("hex"),
          payer: policy.donor,
          mealId: policy.mealId,
          currentVersion: "1",
          termsHash: row.data.termsHash,
          quantity: "1",
          unitPrice: AMOUNT.toString(),
          amount: AMOUNT.toString(),
          deadline: String(clock() + 1800),
        };
        row.data.quote = { message };
        await event(c, "QUOTE_DRAFTED");
      }
      return {
        typedData: typedQuote(policy, row.data, row.data.quote.message),
        verified: !!row.data.quote.signature,
      };
    });
  }
  async function signQuote(wallet, signature) {
    requireRole(wallet, "owner");
    check(/^0x[0-9a-fA-F]{130}$/.test(signature), "INVALID_SIGNATURE", 422);
    const snapshot = await store.read(),
      s = snapshot.data;
    check(["READY", "APPROVED"].includes(s.phase), "QUOTE_UNAVAILABLE");
    check(
      s.quote && Number(s.quote.message.deadline) > clock(),
      "QUOTE_EXPIRED",
    );
    check(
      verifyQuote(typedQuote(policy, s, s.quote.message), signature) ===
        policy.owner,
      "QUOTE_SIGNER_MISMATCH",
    );
    return store.transaction(async (c, row) => {
      check(row.revision === snapshot.revision, "STALE_STATE");
      check(
        !row.data.quote.signature || row.data.quote.signature === signature,
        "QUOTE_IMMUTABLE",
      );
      row.data.quote.signature = signature;
      await event(c, "QUOTE_VERIFIED");
      return { verified: true };
    });
  }
  async function invite(wallet, rotate = false) {
    requireRole(wallet, "issuer");
    return store.transaction(async (c, row) => {
      check(
        row.data.phase === "ISSUED" && (!row.data.invite || rotate),
        "INVITE_UNAVAILABLE",
      );
      if (row.data.invite) {
        const previous = await credential(c, "invite", row.data.invite);
        check(previous && !previous.opened, "INVITE_ALREADY_OPENED");
      }
      const raw = token(),
        expiresAt = Math.min(clock() + 259200, row.data.expiresAt);
      check(expiresAt > clock(), "VOUCHER_EXPIRED");
      row.data.invite = hash(raw);
      await putCredential(c, "invite", hash(raw), { expiresAt, opened: false });
      await event(c, "INVITE_CREATED");
      return { token: raw, expiresAt };
    });
  }
  async function exchange(raw) {
    check(typeof raw === "string" && raw.length === 43, "INVALID_INVITE", 422);
    await store.rate("exchange", clock(), 30);
    return store.transaction(async (c, row) => {
      const i = await credential(c, "invite", hash(raw));
      check(
        i &&
          row.data.invite === hash(raw) &&
          i.expiresAt > clock() &&
          row.data.phase === "ISSUED",
        "INVITE_EXPIRED",
        401,
      );
      i.opened = true;
      await putCredential(c, "invite", hash(raw), i);
      const session = token(),
        csrf = token(),
        expiresAt = Math.min(clock() + 28800, i.expiresAt, row.data.expiresAt);
      await putCredential(c, "recipient", hash(session), {
        csrfHash: hash(csrf),
        expiresAt,
        invite: hash(raw),
      });
      return { session, csrf, expiresAt };
    });
  }
  async function recipient(sessionHash, csrfHash = null) {
    const r = await credential(pool, "recipient", sessionHash),
      s = (await store.read()).data;
    check(
      r &&
        r.expiresAt > clock() &&
        r.invite === s.invite &&
        (!csrfHash || r.csrfHash === csrfHash),
      "RECIPIENT_UNAUTHENTICATED",
      401,
    );
    return r;
  }
  async function recipientView(sessionHash) {
    return store.transaction(async (c, row) => {
      const r = await credential(c, "recipient", sessionHash);
      check(
        r && r.expiresAt > clock() && r.invite === row.data.invite,
        "RECIPIENT_UNAUTHENTICATED",
        401,
      );
      const csrf = token();
      r.csrfHash = hash(csrf);
      await putCredential(c, "recipient", sessionHash, r);
      return {
        state: row.data.phase,
        meal: MEAL,
        amount: AMOUNT.toString(),
        expiresAt: row.data.expiresAt,
        settlementAvailableAt: row.data.settlementAvailableAt,
        csrf,
      };
    });
  }
  async function display(sessionHash, csrfHash) {
    return store.transaction(async (c, row) => {
      const r = await credential(c, "recipient", sessionHash);
      check(
        r &&
          r.csrfHash === csrfHash &&
          r.expiresAt > clock() &&
          r.invite === row.data.invite,
        "RECIPIENT_UNAUTHENTICATED",
        401,
      );
      check(
        row.data.phase === "ISSUED" &&
          !(
            await c.query(
              "SELECT 1 FROM mf_mvp_usdc.operations WHERE action='redeem' AND business_id=$1", [businessId],
            )
          ).rowCount,
        "REDEEM_ALREADY_PREPARED",
      );
      const qrToken = token(),
        code = String(randomInt(1000000)).padStart(6, "0"),
        expiresAt = Math.min(clock() + 120, r.expiresAt, row.data.expiresAt);
      check(expiresAt > clock(), "VOUCHER_EXPIRED");
      row.data.display = hash(qrToken);
      await putCredential(c, "display", hash(qrToken), {
        codeHash: codeHash(pepper, code),
        expiresAt,
        used: false,
      });
      await event(c, "DISPLAY_REPLACED");
      return { qrToken, code, expiresAt };
    });
  }
  async function merchantCheck(wallet, sessionHash, body) {
    requireRole(wallet, "owner");
    await store.rate("merchant:" + sessionHash, clock(), 10);
    await store.rate("merchant-global", clock(), 30);
    return store.transaction(async (c, row) => {
      check(
        row.data.phase === "ISSUED" && row.data.display,
        "NO_VALID_DISPLAY",
      );
      const d = await credential(c, "display", row.data.display);
      check(
        d &&
          !d.used &&
          d.expiresAt > clock() &&
          (body.code
            ? codeHash(pepper, body.code) === d.codeHash
            : hash(body.qrToken) === row.data.display),
        "INVALID_DISPLAY",
      );
      const checkToken = token();
      await putCredential(c, "check", hash(checkToken), {
        display: row.data.display,
        sessionHash,
        expiresAt: d.expiresAt,
        used: false,
      });
      return {
        checkToken,
        expiresAt: d.expiresAt,
        meal: MEAL,
        amount: AMOUNT.toString(),
        state: row.data.phase,
      };
    });
  }
  const methods = {
    businesses,
    createBusiness,
    setup,
    prepare,
    attempt,
    bind,
    reconcile,
    quote,
    signQuote,
    invite,
    exchange,
    recipient,
    recipientView,
    display,
    merchantCheck,
    operation: async (id, wallet) => dto(await owned(id, wallet)),
  };
  return {
    store,
    chain,
    policy,
    role,
    forBusiness: id => makeService({ pool, rpc, pepper, policy, clock, currencyState, businessId: id }),
    ...Object.fromEntries(
      Object.entries(methods).map(([name, fn]) => [
        name,
        async (...args) => {
          const bounded = boundedExecutionRpc({ rpc, budgetMs: 45000 });
          try {
            return await context.run(bounded.rpc, () => fn(...args));
          } finally {
            bounded.close();
          }
        },
      ]),
    ),
  };
}
