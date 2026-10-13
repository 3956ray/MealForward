# Fourth source handoff — 2026-10-13

SOURCE ONLY / NOT READY FOR USER TRIAL / NOT TESTNET CONNECTED / NOT ACCEPTED.
No actual PG, HTTPS, identity/JWKS, RPC, wallet, key loader/signer, signing,
broadcast, deployment, old runtime or blocked matrix was run.

## Completed source

`tools/full-app.py` provides independent prepare/initialize/start/stop source.
Prepare creates a new owned directory and disabled template, separate custody,
security/binding/content/TLS directories and empty dedicated custody slots.
Initialize requires explicitly reviewed inputs and new custody/TLS metadata;
there is no old-runtime import, fixture initialization, reset or epoch adoption.
The new initializer generates the minimum separate API, identity authority,
registration worker, identity security, automatic binding, three authority,
gateway/observer and ledger/registrar logins/capabilities. Owner/group roles are
NOLOGIN and application logins cannot assume owners. Approved roles/budgets and
binding templates are seeded before the first externally retained runtime HEADER.
It never seeds a store, unit, balance, voucher or chain success.

`application_setup.py` creates matching namespace/guard/epochs, fresh independent
security Journal checkpoint plus SQL anchor, binding journal HEADER, HMAC/cursor
keys, private capability/config digests and fully merged API identity/business
configuration. The API has no policy-owner, auto-binding login or system key.

`identity_security_controller.py` reuses the actual Controller and Journal
prepare/apply/proof/finish/abort machinery, with a narrow identity/security-only
checkpoint adapter. It permits identity exchange, wallet binding, query and API
logout; source/execution, economic snapshots, fixtures and synthetic login are
unavailable. The authority checkpoint is explicitly an opaque security-journal
cursor/hash, never a chain block or financial fact. Empty-store login and owner
wallet binding therefore remain reachable. Initial epochs are exactly fresh1;
missing/conflicting anchors, journals or later epochs close rather than adopt.

HTTP connection mode now requires a canonical explicit fixed loopback HTTPS
origin/port; validation precedes TLS file loading and socket binding. Origin,
allowedOrigin, wallet backendOriginHash, TLS SAN/key/certificate and bound report
must agree. The hash is generated from the approved origin if omitted, and a
conflicting supplied hash is rejected. The existing synthetic mode retains its
random-port default. New files are private digest-pinned; existing disabled settings
are not changed. Startup launches only six apps: ledger controller, identity
security controller, identity authority, registrar, automatic business suite and
API. A failed launch stops only its own children; normal stop validates recorded
PID birth and command. Logs/configs/journals/custody remain retained for restart.
Private pool maxima total16 (security/ledger controllers total2), inside the
existing PG24/runtime18/controller2 and seven-app bounds.

The ledger controller periodically advances only the existing private checkpoint-
checked clock. It skips a pending runtime preparation. API lifecycle drives the
registration dispatcher and actual live observer worker; registration DB and
private service resources are closed by their owners.

## Automatic first verified store

`automatic_business.py` waits for the first unique persisted CONFIRMED registration
and complete verified evidence. It receives no user/admin registrationId input.
A trusted detached probe uses the actual bounded business transport, canonical
finalized header, runtime template and immutable getters to obtain the complete
escrow code hash. Role/account/cap templates are preapproved against the registrar
profile. It constructs the exact full authority profiles from those verified facts.

An independent `FirstBindingJournal` fsyncs the original registration/profiles and
per-role creation intentions. The same PgRuntimeLedger seals first_binding_begin,
fixed authority profiles and later bound confirmation. Each role response journal
is first-created once using O_EXCL; existing journals are verified/reopened. A
retained creation intention with missing file, mismatched profile, changed template,
multiple first registrations or conflicting retained/DB state closes the binder.
There is no reinitialize, re-sign, re-deploy, nonce replacement or grant refill.
Partial original progress may reopen the SAME existing header and complete its
original acknowledgement; a missing possibly-created header is never recreated.

After complete original headers and bound acknowledgement, the private service
hot-composes the actual three signer/admission/broadcaster hosts behind preexisting
scoped client capabilities. The API configuration does not change and contains no
custody paths/keys or binder capability. Setup is NOT_CONFIGURED while waiting;
mutable live business is closed until bound. Public/identity/registration operations
are not globally blocked by the empty store. Subsequent readiness requires fresh
complete actual facts and all three private hosts' scoped setup replies. The live
worker sticks to the retained first registration when later registrations exist;
three-store registration/schema boundaries are preserved without creating extra
first-run authority bindings. Manual per-store business-provision is no longer the
full-app path.

## Evidence and remaining work

Seven new bounded memory/source checks pass: fixed origin validation before TLS/
socket IO; disabled fresh slots; no pre-verification probe/resource creation;
automatic once-only binding and restart reuse; missing journal refusal; retained
creation intention without file refusal; actual Journal/Controller security
prepare/apply/proof/finish under an in-memory DB with no economic authority calls.
Seven existing focused live checks also pass after the startup integration changes.
Python AST and disabled-template JSON pass. No signer worker, TLS key, actual DB,
identity, RPC or wallet was exercised. SQL/type/permission/locking semantics and
positive full-app runtime behavior remain UNVERIFIED.

For the required first one-store/one-meal path, startup, identity/security, registrar,
automatic authority binding, actual gateway/observer, quote, approve/fund, issue,
display/link/check, lock/handover/report and owner wallet settlement all have concrete
source paths. No required first-run method is intentionally left as an unimplemented
broker or permanent False. Missing inputs, provider results or retained state still
close these paths. Actual fresh startup, independent source review and real user
flow/chain verification must occur only under later explicit runtime authorization.
Full formal epoch/restore verification remains later; there is no reset/adoption
shortcut. Extra refund/catalog/admin paths and original stopped C1 matrices remain
outside this slice. No acceptance is claimed.

See FRESH-INPUTS.md and config/full-app.disabled.json for the concrete non-secret
input checklist. This is configured source readiness, not deployed/live evidence.
