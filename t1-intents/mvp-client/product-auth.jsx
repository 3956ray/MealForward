import React, { useEffect, useRef, useState } from "react";
import { createMvpWallet } from "./wallet.mjs";
import { POLICIES, validateChallenge } from "./guards.mjs";
import { errorText, roles } from "./shared.jsx";

export function useProductAuth(api, walletFactory = createMvpWallet) {
  const [session, setSession] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const wallet = useRef(null), revision = useRef(0), sessionRef = useRef(null), attempt = useRef(0);
  function invalidate() {
    revision.current++;
    sessionRef.current = null;
    setSession(null);
  }
  useEffect(() => {
    let alive = true;
    wallet.current = walletFactory({ onChange: () => {
      if (!alive) return;
      invalidate();
      queueMicrotask(() => { if (alive) setProviders(wallet.current?.providers() || []); });
    }});
    setProviders(wallet.current.providers());
    return () => { alive = false; revision.current++; wallet.current?.dispose(); };
  }, [walletFactory]);
  function select(id) {
    attempt.current++;
    wallet.current.select(id);
    setSelected(id);
    setError("");
  }
  async function login() {
    if (busy || !selected || !wallet.current) return null;
    setBusy(true); setError("");
    let r = revision.current;
    const loginAttempt = ++attempt.current;
    try {
      const observed = await wallet.current.connect();
      if (attempt.current !== loginAttempt) throw Error("WALLET_CONTEXT_CHANGED");
      r = revision.current;
      if (observed.chainId !== 10143) throw Error("SWITCH_TO_MONAD_TESTNET");
      if (!Object.values(POLICIES).includes(observed.account)) throw Error("ROLE_DENIED");
      const pre = await api("/auth/pre-session", { body: {}, bootstrap: true });
      if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      const c = await api("/identity/wallet/challenge", { body: { address: observed.account }, csrf: pre.csrf });
      if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      validateChallenge(c, observed.account, location.origin);
      const signature = await wallet.current.signMessage(observed.account, c.message, () => {
        if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      });
      if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      await api("/identity/wallet/login", { body: { challengeId: c.challengeId, signature }, csrf: pre.csrf });
      if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      const verified = await api("/me");
      const current = await wallet.current.inspect();
      if (r !== revision.current || current.account !== verified.wallet?.toLowerCase() || current.chainId !== 10143 || !["owner", "donor", "issuer"].includes(verified.role)) throw Error("WALLET_CONTEXT_CHANGED");
      sessionRef.current = verified;
      setSession(verified);
      setOpen(false);
      return verified;
    } catch (e) {
      if (r === revision.current) setError(errorText(e));
      return null;
    } finally { setBusy(false); }
  }
  async function logout() {
    const old = sessionRef.current;
    attempt.current++;
    invalidate();
    setOpen(true);
    if (old?.csrf) try { await api("/auth/logout", { body: {}, csrf: old.csrf }); }
    catch (e) { setError(errorText(e)); }
  }
  return { session, sessionRef, wallet, providers, selected, select, busy, error, open, setOpen, login, logout, invalidate };
}

export function WalletLogin({ auth, requestedRole, onSuccess }) {
  return <section className="container wallet-login-panel" aria-label="钱包登录"><div className="panel">
    <p className="eyebrow">钱包身份</p>
    <h2>{auth.session && requestedRole && auth.session.role !== requestedRole ? `当前为${roles[auth.session.role]}，请使用${roles[requestedRole]}钱包登录` : "连接钱包，开启善意"}</h2>
    <p>选择钱包，由你确认连接和登录签名。签名经服务验证后才能操作业务。请使用 Monad Testnet。</p>
    <label>钱包<select aria-label="选择钱包" value={auth.selected} disabled={auth.busy} onChange={e => auth.select(e.target.value)}><option value="">请选择钱包</option>{auth.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {auth.providers.length === 0 && <p className="notice">未发现钱包，请在安装钱包扩展的浏览器中打开。</p>}
    <button className="button" disabled={auth.busy || !auth.selected} onClick={async () => { const s = await auth.login(); if (s) onSuccess(s); }}>{auth.busy ? "正在核对身份…" : "连接钱包并签名登录"}</button>
    {auth.error && <p className="notice error" role="alert">{auth.error}</p>}
  </div></section>;
}
