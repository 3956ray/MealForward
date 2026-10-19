# G1 Render backend integration checkpoint — 2026-10-19

## Completed source + actual CI
- Combined **reviewed Render Auth Pilot** cloud-auth sources at commit 26092a0b with full Sites / CP30 G1 signed-public read code on a separate branch, without changing the existing Render service.
- Fixed actual G1 integration regressions: wallet SIWE session no longer fetches unavailable original CP30 /v1/store-registrations; initial Sites load now determines Auth-only backend mode before attempting catalog reads; public ledger remains marked unavailable rather than fabricated.
- Added same-origin G1 HTTP gateway with a nullable trusted public source. In the default deployment `publicCache=null`, so public CP30 business endpoints remain 503; only a separately injected independently anchored signed public source may serve GET stores/meals/ledger.
- New tests cover actual G0 cookie/session identity, public DTOs against frontend validators, denial of private /v1/my/*, rejects wrong hosts/origins, and invalid/expired/unanchored data.
- A fresh isolated PostgreSQL 17.11 Docker container was used by GitHub Actions for real SIWE challenge/session/CSRF and wallet A/B tests. It did **not** touch original CP30, Render existing PG, wallets, or on-chain assets.

Current checked actions:
- [G1 PostgreSQL17 + HTTP combined PASS](https://github.com/3956ray/MealForward/actions/runs/39249398974): original 27/27 Auth Pilot tests, 7/7 real PostgreSQL 17 security cases, 12/12 same-origin HTTP/source tests.
- [G1 live existing Render anonymous read-only smoke PASS](https://github.com/3956ray/MealForward/actions/runs/39249445949). Existing URL continues to be Auth-only.

## Render facts and blocker
Current workspace has service `mealforward-cp31-auth-laodao`, deploy `26092a0b`, real separate managed PostgreSQL17 `mealforward-cp31-test-pg`, no live CP30 business source. 
An attempt to provision a **second free** Render PostgreSQL17 in Singapore was **rejected by Render**: `cannot have more than one active free tier database`. No second database was created and no paid plan started.
The Render PG remote SQL connector is also blocked by the DB's empty external IP allowlist. Do not weaken networking to debug.

We have **NOT** deployed this new G1 Render branch, and have **NOT** repointed the already accepted G0 service or its database. Replacing a working identity service before verified schema isolation and safe migration would violate the original acceptance boundaries.

## Deployment gate
- Option A: independently provision a separate disposable PostgreSQL17 using an explicitly accepted resource plan; no approval to incur costs is implied.
- Option B: design and audit a separate, least-privilege G1 test schema in the **existing** Render PG, then migrate only reviewed synthetic/test-only records with a rollback plan, with original SIWE tables untouched. Auth Pilot sessions MUST NOT become original CP30 source principals.
- Render's current App is still intentionally `auth_only`, and there is no publicly available original CP30 read-only source feed or trusted signing key/anchor. No synthetic source may be displayed as original CP30 data.
- Original Mac `PREPARED #3560` and historical Journal remain frozen, last confirmed STOP_GATE PASS, no recovery/backup verified.

Next real human test only after an independently safe database and read-source deployment exposes audited HTTP endpoints, not another empty wallet page.