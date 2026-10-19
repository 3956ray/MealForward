# Registration MVP — local integration

The current working source uses the real API at the same origin. The published
Sites v8 remains unchanged while local integration is being verified.

Local entry: `https://localhost:16443/#register`.

The backend serves an explicit snapshot of these `dist/` files at startup.
After editing the build, use the backend's owned stop/start workflow; a page
refresh alone does not replace the server snapshot. Do not initialize/reset the
existing database or regenerate its credentials.

## Connected scope

- Wallet login on Monad Testnet, backend sessions and owner authorization.
- Store and first-meal registration with image upload and exact token units.
- Separate owner signature and explicit enable-deployment action.
- Original registration recovery through the authenticated list endpoint.
- Polling of the original registration; deployment and publication are distinct.
- Public store/menu data and owner overview from the existing backend.

Registration service windows are entered and displayed in Beijing time (UTC+8), matching the deployed contract. Stored minute values are not converted.
Signatures remain in memory. Session storage holds CSRF proof and original retry
metadata, never wallet keys or signature bodies. A new tab without that proof
requests a new login. No browser data determines deployment success.

The original demo implementation is retained but not used for live actions.
Support for the original published meal is connected and one real payment was confirmed.
Claim review/confirmation, original claim recovery, My meals and short-lived voucher
display are connected for local verification. Merchant verification and payouts are
not yet connected through this frontend.
Kitchen private draft creation, text editing and image upload are connected.
Publishing and listing changes still require the missing catalog transaction service.

## Verification

Run `node --test live-api.test.mjs live-support.test.mjs onboarding.test.mjs onboarding-wallet.test.mjs support-ui.test.mjs` for the 53 API adapter and view
checks. `node verify.mjs` covers the retained demo model. The frontend's
`onboarding-browser.test.mjs` uses isolated mocked responses: it does not prove
real wallet, database or chain completion.

Backend migration 030 adds session-owned registration discovery. Backend static
configuration explicitly names this dist directory and its public assets.
The existing confirmed registration and public store remain intact.

The running backend's first business binding is already occupied by the existing
test kitchen. A second deployed store cannot become business-ready in this run.
The frontend therefore blocks new saves and DRAFT authorization/deployment when
the configured one-store MVP capacity is occupied; recovery and observation of
existing operations remain available. This is an entry-flow restriction, not a
new backend multi-store admission guarantee. Do not reset the original binding
or deploy another store to test this UI.

Real HTTP checks verify served source bytes, public store/menu results, and
unauthenticated rejection. A fresh owner signature/deployment must still be
verified with the user's wallet. Browser automation could not open the local
HTTPS page because its certificate is not trusted by that browser.

Wallet account and chain changes now invalidate private UI state and all pending
owner responses. A reload also compares the connected wallet with the cookie
owner. The user must explicitly sign in again after a change. Public catalog
data remains visible; original registrations are fetched only for the new
authenticated owner. A published public meal is displayed as listed independently
of temporary business-service readiness.

Wallet-switch verification: 13 adapter cases, 5 view cases and 11 groups of
actual UI handler race checks passed. Real wallet signing remains user-operated.
Local browser automation is also blocked by its URL security policy; HTTP
checks verify the served build but do not replace browser interaction.

## Kitchen restoration and private drafts — 2026-10-13

The original Meals toolbar, Add meal / Edit meal forms, image preview, service
times, and listing review UI are restored. Owner access requires authenticated
store ownership; authorization rejection clears cached private results and dialogs.
Public Kitchen is explicitly view-only and remains visible to all wallets.

Migration 031 is applied to the owned local database. Empty migration preserved
original material/floors, registrations, first binding and public store records.
Draft text and images use authenticated backend storage, expected revisions and
stable retry keys. Future drafts never overwrite published content. Image upload
follows text saving; partial failures remain visible and can retry only the image.

25 frontend tests, 10 actual-handler flow groups and 25 backend tests passed.
The backend developer also checked actual SQL in an isolated temporary PG with
synthetic context guards. The served build hashes and anonymous draft/image 401
responses were checked over HTTPS. A real owner-wallet save and second-wallet
browser isolation remain user-operated checks, not completed acceptance.

Publishing/listing remain disabled: the deployed contract requires catalogAuthority,
and the current execution service does not implement that role. Private drafts can
contain additional meals; the public projection is still the original one-meal MVP.

## Explicit wallet choice and published-meal support

Sign-in now enumerates the provider's authorized accounts and requires explicit
selection before signing. Connecting another account requests wallet permissions;
unsupported permission RPCs are reported, never treated as a successful switch.
The selected provider and address remain bound through signing, and the backend
session must return that exact wallet. UI cancellation invalidates adapter work
and preserves the requirement to sign in again.

Support uses only the public published meal, not saved private drafts. Review and
confirmation create an original intent; approve and fund are separate explicit
wallet actions. Client-built transaction calldata is compared against the server
preparation. Each attempted step is locked before sending; an uncertain result
never authorizes another send. Known hashes can be recorded again without another
wallet request. Only FINAL_SUCCEEDED refreshes the public accounting as success.
Original contributions are recovered from the current authenticated session.

The original owner has reported successful private draft saving in the frontend.
This does not establish publication, a second-wallet login, or a completed real
support payment; those remain separate user-operated checks.

## Real wallet claims and voucher display

GET /v1/my/claims recovers only the current recipient's issue requests. The UI
requires FINAL_SUCCEEDED plus the exact voucher returned by the backend before
showing claim completion. Failed or uncertain confirms retain their idempotency key.
Voucher recovery rotates the session cookie and CSRF; the adapter retains access
credentials only in session memory. Display codes and links are generated explicitly,
encoded locally, and removed when expired, closed or the wallet changes. The link
uses a URL fragment so the short-lived display code is not sent in an HTTP URL.
The verification landing page explains that merchant verification remains the next
integration step. Actual user-operated claim and QR acceptance are still pending.

## Kitchen verification and original handover recovery — 2026-10-14

The owner workspace now accepts a same-origin private voucher link or an explicit
camera scan using the browser's local BarcodeDetector. Unsupported cameras fall
back to paste. Checking is non-consuming. Reserving the voucher creates an
original lock request; confirming actual handover is a separate explicit action.
Only the backend voucher state H/S is rendered as used. Lost responses are recovered
from workbench.redemptionIntents and the original case; no automatic resubmission.
Private codes remain in memory and are removed from the URL, modal and camera on
close or account change. Recipient and merchant must use isolated browser profiles
so the recipient's credential session remains valid.

Migration 038 adds owner-scoped original intent recovery and server/snapshot times.
The real local database installation preserved runtime material and function
privileges. The served app/view/adapter/styles bytes and enabled wallet login were
verified. 97 frontend tests passed, followed by 9 verification tests including a
new case-switch regression. Fresh isolated PostgreSQL kitchen/claim checks passed;
these use synthetic chain-state fixtures, not a completed real redemption.

Settlement remains unresolved pending the user's implementation choice: the
existing escrow requires an owner transaction, has no delegated-settlement entry,
and does not enforce a 180-second delay. This release does not present automatic
settlement or a three-minute countdown as implemented. The user's real voucher
was not redeemed by development tools.

## Owner wallet settlement after 180 seconds — 2026-10-14

The user selected the existing-contract route. Migration 039 enforces a platform
180-second waiting period from the original finalized report receipt block time.
It checks verified original receipt evidence, voucher generation and report ID;
missing evidence blocks new settlement. Review, confirmation, wallet preparation
and admission enforce the deadline. Existing original attempts and transaction
hash reporting remain recoverable. The deployed escrow itself has no delay rule.

Payouts now shows authoritative receiver, amount, token, chain, original settlement
requests and a local display countdown based on server time. Review, confirmation
and wallet sending are separate explicit actions. Local calldata is rebuilt with
the existing prepareSettle codec and compared with backend preparation before
admission. A persistent attempt journal prevents repeated sending after uncertainty;
known hashes can be recorded again without another wallet transaction. Only a
FINAL_SUCCEEDED original intent and payout state S display settled. Explorer links
require the configured test chain and a valid hash. No automatic settlement occurs.

Independent validation: 108 frontend tests passed before the final countdown/link
change, then all 7 settlement UI tests passed. Fresh PostgreSQL settlement tests
passed 179/180-second boundaries, invalid receipt evidence, original retry, owner
isolation and nonprivileged API execution; kitchen/claim regressions also passed.
Migration installation preserved runtime material and existing function privileges.
These checks do not constitute a real owner-wallet handover and settlement test.

## Finalized lock rollback and collection timezone correction — 2026-10-14

The real lock request 549f366b-c924-4561-b8a3-3220bfb57ef6 reverted on chain.
The immutable contract uses UTC+8 service windows; the old backend incorrectly
used UTC. At the original transaction time (Beijing 01:28), the captured window
14:30–19:00 was closed. Stored windows and original transaction deadlines were
not changed. Migration 040 aligns redeemability, display expiry and timezone
metadata with the contract; live labels now state Beijing time (UTC+8).

Migration 041 only permits lock FINAL_REVERT after the worker verifies the exact
original transaction, canonical finalized status-zero receipt, absent successful
operation and unlocked original-generation voucher. The SQL projection also
requires a fresh consistent current R projection before releasing only that
intent's lock lease. Historical transaction/receipt evidence remains; old display
credentials remain invalid. No automatic re-lock or resend is introduced.

The UI now queries a case only after lock FINAL_SUCCEEDED. Confirmed failure is
shown separately from UNKNOWN and never opens a handover action. Independent
checks passed 48 relevant frontend tests, 17 observer/gateway tests and the fresh
PostgreSQL rollback/timezone suite. Actual installation preserved runtime material,
original records and function privileges; the explicit lease DELETE privilege
is the sole planned privilege addition. Source/config wallet pins were verified,
and served app/view bytes plus wallet login were checked after restart.
