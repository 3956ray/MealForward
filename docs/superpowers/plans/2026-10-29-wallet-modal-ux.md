# Browser wallet modal and signing UX

Approved scope: desktop browser extensions, no mobile QR connector or wallet migration. Existing single merchant testnet MVP has two settled businesses. Keep backend, contracts, token, roles, recipient wallet-free flow and explicit send-once recovery.

1. Implement one accessible modal with discovered wallet cards, provider-object dedup, truthful installed names, generic safe icons. Separate discovery updates from identity changes. Preserve Three Stores visual design. Reference thirdweb ConnectButton and RainbowKit patterns without copying code or adding incompatible SDK dependencies; use locked Wagmi/Viem.
2. Restore only a valid server session matched to current passive provider account/network, remembering provider metadata only. No automatic permission/sign/send. Avoid concurrent /me CSRF rotation. Logout and account/network changes cancel restoration; late callbacks never restore stale identity. Support bounded late discovery. Keep all auth actions serialized.
3. Show connection/signature/server verification stages, retry and no-wallet states; login signature explanation, actual quote summary and expiry; current-workspace feedback. Do not change transaction counts or approvals, do not introduce unlimited allowance or smart wallets.
4. Focused tests for discovery/dedup/late events, restore match/mismatch/expired/missing provider, explicit logout, races, modal keyboard/focus/close, retry, plus existing recovery tests. Independent review, exact CI, read-only public checks and database fingerprints before/after release. Update HANDOFF and minimal user test instructions.

Human acceptance: open modal, choose installed MetaMask, explicit login, refresh passive restoration, switch account invalidation, reject/retry login. Do not require a third full meal flow or create business 3 automatically.
