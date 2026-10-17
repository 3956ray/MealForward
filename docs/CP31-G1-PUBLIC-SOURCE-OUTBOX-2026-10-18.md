# MealForward · G1 Durable Public Source Publisher Outbox

**2026-10-18 (UTC+8) · SOURCE-ONLY · NO REAL SOURCE KEY OR CLOUD DEPLOYMENT**

## Problem

The earlier [G1 public cache + independent anchor](../docs/CP31-G1-INDEPENDENT-ANCHOR-2026-10-17.md)
can validate a short-lived, Ed25519-signed snapshot and defend against
one-side PostgreSQL rollback. It did **not** implement the publishing half
of the protocol. A source crash between signing and HTTP acknowledgement
could regenerate another signed envelope for the same sequence, lose a
remote receipt, skip a sequence, or mistakenly mark a transaction complete
on an HTTP 201 alone.

This candidate closes the **publishing** portion of that gap **without**
connecting to the original CP30 runtime or configuring a production signer.

## Components

| File | Responsibility |
|---|---|
| `source-publisher-outbox.sql` | Dedicated, disposable PostgreSQL17 outbox, two NOLOGIN roles, immutable trust root, single persisted pending signed public envelope and monotonic ACK transition |
| `source-publisher.mjs` | `prepareNext()` signs once and persists BEFORE attempting transport; `dispatchPending()` sends exactly the stored envelope and verifies independent receiver evidence before advancing ACK |
| `source-publisher-pg.test.mjs` | Real PostgreSQL 17 tests with synthetic public data, freshly generated temporary Ed25519 signing key, receiver cache and separate anchor |
| `source-publisher-transport.mjs` | Pinned HTTPS-only public source POST/GET adapter, local Ed25519 envelope validation, 5-second request abort, redirects/Cookies/Bearer forbidden and 64KB response cap |
| `cp31-g1-source-publisher-pg17.yml` | Three new loopback-only `postgres:17.11` containers; no external source or signer |

This does **not** install `source-publisher-outbox.sql` into an existing
customer or CP30 database and it is NOT migration 046.

## Explicit trust boundaries

The source publisher constructor requires:

1. `readPublicSource()`: **a separately reviewed and narrowly authorized
   source** which must eventually call only the fixed
   `c1_g1_export.public_snapshot()`. In CI this callback reads a synthetic
   allowlisted projection, not the original CP30 system. Arbitrary user
   uploads and the original mixed read/write `live_api` dispatcher MUST
   never become its data source.
2. `signer.purpose === 'G1_PUBLIC_DATA_ONLY_V1'`: an injected
   **purpose-scoped Ed25519 public-data signing capability**, separate from
   CP30 issuer/operator/settler/quote funding and wallet keys. A real signing
   key is neither created nor stored in the Git repository, outbox or cache.
   Signing bytes use the existing domain-separated public-envelope format.
3. `independentCheckpoint.current()`: a separately provisioned,
   **read-only** view of the independent anchor's sequence, source time and
   receipt digest. An object exposing `advance()` is refused by the publisher.
   The source must NEVER receive independent anchor writing credentials.
4. `transport.send()` and `transport.readBack()`: future production
   transport must use a trusted, pinned HTTPS origin, strict redirect refusal,
   bounded latency and the reviewed public-only cache endpoint. The
   source publisher does NOT trust POST status or an unverified HTTP receipt
   alone. The returned public data, digest, expiry and sequence MUST match
   the original signed envelope AND the independent checkpoint.
5. A separate disposable outbox database. Its NOLOGIN writer may update only
   signed-pending and ACK columns; it cannot replace a pending signature,
   change the public trust root, revoke recipient rights, delete the singleton
   row, skip a sequence or read CP30 private tables.

These are **interfaces and deployment obligations**, not assertions that
the missing production source transport is already available.

## State machine

`last_ack_sequence=N` and `pending_sequence=NULL` is idle.

- `prepareNext()` first confirms the remote independent checkpoint is
  still exactly `N` with the last acknowledged digest. A rewound source
  outbox must NOT sign another envelope using a previously anchored number.
- Fetch only source-approved public projection. Strictly validate public
  schema, account conservation, time, privacy whitelist, and a **newer**
  source `asOf`.
- Ask the injected dedicated public signer for exactly one domain-separated
  Ed25519 signature. Verify it against the pinned public key and store the
  original signed envelope/digest as **pending N+1** in PostgreSQL in a
  transaction, before network activity.
- While pending, `prepareNext()` never calls the source reader or signer,
  regardless of retransmissions, browser errors, retries or crashes.
- `dispatchPending()` locks the outbox, re-verifies the exact signed
  pending envelope, sends it and requires a read-back from the receiver
  cache AND the independent anchor's true sequence/digest/as-of.
- Only then does it atomically mark ACK N+1 and erase the pending payload.
  A crash after receiver/anchor COMMIT but before local ACK is handled by
  retrying the same signed payload, letting the receiver's signed read-back
  supply proof of exactly that receipt.

**No two-phase cross-database atomic COMMIT is claimed.** Normal
publication order is outbox PREPARED → independent anchor COMMIT → cache
COMMIT → source ACK. A dropped response or missing ACK is not proof of
remote failure.

## Failure matrix

| Failure or attack | Required response |
|---|---|
| Source report invalid/private/stale | No signature or outbox write |
| Signer wrong or reusing unrelated wallet authority | Reject purpose/key; no pending |
| 16 simultaneous prepare calls | Exactly one signing call, one stored signed envelope |
| 16 simultaneous dispatch calls | Exactly one ACK; no new signing/rebroadcast after it |
| Remote processed snapshot, but POST reply lost | Independently verify remote digest, then ACK |
| Both send and read-back fail | Keep exact pending bytes; retry SAME envelope |
| Source ACK database write fails after receiver commits | Roll back source ACK; resend SAME signed bytes; recover |
| Forged receiver read-back while anchor unchanged | Reject ACK; pending retained |
| Privileged publisher database restored backward | Independent anchor mismatch BEFORE any new signature |
| Signed pending expires before remote recovery | Halt; do not re-sign, skip sequence or mark ACK |
| Changing key ID/audience or pending signed payload in DB | SQL writer trigger/column grants reject |
| Real source/anchor/current principal unavailable | Leave G1 blocked; no original business response |
| Key rotation requested | **Not implemented. Freeze release and require new security review.** |

## Real CI proof

[GitHub Actions — genuine three-database publisher/receiver/anchor tests](https://github.com/3956ray/MealForward/actions/runs/39049688649)

At this run: **28/28 Node tests PASS**, including 16-way prepare,
16-way dispatch, source restart/rollback fail-close, lost acknowledgement,
failure-injected source ACK update, forged remote proof refusal, Ed25519
tampering and SQL role restrictions. PostgreSQL is strictly runner-local and
uses fixed dummy test-only passwords. EIP-191 wallet login, genuine CP30
Journals and actual funded Testnet meals are not used.

## Outbound HTTPS transport hardening

The branch now includes a dedicated `source-publisher-transport.mjs`
candidate. It does not fetch anything on import and it does not open a
server. Once wired by an explicitly authorized deployment, it only sends
already verified, publicly allowlisted Ed25519 envelopes to one exact
pinned `https://...onrender.com/v1/g1/public-snapshot` endpoint.

It refuses redirects and a response whose final URL differs from the
pinned endpoint. It sends neither Cookies nor bearer tokens, uses
`credentials:omit`, no-store/no-referrer headers, 5-second abort
signals, an outgoing 48KB JSON size cap and a 64KB response limit. It
rejects unrecognized content-type, non-canonical/duplicate-key JSON,
private fields, a foreign key or expired signed source before outgoing
network traffic. A remote HTTP **409** may indicate an already-processed
original; neither 201 nor 409 can advance Outbox ACK without successful
anchored read-back.

[CI on revised branch — **36/36 PASS**](https://github.com/3956ray/MealForward/actions/runs/39050190489):
the previous 28 public publisher and real PG17 tests plus 8 HTTPS adapter
protocol tests. These additional HTTPS tests use **injected mock fetch**
responses, not real internet egress or an installed source publisher.
The server-side receipt and source/anchor checks are exercised using the
independent disposable PostgreSQL fixtures.

## Key rotation is deliberately a separate authorization gate

All three existing schema candidates pin `key_id` and `audience` as
immutable; no setter, rotation script or automatic trust-root update is
shipped. This prevents an operator from silently selecting a new key to
reset sequence history.

A separately reviewed rotation protocol must at minimum:

- freeze publication and drain every pending envelope with exact anchored
  ACK before rotating;
- verify out-of-band approval from independent source-key and anchor
  administrators, plus a cross-key signed transition;
- preserve historical high-watermark/receipt history across generations
  and witness it outside both DB backup domains;
- install and verify a new dedicated public signing authority, never
  reuse CP30 quote/issuer/operator/settler/private wallet keys;
- prohibit a unilateral `UPDATE key_id`, `UPDATE audience`, sequence
  reset or local private key file injection.

**No production credential, signing key, upload endpoint or customer
database migration is provisioned here.**

## Remaining original-business gates

- The original Mac CP30 G3 runtime (including COMMITTED→ACK state) remains
  frozen; it has not been restarted or modified. G1 needs an authorized,
  fully read-only source path after a safe recovery and independent chain
  finality verification.
- Render Auth Pilot identity sessions are separate from original CP30
  principals; no private `/v1/my/orders`, `/v1/my/vouchers` or merchant
  HTTP feed exists yet.
- The source signer and transport are injected **test interfaces**; there
  is no production source publishing daemon or external trusted verifier.
- Public signature validity proves the signer produced the data, NOT the
  underlying chain transaction finalized or food delivery occurred.
- Simultaneously compromised source private key plus independent
  checkpoint administrator, or co-rollback of all independent DBs, still
  need external witnessed transparency, backup isolation and incident response.

## Security release status

**Source code / isolated CI only.** No original CP30 source installation,
`045` on initialized PG, old ticket replay, signer creation, Render
service deployment, paid resources, actual wallet fund/claim/report/settle
or customer-private data movement was performed.
