# Phase6 Recovery approval collector — deployment and human gate

Status: source-only development. No new cloud service or real database migration has been activated by this change. Phase5 Owner/Donor practice result is **USER-REPORTED 2/2 PASS · NO RELEASE**; it is not a formal Recovery signature.

## Reviewable boundary

The collector persists an immutable manifest and one verified fingerprint for each fixed role. Its private schema is `mf_t1f_recovery`; capability roles are `mf_t1f_approval_owner` and `mf_t1f_approval_runtime`, both created NOLOGIN with no runtime membership activation. SQL trusts the reviewed collector to verify EIP-712. A fingerprint is an attestation, not independently verifiable cryptographic proof in PostgreSQL.

`2/2` means two verified offchain approvals for that exact unexpired round. It never grants permission to issue, fund, settle, or prepare a wallet transaction. 015 stays `HUMAN_REVIEW_HOLD`; Phase6 does not insert a release or successor operation. All original Fund/Claim/Consent records remain untouched.

## Before any live activation

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

After a new explicit Issuer wallet observation, create one round using `node t1f-approval-operator.mjs create --wallet-observation OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE --observed-at <actual-observation-epoch-seconds>`. The observation must be no older than 120 seconds; do not substitute the current time for an old report. A round lasts 300 seconds. If the command is uncertain, read current state before any further action.

## Formal signature test, only after activation checks

The exact public URL and approved commit must be supplied after deployment; no unverified Phase6 URL is prescribed here.

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
