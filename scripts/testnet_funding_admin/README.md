# CP21 standalone grant client

BUILD only; no execution or broadcast approval is implied. This CLI must never be imported by the web service. It only prepares the fixed deployment's SUPPORTER_ROLE grant to a Leader-frozen exact payer.

After fixed-source review, Leader can inspect the public plan using `.venv/bin/python -m scripts.testnet_funding_admin plan --payer <frozen-address>`. No key is loaded by plan or reconcile. The plan includes the immutable deployment fingerprint, exact grant calldata, admin, nonce, value zero and bounded fee/gas transaction. Existing identical plans return the original record; changing payer is rejected.

Runtime execution requires both `execute --plan-hash <reviewed-hash> --leader-approved-plan-hash <same-reviewed-hash>`. The second explicit argument represents separately obtained Leader approval; it is not cryptographic authentication. All identity, role, fee, nonce, estimate, call and balance guards are repeated before loading the existing deployer account. After signing, volatile identity, role, nonce, fee and balance guards run again before the sole send; any failure preserves consumed signing eligibility. No agent should invoke this command during BUILD. `reconcile` only reads the original transaction hash; no receipt, signing failure, lost response or failed receipt grants another attempt.

Private state lives in `.localbackend/cp21-admin/journal.json` (0600, directory 0700). The independent `.localbackend/cp21-admin-anchor.json` must be preserved outside backups/restores of that directory. Anchor-first fsync updates and a process lock quarantine interrupted or stale restores. Missing journal/anchor never recreates eligibility. Symlinks, nonregular files, group/other permissions, oversized records and unsafe directory modes are quarantined rather than silently repaired. Restoring both the journal and external anchor together cannot be detected; this is not a supported recovery procedure. Do not delete either to start over.

SIGNING_STARTED is persisted before key loading; signed raw/hash is persisted privately; UNKNOWN with attempt=1 precedes the only send invocation. Public output omits raw transaction and exception objects. Reconcile validates original transaction, canonical receipt, exact RoleGranted event, finalized block and hasRole before FINALIZED_SUCCESS.

Offline verification: `.venv/bin/python -m unittest tests.test_testnet_funding_admin -q`. Tests use temporary directories, a deterministic synthetic account and fake RPC. No live key loading, network or transaction is needed.
