# MealForward CP31 G2 — real disposable PostgreSQL 17.11 migration evidence

**Date:** 2026-10-17 (UTC+8) · **Source:** `codex/mealforward-render-free-readiness`.

## What passed

A **new disposable GitHub Actions runner PostgreSQL 17.11 container**, not the user's
original Mac database or Render Auth Pilot, applied **all 44 checked-in migration
files (001–019 and 021–045)** without rewriting source SQL.

Final successful CI:
- [GitHub Actions — disposable PostgreSQL17.11 migration and ACL check](https://github.com/3956ray/MealForward/actions/runs/38934763359)
- Check-in: `cp30-backend/tools/g2-disposable-pg17-ci.py`
- Workflow: `.github/workflows/cp31-g2-postgres17.yml`

The runner verified:
- PostgreSQL major version 17 and a fresh cluster with no existing `c1_*` roles.
- Original SHA-256 source pins for `019`, `043`, and `044`.
- SQL `045` source-delta tests **5/5 PASS**.
- New schema contains all mandatory tables and all three expected reviewed
  `ledger_reserve`, `live_api`, `first_binding_material` functions.
- `c1_auto_binding` has the reviewed catalog first-binding EXECUTE grant.
- Runtime policy/code owner groups cannot LOGIN, gain SUPERUSER or BYPASSRLS.
- The `c1_live_api` group does **not** have direct SELECT on private sessions,
  original ledger state or private claim tables.
- `045` refuses to execute if a **synthetic, initialized** runtime state row
  exists: `FRESH_UNINITIALIZED_RUNTIME_REQUIRED`; the negative probe rolls
  back and touches no durable original record.
- Fresh runtime state row count remains **zero** (this test does not initialize
  a live wallet principal, signer, grants or escrow balances).
- CI deletes its own throwaway database and the runner container is ephemeral.

## What this deliberately does *not* establish

1. Migration compatibility with the user's **existing initialized Mac
   PostgreSQL 17.11 state**. Never run SQL 045 on the old live DB.
2. Full role/ACL functional behavior with a running CP30 controller and
   signer Journal. Only schema, selected grants and negative privileges
   are tested.
3. Correct live-chain finality or merchant payout. No RPC or wallet signer
   is present in CI.
4. An authenticated G1 data bridge between Render Auth Pilot and original
   CP30. Those two session/principal authorities remain intentionally
   **separate**.
5. Restore-from-backup of the original production DB or journal.

## Security restrictions

The runner opts into a fixed `MF_G2_DISPOSABLE_ONLY` guard, loopback
`127.0.0.1:5432` with default `postgres` control DB, enforces
`GITHUB_ACTIONS=true`, Postgres17, zero prior `c1_*` roles and no
existing target DB before it can create any role or schema. The workflow
contains only an explicitly dummy **ephemeral CI password**, never real
credentials.

The original machine's six services, schema, journal, funding and all
original vouchers were left unchanged. This does not grant permission
to restart the original CP30 controller or repeat a pending operation.

## Next engineering gates

- G1: a reviewed **read-only** CP30 source path that does not conflate
  independent SIWE Auth Pilot sessions with original CP30 principals.
- G2 functional: source-aligned synthetic PG17 auth/role/negative E2E
  on fresh disposable DB; original versioned meal terms preserved.
- G3: real signer/controller journal durability and Crash→Recovery verified
  before any real Fund/Issue/Report/Settle traffic.
