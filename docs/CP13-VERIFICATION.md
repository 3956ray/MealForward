# CP13 verification (core complete; wallet integration pending)

2026-09-30. C0 `d1a7b4a`; core source is this commit's contracts/scripts/tests.
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

## Wallet handoff and limitations

Fixed ABI and files/commands in [CP13-CONTRACT](CP13-CONTRACT.md). Main owns core;
Leader's wallet agent owns src/wallet, WalletSupport, wallet-harness, tests/wallet.
`npm run chain:node`18545 is reserved for that isolated wallet harness;
`npm run chain:deploy` compiles and deploys there, grants local test roles, writes
public-only `.localchain/deployment.json`. Main has not started/reset that node.
Manifest never includes keys. `dev:wallet`5195/test:wallet become available with
wallet agent's files; not claimed verified in the core commit.

Final integrated build/regression/browser evidence and fixed SHA follow after wallet
integration and independent review. Real extension testing is not covered by an
EIP1193 test provider. No claim of Monad/mobile or production readiness.
