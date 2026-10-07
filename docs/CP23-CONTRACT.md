# CP23 BUILD — private online voucher delivery

CP23 chooses **private link as the canonical online recipient credential; QR is only a short-lived in-person presentation credential**. This slice creates no chain transaction, loads no signer, and never changes CP22 evidence.

## Product flow

1. A Dynamic-authenticated partner with the existing explicit testnet scope generates one private link for the CP22 voucher.
2. The secret lives only in the URL fragment, so it is not sent in the initial HTTP request or Referer. The recipient page strips the fragment before exchanging it.
3. Recipient needs no account, email, wallet or Dynamic SDK. Explicit “查看餐券” exchanges the link for a bounded HttpOnly voucher session.
4. At the restaurant, the recipient explicitly creates a **2-minute QR + six-digit manual code**. A new display invalidates the previous one. The QR contains only an opaque random presentation token, never the long-lived link secret, voucher ID or recipientRef.

Opening a link means only that a bearer credential was presented. It does not prove the named person received or ate a meal.

## CP22 dependency

CP23 directly reuses IssuanceStore.load() so CP22's anchor, config hash and deterministic IDs are validated by CP22's own code. CP23 additionally requires current state ACCOUNTING_VERIFIED with F=R=0.001, A=H=S=0, liability/balance 0.001, and total funded 0.002 test MON.

Only immutable issuance identity is persisted in the CP23 binding: planHash, operation/voucher/batch IDs, partner label and private recipient label. CP22 observation/finality watermarks may advance and are not credential identity. Every CP23 use rereads CP22 and rechecks the verified accounting invariants.

## Private state and recovery

CP23 uses an isolated SQLite store plus external fsynced anchor. Database/anchor contain only hashes for invite/session/CSRF/display credentials. Missing or inconsistent evidence fails closed as RESTORE_QUARANTINE rather than recreating link eligibility.

- private-link lifetime: 72h
- recipient-session lifetime: 8h
- display lifetime: 2m
- before first open, an explicit partner rotate invalidates the old link and all sessions/displays
- after first open, silent rotation is forbidden
- reopening the same valid link is recovery: it atomically revokes the previous recipient session/display, so only one live bearer session exists
- display refresh and logout share the same credential lock; a confirmed logout cannot race with a display refresh that recreates an active code

## Partner authorization

Partner operations require current Dynamic partner session, existing CP20 testnet:ledger:read scope, and partnerId == CP22 partnerLabel. Authorization is rechecked immediately before creating/rotating a private link. A testnet scope denial does not by itself destroy an otherwise valid Dynamic identity session.

Routes:
- GET /api/v1/work/testnet-voucher
- POST /api/v1/work/testnet-voucher/invite with action create or rotate

The complete link is returned only by the create/rotate response and is never persisted in plaintext.

## Recipient routes

Base /api/v1/testnet-voucher:
- POST /exchange
- GET /session
- POST /display
- POST /logout (session CSRF required; server-confirmed revoke)

Recipient DTOs never contain recipientRef, qualification or delivery-channel data. No merchant lock/report/settle endpoint exists in CP23; consuming the active QR/code belongs to CP24 after separate design review.

## Current deployment boundary

The current product entry remains loopback 15207, matching the existing controlled Monad testnet environment. Moving the same bearer model to a public HTTPS origin and real messaging channel is a later deployment gate.

## Verification

- python3 -m unittest tests.test_testnet_voucher -v
- node --experimental-strip-types --test tests/testnet-voucher/voucher.test.ts

Full Dynamic/backend/browser regression and npm run build:dynamic are required before merge. Unit success does not claim public deployment, real recipient identity, restaurant redemption, or meal delivery.
