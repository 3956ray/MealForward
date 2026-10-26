# Wallet V2 Task 3 report — 2026-10-26

## Scope and state

Integrated the six fixed Wallet V2 assets into the Phase6 static allowlist. `/` now serves the new HTML; `/t1f-approval.html`, its CSS/JS and the old ethers bundle remain explicit rollback routes. The HTTP handler's API/session/auth logic, CSP, database runtime, and service implementation were not changed. The root switch exists in source only until the main agent's independent review, CI, browser fixture and deployment gates complete.

Canonical HTML/CSS now live in `t1-intents/wallet-v2/public/index.html` and `style.css`. The isolated build copies both to `t1-intents/public/wallet-v2.html` and `.css` before producing the four JS bundles. The actual-shell source test reads the canonical HTML. All six served files are covered by CI's rebuild and Git diff check.

## TDD evidence

Added `t1f-wallet-v2-http.test.mjs` first. RED command `node --test t1f-wallet-v2-http.test.mjs` failed at `/wallet-v2.html`, HTTP 403 versus expected 200. After static mapping and build/source changes, the same test passed. It checks exact bytes and MIME for all six assets, new root identity, old rollback routes, no-store/CSP/nosniff/no CORS, rejected unlisted/traversal/query routes, health and authenticated session/state with zero submit calls.

Added `t1f-wallet-v2-live-smoke.mjs` and a loopback test. It compares all six served bytes to repository assets with a per-asset 1 MiB response ceiling, validates MIME/security headers, requires root to equal the new HTML, reads health/session/NO_ROUND state, and exercises the pre-existing negative route matrix. It sends no valid signature or durable write. The old smoke still checks its four rollback assets and accepts either old or new root, so it remains usable across the switch.

## Test commands and results

- `cd t1-intents/wallet-v2 && npm ci --ignore-scripts --no-audit --no-fund && node -e "require('esbuild').transformSync('const x = 1')" && npm test && npm run typecheck && npm run build && git diff --exit-code -- ../public/wallet-v2.html ../public/wallet-v2.css ../public/wallet-v2-bootstrap.mjs ../public/wallet-v2-controller.mjs ../public/wallet-v2-wallet.mjs ../public/wallet-v2-validation.mjs`: PASS; 44 isolated client tests, esbuild binary executable, typecheck, deterministic six-asset diff.
- `cd t1-intents && npm run check && files=(); for file in *.test.mjs; do case "$file" in core.test.mjs|http-auth.test.mjs) continue;; esac; files+=("$file"); done; GITHUB_ACTIONS=true MF_T1D_DISPOSABLE_ONLY=ack-ephemeral-quote-key node --test --test-concurrency=1 "${files[@]}"`: PASS; 184 non-PG tests.
- `node --check` on the new smoke, fixture and HTTP tests; focused old/new smoke and HTTP tests; `git diff --check`: PASS.
- No local PG, real DB, RPC, wallet, cloud, browser automation, or public HTTP operations were performed by this task agent. The existing 15 PG checks remain unchanged in the workflow. The new CI step adds locked client installation, esbuild executable check, test, typecheck, build and six-asset diff.

## Synthetic browser fixture

Run `cd t1-intents && node wallet-v2/tests/browser-fixture.mjs` or add `--port=60468` to choose an available port. The fixture binds only `127.0.0.1` and prints the exact `WALLET_V2_SYNTHETIC_URL=http://127.0.0.1:<port>/` for CUA. Stop with Ctrl-C (SIGINT); SIGTERM also closes its server. I started a sample on `http://127.0.0.1:60468/`, checked root/provider module/shipped bootstrap/health were HTTP 200, and stopped it. That sample port is no longer running; launch it again for browser checks.

The fixture HTML visibly exposes Owner, Donor, Other account, Unauthorized, Wrong chain and Hold API state response controls. Its local provider module is inserted before the actual shipped bootstrap module. Other shipped assets and API routes pass through the actual `makeApprovalHttpHandler` with an in-memory NO_ROUND fake service; pending API requests can be released with the checkbox. There is no real RPC, database, key or signature. Signing remains disabled as in the shipped bootstrap; no production synthetic flag was added.

## Live smoke invocation and output

After a verified deployment, run `cd t1-intents && node t1f-wallet-v2-live-smoke.mjs` against its fixed public Phase6 origin. Expected output is a JSON object with `status: "T1F_WALLET_V2_PUBLIC_NO_ROUND_NEGATIVE_PASS"`, `requests: 33`, six `assetSha256` values, `noRelease: true`, and `realSignatures`, `onchainTransactions`, `durableWritesRequested` all zero. The local loopback test produced that status and 33 requests. The public origin was not contacted by this task agent; main must independently verify deployed commit, HTTPS result, original record fingerprint and zero successor counts.

## Modified files

`t1-intents/t1f-approval-server.mjs`; `t1-intents/t1f-wallet-v2-http.test.mjs`; `t1-intents/t1f-approval-live-smoke.mjs`; `t1-intents/t1f-wallet-v2-live-smoke.mjs`; `t1-intents/t1f-wallet-v2-live-smoke.test.mjs`; `t1-intents/wallet-v2/build.mjs`; `t1-intents/wallet-v2/public/index.html`; `t1-intents/wallet-v2/public/style.css`; `t1-intents/wallet-v2/tests/bootstrap.test.ts`; `t1-intents/wallet-v2/tests/browser-fixture.mjs`; `t1-intents/wallet-v2/tests/browser-fixture-provider.mjs`; `.github/workflows/mealforward-t1f-phase6-approval.yml`.

Main owns HANDOFF and `docs/wallet-v2-verification.md`. Browser CUA, independent review, exact remote CI, public smoke, deployment and real-wallet observation remain main's gates. Operational formal signing hold and NO RELEASE remain.
