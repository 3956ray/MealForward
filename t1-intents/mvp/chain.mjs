import { readFileSync } from "node:fs";
import {
  Interface,
  AbiCoder,
  keccak256,
  toUtf8Bytes,
  getCreateAddress,
  TypedDataEncoder,
  verifyTypedData,
} from "ethers";
import { check } from "./store.mjs";
export const artifacts = Object.fromEntries(
  ["MvpStoreEscrow"].map((n) => [
    n,
    JSON.parse(
      readFileSync(
        new URL(`../../mvp-contracts/artifacts/${n}.json`, import.meta.url),
      ),
    ),
  ]),
);
export const tokenInterface = new Interface(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "event Transfer(address indexed from,address indexed to,uint256 value)", "event Approval(address indexed owner,address indexed spender,uint256 value)"]),
  escrowInterface = new Interface(artifacts.MvpStoreEscrow.abi);
export const AMOUNT = 7000000n;
const digest = (x) => keccak256(toUtf8Bytes(x));
export const POLICY = Object.freeze({
  chainId: 10143,
  token: "0x534b2f3a21130d7a60830c2df862319e593943a3",
  tokenCodeHash: "0x96215e6049ed615cdc22fea7701e85458a8e51a2df3e7d45e8f9fa1d521b5a78",
  owner: "0xc4f8a468f10d5f98dcff3282516125e97f26433b",
  donor: "0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952",
  issuer: "0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3",
  storeId: digest("mealforward.mvp.single-store.v1"),
  mealId: digest("mealforward.mvp.single-meal.v1"),
});
export const MEAL = "单份测试餐 / Test meal";
export const terms = (p) => ({
  mealId: p.mealId,
  version: 1n,
  unitPrice: AMOUNT,
  bodyDigest: digest("mealforward.mvp.test-meal.description.v1"),
  imageDigest: digest("mealforward.mvp.test-meal.image.v1"),
  windowCount: 1,
  startMinute0: 0,
  endMinute0: 1440,
  startMinute1: 0,
  endMinute1: 0,
});
export const quoteTypes = {
  FundingQuote: [
    ["quoteId", "bytes32"],
    ["payer", "address"],
    ["mealId", "bytes32"],
    ["currentVersion", "uint256"],
    ["termsHash", "bytes32"],
    ["quantity", "uint256"],
    ["unitPrice", "uint256"],
    ["amount", "uint256"],
    ["deadline", "uint256"],
  ].map(([name, type]) => ({ name, type })),
};
export const typedQuote = (p, state, message) => ({
  domain: {
    name: "MealForward C0 Funding",
    version: "1",
    chainId: p.chainId,
    verifyingContract: state.escrow,
  },
  types: quoteTypes,
  primaryType: "FundingQuote",
  message,
});
export const verifyQuote = (typed, signature) =>
  verifyTypedData(
    typed.domain,
    typed.types,
    typed.message,
    signature,
  ).toLowerCase();
export const hex = (x) => "0x" + BigInt(x).toString(16);
const lower = (x) => (typeof x === "string" ? x.toLowerCase() : x);
const eq = (a, b) => lower(a) === lower(b);
export function normalizedRuntime(code, artifact) {
  let out = code.slice(2).toLowerCase().split("");
  for (const refs of Object.values(artifact.immutableReferences))
    for (const { start, length } of refs)
      out.splice(start * 2, length * 2, ..."0".repeat(length * 2));
  return out.join("");
}
export function makeChain(rpc, policy = POLICY) {
  async function send(method, params = []) {
    check(
      [
        "eth_chainId",
        "eth_getTransactionCount",
        "eth_getBlockByNumber",
        "eth_getCode",
        "eth_call",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
      ].includes(method),
      "RPC_METHOD_DENIED",
    );
    return rpc.send(method, params);
  }
  async function network() {
    check(
      BigInt(await send("eth_chainId")) === BigInt(policy.chainId),
      "WRONG_CHAIN",
    );
  }
  async function call(
    address,
    name,
    args = [],
    block = "latest",
    token = false,
  ) {
    const iface = token ? tokenInterface : escrowInterface;
    const result = await send("eth_call", [
      { to: address, data: iface.encodeFunctionData(name, args) },
      block,
    ]);
    const decoded = iface.decodeFunctionResult(name, result);
    return decoded.length === 1 ? decoded[0] : decoded;
  }
  async function simulate(tx) {
    await send("eth_call", [
      {
        from: tx.from,
        ...(tx.to ? { to: tx.to } : {}),
        data: tx.data,
        value: "0x0",
      },
      "latest",
    ]);
  }
  async function currency(state, requireFunds = false) {
    check(eq(state.token, policy.token), "WRONG_TOKEN");
    await network();
    const block = await send("eth_getBlockByNumber", ["finalized", false]);
    check(block?.number, "FINALIZED_BLOCK_REQUIRED");
    const code = await send("eth_getCode", [policy.token, block.number]);
    check(code !== "0x" && eq(keccak256(code), policy.tokenCodeHash), "TOKEN_CODE_MISMATCH");
    check(await call(policy.token, "decimals", [], block.number, true) === 6n, "TOKEN_DECIMALS_MISMATCH");
    const balance = await call(policy.token, "balanceOf", [policy.donor], block.number, true);
    if (requireFunds) check(balance >= AMOUNT, "INSUFFICIENT_USDC");
    return { address: policy.token, symbol: "USDC", decimals: 6, existing: true,
      donorBalance: balance.toString(), sufficientFunds: balance >= AMOUNT,
      observedAt: Math.floor(Date.now() / 1000) };
  }
  const completed = (state) => {
    const count = state.completedCount ?? 0;
    check(Number.isInteger(count) && count >= 0 && count < 10, "INVALID_COMPLETED_COUNT");
    return BigInt(count);
  };
  const batchIdFor = (state) => keccak256(AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "bytes32"],
    [policy.chainId, state.escrow, state.quote.message.quoteId],
  ));
  async function ownedUnit(state, seq, block = "latest") {
    const unit = await call(state.escrow, "getUnit", [seq], block);
    const batchId = batchIdFor(state);
    const batch = await call(state.escrow, "getBatch", [batchId], block);
    const used = await call(state.escrow, "quoteUses", [state.quote.message.quoteId], block);
    check(eq(unit.batchId, batchId) && eq(used.batchId, batchId) &&
      (!state.batchId || eq(state.batchId, batchId)) &&
      eq(unit.payer, policy.donor) && eq(batch.payer, policy.donor) &&
      eq(unit.mealId, policy.mealId) && eq(batch.mealId, policy.mealId) &&
      eq(unit.termsHash, state.termsHash) && eq(batch.termsHash, state.termsHash) &&
      unit.version === 1n && batch.version === 1n && unit.localIndex === 0n &&
      unit.unitPrice === AMOUNT && batch.unitPrice === AMOUNT &&
      batch.quantity === 1n && batch.firstUnit === BigInt(seq) && batch.refundedMask === 0n,
      "BUSINESS_UNIT_MISMATCH");
    return unit;
  }
  async function build(action, state, id, now) {
    await network();
    let from = policy.owner,
      to,
      data,
      deadline, unitSeq, generation, batchId;
    await currency(state, ["approve", "fund"].includes(action));
    if (action === "escrow") {
      check(state.token, "TOKEN_REQUIRED");
      data =
        artifacts.MvpStoreEscrow.bytecode +
        escrowInterface
          .encodeDeploy([
            state.token,
            policy.storeId,
            policy.owner,
            policy.owner,
            {
              catalog: policy.owner,
              issuer: policy.issuer,
              operator: policy.owner,
            },
            [{ terms: terms(policy), current: true }],
          ])
          .slice(2);
    } else if (action === "approve") {
      from = policy.donor;
      to = state.token;
      data = tokenInterface.encodeFunctionData("approve", [
        state.escrow,
        AMOUNT,
      ]);
    } else if (action === "fund") {
      from = policy.donor;
      to = state.escrow;
      check(
        state.quote?.signature && Number(state.quote.message.deadline) > now,
        "QUOTE_REQUIRED",
      );
      data = escrowInterface.encodeFunctionData("fund", [
        state.quote.message,
        state.quote.signature,
      ]);
      deadline = Number(state.quote.message.deadline);
    } else if (action === "issue") {
      from = policy.issuer;
      to = state.escrow;
      const c = await call(to, "nextCandidate", [policy.mealId]);
      check(
        c.available &&
          c.unitSeq === completed(state) &&
          (state.unitSeq === undefined || c.unitSeq === BigInt(state.unitSeq)) &&
          !c.needsExpiry &&
          eq(c.termsHash, state.termsHash),
        "CANDIDATE_CHANGED",
      );
      const unit = await ownedUnit(state, c.unitSeq);
      check(unit.bucket === 0n && unit.generation + 1n === c.nextGeneration, "CANDIDATE_CHANGED");
      unitSeq = Number(c.unitSeq);
      generation = Number(c.nextGeneration);
      batchId = unit.batchId;
      deadline = now + 1800;
      data = escrowInterface.encodeFunctionData("issue", [
        id,
        policy.mealId,
        unitSeq,
        generation,
        state.termsHash,
        deadline,
      ]);
    } else if (action === "redeem") {
      to = state.escrow;
      deadline = Math.min(now + 1800, state.expiresAt);
      check(deadline > now, "VOUCHER_EXPIRED");
      data = escrowInterface.encodeFunctionData("redeem", [
        id,
        state.voucherId,
        state.generation ?? 1,
        deadline,
      ]);
    } else if (action === "settle") {
      to = state.escrow;
      const block = await send("eth_getBlockByNumber", ["latest", false]);
      check(
        Number(BigInt(block.timestamp)) >= state.settlementAvailableAt,
        "SETTLEMENT_WAIT",
      );
      data = escrowInterface.encodeFunctionData("settle", [
        id,
        state.voucherId,
        state.generation ?? 1,
      ]);
    } else check(false, "INVALID_ACTION", 422);
    const nonce = await send("eth_getTransactionCount", [from, "pending"]);
    const transaction = {
      from,
      ...(to ? { to } : {}),
      data,
      value: "0x0",
      nonce,
      chainId: hex(policy.chainId),
    };
    await simulate(transaction);
    return { transaction, deadline, opId: id, ...(unitSeq !== undefined ? { unitSeq, generation, batchId } : {}) };
  }
  async function identity(op, txHash) {
    await network();
    const tx = await send("eth_getTransactionByHash", [txHash]);
    if (!tx) return false;
    const t = op.immutable.transaction;
    check(
      eq(tx.hash, txHash) &&
        eq(tx.from, t.from) &&
        eq(tx.to || null, t.to || null) &&
        BigInt(tx.nonce) === BigInt(t.nonce) &&
        BigInt(tx.value) === 0n &&
        eq(tx.input || tx.data, t.data) &&
        BigInt(tx.chainId) === BigInt(policy.chainId),
      "TRANSACTION_MISMATCH",
    );
    return true;
  }
  async function receipt(op, state) {
    check(op.tx_hash, "HASH_REQUIRED");
    check(await identity(op, op.tx_hash), "TRANSACTION_UNAVAILABLE");
    const r = await send("eth_getTransactionReceipt", [op.tx_hash]);
    if (!r) return null;
    check(eq(r.transactionHash, op.tx_hash), "RECEIPT_MISMATCH");
    const finalized = await send("eth_getBlockByNumber", ["finalized", false]);
    if (!finalized || BigInt(finalized.number) < BigInt(r.blockNumber))
      return null;
    const canonical = await send("eth_getBlockByNumber", [
      r.blockNumber,
      false,
    ]);
    check(
      canonical && eq(canonical.hash, r.blockHash),
      "RECEIPT_NOT_CANONICAL",
    );
    const evidence = {
      blockNumber: r.blockNumber,
      blockHash: r.blockHash,
      txHash: op.tx_hash,
    };
    if (BigInt(r.status) === 0n)
      return { state: "REVERTED", receipt: evidence, patch: {} };
    check(BigInt(r.status) === 1n, "INVALID_RECEIPT_STATUS");
    const block = r.blockNumber;
    const action = op.action;
    let patch = {};
    const logs = (address, iface, name) =>
      r.logs
        .filter((l) => eq(l.address, address))
        .flatMap((l) => {
          try {
            const e = iface.parseLog(l);
            return e?.name === name ? [e.args] : [];
          } catch {
            return [];
          }
        });
    const one = (address, iface, name) => {
      const list = logs(address, iface, name);
      check(list.length === 1, "EXPECTED_EVENT_MISSING");
      return list[0];
    };
    if (action === "escrow") {
      const address = getCreateAddress({
        from: op.wallet,
        nonce: op.nonce,
      }).toLowerCase();
      check(eq(r.contractAddress, address), "CREATION_ADDRESS_MISMATCH");
      const a =
        artifacts.MvpStoreEscrow;
      const code = await send("eth_getCode", [address, block]);
      check(
        code.length === a.deployedBytecode.length &&
          normalizedRuntime(code, a) ===
            normalizedRuntime(a.deployedBytecode, a),
        "RUNTIME_MISMATCH",
      );
      {
        for (const [getter, value] of Object.entries({
          asset: state.token,
          storeId: policy.storeId,
          owner: policy.owner,
          receiver: policy.owner,
          quoteAuthority: policy.owner,
          catalogAuthority: policy.owner,
          issuerAuthority: policy.issuer,
          operatorAuthority: policy.owner,
        }))
          check(
            eq(await call(address, getter, [], block), value),
            "DEPLOYMENT_GETTER_MISMATCH",
          );
        check(
          (await call(address, "SETTLEMENT_DELAY", [], block)) === 180n &&
            (await call(address, "VOUCHER_LIFETIME", [], block)) === 259200n &&
            (await call(address, "currentVersion", [policy.mealId], block)) ===
              1n &&
            (await call(address, "listed", [policy.mealId], block)),
          "CATALOG_MISMATCH",
        );
        patch = {
          escrow: address,
          termsHash: await call(
            address,
            "computeTermsHash",
            [terms(policy)],
            block,
          ),
          phase: "READY",
        };
      }
    } else if (action === "approve") {
      const e = one(state.token, tokenInterface, "Approval");
      check(
        eq(e.owner, policy.donor) &&
          eq(e.spender, state.escrow) &&
          e.value === AMOUNT &&
          (await call(
            state.token,
            "allowance",
            [policy.donor, state.escrow],
            block,
            true,
          )) === AMOUNT,
        "APPROVAL_MISMATCH",
      );
      patch = { phase: "APPROVED" };
    } else {
      const expectedBucket = { fund: 0, issue: 1, redeem: 2, settle: 3 }[
        action
      ];
      const prior = completed(state);
      const seq = BigInt(state.unitSeq ?? op.immutable.unitSeq ?? prior);
      const generation = BigInt(state.generation ?? op.immutable.generation ?? 1);
      check(seq === prior, "BUSINESS_UNIT_MISMATCH");
      const acc = await call(state.escrow, "getAccounting", [], block);
      check(
        acc.fundedUnits === prior + 1n &&
          acc.fundedAmount === AMOUNT * (prior + 1n) &&
          acc.counts.every((x, i) => x === (i === 3 ? prior : 0n) + (i === expectedBucket ? 1n : 0n)) &&
          acc.amounts.every(
            (x, i) => x === AMOUNT * ((i === 3 ? prior : 0n) + (i === expectedBucket ? 1n : 0n)),
          ) &&
          acc.liability === (action === "settle" ? 0n : AMOUNT),
        "ACCOUNTING_MISMATCH",
      );
      check(
        (await call(state.token, "balanceOf", [state.escrow], block, true)) ===
          (action === "settle" ? 0n : AMOUNT),
        "ESCROW_BALANCE_MISMATCH",
      );
      // Sequential businesses retain every settled unit; aggregate totals alone
      // must not hide an unrelated, expired, or replaced historical voucher.
      for (let i = 0n; i < prior; i++) {
        const previousUnit = await call(state.escrow, "getUnit", [i], block);
        const previous = await call(state.escrow, "getVoucher", [previousUnit.voucherId], block);
        const settlement = await call(state.escrow, "getOperation", [previous.settleId], block);
        check(previousUnit.bucket === 3n && previousUnit.unitPrice === AMOUNT &&
          eq(previousUnit.payer, policy.donor) && eq(previousUnit.mealId, policy.mealId) &&
          eq(previousUnit.termsHash, state.termsHash) && previous.unitSeq === i &&
          previous.generation === previousUnit.generation && !previous.expired &&
          eq(previous.issuer, policy.issuer) && settlement.kind === 9n &&
          eq(settlement.caller, policy.owner) && BigInt(settlement.result) === AMOUNT &&
          settlement.executedAt >= previous.settlementAvailableAt,
          "PREVIOUS_BUSINESS_MISMATCH");
      }
      if (action === "fund") {
        const e = one(state.escrow, escrowInterface, "Funded");
        check(
          eq(e.quoteId, state.quote.message.quoteId) &&
            eq(e.payer, policy.donor) &&
            eq(e.mealId, policy.mealId) &&
            eq(e.termsHash, state.termsHash) &&
            e.quantity === 1n &&
            e.amount === AMOUNT &&
            e.unitPrice === AMOUNT &&
            e.firstUnit === seq && eq(e.batchId, batchIdFor(state)),
          "FUND_EVENT_MISMATCH",
        );
        const t = one(state.token, tokenInterface, "Transfer");
        check(
          eq(t.from, policy.donor) &&
            eq(t.to, state.escrow) &&
            t.value === AMOUNT,
          "FUND_TRANSFER_MISMATCH",
        );
        await ownedUnit(state, seq, block);
        patch = { phase: "FUNDED", unitSeq: Number(seq), batchId: e.batchId };
      } else {
        const voucherId =
          state.voucherId ||
          keccak256(
            AbiCoder.defaultAbiCoder().encode(
              ["bytes32", "uint256", "address", "uint8", "uint256"],
              [
                digest("MealForwardVoucherV1"),
                policy.chainId,
                state.escrow,
                seq,
                generation,
              ],
            ),
          );
        const v = await call(state.escrow, "getVoucher", [voucherId], block);
        const unit = await ownedUnit(state, seq, block);
        check(
          eq(unit.voucherId, voucherId) &&
            unit.bucket === BigInt(expectedBucket) &&
            v.unitSeq === seq && unit.generation === generation &&
            v.generation === generation &&
            eq(v.termsHash, state.termsHash) &&
            !v.expired,
          "VOUCHER_MISMATCH",
        );
        const o = one(state.escrow, escrowInterface, "OperationExecuted");
        check(
          eq(o.opId, op.immutable.opId) &&
            eq(o.caller, op.wallet) &&
            o.kind === BigInt({ issue: 5, redeem: 12, settle: 9 }[action]),
          "OPERATION_EVENT_MISMATCH",
        );
        const storedOperation = await call(
          state.escrow,
          "getOperation",
          [op.immutable.opId],
          block,
        );
        check(
          storedOperation.kind === o.kind &&
            eq(storedOperation.caller, op.wallet) &&
            eq(storedOperation.payloadHash, o.payloadHash) &&
            eq(storedOperation.result, o.result) &&
            storedOperation.executedAt === BigInt(canonical.timestamp),
          "OPERATION_STATE_MISMATCH",
        );
        if (action === "issue") {
          const e = one(state.escrow, escrowInterface, "Issued");
          check(
            eq(e.voucherId, voucherId) &&
              e.generation === generation &&
              e.unitSeq === seq &&
              eq(e.termsHash, state.termsHash) &&
              e.issuedAt === v.issuedAt &&
              e.expiresAt === v.expiresAt &&
              eq(v.issuer, policy.issuer) &&
              v.expiresAt - v.issuedAt === 259200n,
            "ISSUE_EVENT_MISMATCH",
          );
          patch = {
            phase: "ISSUED",
            voucherId,
            unitSeq: Number(seq), generation: Number(generation),
            expiresAt: Number(v.expiresAt),
          };
        }
        if (action === "redeem") {
          const l = one(state.escrow, escrowInterface, "Locked"),
            h = one(state.escrow, escrowInterface, "HandoverMarked"),
            e = one(state.escrow, escrowInterface, "Reported");
          check(
            eq(l.voucherId, voucherId) &&
              eq(h.voucherId, voucherId) &&
              eq(e.voucherId, voucherId) &&
              eq(v.lockId, op.immutable.opId) &&
              eq(v.markerId, op.immutable.opId) &&
              eq(v.reportId, op.immutable.opId) &&
              eq(e.resultId, op.immutable.opId) &&
              e.amount === AMOUNT &&
              v.settlementAvailableAt === BigInt(canonical.timestamp) + 180n,
            "REDEEM_EVENT_MISMATCH",
          );
          patch = {
            phase: "HANDED_OVER",
            settlementAvailableAt: Number(v.settlementAvailableAt),
          };
        }
        if (action === "settle") {
          const e = one(state.escrow, escrowInterface, "Settled"),
            t = one(state.token, tokenInterface, "Transfer");
          check(
            eq(e.voucherId, voucherId) &&
              eq(e.opId, op.immutable.opId) &&
              eq(e.receiver, policy.owner) &&
              e.amount === AMOUNT &&
              eq(v.settleId, op.immutable.opId) &&
              eq(t.from, state.escrow) &&
              eq(t.to, policy.owner) &&
              t.value === AMOUNT,
            "SETTLEMENT_EVENT_MISMATCH",
          );
          const before = hex(BigInt(block) - 1n);
          check(
            (await call(
              state.token,
              "balanceOf",
              [policy.owner],
              block,
              true,
            )) -
              (await call(
                state.token,
                "balanceOf",
                [policy.owner],
                before,
                true,
              )) ===
              AMOUNT,
            "PAYOUT_DELTA_MISMATCH",
          );
          patch = { phase: "SETTLED" };
        }
      }
    }
    const again = await send("eth_getBlockByNumber", [block, false]);
    check(eq(again?.hash, r.blockHash), "RECEIPT_NOT_CANONICAL");
    return { state: "CONFIRMED", receipt: evidence, patch };
  }
  return { build, identity, receipt, call, network, send, currency };
}
