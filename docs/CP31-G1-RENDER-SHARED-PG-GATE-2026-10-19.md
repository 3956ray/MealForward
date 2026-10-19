# CP31 G1-A — Render shared-PG feasibility / boundary

This branch is an **isolated source and GitHub Actions test**, not a migration on Render PG or the original Mac CP30 runtime.

## Verified
- Reused the current G1 backend candidate at PR #19.
- Separate NOLOGIN G1 reader/writer roles and **synthetic-only** G1 probe schema can coexist with the Auth Pilot schema on a **new disposable** PostgreSQL 17.11 cluster.
- Tests deny G1 roles access to the Auth Pilot's challenges, sessions, and pre-sessions, prevent the reader from updating public projection, block the writer from deleting it, enforce strictly increasing revision, and recheck Auth Pilot health.
- Historical original CP30 data, its source authority and its private wallet principal were never used or recreated.
- CI result: https://github.com/3956ray/MealForward/actions/runs/39261179714 — SUCCESS.

## What this does NOT prove
- Auth and G1 roles sharing the **same Render database** is weaker than independent storage and administration. This does **not** meet the current G1 independent anti-rollback anchor requirement, because a privileged whole-database restore may rewind cache and anchor together.
- Existing Render PG is not externally available to this connector (empty IP allowlist), and Render denies provisioning a second free PostgreSQL. We did not weaken the IP allowlist or introduce paid resources.
- The reviewed source publisher, source signing key, independently administered anchor, and original CP30 read-only source are not installed; no original public/business record is available on Render.
- No new Web Service is deployed here. The original G0 website and Render PG remain unchanged. Nothing has been authorized to issue, lock, report, or settle original vouchers.

## Deployment decision
Treat shared-PG as **synthetic functional regression only**, never as the approved public-source trust boundary. The next deployable G1 step is to provision source provenance and an independent anchor using separate storage/trust ownership (or explicitly revise the threat model with a security decision), then perform strict same-origin real HTTP checks of public Stores/Meals/Ledger and separately wallet-bound private records. Original CP30 Mac journal PREPARED #3560 remains frozen until backup and recovery approval.
