# Explicit formal approval activation

Continuation of the approved Phase6 and Wallet V2 designs. On2026-10-27 the user explicitly removed domain classification as a project blocker and requested continued development. This overrides the prior operational domain hold; it does not claim the classification changed. External review remains unsent.

## Scope and sequence

1. Enable the existing production bootstrap signing capability. Keep the controller default fail-closed and all explicit-click, selected-provider, fixed-role, chain10143, canonical manifest, digest, freshness, expiry and in-flight safeguards. No backend/schema changes or release/transaction capabilities.
2. Test the production-default bootstrap without overriding signingEnabled: a valid synthetic round can sign only after an explicit click; NO_ROUND never can. Observe the positive case fail before activation, then pass. Run all client tests, typecheck and reproducible build.
3. Independent review of the complete change; push existing PR47 branch, verify exact-commit CI, then deploy the existing autoDeploy-off collector using the Render deployment workflow.
4. Verify actual deployed commit, six asset hashes and33 public NO_ROUND checks. Read-only verify original data and successor counters unchanged. Update HANDOFF and the runbook.
5. Stop for a fresh human Issuer activity report and readiness. Only after that report, use the existing operator checks to create a300-second round; age limit120seconds must not be bypassed. The users personally perform Owner/Donor typed-data approval.

## Review focus

No automatic signature after load/inspect/refresh; no no-round bypass; no relaxation of account/chain/digest/expiry validation; generated artifacts match source; documentation must distinguish enabling capability from a live formal round or successful signature. The domain decision is user authorization, not an assertion of safety. Original ISSUE_UNKNOWN and015 HUMAN_REVIEW_HOLD stay intact.

## Progress

- Implementation: production bootstrap default enabled; controller default and backend unchanged. Default-bootstrap valid-round test observed RED before activation and GREEN after.60/60 client tests, typecheck and six-asset reproducible build PASS.
- Independent review: pending.
- CI/deploy/public verification: pending.
- Real formal signatures: NOT_RUN.
