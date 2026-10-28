import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { request, phases, errorText } from "./shared.jsx";
import { ProductShell, MealArt, Embedded } from "./product-shell.jsx";
import { productRoute, scopedPath } from "./product-state.mjs";
function BusinessWork({ businessId, role, api, onSession, onProgress, walletFactory }) {
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const scopedApi = useCallback(async (path, options) => {
    if (!alive.current) throw Error("WALLET_CONTEXT_CHANGED");
    const value = await api(scopedPath(businessId, path), options);
    if (!alive.current) throw Error("WALLET_CONTEXT_CHANGED");
    return value;
  }, [businessId, api]);
  return <App product expectedRole={role} businessId={businessId} merchant={role === "owner"} shell={Embedded} api={scopedApi} onSession={onSession} onProgress={onProgress} walletFactory={walletFactory} />;
}
export function Product({ api = request, walletFactory }) {
  const [route,setRoute] = useState(() => productRoute(location.hash));
  const [records,setRecords] = useState(null), [session,setSession] = useState(null), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const generation = useRef(0), createLock = useRef(false);
  const loadRecords = useCallback(async (quiet = false) => {
    const ticket = ++generation.current;
    try { const next = await api("/businesses"); if (ticket === generation.current) { setRecords(next); if (!quiet) setError(""); } }
    catch(e) { if (!quiet && ticket === generation.current) setError(errorText(e)); }
  }, [api]);
  useEffect(() => {
    const change = () => { generation.current++; setError(""); setRoute(productRoute(location.hash)); };
    window.addEventListener("hashchange",change);
    void loadRecords(true);
    const timer = setInterval(() => { if (!document.hidden && !createLock.current) void loadRecords(true); }, 8000);
    return () => { generation.current++; clearInterval(timer); window.removeEventListener("hashchange",change); };
  }, [api, loadRecords]);
  const onSession = useCallback((value) => { setSession(value); void loadRecords(true); }, [loadRecords]);
  const onProgress = useCallback(() => { void loadRecords(true); }, [loadRecords]);
  const go = (role, businessId = route.businessId) => { location.hash = "businessId=" + businessId + "&role=" + role; };
  const current = records?.businesses.find(b => b.id === route.businessId);
  async function createBusiness() {
    if (createLock.current || !session?.csrf || !records?.canCreate) return;
    createLock.current = true; setBusy(true); setError("");
    try { const result = await api("/businesses", {body:{},csrf:session.csrf}); await loadRecords(); go("owner", result.business.id); }
    catch(e) { setError(errorText(e)); }
    finally { createLock.current = false; setBusy(false); }
  }
  return <ProductShell {...route}>
    {route.role === "home" ? <section className="home-page safe-page-enter">
      <div className="hero-meta"><span>暖心餐馆 × 机构伙伴</span><small>MONAD TESTNET · 7 测试 USDC / 份</small></div>
      <h1>留一膳，待一人。</h1><p className="hero-lead">机构伙伴安排餐券，餐厅负责供餐。一膳之微，亦可为善。</p>
      <MealArt /><button className="button hero-cta" onClick={() => go("donor")}>为一份热餐留位 <span aria-hidden="true">→</span></button>
      <p className="hero-note">领取无需钱包或平台注册。每笔业务独立记录，完成结算后再开启下一份善意。</p>
      <div className="hero-stats"><div><small>当前业务</small><strong>{route.businessId}<em> 笔</em></strong></div><div><small>单份餐款</small><strong>7 <em>测试 USDC</em></strong></div><div><small>业务状态</small><b>{current ? phases[current.phase] : "等待核对"}</b></div><a href={"#businessId="+route.businessId+"&role=records"}>查看业务记录 →</a></div>
      <div className="actor-grid role-entry">{[["issuer","机构伙伴","签发餐券，将私密领取链接交给领取者。"],["owner","餐馆老板","签名确认报价、核对取餐码、声明交餐与结算。"]].map(([id,title,copy]) => <button className="actor-card" key={id} onClick={() => go(id)}><strong>{title}</strong><span>{copy}</span><small>进入工作台 →</small></button>)}</div>
      <p className="fineprint">领取者请使用机构私下提供的领取链接。</p>
    </section> : <>
      <section className="panel business-picker"><label className="field">当前业务<select aria-label="当前业务" value={route.businessId} disabled={busy || !records} onChange={e => go(route.role,e.target.value)}>{records?.businesses.map(b => <option value={b.id} key={b.id}>第 {b.id} 笔 · {phases[b.phase] || b.phase}</option>) || <option value={route.businessId}>第 {route.businessId} 笔</option>}</select></label><p className="fineprint">切换业务会清除当前输入和交易摘要，重新核对所选业务。</p></section>
      {route.role === "records" ? <section className="narrow-page"><p className="eyebrow">每一份餐，都有清楚去向</p><h1>业务记录</h1>{!session && <p className="notice">登录后即可查看业务进度。<a href={"#businessId="+route.businessId+"&role=owner"}>前往工作台登录</a></p>}<div className="event-list">{records?.businesses.map(b => <div className="event-row" key={b.id}><span><strong>第 {b.id} 笔业务</strong><small>1 份 · 7 测试 USDC</small></span><b>{phases[b.phase] || b.phase}</b><button className="button secondary" onClick={() => go("owner",b.id)}>查看</button></div>)}</div><div className="panel"><h2>开启下一份善意</h2><p>上一笔完成结算后，由店主创建下一笔独立业务；原记录永久保留。</p><button className="button" disabled={busy || session?.role !== "owner" || !records?.canCreate} onClick={createBusiness}>创建下一笔业务</button><p className="fineprint">{session?.role !== "owner" ? "请先进入商家工作台，以店主钱包登录。" : !records?.canCreate ? "暂不能创建下一笔；请核对已有业务的结算状态与当前服务限制。" : "下一笔沿用当前餐馆、合约和已有测试 USDC；报价需重新确认。"}</p></div></section> : <BusinessWork key={route.businessId+":"+route.role} {...route} api={api} walletFactory={walletFactory} onSession={onSession} onProgress={onProgress} />}
    </>}
    {error && <p className="notice error" role="alert">{error}<button className="text-button" onClick={() => loadRecords()}>重新查询业务</button></p>}
  </ProductShell>;
}
if (document.getElementById("root") && location.pathname.endsWith("product.html")) createRoot(document.getElementById("root")).render(<Product />);
