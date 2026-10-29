# Phase 7: controlled successor execution

Date: 2026-10-27. Status: implementation design, not live activation approval.

These implementation decisions are the agents' choices under the user's authorization to progress autonomously until human testing. They are not a claim that the user separately approved each technical detail. No generic design-confirmation pause is required. This slice does not apply a real migration, grant live execution privileges, deploy an execution service, create a real approval round, reserve a real successor, or broadcast a transaction.

## Outcome and scope

Deliver a complete execution core and authenticated HTTP controller connecting durable recovery approvals to one controlled successor Issue: inspect readiness, explicitly prepare, return wallet bytes once, bind the original transaction hash, and reconcile receipt/accounting. Exercise the controller with an isolated real PostgreSQL 17 database and a one-shot browser-wallet fixture. Deliver a concrete integration/activation checklist for the existing T1-E SIWE service; live deployment and real wallet acceptance remain a separate reviewed gate. Do not build another authentication service or automated signer.

The original Claim remains ISSUE_UNKNOWN forever in this slice. Its Fund, Consent, original operation/nonce/deadline, events, and review/hold slot are not rewritten. Successor state belongs exclusively to the successor tables. Merchant settlement and funding remain disabled.

## Authorization and evidence

Use immutable 016 role approvals as trusted receipts of verification performed by the reviewed collector. Fingerprints alone are not cryptographic evidence: the trust boundary includes the collector's pinned EIP-712 EOA verification, protected SQL functions, immutable records, and capability isolation. Do not retain or request raw signatures again during execution.

The two role receipts must reference the same round/digest and exact pinned Owner and Donor, with supported verification versions and timestamps inside the round's validity. Reconstruct the signed manifest and calldata hash from the stored round and immutable original context. Do not rebuild its signed block fields from a new chain head. Independently check the original signed anchor is still canonical, then obtain a fresh bounded canonical observation, latest/pending issuer nonce, original operation status, Unit Available, fixed code/authority and escrow accounting. Simulate the exact candidate calldata before reservation. A fresh observation must never silently replace signed evidence.

The passed round `79e1b5e5-ba34-4387-805b-e2eb7d00300d` is expired and cannot be consumed. No deadline, operation ID, or nonce-domain extension is allowed. Require more than 90 seconds remaining before preparation begins; authoritative SQL checks at insertion must retain the 015 minimum of 90 seconds and all candidate deadline bounds. Reject if processing consumes that margin. Display the shorter prepare window separately from approval expiry.

Owner/Donor approvals remain offchain review evidence. Execution additionally requires the separately reviewed activation and a real Issuer-authenticated explicit action. Collection does not automatically authorize a wallet popup or issue transaction.

## Database migration 017

Add an append-only migration; do not edit already-applied 015/016 history. Introduce a distinct execution owner/runtime, default NOLOGIN and without live membership grants. Grant only narrow SECURITY DEFINER functions with fixed search_path and bounded timeouts. Collector, Auth, Claim, funding, anonymous and public roles receive no execution ability or table writes.

One atomic consume-and-reserve function first acquires the existing collector advisory transaction lock (10143,160026), then locks the round and immutable slot in a consistent order, checks current original context and both approvals, rejects expired/consumed/mismatched rounds, and creates a unique consumption receipt, released successor receipt, one successor operation and its audit event in a single transaction. Receipt links round, digest, release and operation; unique constraints prevent competing rounds reserving the same Claim/slot. Derive release fields from stored round/approvals rather than accepting arbitrary client fingerprints or signed values. The service is responsible for validated chain evidence; SQL does not claim to verify RPC or signatures.

017 explicitly replaces the 015 HOLD-only constraints with narrowly validated released receipts and records the new provenance/version. Do not merely remove constraints or grant direct INSERT. Preserve original immutability triggers, no-server-broadcast and no-settlement constraints. Bind and reconcile use narrow CAS functions, immutable identity fields and monotonic status. Status returns no wallet transaction bytes.

## Collector continuity after consumption

Keep the existing `context()`, `current_round()` and `get_round(uuid)` signatures and capability allowlist. Refactor context validation into immutable-original validation plus a separate strict no-successor write guard. Read paths may return validated historical context and a consumption receipt after release only when every successor row has exact legitimate consumption linkage; orphan or mismatched rows must fail closed. `create_round` and `record_approval` must explicitly call the strict guard under their existing transaction lock, and continue rejecting any successor state. Read permission must not become write authorization.

Add a narrowly selected read privilege for the collector function owner to inspect the consumption receipt; give the collector runtime no new direct table capability. Include consumption metadata through the existing read functions. Source validation must verify the receipt's round/digest/Claim/slot/release/operation linkage and exact false capability fields before displaying CONSUMED_NO_RELEASE. Collector DTOs always retain `noRelease:true` and `canIssue:false`, including consumed state. Collector startup, historical reads and status must remain available; no create/record operation succeeds after consumption.

## Execution service and HTTP

Frozen adapter interface (all SQL functions return one jsonb result):

- `execution_context()` returns `{context, round, consumption, operation}`; `context` preserves the current claim/review/slot shape. Read state never returns calldata.
- `execution_round(uuid)` returns the same envelope for a selected historical round.
- `consume_round_and_reserve(uuid,text,jsonb)` takes roundId, expectedDigest and the reviewed service's fresh chain observation attestation. It returns `{created, operation, consumption}`. SQL derives the candidate identity and release proof exclusively from the stored round. The operation returned to the service includes its immutable calldata hash, not a stored send payload.
- `bind_successor(uuid,bigint,text,jsonb)` takes successorId, expected revision, transaction hash and validated transaction attestation; it returns the updated operation.
- `reconcile_successor(uuid,bigint,jsonb)` takes successorId, expected revision and validated receipt/accounting attestation; it returns the updated operation.

These functions live in a new dedicated execution schema. Store methods are `context()`, `get(roundId)`, `consume({roundId,digest,evidence,beforeExecute})`, `bind({successorId,revision,txHash,evidence})`, and `reconcile({successorId,revision,evidence})`. Evidence schemas must be exact and versioned in implementation; they are trusted service attestations and not browser inputs. Store capability selection must finish before evaluating beforeExecute. Atomic consume handles an existing successor first and never returns created=true for recovery. The service reconstructs exact transaction bytes from the already-validated manifest only when created=true.

Collector interface decision: preserve the direct claim/review/slot shape of `context()` and add an optional `consumption` field; preserve round shape in current/get and add the same optional receipt. Implement immutable-original validation independently of the strict no-successor guard, so context can return the unchanged original rows after consumption. No saved secret-bearing snapshot is needed. Change collector `publicApproval`, wallet-v2 validation/controller and legacy approval client to recognize exactly `CONSUMED_NO_RELEASE`, validate the receipt, disable signature submission, and keep every capability false. Both pre-consumption and post-consumption shapes receive integration tests. This is in-scope implementation, not deferred production glue.

Add an execution store/service and successor route controller. The controller accepts only an authenticated original Issuer principal supplied by the existing trusted T1-E SIWE middleware; request headers, body wallet strings and collector anonymous sessions are never identity. Same-origin, CSRF, strict body shapes, rate/time limits and no-store responses remain required. Implement source mounting through the existing SIWE gateway and separate audited execution-pool configuration, explicitly disabled by default. Actual production configuration and enablement remain a reviewed activation gate; importing the controller never enables execution.

Expose status, prepare, bind and reconcile. Prepare names only the selected roundId/digest and any explicitly specified bounded observation fields. The service obtains authoritative stored and chain context. On existing reservation, return recovery-only before requiring an unexpired approval or fetching new readiness evidence. No second reserve or new operation is created.

Return transaction bytes only to the first successful prepare caller after SQL COMMIT. A lost response after COMMIT means recovery-only; never reconstruct a second send capability from status. Bind verifies original from/to/chain/nonce/value/calldata before CAS. Reconcile validates canonical receipt, unique expected events, operation and accounting using existing reviewed protocol primitives. Expiry does not disable recovery reads or binding/reconciliation of an already-reserved operation.

Do not reuse the old ledger reserve path, which requires raw signatures and equates signed historical evidence with a newly observed block. Reuse audited protocol helpers where applicable and keep old source-only reservation unreachable.

## One-shot UI fixture

Provide a local fixture page/controller driving the actual authenticated-route adapter with synthetic issuer authentication and a fake wallet provider; fixture authentication must be impossible in production mode. Show original UNKNOWN separately from successor status, selected round/digest, prepare cutoff, nonce, target and candidate deadline. Preparation requires an explicit click; wallet sending requires a separate explicit click. Validate wallet account and chain, consume in-memory payload before invoking eth_sendTransaction, and never persist payload in local storage. Rejection, account/chain change, reload, timeout or hash loss transitions to recovery-only. A received hash is bound to the same operation. No automatic signing, sending, retries or fresh-round creation.

## Acceptance

- Real isolated PG17: concurrent consume yields one release/operation/receipt; wrong digest, missing role, wrong verification version, expiry, changed original context and replay fail atomically. Original record/event fingerprints remain unchanged.
- Permissions: execution runtime has only the reviewed function set; collector/Auth/Claim/public cannot execute release or write successor tables. Collector capability audit still passes.
- Chain tests: historical reorg, stale observation, nonce change, unexpected code/authority, Unit/accounting mismatch and simulation failure cause zero writes; cancellation before execution causes zero writes.
- Commit ambiguity: response loss/restart and duplicate prepare yield recovery-only with no wallet bytes, including after approval expiry.
- HTTP: unauthenticated/wrong-role/cross-origin/CSRF/body/mode failures are rejected. Fixture traverses prepare, explicit single wallet send, bind and reconcile; refusal/reload never resend.
- Collector: startup/current/get remain available after consume; receipt validation rejects corrupted linkage; every collector DTO stays canIssue=false and create/record stay closed.
- Bind/reconcile: wrong transaction identity, noncanonical receipt, wrong/missing events and accounting mismatch cannot mark issued.

## Live activation and handoff

Deliver the fixed source revision, exact migration and capability diff, isolated acceptance results, production SIWE mounting plan, deployment-mode controls and rollback instructions. Update root HANDOFF with source-only versus live evidence explicitly separated. Review the concrete activation package before any real 017 application or grants/service activation. After approved activation and public/authenticated gates, obtain a fresh round and human Owner/Donor approvals, then let the real Issuer explicitly prepare and send once. Do not request the user repeat the already-passed expired collector test merely to prolong its status.

Rollback disables execution entrypoints and retains all reservations/receipts. Once reserved, never delete or reset state: recover the same transaction. Domain changes are not a blocker. Known contract consent and settlement limitations remain unchanged.
