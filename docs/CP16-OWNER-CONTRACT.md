# CP16 owner C0 — option A

User and PM confirmed four product identities and option A. This overrides role,
settlement signer and backup-v2 portions of CP16-CONTRACT.md. Local Anvil31337 only;
no contract change, new SDK, existing user wallet or network deployment.

## Configuration and schema

Store incrementally migrates v1/v2 to v3 (`003_owner_wallet.sql`), preserving old
records without granting owner authority. `ownerWalletMode` is bound to the DB and
cannot toggle in place. CLI setup creates an owner fixture; the Python fixture's
default legacy mode is retained only for regression/compatibility tests. New tests
and new callers must explicitly use `fixture(..., owner_mode=True)`.

Owner mode has backend issuer/operator keys only. `owner-a` / `shop-local` has a
trusted binding to deployment `merchant`, which holds SETTLER_ROLE but not
OPERATOR_ROLE. The fixture uses Anvil account5 as the external test wallet. Backend
config, worker keys and backup contain no owner private key. Only test drivers may
derive the disposable Anvil key; browser interaction requires an explicit user
action on an injected EIP1193 provider. Existing contract allows privileged operator
calls outside application code/statement checks; it does not prove physical delivery.

## Shared helpers and work module owner

Main owns shared files and `server/owner_wallet.py`. Redemption owner owns only
`server/redemption.py`, `tests/test_redemption.py` after Leader dispatch.

- `work.actor_role(kind)` returns owner for lock/report/settle in owner mode.
- `work.require_owner(db, actor)` checks current owner scope, trusted merchant
  binding, current work session and unexpired wallet proof. Use it for all new
  group/precheck/lock/handoff/report mutations, including original-key replays.
- Read endpoints check `work.require_actor(db, actor, 'owner')`, local shop and
  original owner responsibility. Do not require fresh wallet signatures just to
  read original evidence; restored work sessions remain revoked.
- `validate_code` and `original/enqueue` enforce owner proof in owner mode.
  Consumption + claim + lock operation/outbox still share one caller transaction.
- `enqueue` rejects settle in owner mode. Main HTTP route delegates prepare to
  `backend.owner_wallet.prepare(actor, redemption_id, body)`; do not register
  another settle route or implement a second settlement state machine.
- Existing group/redemption DTO and privacy allowlists remain. Payables use owner
  authorization and retain only the owner's necessary shop data. Remove original
  actor versus settler separation. A handoff remains immutable and report separate.
- Background operator checks current account/binding/scope before new signing;
  accepted work does not require keeping the browser session/proof alive. Disabled
  owner/binding stops dispatch; already executed facts are still reconciled.

## Wallet identity HTTP

All POSTs require exact Origin, JSON object, work cookie and X-CSRF-Token. Errors are
sanitized; no automatic owner binding registration or private-key endpoint exists.

| Endpoint, under /api/v1 | Body | Response |
|---|---|---|
| POST /work/wallet/challenge | `{}` | challengeId, message, address, expiresAt |
| POST /work/wallet/verify | challengeId, signature | verified, address, expiresAt |
| GET /work/wallet/session | — | verified, address, optional expiresAt |
| POST /work/wallet/logout | `{}` | 204 |

Sign the exact returned UTF-8 message with personal_sign/EIP191 (not claimed SIWE).
It binds origin, chain, deployment, contract, shop, actor, work session, wallet,
random challenge and expiry, and explicitly disclaims transaction authorization.
Challenge TTL300s, single use; proof max1800s capped by work session expiry. Work
session expiry/revocation, owner disable and wallet logout invalidate the proof.
Challenge issuance and verification are rate limited. Only EOA local tests are
supported; no smart-account signature claim. Wallet/account or chain switch must
invalidate frontend review and revoke proof; backend cannot observe browser events.

## External settlement HTTP

| Endpoint, under /api/v1 | Body | Response |
|---|---|---|
| POST /work/payables/:redemptionId/settle | intentKey | 201 `{operation,intent}` |
| POST /work/operations/:id/submission-start | `{}` | `{operation,intent,maySubmit}` |
| POST /work/operations/:id/transaction | txHash | `{operation,intent}` |
| GET /operations/:id | — | `{operation,intent}` |
| GET /work/operations/by-intent/settle/:key | — | `{operation,intent}` |

Operation uses the existing backend DTO. Intent fields: operationId, from (owner),
to (contract), chainId31337, data, value string `"0"`, merchant, amountWei string,
gasSeparate true, reviewExpiresAt seconds, submissionStarted boolean. The meal
payment comes from the contract to immutable merchant, not from tx.value. Review
must display destination, amount and separate gas before explicitly sending.

Prepare requires finalized original lock/report/handoff, owner responsibility,
H, proof and on-chain SETTLER_ROLE. It saves PREPARED and owner_settlements without
outbox/raw/backend nonce. Same intent returns original. PREPARED before any start
can be explicitly re-reviewed with that same intent and refreshed300s review TTL.
There is at most one unresolved settlement per voucher.

Start persists SUBMISSION_UNKNOWN before wallet invocation. Only the first start
returns maySubmit=true; repeats return false and never grant another send. A lost
start response is uncertain. The frontend must gate eth_sendTransaction on this
successful first response and recheck current account/chain/review. Once started,
4001/no hash/disconnection is not backend proof of non-submission; retain original
op and occupancy and query only. No cancellation/automatic retry endpoint exists.

Transaction association verifies actual RPC sender/chain/to/value/calldata before
binding hash; unseen hashes leave original unchanged, so the caller retains and
may re-report that same hash. Never substitute another tx. Worker finds matching
original events if hash was lost, verifies canonical receipt/finality, and only
observes. Finalized success alone moves H→S; revert keepsH, then explicit new intent
may be prepared after cause is resolved. UNKNOWN never means failed. Restored
instances stay quarantined and cannot accept any of these new writes.

## Recovery and evidence

Backup v3 preserves private owner context and only configured backend signer keys;
restores revoke wallet challenges/proofs in addition to old capabilities. v1/v2
remain readable quarantined compatibility inputs. External settle is reconciled
without current browser authority or any owner key; lost private context halts
rather than inventing a declaration or authorization.

`tests.test_backend_chain_owner` proves real HTTP identity/settlement protocol and
real test-driver-signed chain transactions; lock/report setup uses C0 shared
helpers. It is not full redemption-module HTTP acceptance or browser acceptance.
The next module must complete HTTP redemption; a separately owned controller /
owner-wallet-harness must prove explicit browser wallet interaction. No simulated
P06 UI result may be reported as completion of the real owner wallet flow.
