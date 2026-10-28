import React from "react";
// Presentation adapted from src/App.tsx (site shell and MealArt). The original
// src/styles.css is copied byte-for-byte by build.mjs; no legacy API is imported.
export function MealArt() {
  return <div className="meal-scene" role="img" aria-label="一份热餐插画：米饭、蔬菜、主菜和热汤"><div className="tray">
    <div className="dish greens"><i /><i /><i /><i /><i /><i /></div>
    <div className="dish soup"><span /><span /><span /></div>
    <div className="dish rice"><span /></div>
    <div className="dish main-dish"><i /><i /><i /><i /><i /><i /></div>
    <div className="tray-mark">留膳<br /><small>一份热餐 · 一份关怀</small></div>
  </div></div>;
}
export function ProductShell({ children, businessId = "1", role = "home", recipient = false }) {
  const link = (r) => "#businessId=" + businessId + "&role=" + r;
  return <div className="app-shell product-shell">
    <header><div className="simulation-ribbon">Monad Testnet · 已有测试 USDC · 测试代币无货币价值</div><div className="site-header">
      <a className="brand" href={recipient ? "/mvp/product.html" : link("home")}><span className="brand-mark" aria-hidden="true">◡</span><span><strong>留膳</strong><small>mealforward</small></span></a>
      {recipient ? <div className="private-nav">安心领取 · 无需注册或钱包</div> : <><nav className="top-nav" aria-label="主导航">{[["home","首页"],["donor","支持一餐"],["issuer","机构发券"],["owner","商家工作台"],["records","业务记录"]].map(([id,label]) => <a key={id} href={link(id)} className={role === id ? "active" : ""} aria-current={role === id ? "page" : undefined}>{label}</a>)}</nav><span className="actor-pill">单商家 · 单份餐</span></>}
    </div></header>
    {!recipient && role !== "home" && <nav className="role-nav" aria-label="角色工作导航"><a href={link("home")}>← 返回首页</a><span>第 {businessId} 笔业务 · 7 测试 USDC</span></nav>}
    <main id="main-content">{children}</main>
    <footer className="site-footer"><span>留一膳，待一人，是为善。</span><span>交餐由商家声明 · 测试网流程</span></footer>
  </div>;
}
export function Embedded({ children }) { return <div className="product-work">{children}</div>; }
