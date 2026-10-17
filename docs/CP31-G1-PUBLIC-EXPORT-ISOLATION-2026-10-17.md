# MealForward · G1 candidate public source isolation gate
**2026-10-17 (UTC+8) · SOURCE-ONLY, NOT INSTALLED ON ORIGINAL CP30**

## Problem solved
The old `c1_live_api` role cannot directly SELECT private tables, but can
EXECUTE `c1_runtime_internal.live_api(text,jsonb)`: a SECURITY DEFINER
dispatcher that includes **read and write** operations. It must not be handed
to a cloud-facing "read-only" connector.

This change is a **separate, narrowly scoped source-only candidate**.
`cp30-backend/g1-export/disposable-public-facade.sql` is NOT migration
046, never auto-installs and has not been applied to the user's Mac or Render.

## New capability and trust boundary

The disposable-source SQL defines two dedicated roles:

| Role | Role traits | Privileges |
|---|---|---|
| `c1_g1_export_owner` | `NOLOGIN`, no elevated admin grants | SELECT on **specific** original source tables for confirmed registration, finalized store data, catalog versions and pending-state fences |
| `c1_g1_export_client` | `NOLOGIN`, no membership grants | EXECUTE on `c1_g1_export.public_snapshot()` **only**; cannot SELECT source/private tables, update binding, or invoke `live_api`, `auth` or `ledger_reserve` |

The function is `STABLE SECURITY DEFINER`, with pinned
`pg_catalog,pg_temp` search path and bounded statement timeout. It has no
dynamic SQL, DML, signer dependency, API session or wallet privileges.
A private fixed-namespace binding defaults to `enabled=false`; the client
cannot choose a namespace or modify it. No cloud login role, credentials,
network listener or signing key is provisioned in this candidate.

Before exposing a **public** record, it requires:

1. Configured and explicitly enabled original namespace; verified fresh
   deployment clock (≤120 s), not halted, no security/execution pending.
2. Durable runtime state exists, no pending ledger ticket.
3. At most 1 store and 3 published meal IDs (MVP caps).
4. Store and its independent original confirmed registration agree on
   escrow address, registration identity and evidence.
5. Snapshot is fresh, matching Monad chain ID 10143, and source has bounded
   unit rows with canonical price/meal/version IDs.
6. Original accounting totals match recomputed bucket counts and base-unit
   amounts; escrow liability is computed from A+R+H, not guessed.
7. Published meal content is from a confirmed original first meal or exact
   `LIVE` catalog version; draft/unconfirmed versions are refused.
8. Menu service windows are minute-valid, ordered and nonoverlapping.

Returned data contains only allowlisted **public** kitchen, meal, accounting
and snapshot metadata. No original wallet subjects, emails, claims,
vouchers, QR codes, access tokens, signatures, owner session hashes,
private registration payloads or full source JSON leaves the function.

## Real execution evidence (disposable PG17.11)

[GitHub Actions — PASS](https://github.com/3956ray/MealForward/actions/runs/38999053945)

The runner applied **all 44 original SQL migrations** to a fresh disposable
database, then exercised the candidate facade with one synthetic confirmed
store, 2 synthetic published meal versions, unit buckets including a
claimed meal, and deliberately inserted private fields. Every source row
and new SQL role is rolled back. Checks included:

- no-login roles; no direct private table SELECT or mixed dispatcher execute
- public-only projection with correct original meal prices, versioned menu,
  available counts and bucket monetary conservation
- private wallet/recipient/QR field redaction
- disabled namespace and stale projections fail closed
- halted runtime, ledger pending ticket, execution pending, unverified
  merchant and non-LIVE catalog versions fail closed
- bad accounting and invalid service windows fail closed
- no original Mac/Render/chain/system signer interaction

This is stronger than a static SQL grep, but it is still **synthetic** and
cannot establish that the actual original chain finalized any transaction.

## Explicit NOT-YET-PASSED gates

- **No original CP30 installation.** The existing Mac PG17, COMMITTED/ACK
  backlog and Journals were not changed. Never install this SQL through
  a normal bootstrap on the initialized original.
- **No approved G1 cloud connector** or authenticated private donor/recipient
  endpoint. The public-only facade deliberately has no /v1/my/* access.
- **No independently authenticated chain finality.** Snapshot freshness,
  registration consensus and accounting conservation do not prove food
  handover or chain receipt validity if the platform itself is malicious.
  Original CP30 observer proof and settlement evidence require separate G3
  verification.
- **No cross-origin user wallet principal bridge.** The Auth Pilot Session
  continues to be independent and cannot grant access to CP30 private data.

## Next safe engineering increment

Build an independently reviewable, authenticated **public snapshot transport**
from the original host's approved public-only reader (not a direct cloud DB
connection) to a separate cloud cache. Use a short-lived signed envelope,
pinned verifier key, replay and age checks, public-field allowlist, and
a durable monotonic sequence. Do not issue any signing key or install anything
on the original machine before explicit user consent and a safe runtime
handoff. Continue to serve HTTP 503 `ORIGINAL_BUSINESS_NOT_CONNECTED`
until the entire new public source proof is accepted.
