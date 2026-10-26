# Phase6 live activation proposal — NO RELEASE

The user explicitly approved this proposal on2026-10-26 and asked to continue until human testing. The staged database and dedicated-login activation described below has now been executed. The new Render service is live at https://mealforward-t1f-approval-laodao.onrender.com, running `cb974115c3bf5198499394bf75ad455e47bdc2cc`; actual31-check public smoke, CI200 tests/15 PG groups and independent database audit passed. Public browser display and formal wallet signatures remain untested. No approval round has been created. See root HANDOFF for exact migration/deployment/test evidence. Historical proposal wording below describes the approved sequence and its pre-activation baseline; it must not be mistaken for current state or rerun.

## Live preflight findings fixed before activation

Read-only Supabase catalog inspection found the migration executor is PostgreSQL17.11 `postgres` with CREATEROLE but without SUPERUSER, and `createrole_self_grant` is empty. The earlier superuser-only fixture did not cover schema creation under a separate owner. 016 must explicitly acquire only temporary SET capability and remove it before commit, preserving the native ADMIN-only creator membership.

The platform also grants PUBLIC SELECT on its statistics views, but does not grant PUBLIC access to their `extensions` schema. Startup must distinguish inaccessible ambient grants from effective access while still rejecting direct table/column grants, schema access and any legacy application table privilege. Do not revoke platform-wide grants or add a blanket platform exception.

These findings were discovered before any live write. The non-superuser migration and inaccessible PUBLIC-view failures were reproduced before changes, then fixed. Real temporary PG17.11 now passes15 behavioral groups, including retained denial of direct/schema/column access and removal of temporary owner capability. Targeted peer review found no remaining blocker in these fixes; CI evidence is recorded in HANDOFF. See [PG17 role attributes](https://www.postgresql.org/docs/17/role-attributes.html), [schema ownership requirements](https://www.postgresql.org/docs/17/sql-createschema.html), and [schema privileges](https://www.postgresql.org/docs/17/ddl-priv.html).

## Exact scope

- Repository: `3956ray/MealForward`, Draft PR #47. Latest migration compatibility source: `de37543`; runtime compatibility source: `cdafe15`. Earlier complete CI tree: `b666d10dfe523c1093722e52f10566d378efef76`; latest integrated [CI40280611850](https://github.com/3956ray/MealForward/actions/runs/40280611850) on `cdafe159228435e3f4ecce766733493f19f88f43` passed all four jobs (189 tests and15 PG groups). Do not include later application changes without review and verification.
- Supabase: `ketfrukrcuosrqynnsay`, current baseline001–012. Add the four reviewed numbered schemas sequentially, with one non-authorizing review and one held slot between them. No mutation of original Claim/Fund/Consent and no insertion into `successor_issue_releases`, `successor_issue_operations` or `successor_issue_events`.
- Provision exactly one dedicated login, `mf_t1f_approval_login`, NOINHERIT, no superuser/bypassRLS/createDB/createRole/replication, member only of `mf_t1f_approval_runtime`. Runtime and owner stay NOLOGIN. Generate its secret privately and send it only to the selected Supabase/Render secret configuration; never place it in source, logs or chat. Existing credentials are not reused.
- Render LaoDao `tea-db7q3ou7bikc73bp2bt0`: a **new** Node22 web service, proposed name `mealforward-t1f-approval-laodao`, Singapore, free instance, automatic deploy off. If free provisioning is unavailable or the proposed service already exists unexpectedly, stop and re-evaluate; do not select a paid tier automatically. Existing RoleProof/Claim services remain unchanged.
- Build in `t1-intents` with the existing pinned package declarations and `npm install --ignore-scripts --no-audit --no-fund --package-lock=false`; start `node t1f-approval-server.mjs`. Environment must match the runbook. Obtain the actual assigned HTTPS hostname before setting the strict origin; no invented URL is a verified test entry.

## Reviewed SQL artifacts

| File | SHA256 |
| --- | --- |
| `013_t1f_expired_issue_review_only.sql` | `76ae74afeb1f1109f51adc4a2473fb6c71ae646159c1e2eee1ea18fde195a515` |
| `014_t1f_successor_attempt_review_hold.sql` | `2454421b7dd1cd7f7753f43cb1a0b051763ba80baa6f116d6db10d3e0fec8c8a` |
| `015_t1f_dual_release_successor_issue.sql` | `99f6c12bbbb839bf613a93a1aab8721fa03c5585c0f7c9a44ac2d225dfd4b9ab` |
| `016_t1f_recovery_approval_collection.sql` | `ea751fae47282fc323391cab979beedc03f99c3eac83f17edd2e3b606eaf5de8` |

## Sequential execution and stop points

1. Re-read deployed migration history, original claim and permissions. Verify exactly one funded intent and immutable original ISSUE_UNKNOWN/revision2/nonce0/deadline1792765625 with no hash/receipt; verify one reserved event and one verified consent. Re-run the original chain/readiness checks on one canonical fresh head. Never reuse stale evidence as a current observation.
2. Apply exact013, inspect permissions, then append one `expired_issue_reviews` row. Read original values from the original claim (do not modify it), use a new UUID, and the newly verified block/hash/latest+pending nonce/op/unit observations. Wallet report is `OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE`, expressly not proof of all mempools. Read back `MANUAL_REVIEW_ONLY_NO_NEW_ISSUE` and all three may_* flags false. Do not seed synthetic fixture identifiers or fake block hashes.
3. Apply exact014, append one `issuer_issue_attempts` row with a new UUID, the same claim/review ID and copied original immutable fields. Read back `REVIEW_HOLD`, null successor/receipt/release fields, all wallet/sign/broadcast/issued/rewrite flags false.
4. Apply exact015 then016, inspect role ownership, fixed search paths, narrow EXECUTE grants and security advisors. Confirm all original rows unchanged and successor release/operation/event counts zero. Every step is a separate gate: a failure leaves the state on HOLD; no blind rerun of completed migrations.
5. Provision the dedicated login privately with only runtime membership. Run the actual `verifyApprovalRuntime` and context startup checks over verified TLS as that login before exposing the service. A Supabase/public default privilege conflict must be reviewed narrowly; never bypass the startup check or revoke unrelated application grants blindly.
6. Deploy the separate service at the pinned reviewed source. Verify actual deployed commit, static asset bytes, health, same-origin session/state, cross-origin/body/cookie/forbidden-route rejection, and zero transaction routes. Initial state must be NO_ROUND. Browser desktop/mobile and real public availability are separate checks from the completed source CI.
7. Only when all prior checks pass, obtain a **new** wallet observation immediately before creating the300-second round; the operator requires age≤120seconds. The present report is historical once stale. Then give the user the verified URL and exact Owner/Donor signing steps. No automatic signature or round rollover.

## Reviewed record insertion templates (executed with verified live values)

Execute these only after the corresponding migration and fresh read-only evidence checks. Bind parameters using the private operator client, never concatenate browser/user strings. Require exactly one RETURNING row, then read back every invariant before the next migration. A lost response is ambiguous: inspect existing unique claim/review/slot state instead of generating another ID or retrying automatically.

After013, bind `$1` to one newly generated review UUID, `$2/$3` to the verified canonical block number/hash. Latest/pending nonce0, op unseen and available unit must already have passed the independent probes; this SQL does not query the chain:

```sql
INSERT INTO mf_t1e.expired_issue_reviews(
 review_id,claim_id,original_operation_id,original_issuer_nonce,
 original_deadline,original_calldata_hash,chain_id,
 observed_block_number,observed_block_hash,
 observed_issuer_latest_nonce,observed_issuer_pending_nonce,
 original_operation_seen,original_unit_available,wallet_observation)
SELECT $1::uuid,claim_id,issuer_op_id,issuer_tx_nonce,
 issuer_issue_deadline,issuer_tx_data_hash,10143,$2::bigint,$3::text,
 0,0,false,true,'OWNER_REPORTED_NO_TRANSACTIONS_VISIBLE'
FROM mf_t1e.recipient_claims
WHERE claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'
 AND stage='ISSUE_UNKNOWN' AND revision=2 AND issuer_tx_nonce=0
 AND issuer_issue_deadline=1792765625 AND issuer_tx_hash IS NULL
 AND receipt_block IS NULL AND receipt_block_hash IS NULL
RETURNING review_id,review_state,may_create_second_operation,
 may_broadcast_transaction,may_modify_original_claim;
```

After014, bind `$1` to one new held-slot UUID and `$2` to the exact review UUID returned above. The reviewed trigger additionally checks the source review and original pins:

```sql
INSERT INTO mf_t1e.issuer_issue_attempts(
 attempt_id,claim_id,review_id,original_operation_id,
 original_issuer_nonce,original_deadline,original_calldata_hash)
SELECT $1::uuid,c.claim_id,r.review_id,c.issuer_op_id,
 c.issuer_tx_nonce,c.issuer_issue_deadline,c.issuer_tx_data_hash
FROM mf_t1e.recipient_claims c
JOIN mf_t1e.expired_issue_reviews r ON r.claim_id=c.claim_id
WHERE c.claim_id='fbab3b22-965d-44e2-b144-d7307b7aa8ea'
 AND r.review_id=$2::uuid
RETURNING attempt_id,stage,successor_operation_id,successor_nonce,
 successor_tx_hash,security_release_id,may_prepare_wallet_tx,
 may_sign_or_broadcast,may_mark_issued,legacy_claim_rewrite_allowed;
```

Private login provisioning must use `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`; grant only `mf_t1f_approval_runtime` with `ADMIN FALSE, INHERIT FALSE, SET TRUE`. Credentials must be generated/injected through a private procedure that does not return them into connector transcripts. If that procedure is unavailable, stop at the completed schema/HOLD stage and request the user's direct secret entry; do not use a shared elevated login as a shortcut. The dedicated credential has since been generated through an ephemeral private provisioning flow, delivered only to its authorized Supabase/Render configuration, and retained in an owner-only local operator file outside Git. Values were not displayed or checked into source. Only the nonsecret role creation is in migration history; password configuration was separate.

## Evidence collected before this proposal

- User: “没有任何的内容和活动在这个地址里面。” This answers the request to inspect Issuer `0x9747d93d9f8c2e1202b4d922a4916fcf634aa2b3` on Monad Testnet; recorded as user-reported observation, not independently viewed wallet evidence.
- Public RPC checked at 2026-10-26T06:22:28.888Z, block `74308442`, hash `0xed598e8b154df9b2f0102fc7f5165582b06e9c0f24b0ac70db83a8bb86684db2`. Exact original bytecode/authorities/funding receipt/accounting/candidate checks passed, with issuer simulation disabled. Issuer latest/pending nonce0, original operation not observed, unit available/not issued, balance and liability7000000 base units. No send methods or signatures.
- Public RPC cannot prove every mempool is empty. Preserve original UNKNOWN and never replay it.
- Supabase still001–012 and original unchanged; RoleProof still c1b99b5 / dep-dbfbvi4s728c73erotl0. CI run40270078908 remains the source verification; this proposal is not deployed verification.

## Failure handling

Stop only the new service or revoke its new dedicated login if needed. Keep immutable review/slot/round/audit rows. No reset, delete, old-operation retry, release or merchant settlement. Actual Issue remains a separate future reviewed and human-confirmed transaction.

## Dedicated identity activation (nonsecret migration record)

Applied migration `20261026064853 mealforward_t1f_approval_dedicated_login_role_v1` created the role disabled, then a separate private account-configuration step set its credential and enabled LOGIN. This SQL contains no password:

```sql
BEGIN;
CREATE ROLE mf_t1f_approval_login NOLOGIN NOINHERIT NOSUPERUSER
 NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4;
GRANT mf_t1f_approval_runtime TO mf_t1f_approval_login
 WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
COMMENT ON ROLE mf_t1f_approval_login IS
 'Dedicated Phase6 collector identity, runtime capability only; credential privately provisioned separately, NO RELEASE';
COMMIT;
```

The actual session pooler ignores the startup `options` role field, unlike native PG. The deployed candidate therefore explicitly awaits fixed runtime SET ROLE and5s/2s time limits after every acquired connection, checks cancellation/deadline again immediately before a write, and discards clients on setup/query failure. Actual TLS login verification showed session_user=dedicated login, current_user=runtime, NO_ROUND. Private operator config is `/Users/mili/.mealforward-phase6-20261026/runtime.json` (directory0700, file0600). Never print or copy its contents into logs, GitHub or chat. Future operator commands must load it directly in-process, not place a DSN in shell arguments.
