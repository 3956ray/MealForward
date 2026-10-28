import React from "react";
export const labels = {
  token: "部署测试代币",
  escrow: "部署餐券合约",
  approve: "授权 7 测试代币",
  fund: "捐赠 7 测试代币",
  issue: "签发一张餐券",
  redeem: "确认交餐",
  settle: "结算测试餐款",
};
export const phases = {
  EMPTY: "等待创建测试代币",
  TOKEN_READY: "等待创建餐券合约",
  READY: "合约已就绪",
  APPROVED: "捐赠额度已授权",
  FUNDED: "捐赠已确认",
  ISSUED: "餐券已签发",
  HANDED_OVER: "商家已声明交餐",
  SETTLED: "测试餐款已结算",
};
export const roles = {
  owner: "店主 / Owner",
  donor: "支持者 / Donor",
  issuer: "机构 / Issuer",
};
export async function request(path, { body, csrf, bootstrap = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const r = await fetch("/v1/mvp" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf ? { "x-mvp-csrf": csrf } : {}),
        ...(bootstrap ? { "x-mvp-bootstrap": "1" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok)
      throw Error(
        /^[A-Z0-9_]+$/.test(data.error) ? data.error : "REQUEST_FAILED",
      );
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw Error("REQUEST_TIMEOUT");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
const errors = {
  SWITCH_TO_MONAD_TESTNET:
    "请在钱包中切换到 Monad Testnet（10143），然后重新登录。",
  ROLE_DENIED: "当前账户不是本轮固定角色，请切换至对应钱包。",
  REQUEST_TIMEOUT: "请求超时，结果尚未确认。请刷新进度；交易请仅恢复原哈希。",
  WALLET_CONTEXT_CHANGED: "钱包或网络发生变化，请重新登录后继续。",
  QUOTE_EXPIRED: "报价已过期，请由店主检查并明确重新生成。",
  RPC_BUSY: "链上查询繁忙，请稍后刷新原交易状态。",
};
export function errorText(e) {
  if (errors[e?.message]) return errors[e.message];
  const code = /^[A-Z0-9_]+$/.test(e?.message) ? e.message : "REQUEST_FAILED";
  return `操作尚未确认（${code}）。请刷新状态；若已打开交易钱包，请仅恢复原交易哈希，不要重新发送。`;
}
export function Shell({ page, children }) {
  return (
    <>
      <header>
        <a
          className="brand"
          href={
            page === "recipient" ? "/mvp/recipient.html" : "/mvp/setup.html"
          }
        >
          <span className="brand-icon">留</span>留膳 <small>mealforward</small>
        </a>
        {page !== "recipient" ? (
          <nav aria-label="主要导航">
            <a
              aria-current={page === "setup" ? "page" : undefined}
              href="/mvp/setup.html"
            >
              准备与发券
            </a>
            <a
              aria-current={page === "merchant" ? "page" : undefined}
              href="/mvp/merchant.html"
            >
              商家工作台
            </a>
          </nav>
        ) : (
          <span className="recipient-label">安心领取 · 无需注册</span>
        )}
        <span className="test-tag">MONAD 测试网</span>
      </header>
      <main>{children}</main>
      <footer>
        留一份温暖，让一餐抵达。<span>测试流程 · 代币无货币价值</span>
      </footer>
    </>
  );
}
export function Notice({ error, busy }) {
  return (
    <div aria-live="polite">
      {busy ? <p className="notice">正在处理，请保持页面打开…</p> : null}
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function Steps({ phase }) {
  const n = [
    "EMPTY",
    "TOKEN_READY",
    "READY",
    "APPROVED",
    "FUNDED",
    "ISSUED",
    "HANDED_OVER",
    "SETTLED",
  ].indexOf(phase);
  return (
    <ol className="steps">
      {["准备一份善意", "领取一份餐券", "完成一餐交接"].map((s, i) => (
        <li key={s} className={n >= [0, 5, 6][i] ? "active" : ""}>
          <b>0{i + 1}</b>
          {s}
        </li>
      ))}
    </ol>
  );
}
