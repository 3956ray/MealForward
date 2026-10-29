import React, { useEffect, useRef, useState } from "react";
import { createMvpWallet } from "./wallet.mjs";
import { POLICIES, validateChallenge } from "./guards.mjs";
import { errorText, roles } from "./shared.jsx";

export function useProductAuth(api, walletFactory = createMvpWallet) {
  const [session, setSession] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selected, setSelected] = useState("");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const wallet = useRef(null), revision = useRef(0), sessionRef = useRef(null), attempt = useRef(0), actionLock = useRef(false), restoreDisabled = useRef(false);
  function invalidate() {
    revision.current++;
    sessionRef.current = null;
    setSession(null);
  }
  useEffect(() => {
    let alive = true;
    let restoreTimer, restoring = false, stopped = false;
    const started = Date.now();
    let remembered;
    try { remembered = JSON.parse(localStorage.getItem("mf-wallet-provider")); } catch {}
    const refresh = () => queueMicrotask(() => {
      if (!alive) return;
      const found = wallet.current?.providers() || [];
      setProviders(found);
      if (!remembered || restoreDisabled.current || stopped || restoring || actionLock.current || Date.now()-started > 2500) return;
      const matches = found.filter(p => remembered.rdns ? p.rdns === remembered.rdns : p.id === remembered.id);
      const match = matches.length === 1 ? matches[0] : null;
      if (!match) return;
      wallet.current.select(match.id); setSelected(match.id);
      restoring = true; actionLock.current = true; setBusy(true); setStage("正在恢复登录…");
      const r = revision.current;
      void (async () => {
        try {
          const verified = await api("/me");
          const observed = await wallet.current.inspect();
          if (!alive || stopped || restoreDisabled.current || r !== revision.current || observed.chainId !== 10143 || observed.account !== verified.wallet?.toLowerCase() || POLICIES[verified.role] !== observed.account) return;
          sessionRef.current = verified; setSession(verified);
        } catch {} finally { stopped = true; actionLock.current = false; if (alive) { setBusy(false); setStage(""); } }
      })();
    });
    wallet.current = walletFactory({ onDiscovery: refresh, onChange: () => {
      if (!alive) return;
      if (restoring) stopped = true;
      if (restoring || sessionRef.current) restoreDisabled.current = true;
      invalidate();
      queueMicrotask(() => { if (alive) setProviders(wallet.current?.providers() || []); });
    }});
    refresh();
    restoreTimer = setTimeout(() => { if (!restoring) stopped = true; }, 2500);
    return () => { alive = false; stopped = true; clearTimeout(restoreTimer); revision.current++; wallet.current?.dispose(); };
  }, [walletFactory]);
  function select(id) {
    restoreDisabled.current = true;
    attempt.current++;
    wallet.current.select(id);
    setSelected(id);
    setError("");
  }
  async function login() {
    if (actionLock.current || !selected || !wallet.current) return null;
    actionLock.current = true;
    setBusy(true); setError(""); setStage("正在连接钱包…");
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
      setStage("请在钱包确认登录签名（无转账、无 Gas）…");
      const signature = await wallet.current.signMessage(observed.account, c.message, () => {
        if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      });
      if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      setStage("正在验证身份…");
      await api("/identity/wallet/login", { body: { challengeId: c.challengeId, signature }, csrf: pre.csrf });
      if (r !== revision.current) throw Error("WALLET_CONTEXT_CHANGED");
      const verified = await api("/me");
      const current = await wallet.current.inspect();
      if (r !== revision.current || current.account !== verified.wallet?.toLowerCase() || current.chainId !== 10143 || POLICIES[verified.role] !== current.account) throw Error("WALLET_CONTEXT_CHANGED");
      sessionRef.current = verified;
      try { const p = wallet.current.providers().find(p => p.id === selected); localStorage.setItem("mf-wallet-provider", JSON.stringify({id:p.id,rdns:p.rdns})); } catch {}
      setSession(verified);
      setOpen(false);
      return verified;
    } catch (e) {
      if (r === revision.current) setError(errorText(e));
      return null;
    } finally { actionLock.current = false; setBusy(false); }
  }
  async function logout() {
    restoreDisabled.current = true;
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    const old = sessionRef.current;
    try { localStorage.removeItem("mf-wallet-provider"); } catch {}
    attempt.current++;
    invalidate();
    setOpen(true);
    try { if (old?.csrf) await api("/auth/logout", { body: {}, csrf: old.csrf }); }
    catch (e) { setError(errorText(e)); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return { session, sessionRef, wallet, providers, selected, select, busy, stage, error, open, setOpen, login, logout, invalidate };
}

export function WalletLogin({ auth, requestedRole, onSuccess }) {
  const panel = useRef(null), busy = useRef(auth.busy);
  busy.current = auth.busy;
  useEffect(() => {
    const previous = document.activeElement;
    // The dialog stays inside the application; keyboard focus is contained here.
    panel.current?.focus();
    const key = e => {
      if (e.key === "Escape" && !busy.current) { e.preventDefault(); auth.setOpen(false); }
      if (e.key !== "Tab") return;
      const items = [...panel.current.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')];
      const first=items[0], last=items.at(-1);
      if (!first) { e.preventDefault(); panel.current.focus(); return; }
      if (e.shiftKey && (document.activeElement===first || document.activeElement===panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement===last || document.activeElement===panel.current)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown",key);
    const focus = e => { if (panel.current && !panel.current.contains(e.target)) panel.current.focus(); };
    document.addEventListener("focusin",focus);
    const overflow=document.body.style.overflow; document.body.style.overflow="hidden";
    return () => { document.removeEventListener("keydown",key); document.removeEventListener("focusin",focus); document.body.style.overflow=overflow; previous?.focus?.(); };
  }, []);
  return <div className="wallet-modal-backdrop" onClick={e => { if(e.target===e.currentTarget && !auth.busy) auth.setOpen(false); }}><section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title" aria-describedby="wallet-modal-description" className="panel wallet-modal">
    <button className="text-button" aria-label="关闭钱包登录" disabled={auth.busy} onClick={() => auth.setOpen(false)}>关闭 ×</button>
    <p className="eyebrow">钱包身份</p>
    <h2 id="wallet-modal-title">{auth.session && requestedRole && auth.session.role !== requestedRole ? `请使用${roles[requestedRole]}钱包登录` : "连接钱包，开启善意"}</h2>
    <p id="wallet-modal-description">选择已发现的浏览器扩展。登录签名仅验证身份，不转账、不支付 Gas。请使用 Monad Testnet。</p>
    <div className="wallet-options">{auth.providers.map(p => <button className="button outline" aria-pressed={auth.selected===p.id} disabled={auth.busy} key={p.id} onClick={() => auth.select(p.id)}><span aria-hidden="true">▣ </span>{p.name}<small> · 已发现{auth.selected===p.id ? " · 已选择" : ""}</small></button>)}</div>
    {auth.providers.length === 0 && <p className="notice">未发现钱包，请在安装并启用钱包扩展的浏览器中打开，然后刷新页面。</p>}
    <p role="status" aria-live="polite">{auth.busy ? auth.stage || "正在核对身份…" : "连接后，请核对钱包显示的登录请求。"}</p>
    <button className="button" disabled={auth.busy || !auth.selected} onClick={async () => { const s = await auth.login(); if (s) onSuccess(s); }}>{auth.busy ? "请在钱包中继续…" : auth.error ? "重试登录" : "连接钱包并签名登录"}</button>
    {auth.error && <p className="notice error" role="alert">{auth.error}</p>}
  </section></div>;
}
