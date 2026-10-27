# Phase8 expired unsent recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Existing user authorization selects independent agents and autonomous execution through source acceptance.

**Goal:** A reviewed source package for one fresh authorized child attempt plus accurate one-shot wallet timing.
**Architecture:** Separate version2 protocol and append-only schema preserve V1 singleton state. Existing SIWE gateway authenticates execution; dedicated capabilities isolate collection/operator/execution.
**Tech Stack:** Node ES modules, ethers6, PostgreSQL17, native browser EIP1193.
**Spec:** docs/superpowers/specs/2026-10-27-phase8-expired-unsent-design.md

## Global Constraints

- Monad10143; original and predecessor immutable; one new child maximum.
- No live changes before reviewed source/CI; no automatic signing/sending, deadline extension or settlement.
- Raw signatures are transient; store fingerprints only.
- Approval300s, candidate480s, prepare/send210s from round creation.

## Review Focus

- Expiry during wallet read must prevent provider send.
- Finalized unsupported/reorg must not become latest-only success.
- Lost commit response must not recreate transaction bytes.
- Concurrent rounds may consume predecessor only once.
- Old hash becoming known must block unrelated new-attempt writes.

## Tasks

1. UI: first reproduce cutoff failure in execution-ui/page tests; implement dynamic capability/countdown and explicit reserved statuses; test boundary and pagehide timer cleanup. Files public/t1f-execution-controller.mjs, public/t1f-execution-page.mjs and matching tests.
2. Protocol: t1f-phase8-protocol.mjs/.test.mjs. Strict fixed predecessor, canonical observation, fresh self-report; version2 typed manifest reconstruction and role verification. Fail first for missing policy; test all unsafe branches and V1 replay rejection.
3. Storage: migration20261027061724_t1f_phase8_recovery.sql and t1f-phase8-store.mjs/pg.ci.mjs. Narrow roles/functions, immutable identities, single child, CAS transitions and old state guard. Real isolated PG17 negative/concurrency/permission tests before acceptance.
4. Service/integration: read-only canonical RPC adapter, operator create/collector approve and Issuer prepare/bind/reconcile, no public create-round endpoint. Default-off gateway and UI; regression tests prove auth/CSRF/origin and one-shot workflow. Source activation package explicitly separate.
5. Independent review: resolve concrete findings; full npm test, relevant isolated PostgreSQL and browser/HTTP checks. Update HANDOFF with exact completed versus pending work and no unsupported live PASS.

Each task follows RED -> GREEN -> review; live deployment proceeds as a separate verified operation under existing autonomous authorization.
