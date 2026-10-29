# Wallet client replacement — discovery, not an approved design

Status: research and isolated diagnostic reproduction complete; the user selected scope A on2026-10-26 and requested development. The detailed design is in `specs/2026-10-26-wallet-client-v2-design.md`; its review/approval is recorded there and in HANDOFF. No replacement product code, dependencies, database changes or deployments in this phase.

## User intent and constraints

The user reports correct MetaMask extension accounts on Monad Testnet, prior successful connection tests, and no apparent activity in the page's Network panel. Treat application initialization, event handling and state transitions as the investigation target. Do not attribute this symptom to the independent domain warning. They authorize fresh agents and either a new implementation without copying Phase6 or reuse of an existing GitHub solution.

Preserve all real business/audit history and the original ISSUE_UNKNOWN. Formal signatures remain paused, NO RELEASE; the user's refusal to submit a MetaMask review remains in force. Replacing a client is not authorization to erase records, create a round or send transactions.

## Fresh agent work

| Agent | Scope | Result |
| --- | --- | --- |
| wallet_v2_diagnosis | Existing frontend read-only investigation and isolated bootstrap reproduction | Application can leave all connection controls inert before/while initialization completes |
| wallet_v2_reuse_research | Official GitHub/docs comparison | Wagmi Core + injected/EIP-6963 + viem fits extension-only use without React or WalletConnect projectId |
| wallet_v2_clean_design | Independent requirements-led proposal | Separate wallet, backend, round and approval state; replace client boundary while retaining durable data |

The independent designer read only HANDOFF/AGENTS and supplied requirements, not existing Phase6 application source. A future implementer should receive the approved design and API/security contract, not the old frontend as a template. Implementation and independent acceptance/review are subsequent roles, not extra concurrent writers now.

## Source-backed findings and reproduction

The actual `t1-intents/public/t1f-approval.mjs` was executed in Node vm.SourceTextModule with a minimal DOM containing the actual HTML IDs, controlled dynamic import and fetch. No actual wallet, HTTP, database or browser was used; no product files were edited.

| Injected condition | Observed actual-module behavior |
| --- | --- |
| Signing dependency import never resolves | Zero refresh/Owner/Donor click handlers, connection and sign buttons remain disabled, zero fetches, initial status persists |
| Signing dependency import rejects | Zero handlers, buttons remain disabled, generic page-not-ready message, zero fetches |
| Dependency resolves but initial session fetch remains pending | Handlers exist, one session fetch, global busy disables refresh and both connection buttons |

These are reproducible application failure modes, not a determination of which occurred in the user's Chrome session. The initial diagnostic harness omitted an HTML ID; the table reports the corrected full-ID harness only.

Other findings: wallet provider is captured once at startup; provider requests have no deadline; connection calls use extension provider RPC rather than page fetch. A handled connect click should immediately change status even when no HTTP request occurs. Empty page Network alone cannot discriminate disabled/unbound handler, extension request, or wrong expected action. Existing unit tests import without document (skipping bootstrap), and public smoke fetches assets rather than executing startup; neither verifies affected-session initialization.

## Reusable candidates

| Candidate | Fit | Tradeoff |
| --- | --- | --- |
| Wagmi Core + connectors + viem | Recommended new vanilla TypeScript client; connection lifecycle/discovery plus typed signing | Still needs application-specific role, round, freshness and persistence validation |
| viem plus discovery alone | Smallest dependency surface | More connection lifecycle/state/error handling remains custom |
| RainbowKit | Useful for a broad React wallet-picker experience | React/wagmi/query integration and default WalletConnect setup exceed current extension-only needs |
| Reown AppKit | Broad wallet/mobile onboarding and adapters | Project configuration and larger feature surface; Community License requires review, not assumed MIT |
| MetaMask Connect | Useful when cross-device MetaMask connectivity is required | Current user needs an already-installed browser extension; added cross-device facilities are not the current problem |

Official sources checked 2026-10-26:

- [Wagmi repository / MIT](https://github.com/wevm/wagmi), [Core installation](https://wagmi.sh/core/getting-started), [injected connector](https://wagmi.sh/core/api/connectors/injected), [createConfig](https://wagmi.sh/core/api/createConfig), [typed signing](https://wagmi.sh/core/api/actions/signTypedData).
- [Viem repository / MIT](https://github.com/wevm/viem), [wallet client](https://viem.sh/docs/clients/wallet), [typed signing](https://viem.sh/docs/actions/wallet/signTypedData). Existing t1-intents dependency is viem2.57.1. Research candidate versions were Core3.6.7/connectors8.2.2; these are not installed/compatibility-tested or final dependency pins.
- [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) and [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963).
- [RainbowKit repository](https://github.com/rainbow-me/rainbowkit), [installation](https://rainbowkit.com/en-US/docs/installation).
- [AppKit repository](https://github.com/reown-com/appkit), [JavaScript installation](https://docs.reown.com/appkit/javascript/core/installation), [license](https://github.com/reown-com/appkit/blob/main/LICENSE.md).
- [MetaMask provider API](https://github.com/MetaMask/metamask-docs/blob/main/metamask-connect/evm/reference/provider-api.md).

Injected-only Wagmi does not require a WalletConnect projectId. Core is framework-independent. Its chain configuration still needs an explicit transport, and wallet-reported chain must be verified independently. Do not infer the selected account/chain from desired configuration or saved connection state. A toolkit cannot resolve the separate domain classification or supply MealForward's business approval protocol.

## Approaches presented; A subsequently selected

**A (recommended):** Entirely new client UI and wallet integration using Wagmi Core + viem, consuming the existing same-origin backend contract. Preserve data and service security. No copying the old frontend state machine or bootstrap. Diagnose backend separately if contract tests uncover a defect.

**B:** Entirely new client and backend in parallel, old records retained read-only. Larger implementation, security and migration scope; current reproduction does not show a backend defect requiring this scope.

The user selected A. Under [Superpowers brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md), next produce the selected design, independent builder review and human design approval, then writing-plans. Existing broad authorization covers the research and agents; the selected scope is approved; do not represent the subsequent detailed document as human-reviewed until it is.

## Proposed acceptance criteria for the eventual design

1. Page shell and wallet controls initialize independently of signing dependencies and backend availability. Dependency/startup failures have visible, actionable states.
2. Read already-authorized current account/chain before asking for new permission; only explicit user actions can open a permission or signature prompt.
3. Show wallet, backend, round and durable approval as four independent facts. Backend timeout cannot erase wallet success or disable read-only wallet inspection.
4. Discover/select providers using standard mechanisms. Verify fixed role and actual chain10143; switching account/chain/provider invalidates the old signing context.
5. Every action immediately reports progress. Unresolved wallet requests show an outstanding state; timeout does not pretend cancellation or allow automatic duplicate prompts. Late results cannot overwrite a newer context.
6. NO_ROUND and expiry explain exactly why signing is unavailable. No page operation creates or renews a round.
7. Full EIP712 content is reviewable. Only explicit signing of a current validated manifest is permitted; preserve account/chain/round/freshness checks before and after the prompt.
8. Signature return, server submission and durable confirmation are separate states. An ambiguous submit is reconciled by readback, not automatic re-signing.
9. Diagnostics contain phase, timing and safe codes only; never raw signatures, session/CSRF, secrets or wallet activity. No transaction/release/round-creation methods.
10. Test actual DOM bootstrap, delayed/failed dependency, late provider discovery, stalled backend/provider, wrong chain, role changes, expired/replaced round and lost submit response. Record unit, browser synthetic, HTTP and human evidence separately.

