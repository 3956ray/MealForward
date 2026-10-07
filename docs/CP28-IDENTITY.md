# CP28 Dynamic identity preparation

Continuation of the accepted a9df7ca safe build. User selected Dynamic email login and one person / one wallet for administrator and merchant. This entry does not grant business authority or activate a chain runtime.

## Entry and state

The existing15287 preparation launcher now serves `/#/identity` with a lazy-loaded identity card. Only explicit email submission initializes the existing Dynamic SDK. Recipient cold loads do not load that card or SDK. OTP is entered by the user; it and access tokens remain in the existing memory-only client. Identity network traffic is limited to Dynamic SDK/JWKS; no chain RPC or transaction is used.

SDK-authenticated, server-verified identity and candidate address declaration are distinct UI states. Missing server profile permits SDK email login but disables server verification and candidate confirmation. The business status remains BLOCKED, regardless of identity success. No actor, role, mapping, deployment or wallet proof is created.

`IdentityPreparation` provides bounded process-memory sessions (max128,1h, exchange20/min), using a separate HttpOnly/SameSite Strict cookie path and CSRF bootstrap. Every authenticated request verifies the current JWT and exact token digest, subject digest, issuer/environment, sid digest and token expiry. Candidate declarations expire with the earlier of token or preparation session. Invalid identity checks remove existing confirmation. Logout/invalidation require CSRF but do not require a still-valid bearer so expired identities can be cleared. Raw tokens/subjects/sids/OTP are never stored or returned by this service. Reload bootstraps a fresh preparation session; process restart revokes all sessions. Existing preparation.json/runId/anchor and old business data are unchanged. Candidates are deliberately not durable business configuration.

The user explicitly connects MetaMask, then confirms the displayed public address for both administrator and merchant. Only `eth_requestAccounts`, `eth_accounts`, `eth_chainId` are used; event-capable provider is required. No signature or chain switch is requested. Current account/network is re-read before confirmation; events, SDK token/subject changes, expiry, logout and leaving the card clear the current declaration. The server derives both candidate fields from one submitted address, never treating it as ownership or role proof. Configured service addresses are excluded; absent service configuration is explicitly NOT_CONFIGURED, not a passed separation check. The later business Runtime and chain-role checks remain mandatory.

## Explicit profile input

Default launcher has **no profile**. A maintenance operator may later use `--identity-profile /absolute/path/to/reviewed-profile.json` only after that source is approved. The file must be owner-controlled0600/non-symlink, bounded16KiB, with exactly `sourceVersion` and `claimProfile`. Profile must be verified, fixed environment `7fe95f70-e5cc-4c3c-beed-a133e81268dc`, issuer `app.dynamicauth.com/<environment>`, audience exactly the entry origin and all absent-claim flags false. Each authentication checks that the approved file has not changed. No auto-discovery, token sampling approval, guessed audience or old business mappings are supported.

Formal historical document `research/cp17/developer/PROFILE-CALIBRATION.md` records an old approved private authority source `.localbackend/cp17-dynamic/authority-20261003-partner.json`, but its audience was exactly15207. That is not approval for15287. No private source was read or imported during this build, and no audience was widened. The existing public environment ID is already present. Email OTP enablement and15287 origin allowlist in the vendor dashboard remain unverified, not known missing.

## Validation

Lifecycle regression: the real shared Dynamic client captures its generation before waiting for SDK initialization. Leaving the card or logging out cancels that generation immediately, independently of HTTP cleanup. Late initialization/send/verify results cannot revive the old state; new login waits for SDK logout completion. Panel completion messages are also bound to the mounted controller. `tests/dynamic/client.test.ts` replaces only the vendor module with deferred offline operations and covers normal login, departure during initialization, late initialization failure, pending send/verify, re-entry and logout competition. It sends no email. The browser fixture below remains a separate UI smoke test and is not the proof of the real-client initialization race.

```sh
.venv/bin/python -m unittest tests.test_cp28_identity tests.test_dynamic_jwt tests.test_dynamic_auth tests.test_dynamic_profile tests.test_dynamic_contracts tests.test_cp28_runtime tests.test_cp28_rpc tests.test_cp28_ipc tests.test_cp28_local_flow tests.test_cp28_fake_flow -v
node --experimental-strip-types --test tests/wallet/cp28-identity.test.ts tests/wallet/cp28.test.ts tests/dynamic/*.test.ts
node_modules/.bin/tsc --noEmit -p manual-business-harness/tsconfig.json
node_modules/.bin/vite build --config manual-business-harness/vite.config.ts
```

Synthetic browser fixture: build `tests/cp28_identity_vite.config.ts`, then run `.venv/bin/python -m tests.cp28_identity_browser` on15288. It uses the actual App/controller, native fetch, actual HTTP service and production JWT verifier over ephemeral synthetic RSA/JWKS. Only the Dynamic client is aliased to a test-only module and window.ethereum is synthetic. The page visibly labels this and provides the synthetic000000 code; no mail is sent. Test state controls exist only in the fixture. Test build output is separate from the production harness. Evidence records endpoints/status/presence booleans, not tokens/OTP/cookies/CSRF. This is not real Dynamic or wallet acceptance.

Actual email/OTP and public-wallet connection are user-operated and NOT_RUN for this delivery. First user action after fixed-SHA acceptance: open15287/#/identity and submit their email themselves. Without the separately approved15287 profile, only SDK login can be attempted; server identity and wallet candidate remain disabled. If SDK initialization fails, report the visible error and verify exact origin/Email OTP configuration rather than assuming they are absent. Business deployment/grant/proof/signing/transfer remain outside this entry.
