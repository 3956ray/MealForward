# CP30-C1 active integration status

2026-10-12. WIP / NOT COMPLETE / NOT ACCEPTED. No fixed local commit exists.
Baseline `3cb717ec6fca60b80106783631a1e22b8abaff18`; final freeze
`b402bcbc50c353dde6abd0917725e5fe7dd5a0c861e956ce0dd6f427eec25802`.
The user-approved temporary Developer exception is Astra/medium. The three
historical capacity failures remain failures, not test evidence.

These are intermediate author results. Subsequent integration changes require
final-candidate reruns; none substitutes for the complete frozen matrices.

| Evidence | Actual intermediate result |
| --- | --- |
| `evidence/smoke-e69e53867745.json` | New private meal save/image/review/publish/list, funding actor, issue, recovery/display/check/lock/manual marker, private report, owner settlement, original-payer refund, three-store continuous watermark; seven real app processes, PG, HTTPS, owned teardown |
| `evidence/smoke-8af311d6e618.json` | C06 20 cross-store same-email barriers and C07 last-unit 20 barriers; one reservation and one final issue per case |
| `evidence/smoke-4130dabe1669.json` | Four C09 races, 20 each; each direction 10/10, observed overlapping HTTPS requests; original issue/expiry and financial totals unchanged |
| `evidence/smoke-7ed952516d7e.json` | Fresh Chrome incognito context with this run's exact certificate SPKI; Secure/HttpOnly/SameSite, reauthentication rotation, old token/CSRF denial, logout denial; browser and app/PG teardown |
| `evidence/smoke-467cc126a450.json` | 13 actual runtime roles, 126 SQL permission denials; non-superuser/non-owner flags and teardown |
| `evidence/smoke-0d1f57ff9705.json` | Eight C11 fault categories, three fresh cases each (plus both domain/outbox rollback positions); six genuine UNKNOWN cases retaining reservations after time advance; actual API/worker/source/observer restarts and owned PostgreSQL immediate crash/restart; teardown passed. Controlled backup restore and R2 remain outstanding |
| `evidence/smoke-a4882779c599.json` | Full matching-content lifecycle plus missing/corrupt body/image: 16 HTTPS risk denials preserving old voucher/financial state, and four already-source-final publications whose damaged original bytes prevent public-head apply; teardown passed |
| `evidence/smoke-e0a01c50d4d4.json` | C04 Save 20 and Publish 20 actual two-API overlapping-request CAS races; exactly one success and one controlled conflict each, no pending public head, one final version; teardown passed |
| `evidence/smoke-daf060403dc7.json` | Eleven unapplied original successes (issue/publish/handover/settle) after logout/email/grant revocation, 259201-second delay and two observer restarts; original t0/expiry retained, no fresh expired access, lawful report continuation; service/source rollback and skew 2/3 boundaries; teardown passed |
| `evidence/smoke-1cd0d3e51af3.json` | Full R2 primary runner: five required classes three each, plus three successful original rebuilds; nine controlled archive loads preserve journal, invalidate old sessions, audit restored content, and quarantine missing original proofs. Stale original finish/abort producers preserve a newer pending operation and retained floors. Supplementary damaged/missing journal and old-grant branches remain pending |
| `evidence/smoke-d3437e66ef5a.json` | Actual HTTPS/PG pagination over 55 final publications: 56 meals at 1/2/20/50, 55 ledger rows at 20/50, three stores at 1/2; default 20, max 50, 51 denial, tamper/scope/principal/expiry and changed-watermark rejection. This is partial C13, not audit/BOLA/all-list completion |
| Unit checks | 36 canonical-email vectors plus HMAC framing; 36 journal/controller tests, 21 model/observer/worker tests, six ownership tests passed in targeted runs |

Failure evidence is retained. Earlier smoke runs exposed SQL ambiguity, function
ownership, digest representation and execution-floor merging defects. The first
C09 run had 16/4 ordering coverage and failed. A later run exposed unstaged lease
retry behavior and failed; the subsequent 80-case run passed. The first browser
attempt failed because the bundled Chromium binary was absent; the installed
Chrome binary was then used with fresh owned browser state. An installer report
comparison initially mishandled package-name case; this was corrected without
altering wheel pins. The initial historical installation lacking configuration
isolation proof remains excluded from clean-install evidence.

Crash runs `338fd7e14dec` and `d132c20810d8` failed before completion. Fault
barriers now terminate the owned process before disarming, and synthetic time
advances through restart lease retries. Run `a94bab8cab85` then exposed a real
worker defect: completed socket timeouts were confused with pending Future wait
timeouts, renewing a failed request indefinitely. The worker now records UNKNOWN
without further heartbeat; a focused regression and the full fault runner passed.
Those failed runs are retained and stopped, not reused or relabeled as successes.

Original-content verification now reads actual persisted material, computes exact
MealBodyV1/PNG/terms commitments in one bounded helper outside transactions, and
CAS-binds the proof to its MVCC row. Byte changes invalidate the witness. The first
integration run `b7944c344c3c` failed on an ambiguous SQL alias and is retained;
the corrected positive/negative run passed. Service-clock monotonicity and source
execution chronology are now separate validator floors; a new pure regression
accepts an unapplied original after 72h without changing t0/expiry. Actual delayed
fact/revocation/restart run passed after an earlier test incorrectly required 403
where the privacy boundary deliberately returned 404 (`93bf3238a4af`, retained).

Controlled restore primary scenarios have passed; supplementary cases remain: the retained
journal now has a separate restore barrier that cannot discard an unresolved
original mutation. The owned restore helper binds backup digests before loading,
invalidates restored credentials above retained epochs, and never restores the
journal. Completion requires all retained original security/execution proofs,
private floors, and matching original history. Missing anchors remain quarantined.

Still required: complete C01–C14 and R1 branches, C04 complete image matrix and
physical decoder limits, remaining C05/C07/C08/C09/C10 cases, remaining C11 restore
and unavailable branches, all R2 controlled restore/floor/epoch classes, complete
C12 poison/replay/rebuild, C13 every-route privacy/pagination and role matrix,
read-only S0b export regression, final source/dependency/role/result manifests,
all-owned-resource audit, child-only clean local commit and C1-DELIVERY. Then stop
writing for independent fixed-SHA Technical review and Leader Gate.

Runtime secrets and synthetic database state stay in private owned cache runs.
Existing initialized scenarios are retained; tools never reset a sealed run.
`tools/setup-runtime.py` makes a fresh run and hash-checks five public wheels.
`tools/local-run.py start RUN` initializes only an unsealed owned run. Each of
`smoke.py`, `race-matrix.py`, `credential-races.py`, `browser-check.py`,
`role-check.py`, and `crash-matrix.py` takes an INITIALIZED fresh run, seals it
before fixtures and tears down its owned applications and PG in `finally`.
These runners are development evidence, not an aggregate acceptance command.

Restore run `d6dbb9315d30` remains FAIL: after the restore and cancellation cases, the evidence writer indexed the process list incorrectly. Fresh complete rerun `1cd0d3e51af3` passed after correction. Both runs stopped owned resources. Independent database acknowledgments now retain the sole-writer journal tip so an older valid journal prefix cannot silently reopen risk writes. Actual damaged/missing/older journal restart probes remain to run.
