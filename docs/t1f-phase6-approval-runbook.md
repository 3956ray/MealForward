# Phase6 Recovery approval collector — deployment and human gate

Status: activated with explicit user approval on2026-10-26. Supabase013–016 and the dedicated login are live; the separate Render collector runs commit `8500627b890589e57f46362a805bce3f006892e1`. Public31-check smoke and source CI211 tests/15 PG groups passed. Current state is **NO_ROUND · NO RELEASE**; a read-only observation confirmed the real Owner connected on10143 before this update; Donor and the revised feedback remain unverified by a human. The corrected UI passed real Chrome synthetic-wallet desktop/390px checks; this is not real wallet acceptance. Phase5 Owner/Donor practice result is **USER-REPORTED 2/2 PASS · NO RELEASE**; it is not a formal Recovery signature. Exact resource IDs and evidence are in root HANDOFF.

**Current human gate (2026-10-26 16:00 UTC+8):** MetaMask dapp scanning returns BLOCK for this hostname. Pause formal signing/round creation while the domain classification is reviewed. One observed attempt returned an Owner/Donor mismatch after the user independently continued a warning. The user subsequently clarified that correct-account attempts also show no visible response; the single mismatch does not explain those attempts. A later foreground observation confirmed that exact Owner attempt connected successfully on10143. This does not prove all previous attempts succeeded. The revised UI shows connection results beside each role button and labels approval records separately. This is not approval to ignore future warnings. The user explicitly chose not to submit the external review on2026-10-26. Keep the draft unsent and formal signing on hold; do not repeatedly ask for the same authorization. See HANDOFF and the prepared, unsent domain-review request.

## Reviewable boundary

The collector persists an immutable manifest and one verified fingerprint for each fixed role. Its private schema is `mf_t1f_recovery`; capability roles are `mf_t1f_approval_owner` and `mf_t1f_approval_runtime`, both NOLOGIN. The separate NOINHERIT login has only runtime SET membership. SQL trusts the reviewed collector to verify EIP-712. A fingerprint is an attestation, not independently verifiable cryptographic proof in PostgreSQL.

`2/2` means two verified offchain approvals for that exact unexpired round. It never grants permission to issue, fund, settle, or prepare a wallet transaction. 015 stays `HUMAN_REVIEW_HOLD`; Phase6 does not insert a release or successor operation. All original Fund/Claim/Consent records remain untouched.

## Activation checklist (completed; historical baseline, do not rerun)

1. Review the source PR, independent review and all CI results at the exact candidate commit. Do not merge this entire source branch into the existing curated Render release branch.
2. Obtain explicit approval for the specific database/service activation. Existing developer authorization and practice PASS do not activate real migrations or formal signatures.
3. Read the actual Supabase migration list and original claim. The recorded live baseline is 001–012 only, original `ISSUE_UNKNOWN`, revision2, nonce0, immutable deadline1792765625, no stored hash. A missing hash is not proof of no broadcast.
4. Re-run read-only original-chain and wallet-activity investigation. Any conflict, unexpected authority, occupied nonce, unavailable Unit, stale block or unknown transaction stops preparation. Do not reset/retry the original UNKNOWN.
5. Independently review 013, create its immutable review record only from fresh verified evidence, then review 014 and create its held slot. These are staged operations, **not a blind batch migration**: 015/016 require exact prior rows and must abort if absent or changed.
6. Apply the reviewed 015 HOLD and 016 collector migration only after the explicit migration gate. Inspect ownership, EXECUTE grants, forbidden table access, public/legacy roles, all original records, absence of successor rows and Supabase security advisors.
7. Provision a dedicated least-privilege login by a separately reviewed private operator procedure. No passwords, DSNs, raw signatures or session/CSRF values belong in GitHub, HANDOFF or chat. Keep strict certificate verification. Never use postgres, service_role, or old Claim/Fund/Auth credentials for this service.
8. Deploy only the separate collection service, with a separate hostname and explicit collection enablement. Existing RoleProof and Claim services remain unchanged. Public health/session/state/static/negative-route checks and deployed-source verification must pass before a user is asked to sign.

## Runtime commands (only after the activation gate)

Build in `t1-intents`: `npm install --ignore-scripts --no-audit --no-fund --package-lock=false`.
Start: `node t1f-approval-server.mjs`. Configure `T1F_APPROVAL_MODE=COLLECTION_NO_RELEASE`, `T1F_APPROVAL_ORIGIN` as the exact separate HTTPS origin, platform `PORT`, and private `T1F_APPROVAL_DB_URL`. The URL must use the dedicated `mf_t1f_approval_login.ketfrukrcuosrqynnsay` identity at the pinned Supabase session pooler; strict TLS and effective catalog privilege checks are mandatory. Never enable the local fixture flag in cloud. The service refuses legacy/admin credentials and overprivileged identities.

The session pooler ignores startup role options. The reviewed runtime therefore awaits fixed SET ROLE and5s/2s limits for every acquired connection, and checks cancellation/deadline again immediately before write SQL. Do not bypass its wrapper.

Only after a new explicit Issuer wallet observation and human readiness, call `runApprovalOperator({args,env})` from `t1f-approval-operator.mjs`. Load `env` directly in-process with `JSON.parse(await readFile('/Users/mili/.mealforward-phase6-20261026/runtime.json','utf8'))`; do not print the config or put the DSN in shell arguments. `args` is `['create','--wallet-observation','OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE','--observed-at',String(actualObservationEpochSeconds)]`. Use the actual report timestamp, never the current time substituted for an old report. The observation must be no older than120seconds. A round lasts300seconds. Catch errors with a generic message, without dumping environment or raw connection errors. If creation is uncertain, use the same reviewed runtime to read `service.status()` before any further action; do not blindly retry.

## Formal signature test, only after activation checks

Verified public URL: **https://mealforward-t1f-approval-laodao.onrender.com**. It serves commit `8500627b890589e57f46362a805bce3f006892e1`, Render deploy `dep-dbfiinuc6qcc739rqdr0`. The page now shows an independent “当前钱包连接” region with the verified current role, actual account and network, or an actionable connection error. Each role now has adjacent connection feedback, an “已连接 · 重新核对” button after success, an explicit “签名批准：尚未记录” label and a reason beside a disabled signature button. Switching accounts invalidates the old connection confirmation; test one role at a time. Before a round exists, expect `NO_ROUND · 0/2 · NO RELEASE`; wallet connection is available but formal signing is disabled. On a cold free instance allow about1–2minutes for the page to load, then refresh once if needed. First confirm actual browser display and readiness before starting the five-minute round.

1. Explicitly inspect the Issuer wallet activity and report the current observation before the operator creates a fresh round. Page loads and refreshes must never create a round. A failed/expired round cannot roll over automatically.
2. Open the verified Phase6 page. Confirm it says **formal Recovery approval**, `MealForward T1F Recovery`, version `1`, `SuccessorIssueRelease`, Monad Testnet `10143`, and the fixed escrow `0xcf0c8827c8610eeff1ecbd9719e559d805fafe58`.
3. Confirm the page and wallet show the same round values: original claim/operation, new candidate operation, nonce0, deadline, nonce domain, observed block and approval expiry. Both people sign the same digest within five minutes. This is different from the prior Practice v0 payload.
4. Explicitly select Owner `0xc4f8a468f10d5f98dcff3282516125e97f26433b`, then click its formal signature control and personally approve the typed-message prompt. No token approval or transaction confirmation should appear.
5. Select Donor `0xcc5c1ce846c0302ab27a4811cf2e0e6fc7282952`, then repeat on the same round/digest. If the round expires, stop; a new operator-created round needs both fresh signatures.
6. Refresh the page. Both recorded roles should remain visible while the round is valid, with `COLLECTED_NO_RELEASE` and **NO RELEASE**. If a request times out, refresh state first; do not automatically re-sign or resubmit.
7. After expiry, the page must show EXPIRED even if both historical signatures were recorded. Account/network/disconnect changes must invalidate unfinished local work. Report only displayed state and errors; never copy a raw signature or cookie.

## Stop and rollback

Disable or suspend only the new collector if validation fails. Retain immutable rounds and audit history; revoke its dedicated login/membership through a reviewed procedure if needed. Do not drop records, reset the claim, enable 015, replay old signatures, or retry an UNKNOWN transaction. A future actual Issue release still requires a separate reviewed protocol and explicit human transaction approval. Merchant settlement remains forbidden because issue #17 is unresolved.

## Verification references

- Design: `docs/superpowers/specs/2026-10-26-phase6-approval-design.md`.
- Plan: `docs/superpowers/plans/2026-10-26-phase6-approval.md`.
- Database definer design follows the [PostgreSQL 17 function security guidance](https://www.postgresql.org/docs/17/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY): private schema, trusted ownership, fixed search path and revoked PUBLIC execution.
- Latest run commands, counts, CI/PR links and the actual live baseline belong in root `HANDOFF.md`; source tests must never be described as live wallet acceptance.
