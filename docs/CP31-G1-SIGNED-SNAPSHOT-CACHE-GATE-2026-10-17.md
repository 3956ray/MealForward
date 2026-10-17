# MealForward CP31 · G1 Signed Public Snapshot Cache Safety Gate

**2026-10-17 (UTC+8) · Source-only candidate · NOT deployed.**

## Problem and what changed

G1 must not treat an arbitrary uploaded JSON file or an empty Render Auth
Pilot catalog as the original CP30 business ledger. In PR #9, the candidate
exporter was separated from the dangerous mixed read/write SQL dispatcher
and a pure Ed25519 signed-public-envelope verifier was added. That verifier
previously depended on the caller remembering `previousSequence`, with
no durable cache or concurrency coordination.

This branch extends that candidate with a **separately provisioned
PostgreSQL 17 cache schema**, a strict cache `ingest/current` adapter,
and an isolated HTTP handler that is **not mounted on the existing Render
service**. No original CP30 runtime, signer Journal, old 7-USDC escrow,
live wallet material, private claim or existing Render PostgreSQL is touched.

## Trust boundaries

| Component | What it may do | What it may NOT do |
|---|---|---|
| Original CP30 (future) | Produce reviewed public projection, only after G3 recovery/read-only source approval | Be started automatically by cache, grant mixed `live_api` privileges to cloud |
| Offline Ed25519 verifier | Verify a pinned **public** key, exact origin, body, accounting, date and sequence | Sign using a private key, authenticate beneficiaries, prove chain finality |
| `mf_g1_cache_writer` (NOLOGIN) | SELECT cache state, UPDATE exactly signed-snapshot columns | ALTER trusted key, INSERT/DELETE cache row, access source/CP30 tables |
| `mf_g1_cache_reader` (NOLOGIN) | SELECT allowlisted signed public cache | UPDATE metadata, see private beneficiary/voucher/session data |
| Cache state | Transactionally serialize increment via `FOR UPDATE`, remember last sequence and full signed envelope | Reset sequence or change trust root via normal writer role |
| Candidate HTTP handler | Accept bounded, canonical public JSON at `POST /v1/g1/public-snapshot`, display verified current public result at GET | Serve stale data; accept cookies/bearer tokens as authority; handle Fund/Issue/Settle |

All roles are created **NOLOGIN** in the isolated SQL candidate. No
cloud login credentials, source signing key, source uploader, new Render
service, production public key or persistent deployment configuration
is created.

### Database and replay semantics

The future deployment operator must provision the singleton state row
with a reviewed immutable `key_id` and `audience`, and supply its
verified Ed25519 public key plus out-of-band SHA-256 SPKI fingerprint.
The first signed source sequence is exactly `1`; each subsequent
accepted envelope must be exactly prior+1. Ingest holds the singleton
row lock through signature verification, source-as-of/accounting monotonic
checks and commit. Failed calls roll back. Every public GET re-verifies
the cached source signature and returns 503 after expiry.

The store's cumulative funded and settled amounts/counts cannot decrease
within a single reviewed escrow. Source timestamp cannot decrease and
different original records cannot claim the same source-as-of instant.
The existing Ed25519 JSON allowlist rejects private session, voucher,
recipient, wallet signature, QR and unknown fields. Signature provenance
is **not** proof of canonical blockchain finality or food being served.

### HTTP candidate contract

- `POST /v1/g1/public-snapshot`: single signed public envelope,
  exact pinned Host and browser Origin, `application/json`,
  JSON.stringify-canonical body, max 48 KB, no Cookie/Authorization.
  Accept => HTTP 201 with public receipt metadata; invalid/replay =>
  HTTP 409 or validation-specific generic error.
- `GET /v1/g1/public-snapshot`: returns verified public snapshot +
  `authenticatedPublicSource=true` and
  `chainFinalityIndependentlyVerified=false`; absent/expired =>
  HTTP 503 `G1_PUBLIC_SOURCE_NOT_READY`.
- All business routes remain absent (404). This is not a wallet API.
  **No HTTP listener is started by the module**; the handler is invoked
  only by localhost CI tests.

### Real PostgreSQL 17.11 evidence

[CI: signed HTTP receiver + durable cache **31/31 PASS**](https://github.com/3956ray/MealForward/actions/runs/39000851631)

Test scenarios include 16 simultaneous submissions of the same signed
sequence (exactly one accepted), strictly increasing sequence with no
gaps, process/pool reinitialization, tampered stored JSON, foreign Ed25519
signer/key mismatch, wrong origin, expiration, bad financial accounting,
source rollback, trust-root mutation, reader/writer SQL privileges,
fault-injected PostgreSQL UPDATE rollback and safe retry.

The CI also exercises **real loopback HTTP POST/GET** (10 concurrent HTTP
replays; one accepted), request-size/JSON duplicate-key/content-type
rejections, stale GET behavior and explicit 404 for private/transaction
routes. The latest CI run on the final branch should be used as the
final acceptance evidence; do not rely solely on historical green runs.

## Explicitly unverified and blocked

1. **No original host deployment.** The source-only SQL candidate from
   PR #9 is not installed into the user's initialized Mac CP30 database.
   No original pending COMMITTED/ACK ticket or Journal has been replayed.
2. **No source signing private key.** The CI signs only using ephemeral
   generated Ed25519 test keys, never from the existing operator/issuer
   business authorities. A reviewed dedicated public-data signing
   authority is a separate design/release decision.
3. **No public cache deployment.** The dedicated PostgreSQL 17 database
   exists only for a single GitHub Actions job. Render Free Auth Pilot
   remains real **wallet identity only**; no original CP30 data bridge.
4. **No private `/v1/my/*` data.** Neither the cache nor public envelope
   permits authenticated private donor, recipient or merchant records.
5. **Database backup rollback caveat.** A privileged DB administrator
   restoring an older entire database can rewind its monotone row.
   Production requires a separate durable, independently verified
   high-watermark/anti-rollback anchor and keyed trust-root rotation policy
   before opening a writable ingestion endpoint to external networks.
6. **Signed source ≠ independently verified chain state.** Actual
   chain receipts, business ledger recovery and adversarial platform
   collusion still need G3/G4/G5 security and E2E evidence.

### What is approved automatically vs requires a new release gate

This branch is approved only for **source development and disposable CI**.
It does **not** approve an original runtime restart, new source credentials,
database migration, installing SQL, binding an initialized source namespace,
direct cloud DB connection, public production endpoint, or real Fund/Issue/
Lock/Report/Settle.

Next safe engineering task: prototype an independently anchored
high-watermark and reviewed source-publisher protocol in disposable CI.
Do not connect it to the original host before authorized G3 recovery and
original principal/finality validation.
