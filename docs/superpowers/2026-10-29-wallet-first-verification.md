# Wallet-first login verification

## Requirement and reuse

The user approved a prominent homepage and header wallet login before role operations. Recipient private links remain wallet-free.

Reuse the locked Wagmi/Viem adapter and the verified SIWE backend, without upgrading dependencies or adding a competing authentication path. GitHub API counts checked on 2026-10-29:

- [Wagmi](https://github.com/wevm/wagmi): 6,764 stars; MIT.
- [Viem](https://github.com/wevm/viem): 3,629 stars; existing locked dependency.
- [SIWE](https://github.com/spruceid/siwe): 1,124 stars; repository lists Apache-2.0/MIT.

References: [Wagmi connection guide](https://wagmi.sh/react/guides/connect-wallet) and [SIWE](https://github.com/spruceid/siwe). Stars are a selection filter, not a security guarantee. Existing challenge validation and server role assignment remain authoritative.

## Preflight evidence

- GitHub HEAD: `a5783a1fa9c2855479fac9a4a2f97bfaa9491121`.
- Render live deployment: `dep-dbhb44afngtc73b5lst0`; commit `d5d4b233f9c5e5dedf0a977f7bcb73089197528f`.
- Database: only business 1, `SETTLED`, revision 10; state fingerprint `408e76f0c970880598786deeb7bfb39c`.
- Business 2 has not been created.

## Implementation boundary

Persistent product authentication owns one wallet adapter and one login lifecycle. Each business screen receives the verified identity and keeps its own scoped operations. The backend, chain, contracts, token and existing records remain unchanged.

## Candidate verification

- Implementation: `0f611f5`; review fixes: `fb4c949` and `78345f223cc594b6e236a5043cec2c45733f785d`.
- Build: `352203334c9e32785dc0`; client tests 27/27 and runtime tests 5/5 PASS. Generated assets are clean.
- Independent review found two P2 issues: the externally owned wallet path skipped the business clock, and a delayed logout could erase a newer login cookie. Fixes move the clock to an independent effect and serialize authentication actions through logout completion, including wallet changes. Focused regression tests cover both.
- Desktop and 390px browser inspection: header/home login is visible; direct anonymous business navigation presents login and no transaction controls; unavailable extension is explained. This is a synthetic anonymous preview, not evidence of real-wallet login. Screenshots: `/tmp/mealforward-wallet-first-evidence/home.jpg` and `login-mobile.jpg`.

## Release results

Independent re-review approved `78345f223cc594b6e236a5043cec2c45733f785d`, independently running 27 client and 5 runtime tests. Header Exit is visibly disabled during authentication, instead of silently ignoring a click. Exact deployment commit `d5a8a1bd37f8627c3fb008b76e119c41798c0646` passed both CI suites:

- [Isolated MVP business flow](https://github.com/3956ray/MealForward/actions/runs/40815158516): PASS, including fresh PostgreSQL/Anvil two-business flow.
- [Recovery compatibility](https://github.com/3956ray/MealForward/actions/runs/40815158562): PASS.

Deployment `dep-dbhc9m2fngtc73b8vglg` is live at 2026-10-29 12:01:30 Asia/Shanghai against that exact commit. Public read/denial smoke PASS: all 16 assets match, Monad Testnet 10143, existing USDC, writes enabled, legacy issued operation preserved. No wallet actions. Database business 1 remains SETTLED/revision 10 with unchanged fingerprint `408e76f0c970880598786deeb7bfb39c`; no business 2.

Public browser navigation timed out in the in-app browser. Local desktop/mobile preview and public HTTP verification are recorded separately; real MetaMask login is still for the user to verify. Human wallet acceptance has not been performed.
