# Phase6 durable Recovery collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development for delegated bounded tasks; superpowers:executing-plans for controller integration.
**Goal:** Deliver source and verified disposable tests for durable two-role Recovery approval collection with NO RELEASE.
**Architecture:** Separate 016 schema/functions, pinned verifier and service, standalone browser client. Existing Issue ledger is never mounted.
**Tech Stack:** Node ESM, ethers6, pg8, PostgreSQL17, native browser EIP-1193.
**Spec:** docs/superpowers/specs/2026-10-26-phase6-approval-design.md

## Global Constraints
Single production writer at a time. No real migrations/deploy/credentials/signatures/transactions. No changes to 013–015 or old services. Frozen original and 015 remain HOLD. Read HANDOFF first. Never log secrets. Red→green per behavior; full project suite before completion.

## Review Focus
1. Forged or cross-round digest/signature: pinned cryptographic tests plus DB digest join.
2. Races/expiry/retry after process restart: real PG concurrency and HTTP persisted state tests.
3. Privilege escalation through functions/search_path/runtime roles: actual SET ROLE denial tests.
4. Stale chain/original evidence or private-data/error leakage: service negative cases and reviewer scrutiny.
5. Browser stale wallet/session state and accidental sign/send: native-provider harness and source capability review; live MetaMask remains NOT RUN.

### Task 1: Immutable approval store and PG17 tests
Files: t1-intents/supabase/016_t1f_recovery_approval_collection.sql; t1-intents/t1f-approval-store.mjs; t1-intents/t1f-approval-phase6.ci.mjs; optional test fixture utility.
Interfaces: consumes fixed 009–015 context; produces context(), current(), create(round), record(attestation), with rows containing round_id, value, digest, created_at/expiry, approvals.
- [ ] Write failing disposable PG17 tests and observe missing feature failure.
- [ ] Implement explicit-function least privileges, immutable records and atomic acceptance; all existing pins remain.
- [ ] Verify real roles, concurrent replay, expiry and untouched legacy. Expected: PASS, zero release/operation.
- [ ] Commit task with test evidence.

### Task 2: Pinned service, HTTP and browser
Files: t1-intents/t1f-approval-{protocol,service,server}.mjs and tests; public/t1f-approval.{html,mjs,css}; operator tool and tests.
Interfaces: consumes Task1 store; produces same-origin session/state/submit endpoints and explicit operator create-round API.
- [ ] Write failing tests for stored canonical verification, expired/swapped/changed manifests, retries, HTTP attacks and wallet changes.
- [ ] Implement service and explicit UI with no sending capabilities.
- [ ] Run tests and whole t1-intents suite. Expected: PASS; real signatures NOT RUN.
- [ ] Commit integration.

### Task 3: Independent review, CI and handoff
Files: .github/workflows/mealforward-t1f-phase6-approval.yml; HANDOFF.md; docs/t1f-phase6-approval-runbook.md.
Interfaces: consumes complete Task1+2; produces source-only Draft PR and concrete next human deployment/test gate.
- [ ] Fresh strongest-model reviewer checks whole branch and listed Review Focus.
- [ ] Important findings get reproducing RED→GREEN tests and final full suite.
- [ ] Push isolated branch, inspect CI (PASS only once complete), refresh live read-only truth.
- [ ] Update HANDOFF and report next needed user action; no misleading live approval claims.

