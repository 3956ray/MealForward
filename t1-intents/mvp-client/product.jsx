import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.jsx";
import { request, phases, errorText } from "./shared.jsx";
import { ProductShell, MealArt, Embedded } from "./product-shell.jsx";
import { productRoute, scopedPath } from "./product-state.mjs";
import { useProductAuth, WalletLogin } from "./product-auth.jsx";
function BusinessWork({ businessId, role, api, onProgress, externalAuth }) {
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const scopedApi = useCallback(async (path, options) => {
    if (!alive.current) throw Error("WALLET_CONTEXT_CHANGED");
    const value = await api(scopedPath(businessId, path), options);
    if (!alive.current) throw Error("WALLET_CONTEXT_CHANGED");
    return value;
  }, [businessId, api]);
  return <App product expectedRole={role} businessId={businessId} merchant={role === "owner"} shell={Embedded} api={scopedApi} onProgress={onProgress} externalAuth={externalAuth} />;
}
export function Product({ api = request, walletFactory }) {
  const [route,setRoute] = useState(() => productRoute(location.hash));
  const auth = useProductAuth(api, walletFactory);
  const {session} = auth;
  const [records,setRecords] = useState(null), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const generation = useRef(0), createLock = useRef(false);
  const loadRecords = useCallback(async (quiet = false) => {
    const ticket = ++generation.current;
    try { if (!auth.sessionRef.current) return; const next = await api("/businesses"); if (ticket === generation.current && auth.sessionRef.current) { setRecords(next); if (!quiet) setError(""); } }
    catch(e) { if (!quiet && ticket === generation.current) setError(errorText(e)); }
  }, [api]);
  useEffect(() => {
    const change = () => { generation.current++; setError(""); setRoute(productRoute(location.hash)); };
    window.addEventListener("hashchange",change);
    const timer = setInterval(() => { if (!document.hidden && !createLock.current && auth.sessionRef.current) void loadRecords(true); }, 8000);
    return () => { generation.current++; clearInterval(timer); window.removeEventListener("hashchange",change); };
  }, [api, loadRecords]);
  useEffect(() => { generation.current++; setRecords(null); if (session) void loadRecords(true); }, [session]);
  const onProgress = useCallback(() => { void loadRecords(true); }, [loadRecords]);
  const go = (role, businessId = route.businessId) => { location.hash = "businessId=" + businessId + "&role=" + role; };
  const current = records?.businesses.find(b => b.id === route.businessId);
  async function createBusiness() {
    if (createLock.current || session?.role !== "owner" || !session?.csrf || !records?.canCreate) return;
    createLock.current = true; setBusy(true); setError("");
    try { const result = await api("/businesses", {body:{},csrf:session.csrf}); if (auth.sessionRef.current !== session) return; await loadRecords(); if (auth.sessionRef.current === session) go("owner", result.business.id); }
    catch(e) { setError(errorText(e)); }
    finally { createLock.current = false; setBusy(false); }
  }
  const workRole = ["owner","donor","issuer"].includes(route.role);
  const gated = workRole && (!session || session.role !== route.role);
  return <ProductShell {...route} session={session} onLogin={() => auth.setOpen(true)} onLogout={auth.logout} authBusy={auth.busy}>
    {(auth.open || gated) && <WalletLogin auth={auth} requestedRole={workRole ? route.role : null} onSuccess={s => { void loadRecords(true); if (route.role === "home" || (workRole && route.role !== s.role)) go(s.role); }} />}
    {route.role === "home" ? <div className="container"><section className="hero"><div className="hero-copy"><div className="eyebrow">A LITTLE KINDNESS, FORWARD</div><h1>一份热餐。<br/>一份<span>善意。</span></h1><p>你留下一份餐，小厨房用心准备。<br />让下一位需要的人安心用餐。</p><div className="hero-ctas"><button className="button" onClick={() => session ? go(session.role) : auth.setOpen(true)}>钱包登录</button><a className="button outline" href={"#businessId="+route.businessId+"&role=issuer"}>机构发券</a></div><div className="hero-note">领取无需钱包 · 请使用机构提供的私密链接</div></div><figure className="hero-visual"><img className="hero-image" src="/mvp/hero-meal.jpg" alt="一份热餐" /><div className="round-stamp"><small>GOOD FOOD</small><strong>Share a meal</strong><small>PASS IT FORWARD</small></div><figcaption className="photo-caption"><div><strong>为下一位留一餐。</strong><small>One meal. A kind gesture.</small></div></figcaption><span className="visual-label">示意餐食图片</span></figure></section><section className="section" id="kitchens"><div className="section-head"><div><div className="eyebrow">THE NEIGHBORHOOD TABLE</div><h2>在喜欢的厨房留一餐。</h2><p>一份热餐，一份善意。</p></div></div><div className="store-grid">{[["Qinghe · 清禾厨房","hero-meal.jpg",true],["Shiguang · 食光厨房","vegetables.jpg",false],["Nuanxiang · 暖巷厨房","bowl.jpg",false]].map(([name,img,active]) => <article className="store-card" key={name}><div className="store-photo"><img src={'/mvp/'+img} alt="餐食图片" /><div className="store-tag"><span>{active?'测试厨房':'暂未开放'}</span></div></div><div className="store-body"><div className="store-heading"><h3>{name}</h3></div><p className="store-description">{active?'由现有商家提供的一份测试餐。':'此厨房尚未接入真实业务。'}</p><div className="store-bottom"><div className="price"><strong>{active?'7':'—'}</strong><small>{active?'测试 USDC / 份':'暂未开放'}</small></div>{active?<button className="button" onClick={() => go("donor")}>支持一餐</button>:<button className="button" disabled>暂未开放</button>}</div></div></article>)}</div><p className="section-foot">测试资产无货币价值 · 领取请使用机构提供的私密链接</p></section><section className="how-section"><div className="how-layout"><div className="how-intro"><div className="eyebrow">A LITTLE KINDNESS, FORWARD</div><h2>为下一位<br />留一餐。</h2></div><div className="how-steps">{[["01","支持一餐","支持者使用测试钱包完成资助。"],["02","机构发券","机构将私密领取链接交给领取者，无需钱包。"],["03","商家交餐","商家核验取餐码并声明交餐，之后结算。"]].map(([n,title,copy])=><div key={n}><div className="step-number">{n}</div><h3>{title}</h3><p>{copy}</p></div>)}</div></div></section><section className="ledger-teaser"><div><div className="eyebrow">EVERY MEAL, ACCOUNTED FOR</div><h2>每份善意，都有记录。</h2></div><button className="button outline" onClick={() => go("records")}>查看业务记录</button></section></div> : <>
      <section className="panel business-picker"><label className="field">当前业务<select aria-label="当前业务" value={route.businessId} disabled={busy || !records} onChange={e => go(route.role,e.target.value)}>{records?.businesses.map(b => <option value={b.id} key={b.id}>第 {b.id} 笔 · {phases[b.phase] || b.phase}</option>) || <option value={route.businessId}>第 {route.businessId} 笔</option>}</select></label><p className="fineprint">切换业务会清除当前输入和交易摘要，重新核对所选业务。</p></section>
      {route.role === "records" ? <section className="narrow-page"><p className="eyebrow">每一份餐，都有清楚去向</p><h1>业务记录</h1>{!session && <p className="notice">登录后即可查看业务进度。<a href={"#businessId="+route.businessId+"&role=owner"}>前往工作台登录</a></p>}<div className="event-list">{records?.businesses.map(b => <div className="event-row" key={b.id}><span><strong>第 {b.id} 笔业务</strong><small>1 份 · 7 测试 USDC</small></span><b>{phases[b.phase] || b.phase}</b><button className="button secondary" onClick={() => go("owner",b.id)}>查看</button></div>)}</div><div className="panel"><h2>开启下一份善意</h2><p>上一笔完成结算后，由店主创建下一笔独立业务；原记录永久保留。</p><button className="button" disabled={busy || session?.role !== "owner" || !records?.canCreate} onClick={createBusiness}>创建下一笔业务</button><p className="fineprint">{session?.role !== "owner" ? "请先进入商家工作台，以店主钱包登录。" : !records?.canCreate ? "暂不能创建下一笔；请核对已有业务的结算状态与当前服务限制。" : "下一笔沿用当前餐馆、合约和已有测试 USDC；报价需重新确认。"}</p></div></section> : !gated && workRole ? <BusinessWork key={route.businessId+":"+route.role} {...route} api={api} externalAuth={{session, sessionRef: auth.sessionRef, wallet: auth.wallet.current}} onProgress={onProgress} /> : null}
    </>}
    {error && <p className="notice error" role="alert">{error}<button className="text-button" onClick={() => loadRecords()}>重新查询业务</button></p>}
  </ProductShell>;
}
if (document.getElementById("root") && location.pathname.endsWith("product.html")) createRoot(document.getElementById("root")).render(<Product />);
