# Owned forward wallet extension contract

Main owns src and connection-migrations/026-wallet-principal.sql. Root's tool
helper may own only tools/wallet-forward-extension.py. Frontend and crypto leaves
remain with their assigned helpers. No original run initialize/reset is allowed.

wallet-login.json private0600 exact keys:
protocol=CP30_WALLET_LOGIN_EXTENSION_V1, installId=freshUUID, namespace=original,
origin=approved original, port=16443, chainId=10143, challengeTtlSeconds=180,
sessionTtlSeconds=3600, principalHmacKey=new internally generated32byte hex.
Also activationExpiresAt=original identity.json.activation.expiresAt (must match
application.json.connection.activation.expiresAt). These installed paths are exact.

WALLET-LOGIN-INSTALLED.json private0600 keys:
protocol, runId=CONNECTION-OWNED.id, installId, namespace, configSha256,
originalConfigs=exact original INSTALLED.configs dictionary, migrationSha256.
Also sourcePins exactly these9 backend-relative paths, SHA256 bytes:
src/c1/wallet_identity.py, src/c1/identity_runtime.py, src/c1/identity_adapter.py,
src/c1/identity_security_controller.py, src/c1/controller.py, src/c1/db.py,
src/c1/application.py, integrations/identity/wallet_login.py,
integrations/identity/wallet-login-codec.mjs. Runtime validates this exact map in
wallet_identity.load_extension before composing wallet authority. No frontend pins.
Do not rewrite original configs or INSTALLED. Preserve a redacted original
snapshot of their hashes, original DB guard/epochs/journal anchors/runtime state
and complete runtime material/floors, not passwords or config contents.

Migration installation row: c1_private.wallet_login_installation
(ns,install_id,config_digest,origin,chain_id,enabled,activation_expires_at).
After executing026 inside one transaction insert the single original namespace
row using original namespace, matching UUID/configSHA, HTTPS origin,10143,true,
original activation expiry. wallet_login_status uses original deployment clock to
turn admission off at expiry; session expiry=min(wallclock+3600,activationExpiresAt).
No other identity/session/principal/nonce/grant/store/journal seed. Code defines
no broad setter callable by apps. Enable/disable from tool updates only this
new installation.enabled; it does not delete challenges/principals or reset epochs.

Ordinary installer prerequisites: exact original owned run/PG identity; no live
app PID; no pending security/execution/runtime anchors; identity/store registration
and all c1_live business rows empty. Preserve all existing private system accounts,
grants/nonce floors and journals. Compare every namespace's runtime material/floors
and state, deployment guard/epochs and journal anchors before/after migration;
abort transaction unless unchanged. Installation must commit atomically. A retained
preparation may resume only the same installId, config and exact migration digest;
never generate another HMAC key after uncertainty. Existing matching installation
is an idempotent no-op; conflicting marker/config/schema is closed. No initdb.

CLI expected shape: isolated-entry.py wallet-forward-extension enable <run>;
disable <run> stops only new wallet login admissions. The tool must never restart
apps or PG. Root owns normal restart after source/manifest review.
Tool and connection-bootstrap.start/stop all take the same owned0600 regular
single-link WALLET-FORWARD.lock O_NOFOLLOW+flock exclusive for their whole mutation.

Private DB methods: wallet_login_status(ns,{}) ->
{enabled,configDigest,origin,chainId}; wallet_login_material(ns,{id,pre_hash,csrf_hash})
-> {challenge:exact9fields,revision:1}. Both c1_onboarding_internal readonly slots.

Private controller methods wallet_login_challenge and wallet_login accept exactly
{mutation_id,command}, existing verified_identity capability only. New security
kinds wallet_login_challenge/wallet_login reuse original reserve/prepare/apply/
proof/finish/abort journal machinery. No signature/privatekey/rawtoken in command;
login keeps only a proof digest. Challenge is bound to original pre-session/CSRF,
approved origin/chain, deadline and one nonce. Login consumes challenge and pre
exactly once in the session-creation transaction.

Public Root-locked protocol: pre-session first; challenge body only address,
response exactly challengeId,address,chainId,nonce,domain,uri,issuedAt,expiresAt,
message. Login body challengeId+signature only. Success existing cookie/CSRF flow,
/v1/me displayName="钱包 "+lowerwallet, authKind=wallet and walletAddress.
Dynamic me authKind=dynamic_email. Wallet login also proves this exact EOA for
owner/supporter binding; it grants no system signer authority. Recipient key is
separate wallet-domain HMAC, not email_key or a fabricated Dynamic issuer.
