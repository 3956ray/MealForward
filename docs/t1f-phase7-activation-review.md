# Phase7 activation review package (not activated)

## Current live boundary
The deployed collector remains6f4710c / dep-dbfnnc59el5s73fumd50. One completed formal round and two role receipts exist; that round expired. No successor release/operation exists. This source phase does not run cloud migrations, add live login credentials, enable production issuer execution, or transact. Disabled source mounting is included for verification.

## Intended integration
Logical017 consumes a valid round only through a separate execution runtime. The collector has no release capability. Its existing context/current/get functions expose a validated consumed receipt without weakening create/record. Runtime trust includes the reviewed collector's verification receipts and executor's independent chain proof.

The production HTTP source integration must reuse the T1-E SIWE-authenticated issuer principal and same-origin CSRF checks. Do not treat an address header, request body, or Phase6 anonymous CSRF session as issuer identity. The route adapter defaults disabled. Configure a distinct execution capability connection, never reuse collector/claim/admin credentials. Existing recipient routes remain unchanged.

## Review sequence before real activation
1. Fix source revision, migration SHA256, exact CI and independent review evidence; verify no pending important findings.
2. Read actual original fingerprint, existing roles/memberships/functions, completed approval state and empty successor tables. Inspect proposed ownership/grants and hosted PG17 compatibility.
3. Review the concrete migration and production configuration package against existing authorization before any live activation. Apply no blind batch and provision no secret through logs/chat.
4. Deploy a disabled execution entrypoint, validate least privileges/auth/origin/CSRF/negative routes and source parity before enabling prepare.
5. Confirm the real Issuer can use the entrypoint. Obtain fresh wallet activity report and new valid Owner/Donor approvals. The already passed historical test is not a reusable authorization.
6. Human Issuer explicitly prepares while more than90seconds of approval remain, inspects target/nonce/data, and sends once. A second click, lost response, rejection or reload never regenerates transaction bytes.
7. Bind only the original successor hash and reconcile independently verified canonical receipt/events/accounting. Preserve originalUNKNOWN and no merchant settlement.

## Rollback
Disable execution HTTP/permissions while preserving all immutable receipts and operations. If no operation exists, no transaction capability has been issued. If an operation exists, inspect/recover that same operation; do not delete/reset/re-reserve or issue another packet. Original Claim remains unchanged.

## Evidence
Accepted source a527feff5e5ff89a5dd4c83964bd5713e8288829; exact CI40404621279 all6 jobs SUCCESS,311 tests+42 isolatedPG groups. Whole-phase and final scoped review PASS with no remaining material findings. Main synthetic browser recovery/reload/wronghash/originalhash/reconcile and mobile checks PASS. This package is concrete and reviewable, but is not approval or evidence of live execution.

## Exact database delta

The append-only logical017 migration is `t1-intents/supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql`.
SHA256: `9c9f5abf9980e4164d6e526f6824788e150cfb51b668615c4a8ade7875092100`.

- Adds NOLOGIN/NOINHERIT `mf_t1f_execution_owner` and `mf_t1f_execution_runtime`, plus immutable linked consumption receipts. It does not create a login or grant a live user membership.
- Execution owner receives explicit SELECT on required original/recovery tables; column UPDATE for row locking; INSERT on successor release/operation/events; limited stage/hash/receipt/revision updates and audit sequence usage. Original mutation triggers remain enforced.
- Execution runtime has schema USAGE and exactly five function identities: `execution_context()`, `execution_round(uuid)`, `consume_round_and_reserve(uuid,text,jsonb)`, `bind_successor(uuid,bigint,text,jsonb)`, `reconcile_successor(uuid,bigint,jsonb)`. No direct table/sequence or schema CREATE capability.
- Collector owner gains only consumption read access; collector runtime's five-function interface is unchanged. Read context validates exact linkage; create/record stay closed after consumption.
- Replaces three015 HOLD-only release checks with a strict released receipt/provenance constraint; updates release/operation guards without changing original Claim or hold slot.
- Temporary migration-executor SET/INHERIT ownership memberships are revoked. Hosted-equivalent non-superuser PG17 migration is tested; actual hosted catalog still requires preflight before application.

Task1 evidence at `d1473a9`: fresh isolated PG17.11 16 groups PASS, including 6-way consume concurrency, rollback, collector continuity, exact callable-signature audit, expiry and original byte equality. Main independently reran the same suite with EXIT0. Scoped independent review PASS; live database unchanged by these tests.

## Source entrypoint contract

New routes are under `/v1/t1f/successor/`: authenticated GET `status`, POST `prepare` with roundId/digest, POST `bind` with roundId/successorId/revision/txHash, POST `reconcile` with roundId/successorId/revision. They use existing SIWE session cookies and POST CSRF checks. A caller-supplied wallet address is not authentication.

The source deployment switch is `T1F_SUCCESSOR_EXECUTION_ENABLED`, default `false`. A distinct `T1F_EXECUTION_DB_URL` is required when enabled; its value must remain secret. This flag must not enable the old `T1F_ISSUE_WALLET_ENABLED` path. No source change or default enables the live service.

Only successful first `prepare` can return transaction bytes. All status and recovery responses omit them. The browser requires a separate explicit send action; it consumes its in-memory packet before asking the provider. Rejection or uncertainty does not permit a second send. The UI distinguishes original UNKNOWN from successor state.

## Next human acceptance (after live prerequisites)

1. Confirm the Issuer wallet's current activity; the report used for the expired historical round is not fresh evidence.
2. Use the deployed Issuer page to check account and Monad Testnet10143, then explicitly complete SIWE login. Login is an authentication signature, not an Issue transaction.
3. Once service and source/permissions gates pass, obtain a new short-lived round. Owner and Donor explicitly approve the same displayed digest before its cutoff. The earlier passed round remains historical evidence.
4. Issuer refreshes status, verifies READY_TO_PREPARE and the displayed round/digest, then explicitly prepares while the displayed prepare window is open.
5. Inspect target/nonce/deadline and explicitly send once. If any step is rejected, times out or loses its response, stop sending and use recovery. Do not clear state to retry.
6. Bind the returned hash to the same successor and reconcile. Acceptance requires verified canonical receipt/events/accounting; a wallet popup or submitted hash alone is not issuance success.

These are future acceptance instructions, not a request to use the current public collector for Issue. Exact deployed URL/build and remaining prerequisites must be supplied before asking for real testing.

Task2 evidence at `1848a85`: 22 targeted service/HTTP/config/legacy tests PASS; 8 actual HTTP + freshPG lifecycle groups PASS (service/SQL unchanged by timeout fix). Independent full task review and scoped timeout-fix review PASS. HTTP deadlines return504 and suppress late bytes; underlying pending calls remain capped at4, and production execution PG has8second client query timeout. No claim of live or real-wallet acceptance.

Read-only hosted preflight at2026-10-27 04:56 UTC+8: PostgreSQL17.11; rounds1, approvals2; successor release/operation/event0/0/0; no mf_t1f_execution schema or execution roles. Collector owner/runtime remain NOLOGIN/NOINHERIT and login remains NOINHERIT; none has superuser/CREATEROLE/BYPASSRLS. Original/successor tables owned bypostgres, collector tables bymf_t1f_approval_owner. No live mutation performed.

## Exact live targets and activation ordering

Read-only Render check2026-10-27: existing Claim/SIWE service `srv-dbdgstivcj2c73fnqcc0`, URL `https://mealforward-t1e-claim-laodao.onrender.com`, live deploy `dep-dbdto63rjlhs738br1sg`, commit `c8723c2f280e4b72ff067e0be08f5bf1c4a15412`. Saved branch remains `codex/mealforward-t1e-recipient-claim-http-20261023`; autoDeploy off. Start command `cd t1-intents && npm run start:t1e:claim:entrypoint`. Collector is separate `srv-dbfflq5g1s2s73fl05fg` at its existing URL. Neither was changed.

Activation must deploy the final reviewed exact commit, not an unrelated saved branch HEAD. First update the collector to consumed-aware source and verify public resource/build parity while it still has only approval capabilities. Deploy the Claim service source with successor disabled and legacy `T1F_ISSUE_WALLET_ENABLED=false`; preserve existing Claim/Auth identity, project, TLS, no funding and no settlement. Then apply the exact017 migration only after current catalog/original-state preflight, provision the dedicated execution LOGIN with only runtime membership, and configure its DSN without exposing credentials. Finally enable the successor flag, verify runtime audit and public unauthenticated/origin/method negatives before asking the human to authenticate.

Expected future UI URL: `https://mealforward-t1e-claim-laodao.onrender.com/t1f-execution.html`. It is not deployed now. Collector formal approvals remain at `https://mealforward-t1f-approval-laodao.onrender.com/`. No fresh round should be created until the Issuer login/read test and a fresh wallet activity report are available; historical2/2 approval is not reusable.

## Explicit activation decision now required

The source phase is complete. Confirm applying the exact017 migration, provisioning the dedicated execution login/runtime membership and configuring only the existing Claim service, deploying the reviewed collector/Claim revision, disabling the old original-Issue route and enabling the successor test entrypoint after negative/auth/capability gates. No fresh round, wallet signature or transaction is included in that activation action; obtain a fresh human activity report and the required explicit wallet actions afterwards. The Superpowers SDD security-sensitive-action stop applies to this new real execution capability. Keep the Draft PR and working branch; do not merge the whole branch into an unrelated curated release.

If reload loses the returned hash after a successful wallet send and failed bind, the Issuer page now accepts the same original transaction hash from wallet history through an explicit recovery action. It validates the loaded operation and calls the existing full server identity check; an unrelated hash cannot update the operation, and no send bytes are recreated.
