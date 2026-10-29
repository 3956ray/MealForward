# Wallet modal UX verification

## Scope and references
User approved desktop extension selection modal, deduplication, passive session recovery and clearer signing steps. No mobile QR, contract changes, new tokens or automatic transaction actions.

References checked 2026-10-29: [thirdweb ConnectButton](https://portal.thirdweb.com/references/typescript/v5/ConnectButtonProps), [RainbowKit](https://github.com/rainbow-me/rainbowkit) 2,835 stars MIT; [thirdweb JS](https://github.com/thirdweb-dev/js) 640 stars Apache-2.0. Reuse existing locked Wagmi/Viem; use modal interaction patterns without copying vendor code or replacing verified auth/transaction ownership.

## Preflight
Baseline 441dd23; Render dep-dbhc9m2fngtc73b8vglg, deployment d5a8a1b, build352203334c9e32785dc0. Both businesses SETTLED: business1 revision10 fingerprint408e76f0c970880598786deeb7bfb39c; business2 revision9 fingerprint517254d2bdad4ef3dffc14ab23806c39. No third business created.

## Pending
Candidate07dc5bc, buildf223eb7a67f5a243c84b:35client+5runtimePASS. Local desktop and390px modal visible, no-extension state truthful; Escape closes and returns focus to login button. Screenshots /tmp/mealforward-wallet-modal-evidence/desktop.jpg and mobile.jpg. No real extension in preview. Independent review, exact CI, deployment/public verification and human extension acceptance pending.

## Reviewed candidate

Final source 1a339cd30950781d6ee688832a36db9e5abf4bcf; build b749401674bede156e3d, 36client+5runtime PASS. Independent review approved after fixing standalone setup/merchant late-discovery callback; dedicated test preserves existing identity and single /me. Same-UUID replacement and unknown selection independently checked. Public release and human testing pending.

## Live release

Deployment a7f4c84dfa02aacd458dcd19cca0abddb8671aaa / Render dep-dbhlh4mc6qcc73fo4nog live2026-10-29 22:31:38 Asia/Shanghai, buildb749401674bede156e3d. ExactCI [MVP](https://github.com/3956ray/MealForward/actions/runs/40891996525) and [compatibility](https://github.com/3956ray/MealForward/actions/runs/40891996601) PASS. Public smoke16assets exact/chain10143/existingUSDC/denialchecks/legacyissuedPASS. Bothsettledbusiness fingerprints unchanged frompreflight. No wallet or businesswrites. Humanextensionacceptance pending; local browserhadnoextension. This supersedes pending statuses above.
