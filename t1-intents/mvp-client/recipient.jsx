import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";
import { Shell, Steps, Notice, request, phases } from "./shared.jsx";
import { captureFragment, displayRemaining } from "./recipient-state.mjs";
const privateToken = location.pathname.includes("product") ? "" : captureFragment(window);
export function Recipient({ token = privateToken, api = request, shell: PageShell = Shell }) {
  const secret = useRef(token),
    working = useRef(false),
    ready = useRef(false),
    [voucher, setVoucher] = useState(null),
    [display, setDisplay] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  async function run(fn, quiet = false) {
    if (working.current) return;
    working.current = true;
    if (!quiet) { setBusy(true); setError(""); }
    try {
      await fn();
    } catch {
      if (!quiet)
        setError(
          "暂时无法完成，请重新查询。若领取链接或取餐码已过期，请联系机构或手动刷新取餐码。",
        );
    } finally {
      working.current = false;
      if (!quiet) setBusy(false);
    }
  }
  async function refresh() {
    const next = await api("/recipient/voucher");
    ready.current = true;
    setVoucher(next);
    if (next.state !== "ISSUED") setDisplay(null);
  }
  useEffect(() => {
    if (!secret.current) void run(refresh, true);
    const tick = setInterval(() => setNow(Date.now()), 1000),
      poll = setInterval(() => {
        if (!working.current && ready.current && !secret.current)
          void run(refresh, true);
      }, 8000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, []);
  const remaining = displayRemaining(display, now),
    show = display && remaining > 0 && voucher?.state === "ISSUED";
  return (
    <PageShell page="recipient">
      <section className="hero">
        <div>
          <p className="eyebrow">为你留好的一餐</p>
          <h1>一份热餐，安心领取。</h1>
          <p>无需注册，也无需钱包。到店后向商家出示取餐码即可。</p>
        </div>
        <div className="meal-art" aria-hidden="true">
          ♨<span>温暖已备好</span>
        </div>
      </section>
      <Steps phase={voucher?.state || "ISSUED"} />
      <div className="recipient-wrap">
        <Notice error={error} busy={busy} />
        <section className="card primary-card">
          <p className="eyebrow">你的餐券</p>
          <h2>{voucher ? phases[voucher.state] : "查看为你准备的餐券"}</h2>
          <div className="meal-line">
            <span className="meal-symbol">♨</span>
            <div>
              <strong>单份测试餐</strong>
              <p>全天供应 · 一人一份</p>
            </div>
            <b>
              7 <small>测试 USDC</small>
            </b>
          </div>
          {secret.current ? (
            <>
              <p>私密领取链接已从地址栏移除。请点击下方按钮查看餐券。</p>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api("/recipient/exchange", {
                      body: { token: secret.current },
                      bootstrap: true,
                    });
                    secret.current = "";
                    await refresh();
                  })
                }
              >
                查看餐券
              </button>
            </>
          ) : null}
          {voucher ? (
            <>
              <p>
                餐券有效至{" "}
                {new Date(Number(voucher.expiresAt) * 1000).toLocaleString(
                  "zh-CN",
                )}
              </p>
              {voucher.state === "ISSUED" ? (
                <>
                  <p>到店后再生成取餐码。有效期最多 2 分钟，请勿公开分享。</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setDisplay(null);
                        setDisplay(
                          await api("/recipient/display", {
                            body: {},
                            csrf: voucher.csrf,
                          }),
                        );
                      })
                    }
                  >
                    {display
                      ? "刷新取餐码（旧码立即失效）"
                      : "到店了，生成取餐码"}
                  </button>
                  {show ? (
                    <div className="qr-panel">
                      <QRCodeSVG
                        value={display.qrToken}
                        size={208}
                        marginSize={2}
                        title="出示给商家核对的短时取餐二维码"
                      />
                      <strong className="pickup-code">{display.code}</strong>
                      <p>{remaining} 秒后失效</p>
                    </div>
                  ) : display ? (
                    <p className="notice">取餐码已过期并隐藏，请手动刷新。</p>
                  ) : null}
                </>
              ) : (
                <p className="success">
                  {voucher.state === "SETTLED"
                    ? "本次测试餐款已核验结算。"
                    : "商家已声明交餐，无需再次出示取餐码。"}{" "}
                  交餐状态来自商家声明。
                </p>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => run(refresh)}
              >
                刷新餐券状态 ↻
              </button>
            </>
          ) : !secret.current ? (
            <>
              <p>请从机构给你的私密链接进入。若已领取，可重新查询餐券。</p>
              <button disabled={busy} onClick={() => run(refresh)}>
                重新查询已领取餐券
              </button>
            </>
          ) : null}
        </section>
        <p className="muted privacy">
          私密链接只用于领取。无需连接钱包或支付费用。
        </p>
      </div>
    </PageShell>
  );
}
if (document.getElementById("root") && !location.pathname.includes("product"))
  createRoot(document.getElementById("root")).render(<Recipient />);
