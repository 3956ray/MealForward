# MealForward / 留膳 — G0–G2 Source Integration Handoff (2026-10-19 UTC+8)

## Source and scope

- Intended integrated MVP truth: GitHub 3956ray/MealForward, branch codex/mealforward-integrated-mvp at fe3d6dfd98dfccb9f3d8e72b0edcc36418cce07b. Historical handoff: docs/agent-handoff-2026-10-16.
- Isolated candidate: codex/mealforward-g1-public-sites-adapter-20261019, started from codex/mealforward-g1-source-publisher-outbox-20261018 at 7b56b6c. NOT merged to main or installed on the old Mac.
- The owner's supplied historic chat confirms G0 MetaMask login, refresh, logout, account switch and wrong-network rejection personally passed 5/5. Challenge expiry, replay and source-principal binding remain separate gates. Do not unnecessarily repeat G0 5/5.
- Owner-supplied Mac output confirmed hashed maintenance v2, OWNED_SERVICE_PROCESSES=0, HTTP_LISTENER_16443=ABSENT, OTHER_PG_CLIENT_BACKENDS=0, POSTGRES_REMAINS_RUNNING=YES, STOP_GATE: PASS and NO_RECOVERY_PERFORMED. Earlier handoff claiming stopped was unverified predates this. No evidence of backup/full Journal-chain verification or permission to restore or restart original CP30 PREPARED #3560.

## Branch reconciliation and delivered source

1. The G1 publisher branch diverged from the integrated branch before Sites files were copied. Porting only 21 G0/G1 changed blobs led to a missing ledger-view.mjs and failed CI. That intermediate failure was not accepted.
2. Restored 42 missing baseline Git blobs from integrated HEAD, while preserving 9 newer G0/G1 Sites file versions rather than overwriting them. Brought across 21 original G0/G1 source blobs (wallet continuity, valid fresh menus, fail-closed DTO validation, tests).
3. Added cp30-backend/g1-export/public-sites-read.mjs. It uses only an injected reviewed, independently anchored public cache.current() facade. It does NOT read original CP30 mixed live dispatcher or accept external data posts.
4. Provides read-only GET /v1/stores, GET /v1/stores/{store}/meals, GET /v1/ledger responses with the real Sites DTO contract. It rejects wrong origins, unwanted methods, all private wallet endpoints, unanchored/unsigned/expired/corrupt input, and preserves 503 on source failure instead of returning an empty list.
5. Added 7 end-to-end local HTTP compatibility/security cases and reruns 12 original Ed25519 public envelope checks.
6. Does not provide login, recipient or donor private access endpoints. My Contributions / My Meals remain bound to genuine original server-side wallet principals.

## Actual remote test evidence

- G1 Sites / CP30 static compatibility: https://github.com/3956ray/MealForward/actions/runs/39213025244 — PASS, 193/193 Node and 5/5 Python; after full baseline reconciliation.
- Signed public envelope and HTTP DTO adapter: https://github.com/3956ray/MealForward/actions/runs/39213025227 — PASS, 12/12 Ed25519 and 7/7 HTTP/source-to-Sites.
- Disposable PG17.11 migration/ACL evidence: https://github.com/3956ray/MealForward/actions/runs/39050285900 — prior PASS, 44 original migration files on a NEW database only.
- Isolated G1 source publisher / three PG17 databases: https://github.com/3956ray/MealForward/actions/runs/39050285833 — prior PASS, not deployed.
- Current connected Render service mealforward-cp31-auth-laodao uses codex/mealforward-cp31-auth-pilot and separate free PG17, still Auth-only. No current original CP30 data was imported or any Render deployment made.

## Release gates not satisfied

- Public signer, durable source Outbox, cache, and independent anchor are candidate source code and disposable CI only. No approved original CP30 read-only feed, real public-data Ed25519 key, production anchor, or public HTTP receiver is provisioned. Do not present synthetic data as historical source truth.
- Public signed source is NOT independent on-chain finality or real-world food-delivery proof.
- Original CP30 GET /v1/stores and /v1/ledger historically returned 422 while ledger was pending. STOP_GATE PASS does not grant source restoration, restarting the six services or copying real data to cloud.
- Personal wallet A/B records require original authority/Session/CSRF checks. The public cache can never answer private voucher or donor endpoints.
- Mutations remain blocked pending durable Intent/Journal, UNKNOWN same-id recovery, isolated signer authorities, validated onchain receipts, and balance reconciliations. Original StoreEscrow does not enforce an on-chain 180s cooldown; see https://github.com/3956ray/MealForward/issues/17.
- Independent PR chains have diverged. Avoid blanket merges without file provenance and complete regression checks.

## Next usable integration gate

Provision a SEPARATE, independently secured, public-only cache/anchor and source signer with strict original readonly projection authorization (after required original runtime approval). Mount the reviewed public DTO adapter as part of the intended same-origin site. Wallet-private reads remain on original source principal and MUST undergo independent A/B permission testing. Then run human mobile+desktop G1 checks of public kitchen/meals/ledger and private orders/vouchers, including refresh and error recovery. This branch is not yet a human-ready real CP30 read integration and does not ask the owner to sign or move money.
