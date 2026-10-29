# Wallet-first product login

User approved visible homepage/header wallet login first, then role-based business operations. Keep Three Stores green/ivory frontend, same Render origin/backend/session/contract/USDC. Recipient private link remains wallet-free. No agent wallet actions.

## Reuse
2026-10-29 GitHub API: wevm/wagmi6764starsMIT, wevm/viem3629stars, spruceid/siwe1124starsApache2.0. Existing locked wagmi/viem and verified SIWE backend reused; consult official Wagmi connection guide https://wagmi.sh/react/guides/connect-wallet and SIWE flow. Do not add a competing identity provider or upgrade dependencies just for a login button.

## Implementation
- Header prominent wallet login visible on desktop/mobile, homepage CTA login before business; clicking opens clear login panel with provider selection, connect/sign explanation, progress/error, no auto-sign on mount. If no wallet extension explain. Connected is not authenticated until server verification.
- One authoritative login/session lifecycle for whole product: preserve authenticated wallet across home/role/records navigation, no duplicate simultaneous /me rotating CSRF. Current verified account + role + logout in header. Select role from server session, not untrusted route or address alone. Route into owner/donor/issuer work after successful login. Owner can enter records/create. Other roles cannot obtain actions by route modification; direct business links show login gate first.
- Provider account/network/disconnect immediately invalidates previous identity and clears stale operations/checks/inputs; require explicit login before new actions. Rejected signatures/errors recoverable, no automatic repeated prompts. Authenticated cookie alone may identify session but must not authorize send without current wallet match. Late session/status responses cannot restore old account.
- Retain explicit transaction preparation/send once/original hash recovery and scope isolation. Avoid controller unmount that makes immediately successful login unusable. Existing test pages behavior retained. No backend/DB changes unless concrete unavoidable issue; notify parent.

## Verify and release
Focused tests: anonymous header/home login entry, one login handshake, role routing, no business calls/actions before auth, session maintained across home/records/work, logout/account/network change invalidation, rejection and retry, stale request safety, existing business2 and recovery tests, recipient no wallet bundle. Desktop/mobile CUA check. Independent code review. Locked build and existing CI; deploy Render only after PASS, public16asset/config smoke, first settled record unchanged. Update HANDOFF and acceptance instructions. User first tests login then same second-voucher acceptance, no new contract/token.
