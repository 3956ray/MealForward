// Entirely synthetic, bounded UI state. No SDK, API, account provider or chain.
export const STORAGE_KEY = "mealforward:cp29-ui03:b2:v1";
export const SCHEMA = 1;
export const HOUR = 3600000;
export const LIFE = 72 * HOUR;
export const SCALE = 1000000;
export const EMAILS = [
  "guest-a@mealforward.invalid",
  "guest-b@mealforward.invalid",
  "guest-c@mealforward.invalid",
  "guest-d@mealforward.invalid",
] as const;
export type StoreId = "meadow" | "river" | "lantern";
export type Meal = "Lunch" | "Dinner";
export type Bucket = "A" | "R" | "H" | "S" | "X";
export type Kind = "fund" | "issue" | "lock" | "report" | "settle" | "refund";
export type Status =
  | "review"
  | "approved"
  | "pending"
  | "unknown"
  | "rejected"
  | "failed"
  | "final";
export type Outcome = "final" | "pending" | "unknown" | "rejected" | "failed";
export type NFT =
  | "declined"
  | "pending"
  | "created"
  | "unknown"
  | "incompatible"
  | "paused";
export interface Menu {
  meal: Meal;
  name: string;
  price: number;
  version: number;
  start: number;
  end: number;
  listed: boolean;
  image: string;
}
export interface Store {
  id: StoreId;
  name: string;
  description: string;
  website: string;
  paused: boolean;
  menus: Menu[];
  welcome: NFT;
}
export interface Unit {
  id: string;
  orderId: string;
  store: StoreId;
  payer: string;
  terms: Menu;
  bucket: Bucket;
  voucherId?: string;
}
export interface Order {
  id: string;
  store: StoreId;
  payer: string;
  unitIds: string[];
  amount: number;
  at: number;
  nft: NFT;
}
export interface Voucher {
  id: string;
  unitId: string;
  email: string;
  issued: number;
  expires: number;
  version: number;
  state: "active" | "locked" | "reported" | "expired";
  lockOwner?: StoreId;
  handedOver: boolean;
  code?: { value: string; expires: number; version: number };
}
export interface Operation {
  id: string;
  kind: Kind;
  store: StoreId;
  status: Status;
  at: number;
  payer?: string;
  email?: string;
  unitIds?: string[];
  voucherId?: string;
  items?: { terms: Menu; count: number }[];
  nft?: boolean;
  message?: string;
}
export interface State {
  schema: 1;
  now: number;
  seq: number;
  stores: Store[];
  units: Unit[];
  orders: Order[];
  vouchers: Voucher[];
  ops: Operation[];
  cooldowns: Record<string, number>;
  wallet: string | null;
  email: string | null;
  verified: string | null;
  owner: StoreId | null;
  outcome: Outcome;
  source: "fresh" | "stale" | "unavailable" | "reorg";
  balance: number;
  gas: boolean;
  network: boolean;
  menuDrafts?: Record<string, Pick<Menu, "name" | "price" | "start" | "end">>;
}
const meal = (name: Meal): Menu => ({
  meal: name,
  name: name === "Lunch" ? "Mushroom chicken rice" : "Mushroom tofu rice",
  price: 3 * SCALE,
  version: 1,
  start: name === "Lunch" ? 11 : 17,
  end: name === "Lunch" ? 14 : 20,
  listed: true,
  image: name === "Lunch" ? "chicken.jpg" : "tofu.jpg",
});
export const isOpen = (o: Operation) =>
  o.status === "pending" || o.status === "unknown";
export function initialState(): State {
  const now = Date.parse("2026-10-10T12:08:30+08:00");
  const s: State = {
    schema: 1,
    now,
    seq: 30,
    stores: [],
    units: [],
    orders: [],
    vouchers: [],
    ops: [],
    cooldowns: {},
    wallet: null,
    email: EMAILS[1],
    verified: null,
    owner: null,
    outcome: "final",
    source: "fresh",
    balance: 100 * SCALE,
    gas: true,
    network: true,
  };
  const names = ["Meadow Kitchen", "River Table", "Lantern Pantry"];
  const ids: StoreId[] = ["meadow", "river", "lantern"];
  ids.forEach((id, index) => {
    s.stores.push({
      id,
      name: names[index],
      description:
        "A warm neighborhood table. Simulated meals, shared with care.",
      website: `https://${id}.example.invalid`,
      paused: false,
      menus: [meal("Lunch"), meal("Dinner")],
      welcome: "declined",
    });
    const buckets: Bucket[] =
      index === 0
        ? ["A", "A", "R", "R", "H", "S", "A", "H"]
        : Array(index === 1 ? 6 : 5).fill("A");
    const oid = `demo-order-${id}`;
    const units = buckets.map(
      (bucket, i): Unit => ({
        id: `demo-unit-${id}-${i + 1}`,
        orderId: oid,
        store: id,
        payer: "demo-supporter-1",
        terms: meal(
          (index === 0 ? i < 6 : i < (index === 1 ? 4 : 3))
            ? "Lunch"
            : "Dinner",
        ),
        bucket,
      }),
    );
    s.units.push(...units);
    s.orders.push({
      id: oid,
      store: id,
      payer: "demo-supporter-1",
      unitIds: units.map((u) => u.id),
      amount: units.length * 3 * SCALE,
      at: now - 2 * HOUR,
      nft: "created",
    });
  });
  for (let i = 0; i < 2; i++) {
    const unit = s.units.filter((u) => u.bucket === "R")[i];
    const issued = Date.parse("2026-10-09T12:00:00+08:00");
    const v: Voucher = {
      id: `demo-voucher-${i + 1}`,
      unitId: unit.id,
      email: EMAILS[i],
      issued,
      expires: issued + LIFE,
      version: 1,
      state: i === 0 ? "locked" : "active",
      lockOwner: i === 0 ? "meadow" : undefined,
      handedOver: false,
    };
    unit.voucherId = v.id;
    s.vouchers.push(v);
    s.cooldowns[v.email] = v.expires;
  }
  s.ops = [
    {
      id: "demo-op-settled",
      kind: "settle",
      store: "meadow",
      status: "final",
      unitIds: [s.units[5].id],
      at: now - 50 * 60000,
    },
    {
      id: "demo-op-reported",
      kind: "report",
      store: "meadow",
      status: "final",
      unitIds: [s.units[4].id],
      at: now - 26 * 60000,
    },
    {
      id: "demo-op-locked",
      kind: "lock",
      store: "meadow",
      status: "final",
      voucherId: "demo-voucher-1",
      at: now - 3 * 60000,
    },
  ];
  return s;
}
export const money = (n: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(n / SCALE)} test USDC`;
export const time = (n: number) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(n);
export function windowEnd(now: number, m: Menu): number | null {
  const local = new Date(now + 8 * HOUR),
    h =
      local.getUTCHours() +
      local.getUTCMinutes() / 60 +
      local.getUTCSeconds() / 3600;
  if (h < m.start || h >= m.end) return null;
  return (
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      m.end,
    ) -
    8 * HOUR
  );
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export const storeOf = (s: State, id: StoreId) =>
  s.stores.find((v) => v.id === id)!;
export const unitOf = (s: State, id: string) =>
  s.units.find((v) => v.id === id)!;
export const voucherOf = (s: State, id: string) =>
  s.vouchers.find((v) => v.id === id)!;
function healthy(s: State) {
  assert(
    s.source === "fresh",
    "Current status needs verification. Refresh the demo source.",
  );
}
export function reserved(s: State, id: string) {
  return s.ops.some((o) => isOpen(o) && o.unitIds?.includes(id));
}
export function totals(s: State, store: StoreId) {
  const units = s.units.filter((u) => u.store === store);
  const sum = (bucket: Bucket) =>
    units
      .filter((u) => u.bucket === bucket)
      .reduce((a, u) => a + u.terms.price, 0);
  const count = (bucket: Bucket) =>
    units.filter((u) => u.bucket === bucket).length;
  return {
    F: units.reduce((a, u) => a + u.terms.price, 0),
    A: sum("A"),
    R: sum("R"),
    H: sum("H"),
    S: sum("S"),
    X: sum("X"),
    supported: units.length,
    available: units.filter((u) => u.bucket === "A" && !reserved(s, u.id))
      .length,
    active: count("R"),
    reported: count("H") + count("S"),
    pending: s.ops.filter((o) => o.store === store && isOpen(o)).length,
    reservedSupport: s.ops
      .filter((o) => o.store === store && o.kind === "fund" && isOpen(o))
      .reduce(
        (a, o) => a + (o.items?.reduce((n, i) => n + i.count, 0) ?? 0),
        0,
      ),
  };
}
export function codeReason(s: State, v: Voucher): string | null {
  if (s.source !== "fresh") return "Current status needs verification.";
  if (v.state === "expired" || s.now >= v.expires) return "Voucher expired.";
  if (
    v.state !== "active" ||
    s.ops.some((o) => o.voucherId === v.id && isOpen(o))
  )
    return "Processing already started. Check the original operation.";
  if (storeOf(s, unitOf(s, v.unitId).store).paused)
    return "Store paused for an incident. Existing obligations remain.";
  if (!windowEnd(s.now, unitOf(s, v.unitId).terms))
    return "Outside the serving window.";
  return null;
}
export function validCode(s: State, v: Voucher) {
  return (
    !codeReason(s, v) &&
    v.code &&
    v.code.expires > s.now &&
    v.code.version === v.version
  );
}
function expire(s: State) {
  for (const v of s.vouchers) {
    if (v.code && v.code.expires <= s.now) delete v.code;
    if (
      v.state === "active" &&
      v.expires <= s.now &&
      !s.ops.some((o) => o.voucherId === v.id && isOpen(o))
    ) {
      v.state = "expired";
      unitOf(s, v.unitId).bucket = "A";
      delete v.code;
    }
  }
}
function add(s: State, o: Omit<Operation, "id" | "at">) {
  const op = { ...o, id: `demo-op-${++s.seq}`, at: s.now };
  s.ops.push(op);
  return op;
}
export function reviewFund(
  s: State,
  store: StoreId,
  counts: Record<Meal, number>,
  nft: boolean,
): string {
  healthy(s);
  const st = storeOf(s, store);
  assert(!st.paused, "Store paused for an incident.");
  const items = st.menus
    .filter((m) => counts[m.meal] > 0)
    .map((terms) => ({
      terms: structuredClone(terms),
      count: counts[terms.meal],
    }));
  assert(items.length > 0, "Choose at least one meal.");
  assert(
    items.every(
      (i) => i.terms.listed && Number.isInteger(i.count) && i.count > 0,
    ),
    "Only listed meals can be supported.",
  );
  const t = totals(s, store);
  assert(
    t.supported + t.reservedSupport + items.reduce((a, i) => a + i.count, 0) <=
      10,
    "This store has a cumulative ten-meal demo limit.",
  );
  assert(
    !s.ops.some((o) => o.kind === "fund" && isOpen(o) && o.payer === s.wallet),
    "Check your original payment before creating another.",
  );
  return add(s, {
    kind: "fund",
    store,
    status: "review",
    items,
    nft,
    payer: s.wallet ?? undefined,
  }).id;
}
export function approve(s: State, id: string) {
  healthy(s);
  const o = s.ops.find((o) => o.id === id)!;
  assert(
    o.kind === "fund" && !isOpen(o) && o.status !== "final",
    "Check the original payment.",
  );
  assert(s.wallet, "Connect a demo wallet.");
  assert(s.network, "Switch the demo network to Monad Testnet.");
  assert(s.gas, "Not enough demo MON for gas.");
  if (o.payer)
    assert(
      o.payer === s.wallet,
      "Wallet changed. Return to the original demo payer.",
    );
  o.payer = s.wallet;
  o.status =
    s.outcome === "rejected"
      ? "rejected"
      : s.outcome === "failed"
        ? "failed"
        : "approved";
  o.message =
    o.status === "approved"
      ? "Approval simulated. No meals supported yet."
      : "Approval request declined or safely failed.";
}
export function submit(s: State, id: string) {
  healthy(s);
  const o = s.ops.find((o) => o.id === id)!;
  assert(
    o && !isOpen(o) && o.status !== "final",
    "Check the original operation; do not submit twice.",
  );
  if (o.kind === "fund") {
    assert(o.status === "approved", "Approve the original order first.");
    assert(s.wallet === o.payer, "Return to the original demo payer.");
    assert(
      !s.ops.some(
        (other) =>
          other.id !== id &&
          other.kind === "fund" &&
          other.payer === o.payer &&
          isOpen(other),
      ),
      "Check your original payment before submitting another.",
    );
    assert(s.network && s.gas, "Check demo network and MON for gas.");
    const st = storeOf(s, o.store),
      t = totals(s, o.store);
    assert(
      !st.paused &&
        o.items!.every((i) =>
          st.menus.some(
            (m) =>
              m.meal === i.terms.meal &&
              m.version === i.terms.version &&
              m.listed,
          ),
        ),
      "Menu changed. Edit and review the cart again.",
    );
    assert(
      t.supported +
        t.reservedSupport +
        o.items!.reduce((a, i) => a + i.count, 0) <=
        10,
      "Cumulative demo limit reached.",
    );
    assert(
      o.items!.reduce((a, i) => a + i.count * i.terms.price, 0) <= s.balance,
      "Not enough demo test USDC.",
    );
  } else if (o.kind === "settle")
    assert(
      s.owner === o.store && s.gas && s.network,
      "Confirm this store’s demo owner wallet and network.",
    );
  o.status =
    s.outcome === "rejected"
      ? "rejected"
      : s.outcome === "failed"
        ? "failed"
        : s.outcome === "unknown"
          ? "unknown"
          : "pending";
}
function newAction(s: State, o: Omit<Operation, "id" | "at" | "status">) {
  const op = add(s, { ...o, status: "review" });
  submit(s, op.id);
  return op.id;
}
export function issue(s: State, store: StoreId, meal: Meal): string {
  healthy(s);
  assert(
    s.verified && EMAILS.includes(s.verified as (typeof EMAILS)[number]),
    "Verify a built-in demo email first.",
  );
  assert(
    (s.cooldowns[s.verified] ?? 0) <= s.now,
    "One meal per email across all stores every 72 hours.",
  );
  assert(
    !s.ops.some(
      (o) => o.kind === "issue" && o.email === s.verified && isOpen(o),
    ),
    "Voucher issuance needs verification. Check the original intent.",
  );
  const st = storeOf(s, store);
  assert(!st.paused, "Store paused for an incident.");
  assert(
    st.menus.find((m) => m.meal === meal)?.listed,
    "This meal is unlisted.",
  );
  const u = s.units.find(
    (u) =>
      u.store === store &&
      u.terms.meal === meal &&
      u.bucket === "A" &&
      !reserved(s, u.id),
  );
  assert(u, "No meals available right now.");
  // A daily window is guaranteed to recur within the fixed 72-hour life.
  assert(
    u.terms.end > u.terms.start && u.terms.start >= 0 && u.terms.end <= 24,
    "No valid serving window in the next 72 hours.",
  );
  return newAction(s, {
    kind: "issue",
    store,
    email: s.verified,
    unitIds: [u.id],
  });
}
export function showCode(s: State, id: string) {
  const v = voucherOf(s, id);
  assert(s.verified === v.email, "Verify the original built-in email.");
  assert(!codeReason(s, v), codeReason(s, v) ?? "Cannot display code.");
  v.code = {
    value: `mealforward:demo:${v.id}:v${v.version}:display${++s.seq}`,
    expires: Math.min(
      s.now + 120000,
      v.expires,
      windowEnd(s.now, unitOf(s, v.unitId).terms)!,
    ),
    version: v.version,
  };
}
export function recover(s: State): string {
  healthy(s);
  assert(s.verified, "Verify the original demo email.");
  const v = s.vouchers.findLast((v) => v.email === s.verified);
  assert(v, "No original voucher for this demo email.");
  assert(
    v.state !== "reported" && v.state !== "expired" && s.now < v.expires,
    "Used or expired vouchers cannot be restored.",
  );
  v.version++;
  delete v.code;
  return v.id;
}
export function lock(s: State, id: string, code: string): string {
  healthy(s);
  const v = voucherOf(s, id),
    u = unitOf(s, v.unitId);
  assert(s.owner === u.store, "This voucher belongs to another store.");
  assert(
    validCode(s, v) && v.code!.value === code,
    "Use an active demo verification string. Refresh expired codes.",
  );
  return newAction(s, {
    kind: "lock",
    store: u.store,
    voucherId: id,
    unitIds: [u.id],
  });
}
export function report(s: State, id: string): string {
  healthy(s);
  const v = voucherOf(s, id),
    u = unitOf(s, v.unitId);
  assert(
    s.owner === u.store && v.lockOwner === s.owner,
    "Confirm this store’s demo owner identity.",
  );
  assert(
    v.state === "locked" &&
      !s.ops.some(
        (o) => o.voucherId === id && o.kind === "report" && isOpen(o),
      ),
    "Check the original handoff report.",
  );
  assert(
    !storeOf(s, u.store).paused,
    "Store paused; keep the original processing responsibility.",
  );
  // A physical handoff already recorded must remain reportable after an expiry edge.
  if (!v.handedOver)
    assert(
      s.now < v.expires && windowEnd(s.now, u.terms),
      "Voucher or serving window ended. Do not start a new handoff.",
    );
  v.handedOver = true;
  delete v.code;
  return newAction(s, {
    kind: "report",
    store: u.store,
    voucherId: id,
    unitIds: [u.id],
  });
}
export function settle(s: State, unitId: string): string {
  healthy(s);
  const u = unitOf(s, unitId);
  assert(
    s.owner === u.store,
    "Confirm the original store’s demo owner identity.",
  );
  assert(
    u.bucket === "H" && !reserved(s, u.id),
    "Check the original settlement; do not settle twice.",
  );
  return newAction(s, { kind: "settle", store: u.store, unitIds: [u.id] });
}
export function refund(s: State, orderId: string): string {
  healthy(s);
  const order = s.orders.find((o) => o.id === orderId)!;
  assert(s.wallet === order.payer, "Return to the original demo payer.");
  const unitIds = order.unitIds.filter(
    (id) => unitOf(s, id).bucket === "A" && !reserved(s, id),
  );
  assert(unitIds.length, "No safe free meals available to refund.");
  return newAction(s, {
    kind: "refund",
    store: order.store,
    payer: order.payer,
    unitIds,
  });
}
export function resolve(s: State, id: string) {
  healthy(s);
  const o = s.ops.find((o) => o.id === id)!;
  assert(o && isOpen(o), "This original operation is already resolved.");
  if (s.outcome !== "final") {
    o.status = s.outcome;
    return;
  }
  if (o.kind === "fund") {
    const orderId = `demo-order-${o.id}`;
    const unitIds: string[] = [];
    for (const item of o.items!)
      for (let i = 0; i < item.count; i++) {
        const id = `demo-unit-${++s.seq}`;
        unitIds.push(id);
        s.units.push({
          id,
          orderId,
          store: o.store,
          payer: o.payer!,
          terms: structuredClone(item.terms),
          bucket: "A",
        });
      }
    const amount = o.items!.reduce((a, i) => a + i.count * i.terms.price, 0);
    s.balance -= amount;
    s.orders.push({
      id: orderId,
      store: o.store,
      payer: o.payer!,
      unitIds,
      amount,
      at: s.now,
      nft: o.nft ? "pending" : "declined",
    });
    o.unitIds = unitIds;
  } else if (o.kind === "issue") {
    const u = unitOf(s, o.unitIds![0]);
    assert(u.bucket === "A", "The original funding unit is not free.");
    const v: Voucher = {
      id: `demo-voucher-${++s.seq}`,
      unitId: u.id,
      email: o.email!,
      issued: s.now,
      expires: s.now + LIFE,
      version: 1,
      state: "active",
      handedOver: false,
    };
    s.vouchers.push(v);
    u.bucket = "R";
    u.voucherId = v.id;
    o.voucherId = v.id;
    s.cooldowns[v.email] = v.expires;
  } else if (o.kind === "lock") {
    const v = voucherOf(s, o.voucherId!);
    assert(v.state === "active", "Original processing right already decided.");
    v.state = "locked";
    v.lockOwner = o.store;
    delete v.code;
  } else if (o.kind === "report") {
    const v = voucherOf(s, o.voucherId!);
    assert(v.state === "locked", "Original voucher already reported.");
    v.state = "reported";
    unitOf(s, v.unitId).bucket = "H";
  } else
    for (const id of o.unitIds!) {
      const u = unitOf(s, id);
      assert(
        u.bucket === (o.kind === "settle" ? "H" : "A"),
        "Original amount already handled.",
      );
      u.bucket = o.kind === "settle" ? "S" : "X";
      if (o.kind === "refund") s.balance += u.terms.price;
    }
  o.status = "final";
  o.message = "Simulated final result.";
  expire(s);
}
function validateMenuDraft(
  draft: Pick<Menu, "name" | "price" | "start" | "end">,
) {
  assert(
    draft.name.trim().length > 0 && draft.name.length <= 140,
    "Meal name must be 1–140 characters.",
  );
  assert(
    Number.isSafeInteger(draft.price) &&
      draft.price > 0 &&
      draft.price <= 1000 * SCALE,
    "Enter a price above zero and at most 1,000 test USDC.",
  );
  assert(
    Number.isInteger(draft.start) &&
      Number.isInteger(draft.end) &&
      draft.start >= 0 &&
      draft.end <= 24 &&
      draft.end > draft.start,
    "Use a valid daily window within 00:00–24:00.",
  );
}
export function saveMenuDraft(
  s: State,
  store: StoreId,
  meal: Meal,
  draft: Pick<Menu, "name" | "price" | "start" | "end">,
) {
  healthy(s);
  assert(s.owner === store, "Choose and confirm this demo store owner.");
  validateMenuDraft(draft);
  (s.menuDrafts ??= {})[`${store}-${meal}`] = { ...draft };
}
export function publish(
  s: State,
  store: StoreId,
  meal: Meal,
  draft: Pick<Menu, "name" | "price" | "start" | "end">,
) {
  healthy(s);
  assert(s.owner === store, "Choose and confirm this demo store owner.");
  validateMenuDraft(draft);
  const m = storeOf(s, store).menus.find((m) => m.meal === meal)!;
  Object.assign(m, draft, { version: m.version + 1 });
  if (s.menuDrafts) delete s.menuDrafts[`${store}-${meal}`];
}
export function advance(s: State, ms: number) {
  assert(ms >= 0, "Time moves forward.");
  s.now += ms;
  expire(s);
}
export function transaction(s: State, fn: (draft: State) => void): State {
  const draft = structuredClone(s);
  fn(draft);
  invariants(draft);
  return draft;
}
export function invariants(s: State) {
  assert(
    s.schema === SCHEMA,
    "Demo schema mismatch. Reset explicitly; pending intents are preserved until then.",
  );
  const stores = ["meadow", "river", "lantern"];
  const statuses = [
    "review",
    "approved",
    "pending",
    "unknown",
    "rejected",
    "failed",
    "final",
  ];
  const kinds = ["fund", "issue", "lock", "report", "settle", "refund"];
  const nfts = [
    "declined",
    "pending",
    "created",
    "unknown",
    "incompatible",
    "paused",
  ];
  const demoEmail = (email: string | null) =>
    email === null || EMAILS.includes(email as (typeof EMAILS)[number]);
  const demoPayer = (payer: string | null) =>
    payer === null || ["demo-supporter-1", "demo-supporter-2"].includes(payer);
  const unique = (rows: { id: string }[]) => {
    assert(
      Array.isArray(rows) &&
        rows.every(
          (row) => typeof row.id === "string" && row.id.startsWith("demo-"),
        ) &&
        new Set(rows.map((row) => row.id)).size === rows.length,
      "Invalid or non-unique demo records.",
    );
  };
  assert(
    Array.isArray(s.stores) &&
      s.stores.length === 3 &&
      new Set(s.stores.map((st) => st.id)).size === 3 &&
      s.stores.every((st) => stores.includes(st.id)),
    "Invalid demo stores.",
  );
  assert(
    Number.isSafeInteger(s.now) &&
      Number.isSafeInteger(s.seq) &&
      s.seq >= 30 &&
      Number.isSafeInteger(s.balance) &&
      s.balance >= 0,
    "Invalid demo clock, sequence or balance.",
  );
  assert(
    demoEmail(s.email) && demoEmail(s.verified),
    "Only built-in synthetic email identities are allowed.",
  );
  assert(
    demoPayer(s.wallet) &&
      (s.owner === null || stores.includes(s.owner)) &&
      typeof s.gas === "boolean" &&
      typeof s.network === "boolean",
    "Invalid demo identity or network.",
  );
  assert(
    ["final", "pending", "unknown", "rejected", "failed"].includes(s.outcome) &&
      ["fresh", "stale", "unavailable", "reorg"].includes(s.source),
    "Invalid demo scenario.",
  );
  unique(s.units);
  unique(s.orders);
  unique(s.vouchers);
  unique(s.ops);
  for (const st of s.stores) {
    assert(
      typeof st.paused === "boolean" &&
        nfts.includes(st.welcome) &&
        st.menus.length === 2 &&
        new Set(st.menus.map((m) => m.meal)).size === 2,
      "Invalid demo store menu.",
    );
    for (const m of st.menus) validateStoredMenu(m);
  }
  for (const o of s.ops) {
    assert(
      statuses.includes(o.status),
      "Invalid persisted operation status; original UNKNOWN cannot be reopened.",
    );
    assert(
      kinds.includes(o.kind) &&
        stores.includes(o.store) &&
        Number.isSafeInteger(o.at) &&
        o.at <= s.now &&
        (o.status !== "approved" || o.kind === "fund"),
      "Invalid persisted operation.",
    );
    assert(
      o.payer === undefined ||
        (typeof o.payer === "string" && demoPayer(o.payer)),
      "Invalid operation payer.",
    );
    assert(
      o.email === undefined ||
        (typeof o.email === "string" && demoEmail(o.email)),
      "Invalid operation email.",
    );
    if (o.kind === "fund") {
      assert(
        Array.isArray(o.items) &&
          o.items.length > 0 &&
          o.items.length <= 2 &&
          new Set(o.items.map((i) => i.terms.meal)).size === o.items.length,
        "Invalid original payment items.",
      );
      for (const item of o.items) {
        validateStoredMenu(item.terms);
        assert(
          Number.isInteger(item.count) && item.count > 0 && item.count <= 10,
          "Invalid original payment count.",
        );
      }
      assert(
        o.status === "review" || !!o.payer,
        "Missing original payment payer.",
      );
    }
    if (o.kind === "issue")
      assert(
        typeof o.email === "string" &&
          demoEmail(o.email) &&
          o.unitIds?.length === 1,
        "Invalid original issuance identity/unit.",
      );
    if (o.unitIds)
      assert(
        Array.isArray(o.unitIds) &&
          new Set(o.unitIds).size === o.unitIds.length &&
          o.unitIds.every((id) =>
            s.units.some((u) => u.id === id && u.store === o.store),
          ),
        "Invalid original operation unit reference.",
      );
    if (o.voucherId)
      assert(
        s.vouchers.some(
          (v) =>
            v.id === o.voucherId &&
            unitOf(s, v.unitId)?.store === o.store &&
            (o.kind !== "issue" || v.email === o.email),
        ),
        "Invalid original operation voucher reference.",
      );
    if (o.kind === "lock")
      assert(!!o.voucherId, "Missing original lock voucher.");
    if (o.kind === "report")
      assert(
        !!o.voucherId || !!o.unitIds?.length,
        "Missing original report responsibility.",
      );
    if (["refund", "settle"].includes(o.kind))
      assert(!!o.unitIds?.length, "Missing original operation units.");
    if (o.kind === "issue" && o.status === "final")
      assert(!!o.voucherId, "Missing finalized original voucher.");
  }
  const open = s.ops.filter(isOpen);
  for (const o of open) {
    if (o.kind === "fund")
      assert(
        open.filter((other) => other.kind === "fund" && other.payer === o.payer)
          .length === 1,
        "Multiple open original payments for one payer.",
      );
    if (o.kind === "issue")
      assert(
        open.filter(
          (other) => other.kind === "issue" && other.email === o.email,
        ).length === 1,
        "Multiple open original issuances for one email.",
      );
    if (o.voucherId)
      assert(
        open.filter((other) => other.voucherId === o.voucherId).length === 1,
        "Multiple open voucher responsibilities.",
      );
    for (const id of o.unitIds ?? [])
      assert(
        open.filter((other) => other.unitIds?.includes(id)).length === 1,
        "Multiple open unit responsibilities.",
      );
  }
  assert(
    s.cooldowns &&
      typeof s.cooldowns === "object" &&
      !Array.isArray(s.cooldowns),
    "Invalid original cooldown structure.",
  );
  const expectedCooldowns: Record<string, number> = {};
  for (const v of s.vouchers)
    expectedCooldowns[v.email] = Math.max(
      expectedCooldowns[v.email] ?? 0,
      v.expires,
    );
  assert(
    Object.keys(s.cooldowns).length === Object.keys(expectedCooldowns).length &&
      Object.entries(expectedCooldowns).every(
        ([email, deadline]) => s.cooldowns[email] === deadline,
      ),
    "Original email cooldown is missing or inconsistent.",
  );
  for (const [key, draft] of Object.entries(s.menuDrafts ?? {})) {
    assert(
      stores.some((id) =>
        ["Lunch", "Dinner"].some((meal) => key === `${id}-${meal}`),
      ),
      "Invalid saved menu draft.",
    );
    validateMenuDraft(draft);
  }
  assert(
    s.units.length <= 30 &&
      new Set(s.units.map((u) => u.id)).size === s.units.length,
    "Invalid cumulative units.",
  );
  for (const st of s.stores) {
    const t = totals(s, st.id);
    assert(
      t.F === t.A + t.R + t.H + t.S + t.X &&
        t.supported + t.reservedSupport <= 10,
      "Financial invariant or cumulative cap violated.",
    );
  }
  for (const u of s.units) {
    assert(
      ["A", "R", "H", "S", "X"].includes(u.bucket) &&
        stores.includes(u.store) &&
        typeof u.payer === "string" &&
        demoPayer(u.payer),
      "Invalid original unit state.",
    );
    validateStoredMenu(u.terms);
    assert(
      Number.isSafeInteger(u.terms.price) && u.terms.price > 0,
      "Invalid integer amount.",
    );
    assert(
      s.orders.some(
        (o) =>
          o.id === u.orderId && o.payer === u.payer && o.unitIds.includes(u.id),
      ),
      "Original payer/order binding lost.",
    );
  }
  for (const v of s.vouchers) {
    assert(
      ["active", "locked", "reported", "expired"].includes(v.state) &&
        Number.isSafeInteger(v.issued) &&
        v.issued <= s.now &&
        Number.isInteger(v.version) &&
        v.version > 0 &&
        typeof v.handedOver === "boolean",
      "Invalid original voucher state.",
    );
    assert(
      EMAILS.includes(v.email as (typeof EMAILS)[number]) &&
        v.expires - v.issued === LIFE,
      "Invalid synthetic identity or original expiry.",
    );
    const u = unitOf(s, v.unitId);
    assert(u, "Invalid voucher unit.");
    if (v.state === "active" || v.state === "locked")
      assert(u.bucket === "R", "Active voucher must retain allocated funding.");
    if (v.state === "locked" || v.state === "reported")
      assert(v.lockOwner === u.store, "Original processing owner lost.");
    if (v.state === "reported")
      assert(
        v.handedOver && ["H", "S"].includes(u.bucket),
        "Original handoff report lost.",
      );
    if (v.code)
      assert(
        typeof v.code.value === "string" &&
          v.code.value.startsWith(
            `mealforward:demo:${v.id}:v${v.version}:display`,
          ) &&
          v.code.version === v.version &&
          Number.isSafeInteger(v.code.expires) &&
          v.code.expires <= v.expires,
        "Invalid original display code.",
      );
  }
  for (const o of s.orders) {
    assert(
      Number.isSafeInteger(o.at) && o.at <= s.now,
      "Invalid original order timestamp.",
    );
    assert(
      stores.includes(o.store) &&
        typeof o.payer === "string" &&
        demoPayer(o.payer) &&
        nfts.includes(o.nft) &&
        Array.isArray(o.unitIds) &&
        new Set(o.unitIds).size === o.unitIds.length,
      "Invalid original order.",
    );
    assert(
      o.unitIds.every((id) =>
        s.units.some(
          (u) =>
            u.id === id &&
            u.orderId === o.id &&
            u.store === o.store &&
            u.payer === o.payer,
        ),
      ) &&
        o.amount ===
          o.unitIds.reduce((sum, id) => sum + unitOf(s, id).terms.price, 0),
      "Original order amount or units lost.",
    );
  }
}
function validateStoredMenu(menu: Menu) {
  validateMenuDraft(menu);
  assert(
    ["Lunch", "Dinner"].includes(menu.meal) &&
      Number.isInteger(menu.version) &&
      menu.version > 0 &&
      typeof menu.listed === "boolean" &&
      ["chicken.jpg", "tofu.jpg"].includes(menu.image),
    "Invalid original menu terms.",
  );
}
export function serialize(s: State) {
  invariants(s);
  return JSON.stringify(s);
}
export function deserialize(raw: string): State {
  const s = JSON.parse(raw) as State;
  invariants(s);
  assert(
    !s.email || EMAILS.includes(s.email as (typeof EMAILS)[number]),
    "Only built-in synthetic email identities are allowed.",
  );
  return s;
}
