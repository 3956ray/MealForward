# CP31 Fresh PostgreSQL Source Parity — 2026-10-15

## Why this change exists

The 2026-10-14 CP30 real-run hotfix log records that the owned local PostgreSQL
was patched directly after migrations 042–044. The user's 2026-10-15 read-only
queries independently confirmed that the live database contains the 042–044
objects, an EXECUTE grant for `c1_auto_binding`, one LIVE and one PENDING catalog
version, plus finalized and unresolved business Intents. **These are observed
schema/query facts, not proof that every hotfix was installed or that unsettled
Intents can be retried.**

The Git-tracked bootstrap runs *all sorted* `migrations/[0-9]*.sql` then
`connection-migrations/[0-9]*.sql`, but SQL 043, 044 and core 019 still contain
older definitions. In particular, a newly provisioned database cannot be
considered equivalent to the prior live-owned database without these fixes.

## Scope

`connection-migrations/045-live-runtime-hotfix-parity.sql` is deliberately a
**forward-only, fresh-install-only** migration. It preserves pinned and audited
019/043/044 source bytes, and applies *only* the following documented deltas:

1. Regrant EXECUTE on `c1_runtime_internal.first_binding_material(text,jsonb)`
   to `c1_auto_binding` (043 recreated the function without this grant).
2. Extend the `c1_runtime_internal.ledger_reserve` operation-role allowlist by
   `catalogAuthority` for **only** `publish` and `setListed`; retain all prior
   original-payload, nonce, grant-expiry, role binding and gas-budget guards.
3. Exclude expired fund Intents **with a signed quote** from pending capacity
   accounting by adding `(signed_quote IS NULL OR (parameters->>'deadline')::bigint>now)`
   to the exact existing capacity aggregate. The null signed-quote branch remains
   conservative by design; there is no wholesale exclusion of `UNKNOWN`.

No new signer grant is created, no on-chain operation is sent, no historical
original is replayed, and no row material is changed by this migration.

### Safety gate for original CP30 runtime

The script checks that `c1_runtime_private.state` is **empty before performing
any DDL or GRANT**. The existing locally-owned database has ledger state and
must fail `FRESH_UNINITIALIZED_RUNTIME_REQUIRED` if anyone inadvertently
attempts this SQL there. **Never run migration 045 against the existing local
`~/.mf-cp30-20261013/` run.** Existing source pin and journal procedures
remain controlled by its current operator. This migration does not include the
one-off stale lock retirement or journal reanchor in the original hotfix report:
those were instance-specific operations tied to original signed evidence.

### Verification performed now

```sh
cd cp30-backend
python tools/live-runtime-hotfix-parity-source-check.py -v
```

This static source-delta gate checks exact byte fingerprints of 019/043/044,
compares the complete original function definitions with 045 after only the
three authorized deltas, verifies retention of guard rails, confirms the
fresh-state barrier and absence of unwanted top-level destructive commands.
It does **not** validate PL/pgSQL by executing it.

**Separate release gate (not yet passed):** Create a new disposable PostgreSQL
**17.11** cluster (never the original `~/.mf-cp30-20261013/pg`) and run the
full sorted bootstrap migrations through 045 in one transaction. Validate:

- Correct `session_user` and restricted role grants; `c1_auto_binding` can
  execute `first_binding_material`, other unprivileged roles cannot.
- Signed expired Fund Quote no longer blocks fresh capacity, while unexpired
  and unresolved operations remain counted according to current policy.
- `catalogAuthority` passes `publish`/`setListed` original reservation with
  correct budget, and attempts `issue`, `lock`, `fund`, wrong opId and wrong
  nonce are all still denied.
- Existing owner binding, original retry/UNKNOWN preservation, meal versions,
  material/floor checkpoint and private visibility remain unchanged.
- An already-initialized state rejects migration 045 before any DDL.

Use only **fresh owned** synthetic PG fixtures for these tests; existing
privileged CP30 API/worker tests do not prove Render Managed PostgreSQL role
creation permissions or cloud runtime portability.

## Cloud deployment sequencing and cost

No Render or Vercel production resources are created in this change. This
migration alone does not make CP30 cloud deployable. The original Python
bootstrap spins up its own PG17 using a Unix socket, its HTTPS listener is
bound to loopback, the frontend wallet login challenge binds the exact
origin, and all signer/runtime journals live outside the database on private
persistent files. Render **free** Web Services have an ephemeral filesystem,
and free PostgreSQL has an expiration lifecycle; the current signer/observer
runtime therefore must remain disabled until an alternative, proven durable
journal and recovery model exists. Only a separate authentication/read-only
preview may be considered during initial free-tier integration.

Before creating resources, confirm the exact Render workspace with the user;
only `plan: free` resources are allowed. Do not deploy private keys or copy
original DB/Journals into Render. Do not switch Vercel production until a
trusted same-origin `/v1/*` API and user-wallet Session E2E pass.

## Sources

- `docs/RUNTIME-HOTFIXES-2026-10-14.md` — exact local runtime hotfix log.
- `docs/WEB-GPT-HANDOFF-2026-10-14.md` — original rollout boundaries (older than runtime hotfix).
- `tools/connection-bootstrap.py` — actual fresh-only database bootstrap.
- `migrations/019-private-original-ledger.sql` — original reservation guards.
- `connection-migrations/043-live-catalog-execution.sql` — original Catalog grant/authority setup.
- `connection-migrations/044-live-multi-meal.sql` — prior support capacity projection.
