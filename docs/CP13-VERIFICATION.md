# CP13 integrated verification (independent wallet review / Leader Gate pending)

2026-09-30. C0 `d1a7b4a`; core `21d1953`; wallet original `1fd3e25` was
cherry-picked alone as integration code commit `0fcaeec8666dd76d5d22c96ba2228c7cfc1ff111`.
Final delivery commit adds this verification record/README only; executable source equals that integration SHA.
Local Anvil31337 only; no existing user wallet, real network, cloud, push or public
release. Existing CP11 app and DB untouched. No persistent backend/auth/outbox/full UI.

## Reproducible core checks

- `npm ci`: pinned Forge/Anvil1.7.1, viem2.57.1, OpenZeppelin5.6.1.
- `npm run chain:test`: Solidity0.8.28, Cancun; **13 tests PASS**, including 256 fuzz
  cases of partial issue/report/settlement conservation. Covers two-batch isolation
  (including independent settlement and cross-batch duplicate voucher rejection),
  payer+intent namespace, funding cap/value/rule, atomic issuance/replay/conflict,
  unique locks, independent/revoked roles, pause with old-lock report, payment failure
  full rollback, authorized malicious merchant reentry, forced extra balance and
  nonlocal deployment rejection.
- `node scripts/check-abi.mjs`: shared ABI entries match compiled contract types,
  mutability and indexed event fields. Inherited OZ entries need not be duplicated
  by the wallet ABI. Constructor verified by deployment.
- `npm run chain:e2e`: **PASS**, actually starts an owned Anvil on18546, sends mined
  transactions and tears down only that child. Refuses existing port; never reset.
  fund→issueN3→lock race→report→settle; unauthorized/wrong value/replay/overbudget/
  paused writes really mined/reverted; second contract with rejecting merchant
  retains H/state/op; separate fixture reaches cumulative cap. No mock ledger.
- E2E discarded the funding hash and recovered exact payer+intent via mapping and
  event; verified receipt block hash and local finalized. First receipt block8,
  initial finalized0, explicit test-only mine128 advanced finalized72. This is
  **local test control**, not Monad confirmation timing. The wallet test harness
  must likewise advance local blocks explicitly when demonstrating finality;
  a receipt alone remains INCLUDED.

Only Solidity warning is test-only ForceValue selfdestruct, used to exercise forced
extra balance; production contract contains no selfdestruct/upgrade/withdraw method.
The contract trusts authorized operators for offchain eligibility and meal statements;
it proves budget/uniqueness/role constraints, not identity or physical delivery.
Unknown absent mapping is not proof of failure. Work actors share scoped backend
operator trust in the future backend slice; there is no secret/recipient field onchain.

## Integrated wallet checks

Only wallet commit 1fd3e25 was cherry-picked (9 owned files). No duplicate core pick,
no change to existing App/main/Python service/CP11 flow tests. Shared ABI remains C0.

- `npm run build`: PASS on integrated source, including TypeScript checks of new
  src controller/component; current application remains the CP11 simulation.
- `npm run test:wallet`: 6 PASS, 1 explicit real-chain SKIP. This default result is
  not claimed as full-chain verification.
- Main developer separately ran all same 7 tests with `CP13_REAL_CHAIN=1`: **7 PASS,
  0 SKIP**. A fresh owned Anvil31337 was started on an OS-assigned loopback port,
  deployFixture deployed the integrated core/roles, and its public manifest was
  written in a temporary working directory for the unchanged tests to consume.
  Tests loaded integrated repository source; only that owned child/temp directory
  was removed. No read/write/reset of wallet18545/5195 or CP11 DB/services.
  Output is local ignored `evidence/cp13-integrated-wallet.txt`.
- This real-chain test sent two fund transactions, including a post-broadcast
  response loss, recovered the original intent/batch/hash after controller reload,
  kept absent mappings unknown, and prohibited blind resend. Explicit test-only
  mining advanced local finalized; controller did not mine. Simulated inconsistent
  canonical block responses preserved UNKNOWN. Unit cases additionally cover
  wrong chain/account, rejection, quote expiry, storage failure, code mismatch
  and stale review across tabs.
- `npx --no-install vite build --config wallet-harness/vite.config.ts`: PASS,
  independent harness bundle built. No new dev server started for integration.
- `git diff --check`: PASS. Before wallet integration, main also ran original
  Python suite **14/14 PASS** and build PASS on core21d1953; those untouched files
  were not redundantly retested after the wallet-only cherry-pick.

Wallet agent's separate CUA evidence records actual browser connect/review/send,
reload/read-only recovery, real send with response dropped, and 390x844 layout.
It used a LocalTestProvider with actual Anvil, **not MetaMask or another extension**.
Main did not relabel that delegated browser evidence as its own rerun. Product
record: `research/cp13/wallet/VERIFICATION.md` under Leader's MCPAY project.

Core independent review of21d1953 is PASS: reviewer reran13 tests and real Anvil
E2E, plus7 independently designed cases and256 two-batch interleaving fuzz rounds.
Source report: `research/cp13/review/CORE-REVIEW.md`. Core source remains unchanged
in the integrated SHA. Wallet independent review and final Leader Gate remain pending;
this document does not self-approve them.

## Run and limitations

See [CP13-CONTRACT](CP13-CONTRACT.md). In a fresh local checkout with ports free:
`npm run chain:node` starts18545; `npm run chain:deploy` produces public-only
`.localchain/deployment.json`; `npm run dev:wallet` starts5195.
`CP13_REAL_CHAIN=1 npm run test:wallet` performs actual local writes/mining against
that manifest. Do not run it against another person's active preview; use a fresh
isolated fixture and respect the cumulative funding cap. Main left wallet agent's
existing18545/5195 processes intact for read-only preview.

WalletSupport explicitly uses the isolated EIP1193 LocalTestProvider, does not
read window.ethereum or request any user wallet. No keys in manifest or UI. Local
storage holds one active operation, not persistent backend history/outbox. Current
App/P01–P14 are not connected to chain. Real extension/mobile/Monad10143, backend
identity/nonce/outbox/projection service and cloud deployment were not implemented
or tested. No claims of actual meals, refunds, recovery or production readiness.
