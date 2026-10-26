# Wallet Client V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inert Phase6 wallet client with an independently initialized, observable client using mature wallet tooling.

**Architecture:** A dependency-free bootstrap binds the UI first. Independently loaded wallet and validation modules feed a controller that keeps wallet, API, round and approval state distinct. Existing same-origin APIs and durable records remain authoritative.

**Tech Stack:** Vanilla TypeScript, Wagmi Core3.6.7, connectors8.2.2, viem2.57.1; isolated client package with exact dependencies/lock; esbuild browser bundles, Node tests with jsdom for actual bootstrap.

**Spec:** `docs/superpowers/specs/2026-10-26-wallet-client-v2-design.md` (user approved; autonomous implementation/review authorized).

## Global Constraints

- New client source only in `t1-intents/wallet-v2/`; do not read/copy/import old `public/t1f-approval.mjs/html/css` as an implementation template. Backend protocol, fixtures and this approved spec are allowed compatibility sources.
- Keep Monad Testnet10143 and exact Owner/Donor/domain/original pins/15 typed fields from the spec. Actual current account/chain must be verified, never inferred from configuration.
- NO RELEASE; no page-created rounds, automatic permission/signature/transaction requests, transaction/release endpoints, wallet chain changes, live migrations, capability changes, raw-signature/session/secret diagnostics or record deletion.
- Existing backend authenticated routes and CSP/session semantics remain unchanged; server changes only add explicit static asset mappings and switch root after acceptance. Keep old assets and `/t1f-approval.html` for rollback.
- Bootstrap binds controls before imports/API. Wallet inspection is independent of signing validation and backend refresh.10s dependency/read reporting,30s outstanding permission/sign reporting,15s API deadline; late results cannot mutate a newer context and unresolved prompts remain single-flight.
- Use an isolated `wallet-v2/package.json` and lockfile; do not alter root or t1-intents dependencies. Browser bundles are checked into `t1-intents/public/`, rebuilt/diff-checked by CI, eliminating Render build/runtime dependency changes.
- Formal real signatures remain held; synthetic wallet/fixture tests are separate evidence. Only main controller edits HANDOFF or performs cloud/wallet/browser actions. Implementers never dispatch subagents.

## Review Focus

- Actual HTML/JS initialization with import rejection or unresolved import must remain visibly actionable; Task2 DOM bootstrap tests.
- Repeated manual refresh must reuse session and not erase verified wallet state; Task1 transport and Task2 controller tests.
- A timed-out or superseded wallet signature must not submit or allow a duplicate pending prompt; Task2 delayed-provider tests.
- Multiple/late injected providers and account/chain change after prompt must invalidate stale data; Task1 adapter and Task2 signing tests.
- Build artifacts, strict static mappings and client entry returned by real HTTP must agree; Task3 integration/build/public checks.

## File Map and Interfaces

- `wallet-v2/src/contract.ts`: exact constants, structural rules and public state types; independent viem validator in `validation.ts`.
- `wallet-v2/src/wallet.ts`: Wagmi/injected adapter and EIP6963 discovery; no backend requests.
- `wallet-v2/src/api.ts`: strict same-origin session/read/submit, deadline and session reuse.
- `wallet-v2/src/controller.ts`: independent operation state, generation guards, signing/readback sequence.
- `wallet-v2/src/bootstrap.ts`: no static imports; immediate HTML bindings, dependency loading/status rendering/diagnostics.
- `wallet-v2/public/index.html`, `style.css`: new Chinese UI; build copies to fixed public assets.
- `wallet-v2/build.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`, `tests/*.test.ts`: isolated build and tests.
- Fixed built assets: `/wallet-v2.html`, `/wallet-v2.css`, `/wallet-v2-bootstrap.mjs`, `/wallet-v2-wallet.mjs`, `/wallet-v2-validation.mjs`, `/wallet-v2-controller.mjs`. All served as same-origin exact paths, each <1MiB. Bootstrap has no static imports; other entry bundles are self-contained, no unlisted chunks/CDN/eval.
- `WalletPort`: `providers(): ProviderChoice[]`, `select(id:string):void`, `inspect():Promise<WalletObservation>`, `connect():Promise<WalletObservation>`, `sign(typedData,account):Promise<string>`, `dispose():void`. Factory `createWalletPort({changed:()=>void}):WalletPort`; observations include `account:string|null,chainId:number|null`; choices include stable id/name. Exact role classification lives in shared new contract/controller. No automatic prompt from factory/inspect.
- `ApprovalApi`: factory `createApprovalApi({fetchImpl?,clock?,timeoutMs?})`; methods `read():Promise<unknown>`, `submit({role,roundId,digest,signature}):Promise<unknown>`. Session management internal/in-memory, sanitized errors. No state validation dependency to hold up wallet bootstrap.
- `validateState(value,now):PublicState`, `roleFor(account):'owner'|'donor'|null`, fixed contract exports. Controller receives validator as async loader, wallet factory as async loader, API, render callback, clock/timers. Its `inspect/connect/selectProvider/refresh/sign` operations expose a snapshot with independent wallet/backend/round/per-role statuses. Bootstrap may adapt exact controller signature so long as Task2 documents it for Task3.

### Task 1: Mature wallet adapter, strict contract and same-origin API

**Files:** Create isolated package/build/typecheck configuration; `src/{contract,validation,wallet,api}.ts`; `tests/{contract,wallet,api}.test.ts`. Create build entries/config only needed for these modules; Task2 completes remaining entries. No existing service/frontend edits.

**Interfaces:** Produce WalletPort, ApprovalApi and validation exports above. Accept actual spec values verbatim. Backend fixture imports may be used in tests, never production browser bundles.

- [ ] Write failing tests for: exact backend public fixture accepted/digest matches ethers; tampered domain/fields/pins/digest and malformed state rejected; NO_ROUND accepted; expiry represented safely. Verify no test imports old frontend.
- [ ] Write failing wallet tests with synthetic EIP1193 announcements: late/multiple provider discovery, inspect reads `eth_accounts`/`eth_chainId` without permission/signing, explicit connect only prompts on user action, actual wrong chain/account preserved, events trigger changed, no forbidden methods. Wagmi Core must be exercised, not replaced entirely by a mock adapter.
- [ ] Write failing API tests: exact same-origin route/header/body/fetch security options, session reused while valid,401 clears session for next explicit read, cancellation/timeout sanitized, submit never automatically retried, no signature in error/diagnostics.
- [ ] Run focused tests before implementation and record relevant RED. Implement minimal exact contract/adapter/API with official packages. Pin valid compatible dependencies and lock; candidate dev packages esbuild0.25.12,typescript5.9.3,tsx4.20.6,jsdom27.0.1; if registry compatibility differs, report before substituting. Use no root dependency changes.
- [ ] Run focused tests and typecheck. Run all current isolated client tests once before commit. Document interfaces/test evidence in report; commit only task files.

### Task 2: Independent initialization, visible UI and safe signing controller

**Files:** Create `src/{controller,bootstrap}.ts`, new public HTML/CSS, `tests/{controller,bootstrap}.test.ts`; complete `build.mjs` for six fixed assets. Task1 source may be amended only for a demonstrated interface integration defect, with report.

**Interfaces:** Consume Task1 WalletPort/API/validator. Export controller factory with injected loaders, render, clock/timers and snapshot; document exact factory/operations in report. Export/bootstrap test seam that mounts the actual shipped entry against jsdom with controlled dynamic loaders. Production bootstrap entry automatically mounts actual HTML.

- [ ] Write actual DOM startup tests using the new HTML and bootstrap: handlers exist before loaders settle; rejected/unresolved wallet import produces visible dependency status; delayed/failing validation only blocks signing; pending API session/state leaves wallet inspect usable; immediate progress text appears on click. Record RED before implementation.
- [ ] Write controller tests with deferred provider/API promises: correct Owner/Donor +10143, NO_ROUND, independent backend error, wrong role/chain, provider/account change, read delay, permission/sign outstanding lock, no duplicate prompt, late result ignored, local expiry/completed expiry. Tests use short injected timer durations, not real10/30s waits.
- [ ] Write signing tests for exact validated same round, before/after current account+chain and time checks, backend round swap, rejected wallet, submit response loss followed by positive/negative readback, server unavailability keeps readiness false. Assert signature cannot submit after invalidation/expiry and cannot auto-retry.
- [ ] Implement a small readable controller and Chinese four-region UI. Show complete typed domain/message/digest before explicit signing; textContent for untrusted values. Diagnostic copy contains only build/phase/timing/safe codes. Keep wallet/API controls independent. Bootstrap has no static imports and reports initialization errors without a generic silent catch.
- [ ] Build all six assets with esbuild. Run all client tests/typecheck/build; verify no forbidden transaction or external request methods and no old frontend imports. Commit task files and fixed build outputs. Report exact bootstrap/controller interfaces and how synthetic browser testing can control a provider without changing production behavior.

### Task 3: Same-service static integration, CI and deployment evidence

**Files:** Modify `t1f-approval-server.mjs` static mapping only; extend service HTTP tests or add `t1f-wallet-v2-http.test.mjs`; add `t1f-wallet-v2-live-smoke.mjs` and focused test if needed; modify Phase6 CI workflow to install/test/build-check isolated client; add safe local synthetic browser fixture entry in wallet-v2 test tooling. Main updates HANDOFF/runbook and performs cloud operations after review.

**Interfaces:** Serve six exact assets and route root to new HTML after client acceptance. Existing `/t1f-approval.html` and its assets remain served. Reuse actual makeApprovalHttpHandler with a synthetic service for browser fixture; loopback only, no real wallet/DB/RPC/signatures. Synthetic controls can be injected into fixture HTML only, never cloud mode. Live smoke uses public HTTP and no valid signature/durable write.

- [ ] Write RED HTTP tests proving new root/new assets MIME/security headers, exact mappings, path traversal/unlisted chunks rejection, old rollback entry remains, API behavior unchanged.
- [ ] Implement minimal static mapping. Add client CI install (`npm ci --ignore-scripts` with explicit reviewed build binary provisioning if required), test/typecheck, build and git-diff asset verification. Use the isolated package lock, no broad dependency scripts. Confirm esbuild binary availability under ignore-scripts; fail clearly rather than silently enabling install scripts.
- [ ] Extend live attestation to compare all new assets byte-for-byte (<1MiB each), root equals new HTML, health/session/NO_ROUND state and existing forbidden routes remain denied; no signature or write requests. Preserve old smoke or adapt assertions compatibly so it does not falsely expect old root.
- [ ] Run client suite/build and full non-PG suite once with existing `GITHUB_ACTIONS=true MF_T1D_DISPOSABLE_ONLY=ack-ephemeral-quote-key`; run syntax/diff checks. Commit integration files. Main obtains independent task and whole-change review before push/CI/deploy.
- [ ] Main executes desktop/390px browser fixture with CUA, confirms actual buttons/progress, then stops fixture. Push and await exact CI (including15 isolated PG checks). Deploy only existing approved Phase6 service with autoDeploy off; verify actual commit/live status, execute public smoke, read original-record fingerprint and zero successor counts. No formal round or human prompt. Update HANDOFF and provide only the necessary human read-only wallet inspection steps; domain hold still governs formal signing.

## Execution authorization

User explicitly chose the subagent workflow earlier and now approved autonomous implementation planning/development/independent acceptance until human testing. Routine plan/interface/build choices are delegated; do not pause to ask for another plan approval. Preserve exact design semantics, log material rulings, and stop only for a genuinely new security-sensitive/destructive action outside that authorization.
