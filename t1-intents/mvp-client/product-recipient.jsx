import React from "react";
import { createRoot } from "react-dom/client";
import { Recipient } from "./recipient.jsx";
import { ProductShell } from "./product-shell.jsx";
import { request } from "./shared.jsx";
import { captureProductInvite, scopedPath } from "./product-state.mjs";
const invite = captureProductInvite(window);
function RecipientShell({children}) { return <ProductShell recipient businessId={invite.businessId}><div className="product-work voucher-page narrow-page">{children}</div></ProductShell>; }
const api = (path, options) => request(scopedPath(invite.businessId, path), options);
if (document.getElementById("root")) createRoot(document.getElementById("root")).render(invite.businessId ? <Recipient token={invite.token} api={api} shell={RecipientShell} /> : <ProductShell recipient><section className="panel"><h1>请使用完整的私密领取链接</h1><p>链接缺少业务标识，请联系发券机构。</p></section></ProductShell>);
