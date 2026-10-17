# MealForward · G1 independent anti-rollback anchor — source-only gate

**Date:** 2026-10-17 (UTC+8)  
**Status:** functional security proof in disposable PostgreSQL 17.11; **NOT deployed**.

## Why this is necessary

A signed public snapshot stored in one PostgreSQL database can still be
presented as current if an administrator restores an older **whole-database
backup**, causing both the cached body and its local last-sequence row to move
backward. A local monotonic trigger cannot detect that type of database
rollback by itself.

The candidate in this branch independently stores the last accepted
`sequence + receiptDigest + sourceAsOf` in a **separate physical
PostgreSQL data store** with different roles, independent backups and
independent administration. This is intentionally limited to the public
catalog and aggregated accounting. It contains **no** CP30 wallet, order,
voucher, recipient, private QR, signer key or runtime Journal.

## Components and security properties

| Source artifact | Purpose | Scope |
|---|---|---|
| `cp30-backend/g1-export/independent-anchor-schema.sql` | An isolated monotone checkpoint and NOLOGIN reader/writer roles | **Not** CP30 migration 046 |
| `independent-anchor.mjs` | Independent Ed25519 signature verification, pinned public key and transactional anchor advancement | Public signed data only |
| `public-cache.mjs` | Cache acquires its own lock, checks prior body, advances independent anchor, then commits cache; GET demands exact anchor match | No wallet, chain or RPC |
| `independent-anchor-pg.test.mjs` | Three PG17 containers: legacy-cache suite, independent anchored cache, and independent anchor | Disposable synthetic data |
| `cp31-g1-public-cache-pg17.yml` | Run both legacy regression and independent recovery/rollback cases | GitHub Actions only |

Production construction **fails closed if there is no independent anchor**.
The old single-DB test behavior can be enabled only through an explicitly
marked disposable GitHub Actions fixture flag; it must not be enabled on
a user-facing service.

## Anchor-first state machine

1. Receive a bounded public-only envelope signed by a *separate dedicated*
   Ed25519 public-data authority. Verify exact key, fingerprint, audience,
   source timestamp, expiry, signature, price/count conservation and strict
   public field allowlist. Do **not** treat this as verified chain finality.
2. Lock the cache singleton row with `SELECT ... FOR UPDATE` and verify
   the previous signed cache record.
3. Require the incoming sequence to equal `cache.sequence+1`. The
   independent anchor verifies the signature again, separately locks
   its checkpoint and either commits the next exact digest or confirms an
   exact previously anchored digest.
4. **Commit the anchor first**, and only after its independent COMMIT succeeds,
   update and commit the cache row.
5. Every public GET re-verifies the cached signature, then contacts the
   independent anchor. If the sequence, digest or source timestamp differ,
   it returns **unavailable**. An unreachable anchor is fail-closed.

### Crash and rollback cases

| Failure | Safe behavior |
|---|---|
| Signature invalid, wrong key/audience, stale | Neither database advances |
| Anchor DB down/commit failed | Cache does not commit or serve unanchored data |
| Anchor COMMIT succeeded; cache COMMIT failed | Cache GET fails; the **same unexpired signed envelope** can exactly reconcile one step |
| Same signed envelope submitted 16 times concurrently | Exactly one cache/anchor advance is accepted |
| Cache restored from backup to an older sequence | Mismatch detected; stale public data is not served |
| Anchor restored backward but cache remains current | Mismatch detected; cache refuses to serve it |
| Cache moved back by multiple sequences | **No silent skipping/re-anchoring**; requires separately reviewed recovery |
| Signed public data expired or cannot be revalidated | Data is unavailable, not an empty original CP30 menu |

No composite distributed transaction or guarantee of two-DB atomic commit
is claimed. The anchor-ahead reconciliation is deliberately bounded:
only the exact, still-valid signed envelope can repair a one-step gap.
If this cannot be supplied safely, the data feed remains unavailable.

## Confirmed disposable testing

[Successful GitHub Actions — three physically separate PostgreSQL 17.11
containers, **43/43 tests PASS**](https://github.com/3956ray/MealForward/actions/runs/39002611672)

The run has **32/32** previous Ed25519 + cache + HTTP regressions and
**11/11** new independent anchor scenarios, including:

- Concurrent 16-way replay (one winner).
- Crash between committed anchor and uncommitted cache.
- Reconcile exact signature; reject a different valid signature at same sequence.
- Simulate privileged old backup restore of either database.
- Independently deny writer DELETE, key change, sequence reversal and gap.
- Reject unsigned/foreign-signature authority and unavailable anchor.
- Preserve expiry and accurate public-only data with no CP30 source access.

The GitHub Actions runner uses fake/local-only database passwords and
fresh ephemeral Ed25519 keys. It does not open the old Mac, original
CP30 database/Journals, existing Render PG, wallet RPC or blockchain funds.

## Important remaining threats and boundaries

**This is not a globally immutable third-party witness.** An attacker able
to restore BOTH independent databases to mutually consistent old backups,
or compromise their separate administrators and keys, can still rewind both.
The production security review should add an independently witnessed
periodic checkpoint (e.g., a separate append-only/WORM destination or
reviewed public chain commitment), immutable backup retention and alerts.

The anchor/checkpoint source credentials and database must not share
administrators or backups with the cache. Key rotation needs a separately
reviewed, explicit dual-authorized trust-root transition; never silently
replace `key_id` or audience. Reserve a dedicated *public-data* signing
authority; do not reuse CP30 quote/issuer/operator/settler/business keys.

**No real source publisher exists yet.** Before a production key or upload
endpoint may be configured, a reviewed source-publisher protocol must prove:

- G3 original CP30 read-only recovery and historical pending-ticket
  continuity, including how the local COMMITTED→ACK state is preserved.
- Source is the reviewed, limited `c1_g1_export.public_snapshot()`, not
  the mixed read/write `c1_runtime_internal.live_api` dispatcher.
- Sender persists and retries the **same** already-signed envelope until
  exact receiver acknowledgement, rather than skipping lost sequences.
- Trusted public key provisioning/rotation, narrow transport credentials,
  independent backup high-watermark, rate limits and incident procedures.
- Chain receipts and observer-derived finality evidence when needed;
  source signatures alone cannot establish on-chain funds or real food served.

**G1 full original-business access remains NOT accepted.** The Render
MetaMask Auth Pilot still has an independent SIWE principal and must keep
returning `ORIGINAL_BUSINESS_NOT_CONNECTED`. There is no private
`/v1/my/orders`, `/v1/my/vouchers` or merchant-data bridge in this PR.

## Explicit non-authorization

This work authorizes only source editing, tests and disposable CI. It does
not authorize restoring or starting the original Mac six services, installing
SQL on its initialized PostgreSQL, applying migration 045 there, creating
signing keys, migrating private beneficiary data, configuring a real
cloud-facing upload endpoint, or funding/redeeming/settling any meal.
