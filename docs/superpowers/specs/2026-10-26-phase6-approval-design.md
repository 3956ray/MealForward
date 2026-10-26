# Phase6 durable Recovery approval collection — source only

Phase5 Owner and Donor practice signatures are USER-REPORTED PASS (2/2 PASS · NO RELEASE). This stage builds a separate durable collector for formal Recovery approvals; it does not release or prepare an Issue transaction.

## Decision and boundary
User instructed autonomous development until testing is needed. Routine design choices are delegated; no extra design confirmation is needed. Use the existing Recovery v1 / SuccessorIssueRelease payload, pinned Owner and Donor, separate service and least-privilege NOLOGIN database role. Preserve 013/014/015 byte-for-byte and HUMAN_REVIEW_HOLD. No live migrations, credentials, deployments, Recovery signatures or transactions in this stage. No backend signer/broadcaster or legacy runtime reuse.

## Behavior
An explicit operator action creates a round after reading the fixed original claim/review/slot and fresh canonical chain evidence. The operator records a fresh wallet-activity observation; no automatic round creation or rollover. The server generates UUID/nonce domain/new candidate operation, with 300-second approval validity and 480-second candidate deadline. One unexpired round at a time. An expired round remains immutable evidence; an explicit fresh round uses fresh IDs.

Owner and Donor independently sign the same stored manifest. Submission accepts only round ID, digest, role, signature; client payload/domain/address/expiry cannot replace authority. Reconstruct fixed domain/types, hash stored values, verify pinned EOA, and recheck original context plus canonical block/current chain conditions before recording. Persist fingerprints only, never raw signatures. Database serializes concurrent submissions, binds each role to the same digest, rejects conflicting/replayed attestations, and allows an identical retry without an extra audit event. Progress survives refresh/restart; expiry overrides even a completed 2/2 result. Signing a round is never a release.

HTTP is a separate service with exact Origin/Host, secure SameSite HttpOnly session, CSRF, bounded sessions/body/rate/time, no CORS, sanitized errors, no signature logging. Cookie loss can create a fresh session and read the persisted same round. UI has explicit connect/sign controls, verifies selected role/account/chain and clears pending local work on account/chain/disconnect events. No automatic retry/sign/switch/send. Display formal Recovery warning, digest, expiry, role progress and NO RELEASE.

## Database
016 creates a separate schema with immutable rounds/attestations/events and SECURITY DEFINER functions with fixed search_path and explicit execute grants only to a dedicated NOLOGIN/NOBYPASSRLS role. No table privileges or old-schema privileges for that role, no grants for anon/authenticated/service_role or legacy runtimes. Functions enforce frozen original pins, review/slot relationship, expected wallet constants, time bounds, nonce uniqueness, atomic per-role acceptance and explicit new-round creation. DB trusts the reviewed collector to attest cryptographic verification; fingerprints alone do not prove a wallet signed. No 015 row is created, updated, or consumed.

## Evidence and next gate
Tests: cryptographic synthetic positive/negative cases; HTTP origin/session/body/error tests; isolated PG17 exact 009–016 migrations with original nonce0/op/hash/deadline pins; duplicate/concurrent/expiry/stale authority checks; privilege matrix; untouched legacy records and 015 holds. Full t1-intents suite. Fresh independent whole-branch review. Draft PR and HANDOFF record source/CI/local/public/human separately.

Next human gate is approval of a concrete reviewed isolated service and migration deployment plan. Only after deployment, exact permissions, live DB and public checks pass may user test formal Recovery signatures. Existing practice signatures are never reused.

