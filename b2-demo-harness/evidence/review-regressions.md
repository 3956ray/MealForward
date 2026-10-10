# Independent WIP findings: reproduction and fix

Date: 2026-10-11 Asia/Shanghai. Source report: Leader project `research/cp29/ui03/review/INDEPENDENT-REVIEW.md`.

The three final tests were first added while the model still had the reported defects. Actual `npm test` result: **31 tests, 28 pass, 3 fail**. Each failure was `AssertionError: Missing expected exception`:

| Regression | Before | After |
| --- | --- | --- |
| Second review created before another UNKNOWN fund cannot submit | Expected original-payment exception missing | Submission checks other open funds for the same payer; safe original final allows the second later |
| Restored lock status `UNKNOWN` outside the enum cannot reopen | Expected invalid-operation-status exception missing | Restoration rejects the malformed status |
| Missing original email cooldown / original operation reference / duplicate ID | Expected cooldown exception missing (first case) | All three damaged snapshots reject |

Actual post-fix `npm test`: **31 tests, 31 pass, 0 fail/skip**. Additional browser regression proves the pre-existing review stays blocked and three corrupted snapshot variants remain on the storage attention screen, survive reload unchanged, and expose no payment submission button. Final browser result is in `browser-results.json`.

This is a mock consistency repair, not proof that editable local storage authenticates real users or protects real funds. Independent fixed-SHA re-review is pending.
