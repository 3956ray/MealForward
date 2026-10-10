# CP29-UI03 B2 design QA

Date: 2026-10-11 Asia/Shanghai. Developer visual QA, pending independent acceptance.

## Findings and history

- **Round 1 — blocked, P1 mobile owner density / P2 voucher density.** The mobile owner header, facts and verification disclosure pushed the handoff action below the first 390×844 viewport; initial recipient copy added an unnecessary no-code paragraph. Desktop owner facts were laid out below the photo and omitted the visible processing progression. Evidence: `evidence/compare-owner-mobile-1.png`, `compare-recipient-mobile-1.png`, `compare-owner-desktop-1.png`, `compare-owner-desktop-focus-1.png`.
- **Round 2 — blocked, P2 owner secondary region.** Smaller photo/fact spacing, shorter header copy and explicit desktop progress made the handoff button visible, but the collapsed verification control still displaced the mobile settlement amounts. Evidence: `evidence/compare-owner-mobile-2.png`, `compare-owner-desktop-2.png`. This round also changed mobile owner captures to viewport screenshots after reload: the earlier full-page capture after viewport resize contained a duplicated capture region and was not accepted as final render evidence.
- **Round 3 — passed.** Verification moved after the main workbench regions; compact owner facts retain full text, desktop status shares the task header, and the desktop photo aligns beside original facts. The mobile handoff button and settlement amounts now fit the initial viewport. The browser assertion checks the handoff button's actual bottom coordinate is ≤844. Final evidence: `evidence/compare-owner-mobile-3.png`, `compare-owner-desktop-3.png`, `compare-owner-desktop-focus-3.png`, `compare-recipient-mobile-3.png`, `compare-supporter-3.png`, `compare-supporter-focus-3.png`.

No actionable P0/P1/P2 visual findings remain in this Developer comparison. Review findings about model recovery and UNKNOWN submission were subsequently reproduced and fixed with separate state/browser regression tests; the reset confirmation uses an accessible HTML dialog.

## Matched comparisons

Source visual root: `/Users/mili/Documents/Leader/projects/monad-consumer-payments/design`.

| Source visual truth | Final implementation capture | Source pixels → CSS comparison | State |
| --- | --- | --- | --- |
| `cp29-ui02/SUPPORTER-DESKTOP-B2.png` | `evidence/supporter-1440.png` | 1487×1058 → 1440×1024 | Meadow supported8, Lunch6/Dinner2, one Lunch cart, NFT selected, disconnected payer |
| `cp29-ui01/OPTION-B2-WARM-COUNTER.png` | `evidence/owner-1440.png` | 1487×1058 → 1440×1024 | Meadow owner, original voucher1 locked, awaiting handoff; F24=A9+R6+H6+S3 |
| `cp29-ui02/OWNER-MOBILE-B2.png` | `evidence/owner-390.png` | 853×1844 → 390×844 | Same owner/voucher/accounting fixture, single column |
| `cp29-ui02/RECIPIENT-MOBILE-B2.png` | `evidence/recipient-390.png` | 853×1844 → 390×844 | Distinct original voucher2, active, original email verified, no display code |

Chrome captures use deviceScaleFactor1 and the specified CSS viewport. Desktop supporter capture is full-page; only the first 1440×1024 region is compared. Owner and recipient final captures are exact viewport images. `tests/compare-design.py` normalizes raster density, adds source/render labels, and writes both images into the same comparison input. Both halves were actually inspected together. Desktop focused pairs make the meal assets, facts, controls and typography readable; mobile full pairs are already readable at native 390px width.

## Five fidelity surfaces

1. **Fonts/typography:** Georgia wordmark and system sans UI; desktop h1 28/36, mobile24/30, body16/24, secondary14/20, zero letter spacing and tabular numerals. Raster source fonts/sizes are approximate; `TOKENS-B2.md` explicitly takes precedence over generated pixel lettering. No vw/clamp font scaling or small-caption reduction. Longer names and 1,000 test USDC reflow at320; enlarged text remains scrollable.
2. **Spacing/layout:** 212px owner sidebar, primary work area plus settlement/menu rail, public meal list plus352px cart, 16px mobile gutters; flat surfaces, no nested card grid or hero. Mobile owner places current facts/action before settlement, with totals/history through separate disclosures/routes. Source history rows are visually denser; implemented controls preserve practical hit targets and may continue below the viewport.
3. **Colors/tokens:** flat #F7F4EE paper, #FFFEFA surfaces, #A3382D actions, frozen divider/control borders and independent green/info/error states. Source gradients and generated letter colors are intentionally replaced by the frozen flat tokens. UNKNOWN is labeled Needs verification, never a green success.
4. **Image quality:** independently generated chicken/tofu photos match the warm wooden-table bowl subject/art direction, remain sharp at reserved crop sizes, and have no stretched screenshot artifacts. Exact food arrangement differs intentionally. Lucide icons and real demo QR library output are used; the source image is never embedded as the application.
5. **Copy/content:** exact original meal/price/version/window/expiry, distinct recipient and locked owner vouchers, explicit synthetic owner/wallet/results. No-code copy is omitted for a new unused display state but expiry/error reasons remain. The redundant source Back to workbench action on the workbench itself is omitted. Demo controls and the verification disclosure extend the mock outside the primary frozen composition.

## Interaction / accessibility evidence

`evidence/browser-results.json`: desktop1440 and mobile390 full flow, original UNKNOWN recovery, report/settle reloads, quota/code/expiry, menu drafts/version/unlist/pause, refunds, source error, saved-state corruption, confirmation cancellation/Escape, keyboard focus/skip link, reduced motion; 320/390/768/1024/1440/1600 reflow. All observed requests are local and the suite reports no console/page errors.

`text-200-percent-390.png` records a CSS text enlargement stress test; it is not a claim of OS font scaling or every browser's zoom behavior. Touch controls can grow with wrapped text. Native screen reader testing is NOT_RUN. No real wallets, identities, OTP or chain behavior is represented by these screenshots.

## Open questions / follow-up polish

P3: the recipient footer and some owner secondary links require scrolling with the frozen readable CSS font sizes. Exact typography/gradient pixels in the generated images are not a CSS contract. Independent design and real user preference review remain pending; this is a developer comparison, not whole-app accessibility certification.

## Implementation checklist

- Completed: matched source/render comparison, focused typography/assets check, visible mobile handoff and amounts, original facts, flat tokens and correct semantic states.
- Completed: build, state tests, isolated browser flows and network/console evidence.
- Pending outside Developer scope: fixed-SHA independent review and Leader acceptance.

final result: passed
