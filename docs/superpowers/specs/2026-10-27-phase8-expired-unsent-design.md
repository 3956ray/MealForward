# Phase8: bounded recovery after an expired, reportedly unsent reservation

Status: implementation and reviewed deployment under existing autonomous authorization until human testing. New wallet approvals and Send remain human-only. Implementation choices below are agent decisions, not claims of separately approved user details.

## Outcome

Support one independently authorized new attempt after predecessor `8872119f-8c4c-4f0d-8c3a-10c841f1018f` expired, so the real Issuer can complete prepare, explicit Send, hash binding and receipt verification. The user reports no Send click or wallet confirmation. That report is evidence of their actions, not a proof of global mempool absence.

## Approaches

Resetting017 consumption or extending old signed deadlines is excluded: it erases one-shot guarantees and audit evidence. Generalizing all existing singleton tables/functions would change reviewed V1 invariants in many places. Chosen engineering approach: isolated Phase8 schema/protocol with exactly one child per pinned predecessor, separate capability roles, version2 approvals and default-off execution. Original Claim,015/016/017 records, functions and historical approval UI stay intact. Additional failed child recovery is outside this bounded slice and fails closed.

## Safety and authority

A fresh trusted observation must pin chain10143 and the fixed escrow/issuer, finalized and latest block identities, and finality timestamp at or after the predecessor's immutable deadline. Inspect original and predecessor operations at both anchors: neither may exist. Unit0 remains available with generation0, expected meal/terms, unchanged code/authorities and accounting. Latest/pending issuer nonce must both be0. Recheck anchor hashes. An RPC lacking finalized support cannot silently fall back to latest. Require a fresh explicit Issuer report of no pending/sent activity before operator round creation; do not refresh the old report timestamp.

Contract issue() checks replay before deadline. Expiry alone therefore cannot establish no previous successful Issue; operation and Unit checks are mandatory. A late previously unseen old transaction could still consume nonce and revert; public pending reads never prove universal absence. A change in nonce/Unit/operation blocks the child. No automatic replacement or nonce bump.

New EIP712 version2 approval binds original immutable identity and predecessor id/op/nonce/deadline/calldata/round/digest, fresh anchor and proposed new operation/nonce/deadline/nonce-domain. Owner and Donor must sign the same exact new digest. V1 signatures cannot authorize Phase8. Fresh signing windows retain +300 approval expiry, +480 candidate deadline, and prepare/send cutoff expiry-90. Do not use a longer candidate deadline as permission to send late.

## Storage and execution

New append-only migration/schema mf_t1f_phase8, distinct NOLOGIN owner and operator/collector/execution runtimes. No direct table access to runtime, no live membership grant in migration. Dedicated SECURITY DEFINER functions with fixed search_path/timeouts. Existing old-state validation reused read-only; writes take existing advisory lock and revalidate exact predecessor. Immutable round/approval/consumption identities, one child per predecessor, unique new op/digest/domain, CAS hash binding/reconcile. SQL trusts only reviewed service attestations; JSON supplied by browser is not chain evidence.

Operator creates rounds only before child consumption. Collector records cryptographically verified role receipts only. Execution prepares once following SIWE Issuer identity, same-origin/CSRF and fresh chain revalidation/simulation; only successful first commit response includes bytes. Read, repeat prepare, lost response, reload, refusal or uncertainty cannot reconstruct another send capability. No server broadcaster/private key. Bound hash must match child from/to/chain/nonce/value/calldata. Canonical successful receipt/events/Unit/accounting must be verified before ISSUED. Original Claim remains UNKNOWN; settlement remains disabled.

## UI and acceptance

Fix existing misleading Ready immediately in source: dynamic cutoff-aware canPrepare/canSend, visible countdown, reserved/no-hash recovery explanation, no refresh between prepare and send. Expired buttons disable without network calls. Separate explicit Send; zero wallet actions on timers or page load. The new flow must show original versus predecessor versus child distinctly and full typed content before signature.

Test synthetic end-to-end dual signatures -> prepare -> single provider Send -> bind -> receipt, expiry exact boundary, clock advancing during wallet reads, refusal, lost response, reload, account/provider switch, forged V1 signatures, stale/finality-reorg/nonce/op/Unit changes, concurrent consumption, capability denial and immutable original table fingerprints. Real PG17 and actual HTTP/DOM checks supplement pure tests. Public live and real wallet evidence remain separate from source tests.

## Release and rollback

Complete source review, exact migration/capability diff and isolated checks before presenting live activation package. Apply the reviewed migration and least-privilege deployment only after source review and CI pass. Existing user authorization covers this necessary deployment; no repeat generic permission question. Do not create a new round until a fresh human wallet report and continuous availability, and never send for the user. Rollback disables Phase8 routes and retains all records. On successful activation and fresh user availability, provide the entire human sequence before creating timed round; never ask user to stop between prepare and Send to report screenshots.
