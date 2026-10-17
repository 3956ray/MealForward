# MealForward · CP31 G1 Atomic Public Cache Gate
2026-10-17 (UTC+8) | Source-only candidate, NOT deployed on Render or original CP30

## Goal

Accept an independently authenticated **public** CP30 snapshot, persist its
monotonically increasing sequence in a separate PostgreSQL 17 database, and
serve only verified/fresh public kitchen, meal and ledger DTOs. Invalid or
expired inputs fail closed.

It does NOT establish chain receipt finality, serve private contributions,
private vouchers or wallet-specific data.

## Separation of authorities

The original public source facade from Draft PR #9 is a source-only candidate,
using independent NOLOGIN roles; it has not been installed on the user's Mac.
The new signed envelope uses Ed25519, a pinned public key/key ID/audience,
canonical signing bytes, <=120s validity, source age, and exact public fields.
No production signer private key or trust root has been provisioned.

The receiver, cp30-backend/g1-export/public-cache.mjs, accepts a restricted
PostgreSQL connection and defaults to disabled. It has NO original CP30 DB
credential, wallet signer, blockchain RPC or private recipient endpoints.

The separate disposable-cache-schema.sql creates one singleton row in the
**new CI-only** database mf_g1_cache_ci_only, and limits the application
role to SELECT and UPDATE of enumerated cache columns. It has no INSERT,
DELETE, TRUNCATE, CREATE, bypass-RLS, role membership or source-table privilege.
A PostgreSQL trigger forbids decreasing or replaying the sequence or
time fields. The receiver verifies the exact DB name and role on the SAME
checked-out connection, checks for elevated roles and any original c1_ schema.

## Candidate HTTP routes, NOT deployed

| Route | Intended behavior |
|---|---|
| POST /internal/g1/public-snapshot | 202 for authentic forward-only signed snapshot, 409 replay, 403 forgery |
| GET /v1/stores | Signed public kitchen DTO only, or 503 |
| GET /v1/stores/:storeId/meals | Signed published public meal DTOs, or 503 |
| GET /v1/ledger | Signed public amounts and bucket totals, or 503 |
| GET /health | Infrastructure health distinct from publicSnapshotUsable |
| GET /v1/my/* and other private paths | 503, no private data |

No fund/issue/lock/report/settle or arbitrary SQL API exists in this candidate.

## Atomicity and replay guarantees tested

1. Acquire a SELECT FOR UPDATE row lock on the attested restricted PG session.
2. Compare the incoming sequence with the durable committed sequence.
3. Verify Ed25519 signature, exact audience/key ID, 120-second deadline,
   source asOf, public DTO allowlist and accounting conservation while locked.
4. Atomically replace sequence, complete signed JSONB envelope, digest and
   expiry with compare-and-swap, followed by COMMIT.
5. Trigger independently rejects rewrites or decreasing sequences/timestamps.
6. Public GETs independently re-verify the stored signature and digest.
7. Expiration hides public records but does not reset the replay floor.
8. Re-created HTTP listener and a new PG pool preserve the accepted floor.

## Executed evidence

GitHub Actions: https://github.com/3956ray/MealForward/actions/runs/39000857864

Fresh PostgreSQL 17.11 plus genuine HTTP requests: **12/12 Ed25519 tests**
and **11/11 DB/HTTP integration tests PASS**. Cases include 12 concurrent
copies of one signed upload (one acceptance), lower-sequence rejection,
persistent floor after connection/server recreation, expiration, foreign
signatures and private data rejection, admin cache tamper detection, and
privileged/unpinned DB connection denial.

All keys, identities and records are ephemeral CI fixtures. The original Mac
database, pending signer Journals, existing Render Auth Pilot database,
MetaMask sessions and all Testnet funds remain untouched.

## Important limitations / NO-GO

- Signature authenticates the publishing key, not independent chain finality,
  accurate food handover or escrow settlement.
- A privileged PostgreSQL administrator could roll back a database from an
  older backup or disable triggers. Full protection against privileged
  rollback requires an external monotonic anchor and reviewed restore policy.
- A lost 202 response after successful COMMIT becomes 409 on retry; clients
  must not interpret 409 as a reason to replay a money operation.
- Source origin public facade is not installed on original CP30; the cloud
  receiver has no live signing key, trusted production public key, live
  upload agent, network listener or durable cloud database.
- disposable-cache-schema.sql refuses installation outside the fixed CI
  database and is not a production migration.
- Private orders, voucher access and the Auth Pilot-to-CP30 subject mapping
  remain separate unaccepted gates.

## Next deployment and release prerequisites

Approve a new isolated durable cache database with minimally privileged
credentials and trusted backup strategy; pin source Ed25519 authority and
rotation; review ingress rate limits; persist the replay floor across backups;
approve a public-only original-source export after its frozen runtime/Journal
is independently safe; verify canonical chain facts; and prove private wallet
A/B authorization separately before revealing any real business records.

Until all gates pass, Render Auth Pilot must continue responding with
ORIGINAL_BUSINESS_NOT_CONNECTED and business writes must stay disabled.
