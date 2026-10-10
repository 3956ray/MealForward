import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../src/model.ts";
function fund(
  s: M.State,
  store: M.StoreId = "meadow",
  counts = { Lunch: 1, Dinner: 0 },
  nft = true,
) {
  s.wallet = "demo-supporter-1";
  const id = M.reviewFund(s, store, counts, nft);
  M.approve(s, id);
  M.submit(s, id);
  return id;
}
function claimant(s: M.State) {
  s.email = M.EMAILS[2];
  s.verified = s.email;
}
function claimed(s: M.State) {
  claimant(s);
  const id = M.issue(s, "meadow", "Lunch");
  M.resolve(s, id);
  return s.vouchers.at(-1)!;
}
function locked(s: M.State) {
  const v = claimed(s);
  M.showCode(s, v.id);
  s.owner = "meadow";
  const id = M.lock(s, v.id, v.code!.value);
  M.resolve(s, id);
  return v;
}
function accounted(s: M.State) {
  M.invariants(s);
  for (const st of s.stores) {
    const t = M.totals(s, st.id);
    assert.equal(t.F, t.A + t.R + t.H + t.S + t.X);
  }
}
test("frozen B2 fixture has distinct owner and recipient vouchers and exact buckets", () => {
  const s = M.initialState();
  assert.deepEqual(
    [
      M.totals(s, "meadow").F,
      M.totals(s, "meadow").A,
      M.totals(s, "meadow").R,
      M.totals(s, "meadow").H,
      M.totals(s, "meadow").S,
      M.totals(s, "meadow").X,
    ],
    [24, 9, 6, 6, 3, 0].map((v) => v * M.SCALE),
  );
  assert.equal(s.vouchers[0].state, "locked");
  assert.equal(s.vouchers[1].state, "active");
  accounted(s);
});
test("approval and submitted payment do not add funds; original final does once", () => {
  const s = M.initialState();
  s.wallet = "demo-supporter-1";
  const id = M.reviewFund(s, "meadow", { Lunch: 1, Dinner: 0 }, true);
  M.approve(s, id);
  assert.equal(M.totals(s, "meadow").supported, 8);
  M.submit(s, id);
  assert.equal(M.totals(s, "meadow").supported, 8);
  M.resolve(s, id);
  assert.equal(M.totals(s, "meadow").supported, 9);
  assert.throws(() => M.resolve(s, id));
  accounted(s);
});
test("UNKNOWN retains the original payment and cap reservation across serialization", () => {
  let s = M.initialState();
  s.outcome = "unknown";
  const id = fund(s, "meadow", { Lunch: 2, Dinner: 0 });
  s = M.deserialize(M.serialize(s));
  assert.equal(M.totals(s, "meadow").reservedSupport, 2);
  assert.throws(() => M.reviewFund(s, "meadow", { Lunch: 1, Dinner: 0 }, true));
  s.outcome = "final";
  M.resolve(s, id);
  assert.equal(M.totals(s, "meadow").supported, 10);
  accounted(s);
});
test("menu edit cannot rewrite accepted original payer/unit/price/version", () => {
  const s = M.initialState();
  const id = fund(s);
  s.owner = "meadow";
  M.publish(s, "meadow", "Lunch", {
    name: "Future lunch",
    price: 8 * M.SCALE,
    start: 11,
    end: 14,
  });
  M.resolve(s, id);
  const u = s.units.at(-1)!;
  assert.equal(u.terms.price, 3 * M.SCALE);
  assert.equal(u.terms.version, 1);
  assert.equal(u.payer, "demo-supporter-1");
  accounted(s);
});
test("unsubmitted menu changed quote must be reviewed again", () => {
  const s = M.initialState();
  s.wallet = "demo-supporter-1";
  const id = M.reviewFund(s, "meadow", { Lunch: 1, Dinner: 0 }, true);
  M.approve(s, id);
  s.owner = "meadow";
  M.publish(s, "meadow", "Lunch", {
    name: "Future",
    price: 8 * M.SCALE,
    start: 11,
    end: 14,
  });
  assert.throws(() => M.submit(s, id), /Menu changed/);
});
test("refunds return free original funds but never restore lifetime ten-meal cap", () => {
  const s = M.initialState();
  const id = fund(s, "meadow", { Lunch: 2, Dinner: 0 });
  M.resolve(s, id);
  const order = s.orders.at(-1)!;
  const rid = M.refund(s, order.id);
  M.resolve(s, rid);
  assert.equal(M.totals(s, "meadow").supported, 10);
  assert.throws(() =>
    M.reviewFund(s, "meadow", { Lunch: 1, Dinner: 0 }, false),
  );
  accounted(s);
});
test("refund cannot take an allocated or reserved original unit", () => {
  const s = M.initialState();
  s.wallet = "demo-supporter-1";
  claimant(s);
  const id = M.issue(s, "meadow", "Lunch");
  const rid = M.refund(s, "demo-order-meadow");
  assert.equal(s.ops.find((o) => o.id === rid)!.unitIds!.length, 2);
  M.resolve(s, rid);
  M.resolve(s, id);
  assert.equal(M.totals(s, "meadow").active, 3);
  accounted(s);
});
test("wrong payer cannot refund or complete approval", () => {
  const s = M.initialState();
  const id = fund(s);
  s.wallet = "demo-supporter-2";
  assert.throws(() => M.refund(s, "demo-order-meadow"));
  assert.throws(() => M.approve(s, id));
  accounted(s);
});
test("email cold start is only consumed by issue final, with a global pending gate", () => {
  const s = M.initialState();
  claimant(s);
  s.outcome = "unknown";
  const id = M.issue(s, "meadow", "Lunch");
  assert.equal(s.cooldowns[s.verified!], undefined);
  assert.throws(() => M.issue(s, "river", "Lunch"), /original intent/);
  s.outcome = "final";
  M.resolve(s, id);
  assert.equal(s.cooldowns[s.verified!], s.now + M.LIFE);
  assert.throws(() => M.issue(s, "river", "Lunch"), /72 hours/);
  accounted(s);
});
test("a proven issue failure releases reservation without quota", () => {
  const s = M.initialState();
  claimant(s);
  const id = M.issue(s, "meadow", "Lunch");
  s.outcome = "failed";
  M.resolve(s, id);
  assert.equal(s.cooldowns[s.verified!], undefined);
  assert.equal(M.totals(s, "meadow").available, 3);
  s.outcome = "final";
  M.issue(s, "river", "Lunch");
  accounted(s);
});
test("claim final starts exact original 72h even after queue delay", () => {
  const s = M.initialState();
  claimant(s);
  const id = M.issue(s, "meadow", "Lunch");
  M.advance(s, 2 * M.HOUR);
  M.resolve(s, id);
  const v = s.vouchers.at(-1)!;
  assert.equal(v.issued, s.now);
  assert.equal(v.expires - v.issued, M.LIFE);
  accounted(s);
});
test("recovery invalidates prior code, preserves identity/source and original expiry", () => {
  const s = M.initialState();
  const v = claimed(s);
  M.showCode(s, v.id);
  const old = v.code!.value,
    expires = v.expires,
    unit = v.unitId;
  M.recover(s);
  assert.equal(v.expires, expires);
  assert.equal(v.unitId, unit);
  assert.equal(v.code, undefined);
  M.showCode(s, v.id);
  assert.notEqual(v.code!.value, old);
  accounted(s);
});
test("code expires after 120 seconds without expiring the voucher", () => {
  const s = M.initialState();
  const v = claimed(s);
  M.showCode(s, v.id);
  M.advance(s, 121000);
  assert.equal(v.code, undefined);
  assert.equal(v.state, "active");
  M.showCode(s, v.id);
  assert.ok(M.validCode(s, v));
  accounted(s);
});
test("display deadline is bounded by serving window and voucher", () => {
  const s = M.initialState();
  const v = claimed(s);
  s.now = Date.parse("2026-10-10T13:59:30+08:00");
  M.showCode(s, v.id);
  assert.equal(v.code!.expires - s.now, 30000);
  M.advance(s, 31000);
  assert.throws(() => M.showCode(s, v.id), /window/);
  s.now = v.expires - 1000;
  const u = M.unitOf(s, v.unitId);
  u.terms.start = 0;
  u.terms.end = 24;
  M.showCode(s, v.id);
  assert.equal(v.code!.expires, v.expires);
});
test("unlocked expiry returns allocated funds to original free lot, not new funding", () => {
  const s = M.initialState();
  const v = claimed(s);
  const F = M.totals(s, "meadow").F;
  M.advance(s, M.LIFE);
  assert.equal(v.state, "expired");
  assert.equal(M.unitOf(s, v.unitId).bucket, "A");
  assert.equal(M.totals(s, "meadow").F, F);
  assert.throws(() => M.recover(s), /expired/);
  accounted(s);
});
test("owner scope and active code are necessary for a unique lock", () => {
  const s = M.initialState();
  const v = claimed(s);
  M.showCode(s, v.id);
  s.owner = "river";
  assert.throws(() => M.lock(s, v.id, v.code!.value), /another store/);
  s.owner = "meadow";
  const id = M.lock(s, v.id, v.code!.value);
  assert.throws(() => M.lock(s, v.id, v.code!.value));
  M.resolve(s, id);
  assert.throws(() => M.showCode(s, v.id));
  accounted(s);
});
test("UNKNOWN lock cannot expire/recover into new spending rights", () => {
  const s = M.initialState();
  const v = claimed(s);
  M.showCode(s, v.id);
  s.owner = "meadow";
  s.outcome = "unknown";
  const id = M.lock(s, v.id, v.code!.value);
  M.recover(s);
  assert.equal(v.code, undefined);
  assert.throws(() => M.showCode(s, v.id));
  M.advance(s, M.LIFE + 1);
  assert.equal(M.unitOf(s, v.unitId).bucket, "R");
  s.outcome = "final";
  M.resolve(s, id);
  assert.equal(v.state, "locked");
  assert.throws(() => M.report(s, v.id), /ended/);
  accounted(s);
});
test("report final moves only R to H, then single settlement moves H to S", () => {
  const s = M.initialState();
  const v = locked(s);
  const before = M.totals(s, "meadow");
  const id = M.report(s, v.id);
  assert.equal(M.totals(s, "meadow").H, before.H);
  assert.throws(() => M.report(s, v.id));
  M.resolve(s, id);
  assert.equal(M.totals(s, "meadow").H, before.H + 3 * M.SCALE);
  assert.equal(M.totals(s, "meadow").S, before.S);
  const sid = M.settle(s, v.unitId);
  assert.throws(() => M.settle(s, v.unitId));
  M.resolve(s, sid);
  assert.equal(M.totals(s, "meadow").S, before.S + 3 * M.SCALE);
  assert.throws(() => M.settle(s, v.unitId));
  accounted(s);
});
test("handover/report UNKNOWN stays allocated after expiry and is resumed once", () => {
  const s = M.initialState();
  const v = locked(s);
  s.outcome = "unknown";
  const id = M.report(s, v.id);
  M.advance(s, M.LIFE);
  assert.equal(M.unitOf(s, v.unitId).bucket, "R");
  assert.equal(v.handedOver, true);
  s.outcome = "final";
  M.resolve(s, id);
  assert.equal(M.unitOf(s, v.unitId).bucket, "H");
  accounted(s);
});
test("late new handoff forbidden but already handed over safe retry retains responsibility", () => {
  const s = M.initialState();
  const v = locked(s);
  s.outcome = "rejected";
  M.report(s, v.id);
  M.advance(s, M.LIFE);
  s.outcome = "final";
  const id = M.report(s, v.id);
  M.resolve(s, id);
  accounted(s);
});
test("settlement rejection or UNKNOWN never shows received or allows double spending", () => {
  const s = M.initialState();
  s.owner = "meadow";
  s.outcome = "unknown";
  const u = s.units.find((u) => u.bucket === "H")!;
  const before = M.totals(s, "meadow").S;
  const id = M.settle(s, u.id);
  assert.equal(M.totals(s, "meadow").S, before);
  assert.throws(() => M.settle(s, u.id));
  s.outcome = "rejected";
  M.resolve(s, id);
  assert.equal(u.bucket, "H");
  s.outcome = "final";
  const sid = M.settle(s, u.id);
  M.resolve(s, sid);
  accounted(s);
});
test("NFT failure/decline does not change payment or meal accounting", () => {
  const s = M.initialState();
  const id = fund(s, "meadow", { Lunch: 1, Dinner: 0 }, false);
  M.resolve(s, id);
  assert.equal(s.orders.at(-1)!.nft, "declined");
  const before = JSON.stringify(M.totals(s, "meadow"));
  s.orders.at(-1)!.nft = "incompatible";
  assert.equal(JSON.stringify(M.totals(s, "meadow")), before);
  accounted(s);
});
test("unlisting stops new orders/claims while old voucher can still show a code", () => {
  const s = M.initialState();
  const v = claimed(s);
  M.storeOf(s, "meadow").menus[0].listed = false;
  assert.throws(() => M.reviewFund(s, "meadow", { Lunch: 1, Dinner: 0 }, true));
  M.showCode(s, v.id);
  assert.ok(v.code);
  accounted(s);
});
test("incident pause forbids new handoff but does not erase locked funds", () => {
  const s = M.initialState();
  const v = locked(s);
  M.storeOf(s, "meadow").paused = true;
  assert.throws(() => M.report(s, v.id));
  assert.equal(v.state, "locked");
  assert.equal(M.unitOf(s, v.unitId).bucket, "R");
  accounted(s);
});
test("source uncertainty keeps figures but rejects new money/claim/code operations", () => {
  const s = M.initialState();
  s.source = "stale";
  const before = M.totals(s, "meadow");
  assert.throws(() => fund(s));
  claimant(s);
  assert.throws(() => M.issue(s, "meadow", "Lunch"));
  assert.deepEqual(M.totals(s, "meadow"), before);
});
test("persistence preserves UNKNOWN operation/source/expiry and rejects incompatible schema", () => {
  const s = M.initialState();
  s.outcome = "unknown";
  fund(s);
  assert.equal(M.serialize(M.deserialize(M.serialize(s))), M.serialize(s));
  assert.throws(
    () => M.deserialize(JSON.stringify({ ...s, schema: 99 })),
    /schema/,
  );
  assert.throws(
    () => M.deserialize(JSON.stringify({ ...s, email: "real@example.com" })),
    /built-in/,
  );
});
test("transaction rolls back all mutations on invariant/operation failure", () => {
  const s = M.initialState();
  const before = M.serialize(s);
  assert.throws(() =>
    M.transaction(s, (d) => {
      d.units[0].terms.price = -1;
    }),
  );
  assert.equal(M.serialize(s), before);
});
test("saved menu drafts survive refresh without publishing or altering funded terms", () => {
  const s = M.initialState();
  s.owner = "meadow";
  const draft = {
    name: "A future lunch",
    price: 8 * M.SCALE,
    start: 10,
    end: 15,
  };
  M.saveMenuDraft(s, "meadow", "Lunch", draft);
  const restored = M.deserialize(M.serialize(s));
  assert.deepEqual(restored.menuDrafts?.["meadow-Lunch"], draft);
  assert.equal(restored.stores[0].menus[0].price, 3 * M.SCALE);
  M.publish(restored, "meadow", "Lunch", draft);
  assert.equal(restored.menuDrafts?.["meadow-Lunch"], undefined);
  assert.equal(restored.units[0].terms.price, 3 * M.SCALE);
});
test("a review created before another UNKNOWN payment cannot bypass its submission gate", () => {
  let s = M.initialState();
  s.wallet = "demo-supporter-1";
  const first = M.reviewFund(s, "meadow", { Lunch: 1, Dinner: 0 }, false);
  const second = M.reviewFund(s, "river", { Lunch: 1, Dinner: 0 }, false);
  M.approve(s, first);
  s.outcome = "unknown";
  M.submit(s, first);
  s.outcome = "final";
  M.approve(s, second);
  assert.throws(
    () => M.transaction(s, (d) => M.submit(d, second)),
    /original payment/,
  );
  assert.equal(s.ops.filter((o) => o.kind === "fund" && M.isOpen(o)).length, 1);
  s = M.transaction(s, (d) => M.resolve(d, first));
  s = M.transaction(s, (d) => M.submit(d, second));
  assert.equal(s.ops.find((o) => o.id === second)!.status, "pending");
});
test("corrupt restored UNKNOWN status cannot reopen an original lock", () => {
  const s = M.initialState();
  s.verified = M.EMAILS[1];
  M.showCode(s, "demo-voucher-2");
  s.owner = "meadow";
  s.outcome = "unknown";
  const id = M.lock(
    s,
    "demo-voucher-2",
    M.voucherOf(s, "demo-voucher-2").code!.value,
  );
  const raw = JSON.parse(M.serialize(s));
  raw.ops.find((o: M.Operation) => o.id === id).status = "UNKNOWN";
  assert.throws(() => M.deserialize(JSON.stringify(raw)), /operation status/);
});
test("restored snapshots require original email cooldown and operation references", () => {
  const raw = JSON.parse(M.serialize(M.initialState()));
  delete raw.cooldowns[M.EMAILS[1]];
  assert.throws(() => M.deserialize(JSON.stringify(raw)), /cooldown/);
  const broken = JSON.parse(M.serialize(M.initialState()));
  broken.ops[0].unitIds = ["missing-original-unit"];
  assert.throws(() => M.deserialize(JSON.stringify(broken)), /operation unit/);
  const duplicate = JSON.parse(M.serialize(M.initialState()));
  duplicate.ops.push(duplicate.ops[0]);
  assert.throws(() => M.deserialize(JSON.stringify(duplicate)), /unique/);
});
