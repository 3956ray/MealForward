import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Copy,
  Home,
  Info,
  Menu as MenuIcon,
  Minus,
  Plus,
  ReceiptText,
  Settings,
  ShieldCheck,
  Store as StoreIcon,
  Utensils,
  Wallet,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import * as M from "./model";
import type { State, StoreId, Meal, Operation, Menu, Voucher } from "./model";
const route = () => location.hash.slice(2) || "meals";
const labels: Record<string, string> = {
  meals: "Meals",
  orders: "My orders",
  claim: "Claim a meal",
  ledger: "Public ledger",
  owner: "Workbench",
  menu: "Menu",
  settlements: "Settlements",
  settings: "Store settings",
  records: "All records",
  voucher: "My voucher",
  payment: "Review payment",
  recovery: "Recover my voucher",
};
const opLabels: Record<M.Kind, string> = {
  fund: "Payment",
  issue: "Voucher issuance",
  lock: "Processing right",
  report: "Handoff report",
  settle: "Settlement",
  refund: "Refund",
};
function Status({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}) {
  const color = ["final", "active", "locked", "created", "approved"].includes(
    status,
  )
    ? "success"
    : ["unknown", "pending", "stale", "paused", "review"].includes(status)
      ? "info"
      : ["expired", "failed", "rejected", "incompatible"].includes(status)
        ? "error"
        : "neutral";
  return (
    <span className={`status ${color}`}>
      {color === "success" ? (
        <CheckCircle2 size={18} />
      ) : color === "error" ? (
        <AlertCircle size={18} />
      ) : (
        <Info size={18} />
      )}
      <span>{children ?? status}</span>
    </span>
  );
}
function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Photo({ menu, small = false }: { menu: Menu; small?: boolean }) {
  return (
    <img
      className={small ? "meal-thumb" : "meal-photo"}
      src={`/assets/${menu.image}`}
      width={small ? 80 : 256}
      height={small ? 72 : 160}
      alt={`Simulated ${menu.name}`}
      loading={small ? "eager" : "lazy"}
    />
  );
}
function load() {
  try {
    const raw = localStorage.getItem(M.STORAGE_KEY);
    return { state: raw ? M.deserialize(raw) : M.initialState(), error: "" };
  } catch {
    return {
      state: M.initialState(),
      error:
        "Saved demo data could not be read. It has not been replaced. Confirm a demo-only reset to continue.",
    };
  }
}
export default function App() {
  const [boot] = useState(load),
    [s, setS] = useState(boot.state),
    [storageError, setStorageError] = useState(boot.error);
  const [page, setPage] = useState(route),
    [store, setStore] = useState<StoreId>("meadow"),
    [counts, setCounts] = useState<Record<Meal, number>>({
      Lunch: 1,
      Dinner: 0,
    }),
    [nft, setNft] = useState(true);
  const [opId, setOpId] = useState(
      boot.state.ops.findLast((o) => o.kind === "fund")?.id ?? "",
    ),
    [voucherId, setVoucherId] = useState("demo-voucher-2"),
    [checked, setChecked] = useState("demo-voucher-1"),
    [paste, setPaste] = useState(""),
    [ownerChoice, setOwnerChoice] = useState<StoreId>("meadow");
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [ownerNav, setOwnerNav] = useState(false),
    [replacement, setReplacement] = useState<StoreId | null>(null);
  const [record, setRecord] = useState(""),
    [returnRecord, setReturnRecord] = useState(""),
    [welcome, setWelcome] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    swapDialog = useRef<HTMLDialogElement>(null),
    swapTrigger = useRef<HTMLElement | null>(null),
    resetDialog = useRef<HTMLDialogElement>(null),
    resetTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const change = () => {
      setPage(route());
      setError("");
      setNotice("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    heading.current?.focus();
    setOwnerNav(false);
  }, [page]);
  useEffect(() => {
    if (!storageError) {
      try {
        localStorage.setItem(M.STORAGE_KEY, M.serialize(s));
      } catch {
        setStorageError(
          "Demo storage is unavailable. Operations are paused; explicitly reset or enable local storage.",
        );
      }
    }
  }, [s, storageError]);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setS((old) => {
          if (storageError) return old;
          return M.transaction(old, (d) => M.advance(d, 1000));
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [storageError]);
  useEffect(() => {
    if (replacement) swapDialog.current?.showModal();
  }, [replacement]);
  useEffect(() => {
    if (resetOpen) resetDialog.current?.showModal();
  }, [resetOpen]);
  function act(fn: (draft: State) => void) {
    if (storageError) {
      setError(storageError);
      return false;
    }
    try {
      const next = M.transaction(s, fn);
      localStorage.setItem(M.STORAGE_KEY, M.serialize(next));
      setS(next);
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  const go = (to: string) => {
    location.hash = `/${to}`;
    setPage(to);
    setNotice("");
    setError("");
  };
  const ownerPage = [
    "owner",
    "menu",
    "settlements",
    "settings",
    "records",
    "record",
  ].includes(page);
  const selected = M.storeOf(s, ownerPage ? (s.owner ?? ownerChoice) : store),
    t = M.totals(s, selected.id);
  const currentVoucher = s.vouchers.find((v) => v.id === voucherId),
    currentOp = s.ops.find((o) => o.id === opId);
  const qty = counts.Lunch + counts.Dinner,
    total = selected.menus.reduce((a, m) => a + counts[m.meal] * m.price, 0);
  function changeStore(id: StoreId) {
    if (id === store) return;
    if (qty > 0) {
      swapTrigger.current = document.activeElement as HTMLElement;
      setReplacement(id);
    } else setStore(id);
  }
  function connect() {
    act((d) => {
      d.wallet = "demo-supporter-1";
    });
    setNotice("Demo wallet connected. No wallet extension was accessed.");
  }
  function confirmOp(id: string) {
    act((d) => M.resolve(d, id));
    setOpId(id);
  }
  function review() {
    let id = "";
    if (
      act((d) => {
        id = M.reviewFund(d, store, counts, nft);
      })
    ) {
      setOpId(id);
      go("payment");
    }
  }
  function viewVoucher(id: string) {
    setVoucherId(id);
    go("voucher");
  }
  const publicNav = (
    <nav aria-label="Public navigation">
      {["meals", "orders", "claim", "ledger"].map((p) => (
        <button
          key={p}
          aria-current={page === p ? "page" : undefined}
          onClick={() => go(p)}
        >
          {labels[p]}
        </button>
      ))}
    </nav>
  );
  const ownerLinks = [
    ["owner", Home],
    ["menu", Utensils],
    ["settlements", ReceiptText],
    ["settings", Settings],
  ] as const;
  function opPanel(o: Operation) {
    return (
      <section
        className="operation"
        aria-label={`${opLabels[o.kind]} original operation`}
      >
        <div className="row between">
          <h2>{opLabels[o.kind]}</h2>
          <Status status={o.status}>
            {o.status === "unknown"
              ? "Needs verification"
              : o.status === "final"
                ? `${opLabels[o.kind]} confirmed · Simulated`
                : o.status === "pending"
                  ? "Pending · Simulated"
                  : o.status === "rejected"
                    ? "Request declined"
                    : o.status === "failed"
                      ? "Safely failed"
                      : o.status}
          </Status>
        </div>
        <p className="secondary">Original operation: {o.id}</p>
        {M.isOpen(o) ? (
          <>
            <p>
              Only the original intent will be checked. No new payment or
              voucher is created.
            </p>
            <button className="primary" onClick={() => confirmOp(o.id)}>
              Check original operation
            </button>
            <p className="secondary">
              Demo controls determine the next simulated result.
            </p>
          </>
        ) : o.status === "final" ? (
          <p className="success-text">This original operation is complete.</p>
        ) : (
          <p>Return to the original step after a confirmed safe closure.</p>
        )}
      </section>
    );
  }
  const orderProgress = (order: M.Order) => {
    const units = order.unitIds.map((id) => M.unitOf(s, id));
    return {
      reported: units.filter((u) => ["H", "S"].includes(u.bucket)).length,
      refunded: units.filter((u) => u.bucket === "X").length,
      free: units.filter((u) => u.bucket === "A" && !M.reserved(s, u.id))
        .length,
      received: units
        .filter((u) => u.bucket === "S")
        .reduce((a, u) => a + u.terms.price, 0),
    };
  };
  function VoucherFacts({ v, owner = false }: { v: Voucher; owner?: boolean }) {
    const u = M.unitOf(s, v.unitId),
      st = M.storeOf(s, u.store);
    return (
      <>
        <div className="voucher-meal">
          <Photo menu={u.terms} small />
          <div>
            <h2>{u.terms.meal}</h2>
            <p>{u.terms.name}</p>
            <p>1 meal</p>
            {!owner && (
              <Status status={v.state}>
                {v.state === "active"
                  ? "Voucher active"
                  : v.state === "locked"
                    ? "Processing started"
                    : v.state === "reported"
                      ? "Meal reported · Simulated"
                      : "Voucher expired"}
              </Status>
            )}
          </div>
        </div>
        {owner ? (
          <Facts
            items={[
              ["Quantity", "1 meal"],
              ["Original price", M.money(u.terms.price)],
              ["Menu version", `v${u.terms.version}`],
              ["Serving window", `${u.terms.start}:00 – ${u.terms.end}:00`],
              ["Voucher expires", M.time(v.expires)],
            ]}
          />
        ) : (
          <Facts
            items={[
              ["Serving window", `${u.terms.start}:00 – ${u.terms.end}:00`],
              ["Issued", M.time(v.issued)],
              ["Valid until", M.time(v.expires)],
            ]}
          />
        )}
        <p className={`secondary ${owner ? "desktop-only" : ""}`}>
          {owner ? st.name + " · " : ""}Times in Asia/Shanghai.
        </p>
      </>
    );
  }
  let content: ReactNode;
  if (storageError) {
    content = (
      <section className="panel">
        <h1 ref={heading} tabIndex={-1}>
          Demo storage needs attention
        </h1>
        <p role="alert">{storageError}</p>
        <p>
          Saved original intents have not been silently reset. Use Demo controls
          below to confirm a reset of this demo namespace.
        </p>
      </section>
    );
  } else if (page === "meals") {
    content = (
      <div className="browse-grid">
        <section>
          <h1 ref={heading} tabIndex={-1}>
            Choose a meal
          </h1>
          <p className="subtitle">One store per order.</p>
          <div className="store-selector" aria-label="Choose a simulated store">
            {s.stores.map((st) => (
              <button
                key={st.id}
                aria-pressed={store === st.id}
                className={store === st.id ? "selected" : ""}
                onClick={() => changeStore(st.id)}
              >
                <StoreIcon size={25} />
                <span>
                  <strong>{st.name}</strong>
                  <small>{M.totals(s, st.id).supported} meals supported</small>
                </span>
              </button>
            ))}
          </div>
          <div className="store-heading">
            <div>
              <h2>
                {selected.name}{" "}
                <span className="secondary inline">Simulated store</span>
              </h2>
              <p className="secondary">
                Menu v{Math.max(...selected.menus.map((m) => m.version))} ·
                Monad Testnet
              </p>
            </div>
            <button
              className="text"
              onClick={() => {
                setNotice(
                  `Simulated website: ${selected.website}. This reserved example domain has no live store website.`,
                );
              }}
            >
              Visit store website <ArrowUpRight size={18} />
            </button>
          </div>
          {selected.paused && (
            <Status status="unknown">
              Store paused for an incident. New support and claims are paused.
            </Status>
          )}
          {selected.menus.map((m) => (
            <article className="meal-row" key={m.meal}>
              <Photo menu={m} />
              <div className="meal-info">
                <h2>{m.meal}</h2>
                <p className="meal-name">{m.name}</p>
                <p>{M.money(m.price)}</p>
                <p className="secondary row">
                  <Clock size={19} />
                  {m.start}:00 – {m.end}:00
                </p>
                <p className="secondary row">
                  <Utensils size={19} />
                  {
                    s.units.filter(
                      (u) => u.store === store && u.terms.meal === m.meal,
                    ).length
                  }{" "}
                  meals supported
                </p>
                {!m.listed && (
                  <Status status="neutral">
                    Unlisted · Existing vouchers keep their terms
                  </Status>
                )}
              </div>
              <div className="stepper-wrap">
                <span>Quantity</span>
                <div className="stepper">
                  <button
                    aria-label={`Decrease ${m.meal} quantity`}
                    disabled={counts[m.meal] === 0}
                    onClick={() =>
                      setCounts((c) => ({ ...c, [m.meal]: c[m.meal] - 1 }))
                    }
                  >
                    <Minus size={19} />
                  </button>
                  <output aria-label={`${m.meal} quantity`}>
                    {counts[m.meal]}
                  </output>
                  <button
                    aria-label={`Increase ${m.meal} quantity`}
                    className="add"
                    disabled={
                      !m.listed ||
                      selected.paused ||
                      t.supported + t.reservedSupport + qty >= 10
                    }
                    onClick={() =>
                      setCounts((c) => ({ ...c, [m.meal]: c[m.meal] + 1 }))
                    }
                  >
                    <Plus size={19} />
                  </button>
                </div>
              </div>
            </article>
          ))}
          <p className="secondary limit">
            Cumulative demo limit: {t.supported}/10 meals. Consumption and
            refunds do not restore this limit.
          </p>
        </section>
        <aside className="cart" aria-label="Your cart">
          <h2>Your cart</h2>
          <p className="cart-store">{selected.name}</p>
          {selected.menus
            .filter((m) => counts[m.meal] > 0)
            .map((m) => (
              <div className="cart-item" key={m.meal}>
                <Photo menu={m} small />
                <div>
                  <strong>
                    {m.meal} · {m.name}
                  </strong>
                  <p>
                    {counts[m.meal]} × {M.money(m.price)}
                  </p>
                </div>
              </div>
            ))}
          {!qty && <p>Your cart is empty. Choose a meal.</p>}
          <div className="cart-total" aria-live="polite">
            <h3>Total</h3>
            <div className="row between">
              <span>
                {qty} {qty === 1 ? "meal" : "meals"}
              </span>
              <strong>{M.money(total)}</strong>
            </div>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={nft}
              onChange={(e) => setNft(e.target.checked)}
            />
            <span>
              Receive one thank-you NFT
              <small>
                Optional. Public and non-transferable.
                <br />
                Sent to your original payment wallet after payment is final.
                <br />
                No extra NFT payment or signature.
              </small>
            </span>
          </label>
          <button
            className="primary full"
            disabled={!qty || selected.paused || s.source !== "fresh"}
            onClick={review}
          >
            Review payment
          </button>
          <p className="secondary">
            Wallet approval and payment are separate steps.
            <br />
            MON is used for gas. All actions here are simulated.
          </p>
          <div className="cart-foot">
            <p className="row secondary">
              <Info size={20} />
              Changing stores asks you to replace this cart.
            </p>
            <button className="text" onClick={() => go("owner")}>
              <ArrowUpRight size={19} />
              Store workspace
            </button>
          </div>
        </aside>
      </div>
    );
  } else if (page === "payment") {
    content = (
      <section className="narrow">
        <h1 ref={heading} tabIndex={-1}>
          Review payment
        </h1>
        {currentOp?.kind === "fund" ? (
          <>
            <Facts
              items={[
                ["Store", M.storeOf(s, currentOp.store).name],
                ["Demo payer", currentOp.payer ?? "Not connected"],
                [
                  "Meals",
                  currentOp
                    .items!.map(
                      (i) => `${i.terms.meal} v${i.terms.version} × ${i.count}`,
                    )
                    .join(", "),
                ],
                [
                  "Total",
                  M.money(
                    currentOp.items!.reduce(
                      (a, i) => a + i.count * i.terms.price,
                      0,
                    ),
                  ),
                ],
                [
                  "Payment destination",
                  `${currentOp.store} · simulated meal contract`,
                ],
                ["Approval", "Exact original order amount · test USDC"],
                ["Network", "Monad Testnet · simulated"],
                ["Gas", "MON · No real gas charged or estimated"],
              ]}
            />
            {M.isOpen(currentOp) || currentOp.status === "final" ? (
              <>
                {opPanel(currentOp)}
                {currentOp.status === "final" && (
                  <button
                    className="primary"
                    onClick={() => {
                      setCounts({ Lunch: 0, Dinner: 0 });
                      go("orders");
                    }}
                  >
                    View my orders
                  </button>
                )}
              </>
            ) : (
              <>
                <p>Approve and payment are separate simulated requests.</p>
                {!s.wallet ? (
                  <button className="primary" onClick={connect}>
                    Connect demo wallet
                  </button>
                ) : currentOp.status !== "approved" ? (
                  <button
                    className="primary"
                    onClick={() => act((d) => M.approve(d, currentOp.id))}
                  >
                    Approve exact amount · Demo
                  </button>
                ) : (
                  <button
                    className="primary"
                    onClick={() => act((d) => M.submit(d, currentOp.id))}
                  >
                    Confirm payment · Demo
                  </button>
                )}
                {["rejected", "failed"].includes(currentOp.status) && (
                  <Status status={currentOp.status}>
                    Original request {currentOp.status}; resume only this order.
                  </Status>
                )}
              </>
            )}
            <button className="text" onClick={() => go("meals")}>
              Edit cart
            </button>
          </>
        ) : (
          <p>No original payment selected. Return to Meals or My orders.</p>
        )}
      </section>
    );
  } else if (page === "orders") {
    const orders = s.orders.filter((o) => o.payer === s.wallet);
    const ops = s.ops.filter(
      (o) => o.payer === s.wallet && o.kind === "fund" && o.status !== "final",
    );
    content = (
      <section>
        <h1 ref={heading} tabIndex={-1}>
          My orders
        </h1>
        <p className="subtitle">
          Your original support, meal progress and independent thank-you.
        </p>
        {!s.wallet ? (
          <button className="primary" onClick={connect}>
            Connect demo wallet
          </button>
        ) : (
          <>
            <p className="secondary">Original demo payer: {s.wallet}</p>
            {ops.map((o) => (
              <div key={o.id}>
                {opPanel(o)}
                {!M.isOpen(o) && (
                  <button
                    className="text"
                    onClick={() => {
                      setOpId(o.id);
                      go("payment");
                    }}
                  >
                    Resume original payment
                  </button>
                )}
              </div>
            ))}
            {orders.length === 0 && <p>No orders yet.</p>}
            <div className="order-list">
              {orders.toReversed().map((o) => {
                const p = orderProgress(o);
                return (
                  <article className="order" key={o.id}>
                    <div className="row between">
                      <h2>{M.storeOf(s, o.store).name}</h2>
                      <Status status="final">
                        Payment confirmed · Simulated
                      </Status>
                    </div>
                    <p className="secondary">
                      {o.id} · {M.time(o.at)}
                    </p>
                    <Facts
                      items={[
                        [
                          "Supported",
                          `${o.unitIds.length} meals · ${M.money(o.amount)}`,
                        ],
                        [
                          "Reported",
                          `${p.reported}/${o.unitIds.length} meals · Simulated handoffs`,
                        ],
                        ["Refunded", `${p.refunded} meals`],
                        [
                          "Still pending",
                          `${o.unitIds.length - p.reported - p.refunded} meals`,
                        ],
                        ["Owner received", M.money(p.received)],
                      ]}
                    />
                    <div className="order-actions">
                      <button
                        disabled={!p.free || s.source !== "fresh"}
                        onClick={() => {
                          let id = "";
                          if (
                            act((d) => {
                              id = M.refund(d, o.id);
                            })
                          )
                            setOpId(id);
                        }}
                      >
                        Refund {p.free} safe free{" "}
                        {p.free === 1 ? "meal" : "meals"} · Demo
                      </button>
                      <p className="secondary">
                        Only unallocated original funds, returned to the
                        original demo payer.
                      </p>
                    </div>
                    {s.ops
                      .filter(
                        (op) =>
                          op.kind === "refund" &&
                          op.unitIds?.some((id) => o.unitIds.includes(id)),
                      )
                      .map((op) => (
                        <div key={op.id}>{opPanel(op)}</div>
                      ))}
                    <div className="thanks">
                      <h3>Thank-you feedback</h3>
                      <Status status={o.nft}>
                        {o.nft === "declined"
                          ? "NFT declined"
                          : o.nft === "created"
                            ? "Thank-you NFT created · Simulated"
                            : o.nft === "pending"
                              ? "Thank-you NFT pending"
                              : o.nft === "unknown"
                                ? "Thank-you NFT needs verification"
                                : o.nft === "paused"
                                  ? "NFT paused for budget"
                                  : "Wallet not compatible"}
                      </Status>
                      <p className="secondary">
                        Historical support thank-you. Funds may have been
                        refunded. Meal progress is shown above. No handoff NFT.
                      </p>
                      {o.nft === "pending" && (
                        <div className="row wrap">
                          <button
                            onClick={() =>
                              act((d) => {
                                d.orders.find((x) => x.id === o.id)!.nft =
                                  "created";
                              })
                            }
                          >
                            Complete simulated NFT
                          </button>
                          <button
                            onClick={() =>
                              act((d) => {
                                d.orders.find((x) => x.id === o.id)!.nft =
                                  "incompatible";
                              })
                            }
                          >
                            Simulate receiver failure
                          </button>
                          <button
                            className="text"
                            onClick={() =>
                              act((d) => {
                                d.orders.find((x) => x.id === o.id)!.nft =
                                  "declined";
                              })
                            }
                          >
                            Stop pending generation
                          </button>
                        </div>
                      )}
                      {o.nft === "created" && (
                        <button
                          className="text"
                          onClick={() => {
                            setRecord(o.id);
                            go("nft");
                          }}
                        >
                          View public thank-you
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    );
  } else if (page === "claim" || page === "recovery") {
    const recovery = page === "recovery";
    const issuance = s.ops.findLast(
      (o) => o.kind === "issue" && o.email === s.email,
    );
    content = (
      <section className="narrow">
        <h1 ref={heading} tabIndex={-1}>
          {recovery ? "Recover my voucher" : "Claim a meal"}
        </h1>
        <p className="subtitle">
          One meal across all stores every 72 hours. No wallet required.
        </p>
        <div className="panel">
          <h2>Demo email verification</h2>
          <p className="secondary">
            Choose a built-in fictional identity. No email is sent or real
            address collected.
          </p>
          <label>
            Built-in email
            <select
              value={s.email ?? M.EMAILS[1]}
              onChange={(e) =>
                act((d) => {
                  d.email = e.target.value;
                  d.verified = null;
                })
              }
            >
              {M.EMAILS.map((email) => (
                <option key={email}>{email}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              act((d) => {
                d.verified = d.email;
              })
            }
          >
            Simulate email verification
          </button>
          {s.verified === s.email && (
            <Status status="final">Demo email verified</Status>
          )}
        </div>
        {recovery ? (
          <>
            <p>
              Recovery keeps the original expiry and revokes the old display
              code. Used or expired vouchers cannot be restored.
            </p>
            <button
              className="primary"
              disabled={!s.verified}
              onClick={() => {
                let id = "";
                if (
                  act((d) => {
                    id = M.recover(d);
                  })
                )
                  viewVoucher(id);
              }}
            >
              Recover original demo voucher
            </button>
          </>
        ) : (
          <>
            <label>
              Store
              <select
                aria-label="Store"
                value={store}
                onChange={(e) => setStore(e.target.value as StoreId)}
              >
                {s.stores.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="claim-meals">
              {M.storeOf(s, store).menus.map((m) => (
                <button
                  key={m.meal}
                  disabled={
                    !s.verified || !m.listed || M.storeOf(s, store).paused
                  }
                  onClick={() => {
                    let id = "";
                    if (
                      act((d) => {
                        id = M.issue(d, store, m.meal);
                      })
                    )
                      setOpId(id);
                  }}
                >
                  Claim one {m.meal} · Demo
                </button>
              ))}
            </div>
            {s.verified && (s.cooldowns[s.verified] ?? 0) > s.now && (
              <p>
                Next eligible at {M.time(s.cooldowns[s.verified])} ·
                Asia/Shanghai
              </p>
            )}
            {issuance && (
              <>
                {opPanel(issuance)}
                {issuance.status === "final" && (
                  <button
                    className="primary"
                    onClick={() => viewVoucher(issuance.voucherId!)}
                  >
                    Open original voucher
                  </button>
                )}
              </>
            )}
            {s.verified &&
              s.vouchers
                .filter((v) => v.email === s.verified)
                .map((v) => (
                  <button
                    className="text"
                    key={v.id}
                    onClick={() => viewVoucher(v.id)}
                  >
                    Open my original voucher <ArrowRight size={18} />
                  </button>
                ))}
          </>
        )}
        <button
          className="text"
          onClick={() => go(recovery ? "claim" : "recovery")}
        >
          {recovery ? "Back to claim" : "Recover my voucher"}
        </button>
      </section>
    );
  } else if (page === "voucher") {
    const v = currentVoucher;
    const u = v ? M.unitOf(s, v.unitId) : undefined;
    content = (
      <section className="voucher-page narrow">
        <h1 ref={heading} tabIndex={-1}>
          My voucher
        </h1>
        {v && u ? (
          <>
            <h2 className="voucher-store">{M.storeOf(s, u.store).name}</h2>
            <p className="subtitle">Simulated store</p>
            <VoucherFacts v={v} />
            <section className="counter">
              <h2>At the counter</h2>
              <p>Show a short-lived code when you are ready.</p>
              {s.verified !== v.email ? (
                <>
                  <p>
                    Verify the original built-in email to access this demo
                    voucher.
                  </p>
                  <button onClick={() => go("recovery")}>
                    Verify through recovery
                  </button>
                </>
              ) : (
                <>
                  {M.validCode(s, v) ? (
                    <div className="code-area">
                      <Status status="active">
                        Code active ·{" "}
                        {Math.max(
                          0,
                          Math.ceil((v.code!.expires - s.now) / 1000),
                        )}{" "}
                        seconds
                      </Status>
                      <QRCodeSVG
                        value={v.code!.value}
                        size={168}
                        title="Demo-only voucher code"
                      />
                      <p className="code-string">{v.code!.value}</p>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(v.code!.value);
                            setNotice("Copied demo verification string.");
                          } catch {
                            setError(
                              "Clipboard unavailable. Select the displayed demo string to copy.",
                            );
                          }
                        }}
                      >
                        <Copy size={18} />
                        Copy verification string
                      </button>
                    </div>
                  ) : v.code || M.codeReason(s, v) ? (
                    <p className="secondary">
                      {M.codeReason(s, v) ??
                        "Code not shown. Any previous display code is no longer valid."}
                    </p>
                  ) : null}
                  <button
                    className="primary full"
                    disabled={!!M.codeReason(s, v)}
                    onClick={() => act((d) => M.showCode(d, v.id))}
                  >
                    {v.code
                      ? "Refresh verification code"
                      : "Show verification code"}
                  </button>
                </>
              )}
              <p className="secondary">
                Codes last up to 2 minutes, or until the serving window or
                voucher ends.
              </p>
              <button
                className="text recovery-link"
                onClick={() => go("recovery")}
              >
                Recover my voucher
              </button>
              <p className="secondary center">
                Recovery keeps the original expiry.
              </p>
            </section>
            <div className="voucher-foot">
              <p className="row">
                <Utensils size={22} />
                One meal per email every 72 hours.
              </p>
              <p className="row">
                <ReceiptText size={22} />
                No wallet required.
              </p>
            </div>
          </>
        ) : (
          <p>No voucher selected. Recover the original demo voucher.</p>
        )}
      </section>
    );
  } else if (ownerPage && !s.owner) {
    content = (
      <section className="narrow">
        <h1 ref={heading} tabIndex={-1}>
          Store workspace
        </h1>
        <p className="subtitle">Select and confirm a simulated store owner.</p>
        <label>
          Demo store owner
          <select
            value={ownerChoice}
            onChange={(e) => setOwnerChoice(e.target.value as StoreId)}
          >
            {s.stores.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} · demo owner
              </option>
            ))}
          </select>
        </label>
        <p className="secondary">
          This role selector is not real authentication or wallet ownership
          proof.
        </p>
        <button
          className="primary"
          onClick={() => {
            act((d) => {
              d.owner = ownerChoice;
            });
            setChecked(ownerChoice === "meadow" ? "demo-voucher-1" : "");
            go("owner");
          }}
        >
          <ShieldCheck size={19} />
          Confirm demo owner identity
        </button>
      </section>
    );
  } else if (page === "owner") {
    const v = s.vouchers.find(
      (v) => v.id === checked && M.unitOf(s, v.unitId).store === s.owner,
    );
    const pending = v
      ? s.ops.findLast((o) => o.voucherId === v.id && M.isOpen(o))
      : undefined;
    content = (
      <>
        <h1 ref={heading} tabIndex={-1}>
          <span className="desktop-only">Voucher &amp; handoff</span>
          <span className="mobile-only">Workbench</span>
        </h1>
        <div className="metrics desktop-metrics">
          {[
            ["Meals supported", `${t.supported} (max 10)`],
            ["Available now", t.available],
            ["Active vouchers", t.active],
            ["Reported handoffs", t.reported],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="owner-grid">
          <section className="panel current-voucher">
            <h2>Current voucher</h2>
            {v ? (
              <>
                <Status
                  status={
                    v.state === "locked"
                      ? "locked"
                      : v.state === "reported"
                        ? "final"
                        : v.state
                  }
                >
                  {v.state === "locked"
                    ? "Processing right confirmed"
                    : v.state === "reported"
                      ? "Handoff report confirmed · Simulated"
                      : v.state === "active"
                        ? "Voucher checked · Not consumed"
                        : "Voucher expired"}
                </Status>
                <p className="secondary">
                  {v.state === "locked"
                    ? "Awaiting handoff"
                    : v.state === "reported"
                      ? "Settlement is separate."
                      : "Check and obtain the unique processing right."}
                </p>
                <ol
                  className="voucher-progress desktop-only"
                  aria-label="Voucher processing progress"
                >
                  <li>
                    <CheckCircle2 size={22} />
                    Checked
                  </li>
                  <li>
                    {v.state === "locked" || v.state === "reported" ? (
                      <CheckCircle2 size={22} />
                    ) : (
                      <Clock size={22} />
                    )}
                    Processing right
                  </li>
                  <li>
                    {v.state === "reported" ? (
                      <CheckCircle2 size={22} />
                    ) : (
                      <Utensils size={22} />
                    )}
                    {v.state === "reported"
                      ? "Handoff reported"
                      : "Awaiting handoff"}
                  </li>
                </ol>
                <VoucherFacts v={v} owner />
                {pending ? (
                  opPanel(pending)
                ) : v.state === "locked" ? (
                  <>
                    <p className="secondary">
                      Confirm after handing over the meal. Settlement is
                      separate.
                    </p>
                    <button
                      className="primary full"
                      disabled={
                        selected.paused ||
                        (!v.handedOver &&
                          (s.now >= v.expires ||
                            !M.windowEnd(s.now, M.unitOf(s, v.unitId).terms)))
                      }
                      onClick={() => {
                        let id = "";
                        if (
                          act((d) => {
                            id = M.report(d, v.id);
                          })
                        )
                          setOpId(id);
                      }}
                    >
                      Confirm handoff &amp; report
                    </button>
                  </>
                ) : v.state === "active" ? (
                  <button
                    className="primary full"
                    disabled={!M.validCode(s, v)}
                    onClick={() => {
                      let id = "";
                      if (
                        act((d) => {
                          id = M.lock(d, v.id, paste);
                        })
                      )
                        setOpId(id);
                    }}
                  >
                    Obtain processing right · Demo
                  </button>
                ) : (
                  <button className="text" onClick={() => go("settlements")}>
                    View settlements <ArrowRight size={18} />
                  </button>
                )}
              </>
            ) : (
              <p>No current voucher checked.</p>
            )}
          </section>
          <aside className="owner-summary">
            <section className="settlement-summary">
              <h2>Settlement summary</h2>
              <div className="settlement-values">
                <div>
                  <p className="secondary">Awaiting settlement</p>
                  <strong>{M.money(t.H)}</strong>
                </div>
                <div>
                  <p className="secondary">Received</p>
                  <strong>{M.money(t.S)}</strong>
                </div>
              </div>
              <p className="secondary">
                Confirm each settlement in your demo wallet.
              </p>
              <button className="text" onClick={() => go("settlements")}>
                View settlements <ArrowRight size={18} />
              </button>
              <button
                className="text mobile-only"
                onClick={() => go("records")}
              >
                View all records <ArrowRight size={18} />
              </button>
            </section>
            <section className="today-menu">
              <div className="row between">
                <h2>Today’s menu</h2>
                <button className="text" onClick={() => go("menu")}>
                  Manage menu
                </button>
              </div>
              {selected.menus.map((m) => (
                <div className="cart-item" key={m.meal}>
                  <Photo menu={m} small />
                  <div>
                    <strong>{m.name}</strong>
                    <p className="secondary">
                      {M.money(m.price)} · v{m.version}
                    </p>
                  </div>
                </div>
              ))}
            </section>
          </aside>
        </div>
        <details className="mobile-only totals-disclosure">
          <summary>Store totals</summary>
          <Facts
            items={[
              ["Meals supported", `${t.supported} / 10`],
              ["Available now", t.available],
              ["Active vouchers", t.active],
              ["Reported handoffs", t.reported],
            ]}
          />
        </details>
        <section className="recent desktop-only">
          <div className="row between">
            <h2>Recent operations</h2>
            <button className="text" onClick={() => go("records")}>
              View all records <ArrowRight size={18} />
            </button>
          </div>
          {recordsList(true)}
        </section>
        <details className="verify">
          <summary>Check another demo voucher</summary>
          <label>
            Verification string
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste mealforward:demo:…"
            />
          </label>
          <button
            onClick={() => {
              const found = s.vouchers.find(
                (v) => M.validCode(s, v) && v.code?.value === paste.trim(),
              );
              if (!found) {
                setError(
                  "No active code matches. Ask the demo recipient to refresh.",
                );
                return;
              }
              if (M.unitOf(s, found.unitId).store !== s.owner) {
                setError("This voucher belongs to another store.");
                return;
              }
              setChecked(found.id);
              setError("");
              setNotice("Voucher checked. It has not been consumed.");
            }}
          >
            Check demo verification string
          </button>
          <label>
            Or choose an original demo record
            <select
              value={checked}
              onChange={(e) => {
                setChecked(e.target.value);
                const found = M.voucherOf(s, e.target.value);
                setPaste(found.code?.value ?? "");
              }}
            >
              <option value="">Choose a record</option>
              {s.vouchers
                .filter((v) => M.unitOf(s, v.unitId).store === s.owner)
                .map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.id} · {v.state}
                  </option>
                ))}
            </select>
          </label>
          <p className="secondary">
            Choosing a record does not bypass the active-code requirement for a
            new lock.
          </p>
        </details>
      </>
    );
  } else if (page === "settlements") {
    const units = s.units.filter(
      (u) => u.store === s.owner && u.bucket === "H",
    );
    content = (
      <section>
        <h1 ref={heading} tabIndex={-1}>
          Settlements
        </h1>
        <p className="subtitle">
          Each original item is settled separately by this store’s demo owner
          wallet.
        </p>
        <Facts
          items={[
            ["Awaiting settlement", M.money(t.H)],
            ["Received", M.money(t.S)],
            ["Original beneficiary", `${selected.id} · demo owner wallet`],
            ["Gas", "Demo MON · No real signature or fee"],
          ]}
        />
        {units.length === 0 && <p>No items awaiting settlement.</p>}
        {units.map((u) => {
          const o = s.ops.findLast(
            (o) => o.kind === "settle" && o.unitIds?.includes(u.id),
          );
          return (
            <article className="order" key={u.id}>
              <h2>
                {u.terms.meal} · {u.terms.name}
              </h2>
              <p>
                Original v{u.terms.version} · {M.money(u.terms.price)}
              </p>
              <p className="secondary">Original responsibility: {u.id}</p>
              {o && M.isOpen(o) ? (
                opPanel(o)
              ) : (
                <button
                  className="primary"
                  onClick={() => {
                    let id = "";
                    if (
                      act((d) => {
                        id = M.settle(d, u.id);
                      })
                    )
                      setOpId(id);
                  }}
                >
                  Settle selected item · Demo wallet
                </button>
              )}
              {o && ["failed", "rejected"].includes(o.status) && (
                <Status status={o.status}>
                  No funds received. Original amount remains due.
                </Status>
              )}
            </article>
          );
        })}
        <button className="text" onClick={() => go("owner")}>
          <ArrowLeft size={18} />
          Back to workbench
        </button>
      </section>
    );
  } else if (page === "menu") {
    content = (
      <section>
        <h1 ref={heading} tabIndex={-1}>
          Menu
        </h1>
        <p className="subtitle">
          New versions change future support. Existing vouchers keep their
          original price and terms.
        </p>
        {selected.menus.map((m) => (
          <MenuEditor
            key={`${selected.id}-${m.meal}-${m.version}`}
            m={m}
            draft={s.menuDrafts?.[`${selected.id}-${m.meal}`]}
            onSave={(draft) => {
              if (act((d) => M.saveMenuDraft(d, selected.id, m.meal, draft)))
                setNotice(
                  "Draft saved in this demo. Published and funded terms are unchanged.",
                );
            }}
            onPublish={(draft) => {
              if (act((d) => M.publish(d, selected.id, m.meal, draft)))
                setNotice(
                  "New menu version published · Simulated. Original funded terms are unchanged.",
                );
            }}
            onToggle={() =>
              act((d) => {
                M.storeOf(d, selected.id).menus.find(
                  (x) => x.meal === m.meal,
                )!.listed = !m.listed;
              })
            }
          />
        ))}
      </section>
    );
  } else if (page === "settings") {
    content = (
      <section className="narrow">
        <h1 ref={heading} tabIndex={-1}>
          Store settings
        </h1>
        <StoreSettings
          key={selected.id}
          store={selected}
          save={(description, website) => {
            if (
              act((d) => {
                const st = M.storeOf(d, selected.id);
                st.description = description;
                st.website = website;
              })
            )
              setNotice("Store settings saved · Demo.");
          }}
        />
        <section className="rule-section">
          <h2>Incident pause</h2>
          <p>
            Separate from unlisting a meal. Existing locked and reported
            responsibilities remain.
          </p>
          <button
            onClick={() =>
              act((d) => {
                M.storeOf(d, selected.id).paused = !selected.paused;
              })
            }
          >
            {selected.paused
              ? "Resume demo store"
              : "Pause store for an incident"}
          </button>
        </section>
        <section className="rule-section">
          <h2>Demo welcome NFT</h2>
          <p>
            One optional joining memento per store. Simulated, public,
            non-transferable; not certification or business access.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={welcome}
              onChange={(e) => setWelcome(e.target.checked)}
            />
            <span>Receive a demo welcome NFT</span>
          </label>
          <Status status={selected.welcome}>{selected.welcome}</Status>
          <button
            disabled={
              !welcome || selected.welcome !== "declined" || selected.paused
            }
            onClick={() =>
              act((d) => {
                M.storeOf(d, selected.id).welcome = "created";
              })
            }
          >
            Generate one welcome NFT · Demo
          </button>
        </section>
        <button
          className="text"
          onClick={() =>
            act((d) => {
              d.owner = null;
            })
          }
        >
          Switch demo owner identity
        </button>
      </section>
    );
  } else if (page === "ledger") {
    content = (
      <section>
        <h1 ref={heading} tabIndex={-1}>
          Public meal ledger
        </h1>
        <p className="subtitle">
          Final simulated funds. Pending operations and NFT status are separate.
        </p>
        <div className="store-selector">
          {s.stores.map((st) => (
            <button
              aria-pressed={store === st.id}
              className={store === st.id ? "selected" : ""}
              key={st.id}
              onClick={() => setStore(st.id)}
            >
              <StoreIcon size={23} />
              <strong>{st.name}</strong>
            </button>
          ))}
        </div>
        <h2>{selected.name} · Simulated store</h2>
        <Facts
          items={[
            ["Meals supported", `${t.supported} / 10 cumulative`],
            ["Available meals", t.available],
            ["Active vouchers", t.active],
            ["Reported handoffs", t.reported],
            ["Pending original operations", t.pending],
            ["F · Final support", M.money(t.F)],
            ["A · Free funds", M.money(t.A)],
            ["R · Allocated funds", M.money(t.R)],
            ["H · Awaiting settlement", M.money(t.H)],
            ["S · Received", M.money(t.S)],
            ["X · Refunded", M.money(t.X)],
          ]}
        />
        <p className="success-text">F = A + R + H + S + X · {M.money(t.F)}</p>
        <p className="secondary">
          Observed at {M.time(s.now)} · Asia/Shanghai · Local simulated state.
          Reported includes both awaiting settlement and received.
        </p>
        <h2>Public operations</h2>
        {s.ops
          .filter((o) => o.store === store)
          .toReversed()
          .map((o) => (
            <button
              className="record-row"
              key={o.id}
              onClick={() => {
                setRecord(o.id);
                go("public-operation");
              }}
            >
              <span>{M.time(o.at)}</span>
              <strong>{opLabels[o.kind]}</strong>
              <Status status={o.status}>
                {o.status === "unknown" ? "Needs verification" : o.status}
              </Status>
              <ArrowRight size={18} />
            </button>
          ))}
      </section>
    );
  } else if (page === "records") {
    content = (
      <section>
        <h1 ref={heading} tabIndex={-1}>
          All records
        </h1>
        <p className="subtitle">Original operations for {selected.name}.</p>
        {recordsList(false)}
        <button className="text" onClick={() => go("owner")}>
          <ArrowLeft size={18} />
          Back to workbench
        </button>
      </section>
    );
  } else if (page === "record" || page === "public-operation") {
    const o = s.ops.find((o) => o.id === record);
    content = (
      <section className="narrow">
        <h1 ref={heading} tabIndex={-1}>
          Original operation
        </h1>
        {o ? (
          <>
            <Facts
              items={[
                ["Operation", o.id],
                ["Store", M.storeOf(s, o.store).name],
                ["Action", opLabels[o.kind]],
                ["Started", M.time(o.at)],
                [
                  "Status",
                  o.status === "unknown" ? "Needs verification" : o.status,
                ],
              ]}
            />
            {page === "record" &&
              s.owner === o.store &&
              M.isOpen(o) &&
              opPanel(o)}
          </>
        ) : (
          <p>No original record selected.</p>
        )}
        <button
          className="text"
          onClick={() => {
            go(page === "record" ? "records" : "ledger");
            setTimeout(
              () => document.getElementById(returnRecord)?.focus(),
              50,
            );
          }}
        >
          <ArrowLeft size={18} />
          Back to records
        </button>
      </section>
    );
  } else if (page === "nft") {
    const o = s.orders.find((o) => o.id === record);
    content = (
      <section className="narrow">
        <h1 ref={heading} tabIndex={-1}>
          Thank you for sharing a meal
        </h1>
        <Status status="info">Frontend demo · No NFT was minted</Status>
        <p>Historical support thank-you. Funds may have been refunded.</p>
        {o && (
          <Facts
            items={[
              ["Simulated store", M.storeOf(s, o.store).name],
              ["Type", "SUPPORT · Public and non-transferable"],
              ["Original demo payer", o.payer],
            ]}
          />
        )}
        <p className="secondary">
          This public memento grants no meal, refund or private-order access.
        </p>
        <button className="text" onClick={() => go("orders")}>
          Back to my orders
        </button>
      </section>
    );
  } else {
    content = (
      <section>
        <h1 ref={heading} tabIndex={-1}>
          Page not found
        </h1>
        <button onClick={() => go("meals")}>Return to meals</button>
      </section>
    );
  }
  function recordsList(short: boolean) {
    const rows = s.ops
      .filter((o) => o.store === (s.owner ?? store))
      .toReversed()
      .slice(0, short ? 5 : 100);
    return (
      <div className="record-list">
        {rows.map((o) => (
          <button
            id={`record-${o.id}`}
            className="record-row"
            key={o.id}
            onClick={() => {
              setRecord(o.id);
              setReturnRecord(`record-${o.id}`);
              go("record");
            }}
          >
            <span>{M.time(o.at)}</span>
            <strong>
              {opLabels[o.kind]} {o.status === "final" ? "final" : ""}
            </strong>
            <Status status={o.status}>
              {o.status === "unknown"
                ? "Needs verification"
                : o.status === "final"
                  ? "Confirmed · Simulated"
                  : o.status}
            </Status>
            <ArrowRight size={18} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          heading.current?.focus();
          heading.current?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to main content
      </a>
      {ownerPage ? (
        <>
          <aside className="owner-sidebar">
            <button className="brand" onClick={() => go("meals")}>
              MealForward
            </button>
            <strong>{selected.name}</strong>
            <p className="secondary">Simulated store</p>
            <nav aria-label="Owner navigation">
              {ownerLinks.map(([p, Icon]) => (
                <button
                  key={p}
                  aria-current={page === p ? "page" : undefined}
                  onClick={() => go(p)}
                >
                  <Icon size={22} />
                  {labels[p]}
                </button>
              ))}
            </nav>
            <p className="sidebar-foot">Frontend demo · Test assets</p>
          </aside>
          <header className="owner-header">
            <button className="brand mobile-only" onClick={() => go("meals")}>
              MealForward
            </button>
            <button
              className="icon mobile-only"
              aria-label="Open store menu"
              aria-expanded={ownerNav}
              onClick={() => setOwnerNav(!ownerNav)}
            >
              <MenuIcon />
            </button>
            <div className="owner-identity">
              <strong>{selected.name}</strong>
              <p className="secondary">
                Simulated store · {s.owner ? "Demo owner" : "Choose identity"}
              </p>
            </div>
            <div className="observed">
              <strong>{M.time(s.now)}</strong>
              <small>Demo · Asia/Shanghai</small>
            </div>
            {ownerNav && (
              <nav
                className="mobile-owner-nav"
                aria-label="Mobile owner navigation"
              >
                {ownerLinks.map(([p, Icon]) => (
                  <button key={p} onClick={() => go(p)}>
                    <Icon size={20} />
                    {labels[p]}
                  </button>
                ))}
              </nav>
            )}
          </header>
        </>
      ) : (
        <header
          className={`public-header ${page === "voucher" ? "voucher-header" : ""}`}
        >
          {page === "voucher" && (
            <button className="text" onClick={() => go("meals")}>
              <ArrowLeft size={22} />
              Meals
            </button>
          )}
          <button className="brand" onClick={() => go("meals")}>
            MealForward
          </button>
          {page !== "voucher" && publicNav}
          <div className="header-right">
            {page !== "voucher" && (
              <button onClick={connect}>
                <Wallet size={18} />
                {s.wallet ? "Demo wallet connected" : "Connect demo wallet"}
              </button>
            )}
            <small>
              {page === "voucher"
                ? "Frontend demo"
                : "Frontend demo · Simulated data"}
            </small>
            <small>{M.time(s.now)} · Asia/Shanghai</small>
          </div>
        </header>
      )}
      <main id="main" className={ownerPage ? "owner-main" : "public-main"}>
        {s.source !== "fresh" && (
          <div className="source-warning" role="status">
            {s.source === "stale"
              ? "Data may be out of date"
              : "Current source needs verification"}
            . Last simulated values are retained.{" "}
            <button
              onClick={() =>
                act((d) => {
                  d.source = "fresh";
                })
              }
            >
              Refresh demo source
            </button>
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            <AlertCircle size={20} />
            {error}
            <button className="text" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div className="message info" role="status">
            {notice}
          </div>
        )}
        {content}
        <details className="demo-controls">
          <summary>Demo controls · Scenarios, time and reset</summary>
          <p className="secondary">
            Synthetic state only. These controls do not represent real
            permissions or chain evidence.
          </p>
          <div className="controls-grid">
            <label>
              Next operation result
              <select
                value={s.outcome}
                onChange={(e) =>
                  act((d) => {
                    d.outcome = e.target.value as M.Outcome;
                  })
                }
              >
                <option value="final">Final on original check</option>
                <option value="pending">Keep pending</option>
                <option value="unknown">UNKNOWN · Needs verification</option>
                <option value="rejected">Request rejected</option>
                <option value="failed">Proven failed</option>
              </select>
            </label>
            <label>
              Data source
              <select
                value={s.source}
                onChange={(e) =>
                  act((d) => {
                    d.source = e.target.value as State["source"];
                  })
                }
              >
                <option value="fresh">Fresh simulated source</option>
                <option value="stale">Stale</option>
                <option value="unavailable">Unavailable</option>
                <option value="reorg">Reorg · Needs verification</option>
              </select>
            </label>
            <label>
              Demo payment wallet
              <select
                value={s.wallet ?? ""}
                onChange={(e) =>
                  act((d) => {
                    d.wallet = e.target.value || null;
                  })
                }
              >
                <option value="">Disconnected</option>
                <option>demo-supporter-1</option>
                <option>demo-supporter-2</option>
              </select>
            </label>
            <label>
              Test USDC scenario
              <select
                value={s.balance === 0 ? "empty" : "funded"}
                onChange={(e) =>
                  act((d) => {
                    d.balance = e.target.value === "empty" ? 0 : 100 * M.SCALE;
                  })
                }
              >
                <option value="funded">Enough synthetic balance</option>
                <option value="empty">Insufficient balance</option>
              </select>
            </label>
          </div>
          <div className="row wrap">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={s.gas}
                onChange={(e) =>
                  act((d) => {
                    d.gas = e.target.checked;
                  })
                }
              />
              <span>Enough demo MON for gas</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={s.network}
                onChange={(e) =>
                  act((d) => {
                    d.network = e.target.checked;
                  })
                }
              />
              <span>Demo network is Monad Testnet</span>
            </label>
          </div>
          <div className="row wrap">
            {[
              ["+ 121 seconds", 121000],
              ["+ 2 hours", 2 * M.HOUR],
              ["+ 72 hours", M.LIFE],
            ].map(([label, ms]) => (
              <button
                key={label}
                onClick={() => act((d) => M.advance(d, Number(ms)))}
              >
                <Clock size={18} />
                {label}
              </button>
            ))}
            <button ref={resetTrigger} onClick={() => setResetOpen(true)}>
              <RefreshCw size={18} />
              Reset this demo only
            </button>
          </div>
        </details>
        <footer>
          MealForward · Frontend demo · Simulated stores, identities and
          transactions
        </footer>
      </main>
      <dialog
        ref={resetDialog}
        aria-labelledby="demo-reset-title"
        onCancel={() => setResetOpen(false)}
      >
        <h2 id="demo-reset-title">Reset this demo?</h2>
        <p>
          This clears only CP29-UI03 synthetic data, including saved original
          UNKNOWN operations. It restores the built-in fixture.
        </p>
        <p>Old services and other saved data are not changed.</p>
        <div className="row wrap">
          <button
            autoFocus
            onClick={() => {
              resetDialog.current?.close();
              setResetOpen(false);
              resetTrigger.current?.focus();
            }}
          >
            Keep demo data
          </button>
          <button
            className="primary"
            onClick={() => {
              resetDialog.current?.close();
              setResetOpen(false);
              try {
                const next = M.initialState();
                localStorage.setItem(M.STORAGE_KEY, M.serialize(next));
                setStorageError("");
                setS(next);
                setChecked("demo-voucher-1");
                setVoucherId("demo-voucher-2");
                setOpId("");
                setStore("meadow");
                setCounts({ Lunch: 1, Dinner: 0 });
                go("meals");
              } catch {
                setStorageError("Local storage remains unavailable.");
              }
            }}
          >
            Confirm demo-only reset
          </button>
        </div>
      </dialog>
      <dialog ref={swapDialog} onCancel={() => setReplacement(null)}>
        <h2>Replace your cart?</h2>
        <p>Changing stores replaces the current single-store cart.</p>
        <div className="row wrap">
          <button
            onClick={() => {
              swapDialog.current?.close();
              setReplacement(null);
              swapTrigger.current?.focus();
            }}
          >
            Keep current cart
          </button>
          <button
            className="primary"
            onClick={() => {
              setStore(replacement!);
              setCounts({ Lunch: 0, Dinner: 0 });
              swapDialog.current?.close();
              setReplacement(null);
            }}
          >
            Replace cart
          </button>
        </div>
      </dialog>
    </>
  );
}
function MenuEditor({
  m,
  draft,
  onSave,
  onPublish,
  onToggle,
}: {
  m: Menu;
  draft?: Pick<Menu, "name" | "price" | "start" | "end">;
  onSave: (d: Pick<Menu, "name" | "price" | "start" | "end">) => void;
  onPublish: (d: Pick<Menu, "name" | "price" | "start" | "end">) => void;
  onToggle: () => void;
}) {
  const [name, setName] = useState(draft?.name ?? m.name),
    [price, setPrice] = useState(String((draft?.price ?? m.price) / M.SCALE)),
    [start, setStart] = useState(String(draft?.start ?? m.start)),
    [end, setEnd] = useState(String(draft?.end ?? m.end)),
    [preview, setPreview] = useState(false);
  return (
    <section className="menu-editor">
      <div className="row between">
        <h2>
          {m.meal} · v{m.version}
        </h2>
        <Status status="neutral">{m.listed ? "Listed" : "Unlisted"}</Status>
      </div>
      <div className="editor-grid">
        <Photo menu={m} />
        <div>
          <label>
            Meal name
            <input
              maxLength={140}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Future price · test USDC
            <input
              inputMode="decimal"
              type="number"
              min="0.000001"
              max="1000"
              step="0.000001"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              Window start hour
              <input
                type="number"
                min="0"
                max="23"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Window end hour
              <input
                type="number"
                min="1"
                max="24"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <div className="row wrap">
            <button
              onClick={() =>
                onSave({
                  name,
                  price: Math.round(Number(price) * M.SCALE),
                  start: Number(start),
                  end: Number(end),
                })
              }
            >
              Save draft
            </button>
            <button onClick={() => setPreview(!preview)}>Preview</button>
            <button
              className="primary"
              onClick={() =>
                onPublish({
                  name,
                  price: Math.round(Number(price) * M.SCALE),
                  start: Number(start),
                  end: Number(end),
                })
              }
            >
              Publish new version
            </button>
            <button onClick={onToggle}>
              {m.listed ? "Unlist meal" : "List meal"}
            </button>
          </div>
          {preview && (
            <p>
              {name} · {price} test USDC · {start}:00–{end}:00 · New version
              preview
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
function StoreSettings({
  store,
  save,
}: {
  store: M.Store;
  save: (description: string, website: string) => void;
}) {
  const [description, setDescription] = useState(store.description),
    [website, setWebsite] = useState(store.website),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const url = new URL(website);
          if (url.protocol !== "https:" || !url.hostname.endsWith(".invalid"))
            throw new Error(
              "Use an https://… .invalid example domain. No live store website is connected.",
            );
          save(description, website);
          setError("");
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label>
        Store introduction
        <textarea
          maxLength={300}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label>
        Simulated website · .invalid only
        <input value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary" type="submit">
        Save store settings
      </button>
    </form>
  );
}
