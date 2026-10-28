import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import jsQR from "jsqr";
import { createMvpWallet } from "./wallet.mjs";
import {
  POLICIES,
  validateChallenge,
  validateQuote,
  validateTransaction,
} from "./guards.mjs";
import {
  Shell,
  Steps,
  Notice,
  request,
  errorText,
  labels,
  phases,
  roles,
} from "./shared.jsx";
const paths = {
  token: "/setup/token",
  escrow: "/setup/escrow",
  approve: "/donor/approve",
  fund: "/donor/fund",
  issue: "/issuer/issue",
  redeem: "/merchant/redeem",
  settle: "/merchant/settle",
};
const pending = (o) => o && o.state !== "CONFIRMED";
function save(o, hash) {
  try {
    localStorage.setItem(
      "mf-mvp-recovery-v1",
      JSON.stringify({
        id: o.id,
        action: o.action,
        hash: hash || o.txHash || o.candidateHash || null,
      }),
    );
  } catch {
    throw Error("RECOVERY_STORAGE_UNAVAILABLE");
  }
}
function readSaved() {
  try {
    return JSON.parse(localStorage.getItem("mf-mvp-recovery-v1"));
  } catch {
    return null;
  }
}
export function App({
  merchant = false,
  walletFactory = createMvpWallet,
  api = request,
  decodeQr = jsQR,
}) {
  const [status, setStatus] = useState(null),
    [session, setSession] = useState(null),
    [setup, setSetup] = useState(null),
    [providers, setProviders] = useState([]),
    [selected, setSelected] = useState(""),
    [observed, setObserved] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [op, setOp] = useState(null),
    [hash, setHash] = useState(""),
    [invite, setInvite] = useState(""),
    [check, setCheck] = useState(null),
    [code, setCode] = useState(""),
    [now, setNow] = useState(Date.now()),
    [camera, setCamera] = useState(false);
  const wallet = useRef(null),
    revision = useRef(0),
    working = useRef(false),
    sessionRef = useRef(null),
    setupRef = useRef(null),
    video = useRef(null),
    stream = useRef(null),
    frame = useRef(null),
    pendingScan = useRef(null);
  function stopCamera() {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  function invalidate() {
    stopCamera();
    revision.current++;
    pendingScan.current = null;
    sessionRef.current = null;
    setSession(null);
    setSetup(null);
    setupRef.current = null;
    setCheck(null);
    setOp(null);
    setObserved(null);
    setInvite("");
  }
  useEffect(() => {
    let alive = true;
    wallet.current = walletFactory({
      onChange: () => {
        if (alive) {
          invalidate();
          queueMicrotask(() => {
            if (alive) setProviders(wallet.current?.providers() || []);
          });
        }
      },
    });
    setProviders(wallet.current.providers());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    void run(async () => {
      const bootRevision = revision.current;
      setStatus(await api("/status"));
      try {
        const s = await api("/me");
        if (alive && bootRevision === revision.current) {
          sessionRef.current = s;
          setSession(s);
          await refresh(s);
        }
      } catch {
        // An unauthenticated first visit is an ordinary state.
      }
    });
    return () => {
      alive = false;
      revision.current++;
      pendingScan.current = null;
      clearInterval(tick);
      wallet.current.dispose();
      stopCamera();
    };
  }, []);
  async function run(fn) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      working.current = false;
      setBusy(false);
      drainScan();
    }
  }
  function drainScan() {
    if (working.current || !pendingScan.current) return;
    const queued = pendingScan.current;
    pendingScan.current = null;
    if (
      queued.revision !== revision.current ||
      queued.session !== sessionRef.current
    )
      return;
    void run(() => checkCode({ qrToken: queued.token }));
  }
  async function refresh(s = sessionRef.current) {
    if (!s) return;
    const r = revision.current;
    const [data, publicStatus] = await Promise.all([
      api("/setup"),
      api("/status"),
    ]);
    if (r !== revision.current || s !== sessionRef.current) return;
    setStatus(publicStatus);
    setupRef.current = data;
    setSetup(data);
    const active = data.operations.find(pending);
    setOp(active || null);
    if (active) {
      const saved = readSaved();
      setHash(
        active.txHash ||
          active.candidateHash ||
          (saved?.id === active.id ? saved.hash : "") ||
          "",
      );
    }
  }
  useEffect(() => {
    const id = setInterval(() => {
      if (!working.current && sessionRef.current)
        void run(async () => {
          const active = setupRef.current?.operations.find((o) =>
            ["SEND_UNKNOWN", "HASH_BOUND"].includes(o.state),
          );
          if (active && (active.txHash || active.candidateHash))
            await post("/operations/" + active.id + "/reconcile", {});
          await refresh();
        });
    }, 8000);
    return () => clearInterval(id);
  }, []);
  function assertContext(r, s) {
    if (r !== revision.current || s !== sessionRef.current)
      throw Error("WALLET_CONTEXT_CHANGED");
  }
  async function post(path, body, auth = sessionRef.current) {
    if (!auth?.csrf) throw Error("LOGIN_REQUIRED");
    return api(path, { body, csrf: auth.csrf });
  }
  async function login() {
    const obs = await wallet.current.connect();
    setObserved(obs);
    if (obs.chainId !== 10143) throw Error("SWITCH_TO_MONAD_TESTNET");
    if (!Object.values(POLICIES).includes(obs.account))
      throw Error("ROLE_DENIED");
    const r = revision.current;
    const pre = await api("/auth/pre-session", { body: {}, bootstrap: true });
    const c = await api("/identity/wallet/challenge", {
      body: { address: obs.account },
      csrf: pre.csrf,
    });
    validateChallenge(c, obs.account, location.origin);
    const signature = await wallet.current.signMessage(
      obs.account,
      c.message,
      () => {
        if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      },
    );
    if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
    await api("/identity/wallet/login", {
      body: { challengeId: c.challengeId, signature },
      csrf: pre.csrf,
    });
    const s = await api("/me");
    if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
    sessionRef.current = s;
    setSession(s);
    await refresh(s);
  }
  async function prepare(action) {
    const s = sessionRef.current,
      r = revision.current;
    const o = await post(
      paths[action] + "/prepare",
      action === "redeem" ? { checkToken: check.checkToken } : {},
    );
    save(o);
    assertContext(r, s);
    setOp(o);
    if (action === "redeem") setCheck(null);
    await refresh(s);
  }
  async function send() {
    const s = sessionRef.current,
      r = revision.current,
      o = op;
    assertContext(r, s);
    validateTransaction(
      o.transaction,
      o.action,
      s.wallet,
      setupRef.current.state,
    );
    await wallet.current.inspect();
    assertContext(r, s);
    save(o);
    // Fail closed even when the attempt response is lost.
    setOp({ ...o, state: "SEND_UNKNOWN", transaction: undefined });
    const result = await post("/operations/" + o.id + "/attempt", {});
    setOp(result.operation);
    if (result.allowed !== true) throw Error("SEND_NOT_ALLOWED");
    const txHash = await wallet.current.sendTransaction(
      s.wallet,
      o.transaction,
      () => assertContext(r, s),
    );
    setHash(txHash);
    save(o, txHash);
    if (r !== revision.current || s !== sessionRef.current)
      throw Error("HASH_SAVED_LOGIN_TO_RECOVER");
    await post("/operations/" + o.id + "/hash", { txHash });
    await refresh(s);
  }
  async function quote() {
    const s = sessionRef.current,
      r = revision.current;
    const q = await post("/quote", {});
    assertContext(r, s);
    validateQuote(q.typedData, setupRef.current.state);
    if (!q.verified) {
      const signature = await wallet.current.signTypedData(
        s.wallet,
        q.typedData,
        () => assertContext(r, s),
      );
      assertContext(r, s);
      await post("/quote/verify", { signature });
    }
    await refresh(s);
  }
  async function inviteCreate(rotate = false) {
    const value = await post("/issuer/invite", rotate ? { rotate: true } : {});
    setInvite(location.origin + "/mvp/recipient.html#" + value.token);
    await refresh();
  }
  async function checkCode(body) {
    const s = sessionRef.current,
      r = revision.current;
    const result = await post("/merchant/check", body);
    assertContext(r, s);
    setCheck(result);
  }
  async function startCamera() {
    const r = revision.current;
    setCamera(true);
    let media;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch (e) {
      setCamera(false);
      throw e;
    }
    if (r !== revision.current) {
      media.getTracks().forEach((t) => t.stop());
      setCamera(false);
      return;
    }
    stream.current = media;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!video.current) {
      stopCamera();
      return;
    }
    video.current.srcObject = media;
    await video.current.play();
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    function scan() {
      if (!stream.current || !video.current) return;
      const v = video.current;
      if (v.readyState >= 2) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const result = decodeQr(
          ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        );
        if (result) {
          stopCamera();
          pendingScan.current = {
            token: result.data,
            revision: r,
            session: sessionRef.current,
          };
          drainScan();
          return;
        }
      }
      frame.current = requestAnimationFrame(scan);
    }
    scan();
  }
  const phase = setup?.state.phase || "EMPTY",
    action = setup?.allowedAction,
    active = pending(op),
    writes = status?.enabled && status?.writesEnabled,
    rightPage = merchant
      ? ["redeem", "settle"].includes(action)
      : !["redeem", "settle"].includes(action),
    checkValid = check && Number(check.expiresAt) * 1000 > now,
    walletReady = !!selected,
    wait =
      Math.max(
        0,
        Math.ceil(
          (Number(setup?.state.settlementAvailableAt) * 1000 - now) / 1000,
        ),
      ) || 0;
  const canPrepare = !!(
    writes &&
    action &&
    rightPage &&
    !active &&
    (action !== "redeem" || checkValid) &&
    (action !== "settle" || setup.settleEnabled) &&
    (action !== "fund" || setup.quote?.verified)
  );
  return (
    <Shell page={merchant ? "merchant" : "setup"}>
      <section className="hero">
        <div>
          <p className="eyebrow">一份餐 · 一份关怀</p>
          <h1>{merchant ? "让善意，在这里交接。" : "让下一餐，有着落。"}</h1>
          <p>
            {merchant
              ? "核对餐券，确认交餐，再领取测试餐款。"
              : "从一份支持出发，连接机构、领取者与暖心餐馆。"}
          </p>
        </div>
        <div className="meal-art" aria-hidden="true">
          ♨<span>一份热餐</span>
        </div>
      </section>
      <Steps phase={phase} />
      <Notice busy={busy} error={error} />
      <div className="grid">
        <section className="card">
          <p className="eyebrow">01 · 身份与连接</p>
          <h2>{session ? roles[session.role] : "选择你的测试钱包"}</h2>
          <p>每次签名与交易都由你亲自确认。请使用 Monad Testnet（10143）。</p>
          <label>
            钱包
            <select
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                wallet.current.select(e.target.value);
              }}
            >
              <option value="">请选择钱包</option>
              {providers.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {providers.length === 0 ? (
            <p className="muted">
              未发现钱包。请在已安装钱包的浏览器中打开此页。
            </p>
          ) : null}
          <button disabled={busy || !selected} onClick={() => run(login)}>
            {session ? "重新验证钱包身份" : "连接钱包并签名登录"}
          </button>
          {session ? (
            <>
              <p className="success">身份已验证 · {roles[session.role]}</p>
              <p className="address">{session.wallet}</p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post("/auth/logout", {});
                    invalidate();
                  })
                }
              >
                退出登录
              </button>
            </>
          ) : null}
          {observed && observed.chainId !== 10143 ? (
            <p className="error">
              请在钱包中切换到 Monad Testnet，然后重新登录。
            </p>
          ) : null}
          <details>
            <summary>本轮固定角色</summary>
            {Object.entries(POLICIES).map(([r, a]) => (
              <p key={r}>
                {roles[r]}
                <br />
                <span className="address">{a}</span>
              </p>
            ))}
          </details>
        </section>
        <section className="card primary-card">
          <p className="eyebrow">02 · {merchant ? "餐券交接" : "当前进度"}</p>
          <h2>{session ? phases[phase] : "登录后继续这一份善意"}</h2>
          <div className="meal-line">
            <span className="meal-symbol">♨</span>
            <div>
              <strong>单份测试餐</strong>
              <p>全天供应 · 一张餐券</p>
            </div>
            <b>
              7 <small>测试代币</small>
            </b>
          </div>
          {!writes ? (
            <p className="notice">
              服务暂未开放新的操作。已发送交易仍可恢复核对。
            </p>
          ) : null}
          {session ? (
            <>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => run(() => refresh())}
              >
                刷新已确认进度 ↻
              </button>
              {setup?.nextAction ? (
                <p>
                  下一步：{labels[setup.nextAction]}
                  {!action ? " · 请切换至对应角色钱包并重新登录" : ""}
                </p>
              ) : null}
              {!merchant && ["ISSUED", "HANDED_OVER"].includes(phase) ? (
                <a className="button secondary" href="/mvp/merchant.html">
                  前往商家工作台 →
                </a>
              ) : null}
              {session.role === "owner" &&
              ["READY", "APPROVED"].includes(phase) ? (
                <div className="subcard">
                  <strong>店主确认本餐报价</strong>
                  <p>1 份 × 7 测试代币 · 30 分钟有效</p>
                  <button
                    disabled={
                      busy ||
                      !writes ||
                      !walletReady ||
                      active ||
                      (setup.quote?.verified &&
                        Number(setup.quote.deadline) * 1000 > now)
                    }
                    onClick={() => run(quote)}
                  >
                    {setup.quote?.verified &&
                    Number(setup.quote.deadline) * 1000 > now
                      ? "报价已签名验证"
                      : "签名确认测试餐报价"}
                  </button>
                </div>
              ) : null}
              {merchant && phase === "ISSUED" && session.role === "owner" ? (
                <div className="subcard">
                  <label>
                    领取者的 6 位取餐码
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, ""));
                        setCheck(null);
                      }}
                      placeholder="000000"
                    />
                  </label>
                  <button
                    disabled={busy || !writes || active || code.length !== 6}
                    onClick={() => run(() => checkCode({ code }))}
                  >
                    核对餐券
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !writes || active || camera}
                    onClick={() => run(startCamera)}
                  >
                    开启相机扫码
                  </button>
                  {camera ? (
                    <>
                      <video ref={video} playsInline muted />
                      <button className="secondary" onClick={stopCamera}>
                        关闭相机
                      </button>
                    </>
                  ) : null}
                  {checkValid ? (
                    <p className="success">
                      餐券有效 · {check.meal} · 7
                      测试代币。核对不代表已交餐，请在实际交餐后点击下方确认。
                    </p>
                  ) : check ? (
                    <p>核对凭证已过期，请重新核对。</p>
                  ) : null}
                </div>
              ) : null}
              {phase === "HANDED_OVER" ? (
                <p className="notice">
                  商家已声明交餐。
                  {wait > 0
                    ? `预计还需 ${wait} 秒`
                    : "正在等待链上结算资格核验"}
                  ；以服务端与链上核验为准。
                </p>
              ) : null}
              {phase === "SETTLED" ? (
                <p className="success">
                  餐券流程完成，测试代币付款已核验。交餐状态来自商家声明，不代表独立核实了实际用餐。
                </p>
              ) : null}
              {action && rightPage && !active ? (
                <>
                  <button
                    disabled={busy || !canPrepare}
                    onClick={() => run(() => prepare(action))}
                  >
                    准备{labels[action]}
                  </button>
                  {!canPrepare ? (
                    <p className="muted">
                      {!writes
                        ? "等待服务开放"
                        : action === "redeem"
                          ? "请先核对有效取餐码"
                          : action === "settle"
                            ? "等待链上 180 秒窗口结束并核验"
                            : action === "fund" && !setup.quote?.verified
                              ? "请店主先签名报价"
                              : "当前步骤暂不可执行"}
                    </p>
                  ) : (
                    <p className="muted">
                      先查看交易摘要，再由你打开钱包确认。
                    </p>
                  )}
                </>
              ) : null}
              {session.role === "issuer" && phase === "ISSUED" ? (
                <div className="subcard">
                  <h3>交给领取者的私密链接</h3>
                  <button
                    disabled={busy || !writes || setup.invitationCreated}
                    onClick={() => run(() => inviteCreate())}
                  >
                    生成私密领取链接
                  </button>
                  {setup.invitationCreated &&
                  !setup.invitationOpened &&
                  !invite ? (
                    <>
                      <p>
                        已生成的链接不会再次展示。若已遗失，可明确替换；原链接将失效。
                      </p>
                      <button
                        className="secondary"
                        disabled={busy || !writes}
                        onClick={() => run(() => inviteCreate(true))}
                      >
                        替换遗失的领取链接
                      </button>
                    </>
                  ) : null}
                  {invite ? (
                    <>
                      <label>
                        仅向领取者私下分享
                        <textarea readOnly value={invite} />
                      </label>
                      <button
                        className="secondary"
                        onClick={() =>
                          run(() => navigator.clipboard.writeText(invite))
                        }
                      >
                        复制私密链接
                      </button>
                      <a className="button secondary" href={invite}>
                        打开领取页
                      </a>
                    </>
                  ) : null}
                  {setup.invitationOpened ? (
                    <p>领取链接已打开，不可再替换。</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">
              店主准备 → 支持者捐赠 → 机构发券。已有进度保存在服务端。
            </p>
          )}
        </section>
      </div>
      {active ? (
        <section className="card recovery">
          <p className="eyebrow">03 · 原交易与恢复</p>
          <h2>
            {labels[op.action]} ·{" "}
            {op.state === "PREPARED" ? "待本人确认" : "等待原交易核验"}
          </h2>
          <p>
            {op.state === "PREPARED"
              ? "交易已准备，尚未申请发送。请核对下面的摘要。"
              : "已进入一次性发送阶段。钱包拒绝、超时或刷新后均不可重发；只恢复同一交易哈希。"}
          </p>
          {op.state === "PREPARED" && op.transaction ? (
            <>
              <dl>
                <dt>网络</dt>
                <dd>Monad Testnet · 10143</dd>
                <dt>动作</dt>
                <dd>{labels[op.action]}</dd>
                <dt>原生币转账</dt>
                <dd>0 MON（另需网络 Gas）</dd>
                <dt>目标</dt>
                <dd className="address">
                  {op.transaction.to || "创建本轮隔离测试合约"}
                </dd>
                <dt>发送账户</dt>
                <dd className="address">{op.transaction.from}</dd>
                <dt>Nonce</dt>
                <dd>{Number(op.transaction.nonce)}</dd>
              </dl>
              <button
                disabled={busy || !walletReady || !writes}
                onClick={() => run(send)}
              >
                本人打开钱包，发送这笔{labels[op.action]}交易
              </button>
            </>
          ) : null}
          <details>
            <summary>原操作标识与状态</summary>
            <p className="address">{op.id}</p>
            <p>{op.state}</p>
            {op.txHash || op.candidateHash ? (
              <p className="address">{op.txHash || op.candidateHash}</p>
            ) : null}
          </details>
          {op.state !== "PREPARED" ? (
            <>
              <label>
                原交易哈希
                <input
                  value={hash}
                  onChange={(e) => setHash(e.target.value.trim())}
                  placeholder="0x…"
                  spellCheck="false"
                />
              </label>
              <button
                className="secondary"
                disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)}
                onClick={() =>
                  run(async () => {
                    await post("/operations/" + op.id + "/hash", {
                      txHash: hash,
                    });
                    await refresh();
                  })
                }
              >
                绑定并核对原哈希
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post("/operations/" + op.id + "/reconcile", {});
                    await refresh();
                  })
                }
              >
                查询原交易确认结果
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}
if (document.getElementById("root"))
  createRoot(document.getElementById("root")).render(
    <App merchant={location.pathname.endsWith("merchant.html")} />,
  );
