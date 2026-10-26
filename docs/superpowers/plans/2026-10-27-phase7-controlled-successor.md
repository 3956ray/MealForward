# Controlled successor execution implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development; one implementation writer at a time, task review then final review.

**Goal:** Complete isolated execution core, authenticated route adapter, consumed-history client and one-shot wallet fixture, ready for concrete production activation review.
**Architecture:** Trusted immutable016 attestations feed a separate atomic017 execution capability. Collector never acquires release authority. Issuer explicit prepare/send is separate; retries are recovery-only.
**Tech Stack:** existing Node ESM/ethers/pg, PostgreSQL17.11, Wallet V2 TypeScript/viem and native browser modules.
**Spec:** docs/superpowers/specs/2026-10-27-phase7-controlled-successor-design.md

## Global constraints
No real migration, grant, deployment, successor reservation or transaction in this source phase. No real credentials for tests. Immutable originalUNKNOWN/Consent/Fund/review/slot, no settlement. Expired round cannot authorize execution. No raw signature persistence. One fresh isolated PG cluster at15439 after free-port check; clean up owned cluster. Do not touch oldCP30.

## Review focus
1. Concurrent collector write vs consume: shared advisory lock before other locks, orphan rows fail closed.
2. Delayed RPC/COMMIT/lost response: expiry checked atSQL, no regenerated send capability.
3. Historical signed anchor vs fresh chain: reconstruct manifest unchanged, separately verify current canonical state and exact simulation.
4. Spoofed issuer/CSRF/runtime grants: reject before writes, narrow functions, collector cannotrelease.
5. UI dependency delay/account switch/reload/refusal: one explicit wallet request maximum, payload burned before request.

### Task 1: atomic execution capability and store
Files: t1-intents/supabase/migrations/20261026201810_t1f_controlled_successor_execution.sql (CLI-created logical017), t1-intents/t1f-execution-store.mjs, t1-intents/t1f-execution-phase7.ci.mjs; isolated fixture helper if needed.
Interfaces: SQL/store exactly as Spec. Define exact versioned evidence/receipt schemas in shared t1f-execution-contract.mjs forTask2. Roles mf_t1f_execution_owner/runtime NOLOGIN. Five collector functions unchanged; split readonly context from strict writeguard.
- [x] PG failing test RED then implement migration/store.
- [x] Fresh PG17.11 tests: concurrency,expiry,provenance,rollback,leastprivileges,postconsume collectorreads/deniedwrites,oldrecordhash equality,bind/reconcileCAS.
- [x] Independent review.

### Task 2: execution service and authenticated HTTP
Files: t1-intents/t1f-execution-service.mjs,t1f-execution-http.mjs and tests; shared contract; disabled integration in t1e-claim-http.mjs / t1e-claim-server.mjs and configuration tests.
Interfaces: makeExecutionService({store,rpc,clock}) => status/prepare/bind/reconcile; handler takes trusted issuer from existingSIWE verification, exactorigin/CSRF; explicit enabledfalse default. Transaction bytes only on createdtrue. Reuse receipt oracle, never oldreserve.
- [x] RED/GREEN service negatives: historical/fresh anchor split,cancellation,expiry,commit ambiguity.
- [x] RED/GREEN HTTP identity/origin/CSRF/body/mode and actualHTTP+PG+syntheticRPC lifecycle.
- [x] Source integration with existing SIWE middleware and separate audited execution pool, default disabled; no live configuration.
- [x] Independent review.

### Task 3: consumed collector and one-shot fixture
Files: collectorprotocol/service/tests; wallet-v2 contract/validation/controller/tests; legacyapprovalclient consumed handling; newexecutionclient/controller/fixture/tests. Main rebuildsassets.
Interfaces: strict optional consumptionreceipt, CONSUMED_NO_RELEASE, canIssuefalse/noReleasetrue. Localfixture actualroute plus syntheticauth/provider, nevercloud.
- [x] RED/GREEN consumedread invariants and fakewallet one-shot/rejection/reload/account-chainchanges.
- [x] Browserdesktop/mobilefixture,rebuild/typecheck.
- [ ] Full exactCI includingPG and independentfinalreview.

### Delivery
- [ ] Concrete activation package: exactmigration/checksum,role/grantdiff,mounting/configurationwork,humansteps,rollback. Label source-only and remainingintegration honestly.
- [ ] Update HANDOFF,existingPR47/sourcebranch and canonicalhandoffs; no autoactivation.

Ruling: agents choose trustedcollectorreceipts and separateexecutionrole under autonomousdevelopment authorization. This changes proof trust from raw-signature reverification to protectedserviceattestations. Rejection costs executionproof redesign; no liveprivileges changed.
