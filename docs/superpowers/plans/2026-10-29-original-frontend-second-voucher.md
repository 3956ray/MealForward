# Original frontend and sequential voucher implementation

Goal: reuse original product styling and verified MVP wallet flow for one second voucher, same escrow and existing USDC, preserving first settled business.

Approved scope: one active business, Owner creates next and signs quote; fixed roles, single meal 7 USDC, Monad10143, existing escrow lifecycle cap10. No contract edits, token deployment, old record reset, bulk/multi-store or mainnet. Human signs and sends every chain transaction.

## Tasks and owners
- [ ] Backend: scoped businesses, additive migration, fixed legacy first-business routes, scoped credentials, one active business and globally exclusive pending wallet nonce. Owner business_backend.
- [ ] Chain: dynamic candidate with batch ownership, completed-count accounting and two-business local verification. Owner business_chain.
- [ ] Frontend: original layout/styles reused with verified client controller; same-origin product entry, role pages and wallet-free recipient, clear inline send section and stable silent polling. Owner original_frontend.
- [ ] Integration: runtime static allowlist, build/live smoke, migration validation, independent review, CI, deploy, handoff. Owner root.

## Interface rulings
Business ids are decimal strings, first id=1. /v1/mvp/businesses list/create; /v1/mvp/businesses/:id/* mirrors business routes. Authentication retains existing secure namespace. Old unscoped API always first business; operations remain original immutable IDs and must validate business membership. Recipient identity/credential binds business. No URL query parameters; product uses fragment routing. Current first state fingerprint 408e76f0c970880598786deeb7bfb39c, revision10, SETTLED.

## Evidence required
Local sequential two-business cycle; role/code isolation, send-once/unknown recovery and180s safety, immutable first record; static/browser action visibility; focused CI and public read/denial smoke. Independent review before publication. Production migration preserves originals, runtime role privileges and RLS. New business is NOT created by agent on public service; user does Owner create/quote then approval/funding/issue/redeem/settle. Record version, first-record fingerprint, migration, deploy and pending human test in HANDOFF.

## Reuse
Already pinned TanStack Query, Viem, jsQR, qrcode.react. No framework upgrade. Original src/App.tsx and styles.css are visual source; old simulation/auth/data logic is not connected to real money routes.
