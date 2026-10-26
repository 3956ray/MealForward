# MealForward Wallet V2 — selected approach A

Status: user selected approach A and requested development on2026-10-26. This document makes the implementation decisions concrete; independent builder check and human review of this document precede implementation under the requested Superpowers workflow. The current conversation is named “MealForward · 钱包客户端重建 A”.

用户确认摘要：全新客户端使用Wagmi Core＋viem，不复制旧Phase6前端；先检查已经授权的钱包，仅未授权时提供连接动作；钱包/后台/轮次/批准记录独立显示；后台或签名组件卡住不锁钱包检查；所有等待有可见反馈，不自动重复请求；沿用后台验签与保存接口，正式双签/发券操作仍遵守原有门槛。验收覆盖实际页面初始化和点击，不以内部函数测试代替浏览器验收。

Independent builder check: a fresh reviewer reported “nothing important left” on2026-10-26. The user explicitly approved this design and autonomous planning, development and independent acceptance until human testing is needed. Implementation authorization is recorded in HANDOFF; subsequent engineering choices are delegated.

## Intent and selected scope

Build a new desktop browser client that reliably checks an already-connected MetaMask wallet and collects an explicit formal approval for an existing valid round. The user has already demonstrated correct accounts and Monad Testnet; they should immediately see where any unfinished operation stopped.

Approach A was selected: new client using Wagmi Core, its injected/EIP-6963 connector and viem, consuming the existing same-origin approval API. The old client is not a source/template/import for the new implementation. Reviewed API/security requirements remain binding. Approach B, rewriting the backend too, was not selected because it enlarges migration/security scope without evidence that this is needed for the reproduced startup failure modes.

Preserve original business/audit records, immutable rounds and UNKNOWN recovery rules. No database migration or capability change. No automatic round creation, renewal, transaction, release, issue, funding or settlement. The existing domain-review refusal and formal-signature hold remain. Development and synthetic testing proceed independently of that hold.

## User-visible behavior

One account is active at a time. The page displays four separate facts, with actual addresses/chain rather than configuration assumptions:

1. **钱包检查**: provider discovery, actual account, chain10143, matching Owner/Donor, observation time and current operation.
2. **服务连接**: loading/ready/unavailable/timeout, with an independent explicit refresh button.
3. **正式批准轮次**: absent/collecting/expired/collected, round ID, complete EIP712 payload, digest and expiry.
4. **批准记录**: each role's durable server-confirmed result; distinguish waiting for wallet, signature returned, saving and result uncertain.

Primary control: “检查当前 MetaMask”. It reads already-authorized account/chain without opening permissions or signing. If no account is authorized, present a distinct “连接 MetaMask” control. If multiple injected providers exist, show provider choices; never silently choose a non-MetaMask provider. EIP6963 metadata is discovery information, not proof of authenticity. An actual account matching a fixed role is required.

Owner is `0xc4f8a468f10d5f98dcff3282516125e97f26433b`; Donor is `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`. Verify the current first account selected by the provider; do not search an account array for a convenient match. Show other accounts as an unsupported role. Never auto-switch/add a chain or open permission prompts on load.

With NO_ROUND, wallet inspection remains usable and signing explains “尚无正式轮次”. An unavailable backend does not erase wallet success or prevent another read-only inspection. Connection is never labelled approval. Completed dual approval says “2/2 已记录 · NO RELEASE”; expiry overrides completed status while retaining historical role records.

Use responsive Chinese layout, keyboard-accessible buttons, status live regions and wrapping full addresses. Put progress/errors next to the affected control. Expose a copyable safe diagnostic summary with build ID, phase, elapsed time and sanitized error codes; exclude signatures, session/CSRF, cookies, private URLs and wallet activity.

## Initialization and operations

A small bootstrap with no external imports binds controls before asynchronous dependency imports or API calls. The HTML shell has a clear static loading/no-script message. Bootstrap dependency failures are visible with a retry/reload instruction; they cannot leave a misleading apparently-ready inert page. Library loading has a10-second reporting deadline. Signing validation is loaded independently from wallet inspection; its failure only blocks signing. All runtime code is same-origin bundled code, no CDN or inline eval/CSP weakening.

Use independent wallet-operation and API-operation state, not a global busy flag. The wallet adapter is obtained/discovered at action time, supporting late injection, and watches account/chain/provider/disconnect changes. Use transient connection storage; no automatic permission request or eager persisted reconnection.

Read-only wallet observations report delay after10seconds. Permission and signature requests report an outstanding request after30seconds; this is not cancellation. Retain a single-flight lock until the underlying provider settles, prevent duplicate prompts, allow safe backend refresh, and ignore stale results by operation generation. An invalidated signature result is discarded and never submitted. A new user action must never cause an unresolved signature request to be silently retried.

API requests are cancellable and have a15-second browser deadline. Timeout leaves backend status explicit and allows manual refresh; no automatic retry loops. A failed refresh must invalidate signing readiness even when displaying the last observed round. Manual refresh reuses a valid in-memory session, requesting a new one only when absent, expired or rejected; it must not exhaust the server's12-session-per-minute allowance through frequent refreshes.

## Existing backend contract

Keep exact origin/host and existing HttpOnly Secure SameSite session/CSRF protections. Fetch uses same-origin credentials, no-store and redirect rejection. No CORS, external origin, secrets in frontend or backend privilege expansion.

- `GET /health`: `{status:'APPROVAL_COLLECTOR',noRelease:true}`.
- `POST /v1/approval/session`, JSON `{}`: `{csrf,expiresAt}` with server session cookie. CSRF is a64-character lowercase hex string; expiry is valid epoch seconds. Keep only in memory.
- `GET /v1/approval/state`, header `X-Approval-CSRF`: strict public state below.
- `POST /v1/approval/submit`, same header, exact body `{role,roundId,digest,signature}`: returns strict public state. Signature is sent only to this existing verification endpoint and is cleared from temporary references after use; never log or persist it in the browser.

Public state has exactly `noRelease,canIssue,chainId,wallets,roles,serverTime,status,round`. Require noRelease=true, canIssue=false, chainId10143, exact fixed wallets, boolean role fields, serverTime within30seconds and no unknown fields. NO_ROUND requires null round and no approvals. A round has exactly `id,digest,expiresAt,typedData`; typed data has exactly `domain,types,primaryType,message`. Validate all canonical UUID/bytes32/uint string values, exact type list, immutable original pins, and compute the digest independently with viem.

The domain is MealForward T1F Recovery/version1/chain10143/escrow `0xcf0c8827c8610eeff1ecbd9719e559d805fafe58`; primaryType SuccessorIssueRelease. The API adapter's compatibility reference is the existing backend protocol and dual-approval specification, never the old frontend implementation. Preserve its15 message fields, original claim/op/voucher/nonce/deadline/dataHash pins, distinct newOpId, nonzero observation,300-second approval and candidate deadline relationship. Before planning, extract these exact public constants and types into the task brief so the implementer cannot guess them.

Compatibility pins, extracted from the backend contract:

- claimId `fbab3b22-965d-44e2-b144-d7307b7aa8ea`.
- voucherId `0x170f16ef9ea00697bcfad635e33d521159db5e852b8b5499ddf8db819278b605`.
- originalOpId `0x2e709dee8113d2dac73cbea53d016d6629fc3730c6f85325a17c98bc4777445b`.
- originalDataHash `0x089cb2b0a35e81f31a9f9a658cd298ad7c9d3376ea01fac6fb77013451e1f0ed`.
- originalNonce/newNonce string `0`; originalDeadline string `1792765625`.
- Ordered fields: claimId/string, reviewId/string, slotId/string, voucherId/bytes32, originalOpId/bytes32, originalNonce/uint256, originalDeadline/uint256, originalDataHash/bytes32, newOpId/bytes32, newNonce/uint256, newDeadline/uint256, nonceDomain/bytes32, observedBlockNumber/uint256, observedBlockHash/bytes32, approvalExpiresAt/uint256.
- EIP712Domain ordered fields: name/string, version/string, chainId/uint256, verifyingContract/address. Message uint values are canonical decimal strings; signing tooling may internally use compatible bigint representations but must hash the same values. Require newDeadline=approvalExpiresAt+180 and round.expiresAt=approvalExpiresAt. At fresh read, expiry may be at most serverTime+300; an already-expired round remains displayable but never signable.

## Signing and uncertain results

Enable only for an independently validated, fresh COLLECTING round, unapproved matching current role and actual chain10143, with no wallet or submit request outstanding. The independent domain hold is an operational gate; do not invite human signing while it remains unresolved. Synthetic fixtures can exercise signing with synthetic keys only.

After the explicit click, re-read account/chain and server state, confirm the displayed round ID/digest remain identical and unexpired, then open exactly one typed-data prompt via Wagmi/viem. Re-read account/chain and check operation generation/time immediately after return. Never turn a stale signature into a new-round submission.

On HTTP submission rejection, timeout or lost response, mark that role/round result uncertain and require state readback before enabling any new signature for it. If readback confirms approval, show durable success; if it confirms no approval for the same valid round, an explicit fresh user action may sign again. If backend remains unavailable, keep signing blocked. No automatic signature/post retry; no secret-bearing diagnostics.

## Architecture, dependencies and integration

New isolated client modules in `t1-intents/wallet-v2/`: bootstrap/UI, wallet adapter, API transport, manifest validation and controller. They may import each other and official packages, not old frontend modules. Runtime wallet packages are pinned after compatibility verification: candidate `@wagmi/core`3.6.7, `@wagmi/connectors`8.2.2, existing viem2.57.1. Use an exact esbuild pin for self-hosted browser bundles; no React/AppKit/WalletConnect SDK or projectId. Do not change root CP30 dependencies. Prefer an isolated client package/lockfile so runtime service/legacy dependencies remain intact.

Produce fixed same-origin assets `/wallet-v2.html`, `/wallet-v2-bootstrap.mjs`, `/wallet-v2.css`, `/wallet-v2-wallet.mjs`, `/wallet-v2-validation.mjs` plus any explicitly listed controller/API bundle needed. The minimal server change is static allowlisting/MIME only; authenticated APIs, database and CSP semantics stay unchanged. Build output must be deterministic from pinned source/lock and checked in or built explicitly before service start, with CI proving served asset identity. The implementation plan decides one method and updates build verification accordingly.

Stage the new path alongside the existing root. Switch the same service's root only after source tests, independent review, exact CI and synthetic browser checks pass. Retain the old assets for explicit rollback; no new domain to evade classification. Existing approved deployment authorization covers the same Phase6 service update after checks; fresh public checks remain mandatory. Never claim new live version or human PASS until directly verified.

## Acceptance and completion

Automate actual bootstrap execution with DOM events and controlled loaders, not only exported helpers. Tests cover unresolved/rejected dependency, stalled session/state, late/multiple providers, no authorized account, correct/wrong role/chain, rejection/pending request, stale late result, account/chain change during signing, expiry/completed expiry, malformed/tampered manifests, server session expiry, submit response loss and exact readback recovery. Assert no forbidden wallet/HTTP methods and no automatic prompt/retry.

Browser checks execute the built app on desktop and390px using a synthetic EIP1193 provider and existing server handler with an isolated fixture service. Real extension acceptance is recorded separately and waits for the operational human gate. Run the existing non-PG suite and CI's isolated PostgreSQL checks when integrating. Public health/state/static/negative-route checks verify the actual deployment; existing old-asset smoke alone is insufficient for the new path.

Complete means reviewed new client built and integrated, checks passed, deployed version verified if deployment is performed, HANDOFF updated, and remaining human actions explained. It never means formal signatures collected, original UNKNOWN resolved, a voucher issued or merchant settlement enabled merely because client work passes.

