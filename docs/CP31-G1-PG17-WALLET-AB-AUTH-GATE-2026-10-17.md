# MealForward — CP31 G1 original wallet A/B SQL security gate

**Date:** 2026-10-17 (UTC+8)  
**Execution environment:** disposable GitHub Actions runner, `postgres:17.11`, local-only TCP.
**Production/original CP30 runtime:** NOT accessed.

## What ran

On a never-initialized disposable PostgreSQL 17.11, the runner first applies
the **original 44 checked-in CP30 migrations (001–019, 021–045)** and
the reviewed source bootstrap's post-migration `c1_private` function grants.
It verifies the three previously pinned source hashes and the SQL 045
initialized-runtime refusal.

The test then creates exactly **two synthetic wallet principals** and
independent Session, CSRF, recipient key and wallet-principal rows using
the original `c1_private.identities`, `c1_private.sessions`,
`c1_private.wallet_principals` and
`c1_private.external_session_expiry` tables. It invokes the original
PostgreSQL SECURITY DEFINER `c1_private.auth(text,jsonb,boolean)` function.

All synthetic principals/sessions are placed in a rollback-only transaction.
The test checks no synthetic deployment row survives.

## Verified security properties

- Wallet A and Wallet B's separate hashed session locators select **different
  original CP30 subjects**; an untrusted `walletAddress` JSON override never
  changes the subject selected by the original server-side session token.
- A's mutation needs A's matching CSRF hash; B's CSRF and missing CSRF are
  rejected. B's session independently requires B's CSRF.
- A nonexistent Session, revoked Session, stale Session identity revision,
  stale identity revision, wallet-principal revision mismatch, recipient-key
  mismatch, expired wallet principal, expired external Session, altered global
  credential epoch and Session idle timeout all fail closed.
- **Important dispatcher separation:** the existing `c1_live_api`
  role *does* have EXECUTE on the original mixed read/write
  `c1_runtime_internal.live_api(text,jsonb)` SECURITY DEFINER dispatcher.
  A new G1 cloud **read-only** data source must **not reuse this role or its
  credentials**, even though it lacks direct SELECT on the private tables.
  Original controller/ledger admission still guards mutations, but the role
  is not a narrowly read-only DB principal. Prefer a separately reviewed
  non-mutating projection/export path with dedicated privileges.
- The `c1_live_api` role has **no direct SELECT** on
  `c1_private.sessions`, `c1_private.wallet_principals`,
  or `c1_live_private.claims`. The caller never bypasses the original
  SECURITY DEFINER source function through a fabricated public DTO.
- The reviewed original SQL 045 rejects an initialized synthetic CP30
  runtime checkpoint; G1 probe never creates a persistent checkpoint or
  executes a signer, chain transaction or old business service.

## Evidence

[GitHub Actions, real PG17.11 A/B wallet SQL PASS](https://github.com/3956ray/MealForward/actions/runs/38997604997)

Expected machine-readable proof:
`g1SourceWalletAb=true`,
`clientWalletOverrideIgnored=true`,
`csrfMutationBoundToCurrentSession=true`,
`revocationRevisionEpochExpiryRejected=true`,
`directApiPrivateSelect=false`,
`syntheticRowsPersisted=false`,
`initializedRuntime045Rejected=true`,
`sqlFilesApplied=44`.

## Limitations: G1 NOT COMPLETE

- This tests the **actual original wallet Session authenticator and role
  privileges** in disposable PostgreSQL, not a deployed original
  `/v1/my/orders`, `/v1/my/vouchers` or merchant `/workbench`
  endpoint. Original `LiveGateway.handle` and SQL `live_api` still need
  read-only, fully initialized runtime-bound ticket/ledger proof.
- The independent Render SIWE Auth Pilot's wallet Session is NOT the
  original CP30 wallet principal. There is no accepted cross-service
  authentication bridge.
- No Mac CP30 existing DB, old 7-USDC escrow, pending COMMITTED/ACK ticket,
  signer key, journal or original business record was read or modified.
- This does not establish that a real meal was served, a transaction finalized,
  or that any settled funds arrived at a merchant wallet.

## Next gate

Before allowing real G1 business reads, require an independently approved
original CP30 read-only source/immutable snapshot with a verifiable
source identity, strict subject+recipient filters, wallet A/B isolation and
same-origin authorization; return `ORIGINAL_BUSINESS_NOT_CONNECTED` until
such a source passes. Do NOT restart the original controller merely to
expose API reads, and never apply migration 045 to the initialized Mac PG.
