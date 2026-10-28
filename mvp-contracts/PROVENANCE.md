# Provenance

MvpStoreEscrow is an isolated MIT-licensed copy of `cp30-contracts/contracts/StoreEscrow.sol` from repository HEAD `64714db6633af1a00e5d7957014db19538119b46`. Original source SHA-256: `bd84f387a46428802a453f28306ad6f9de7317465ff48844619d550713ce0c66`. Frozen source and all of cp30-contracts remain unmodified.

Changes: contract name; 180-second constant; appended voucher settlementAvailableAt; report sets it on entry to H; settle enforces it; atomic redeem operation kind 12 and documentation. Original staged lock/markHandover/report remain available with the same delay enforced at report time. Existing accounting, role, quote, expiry, refund and close behavior is retained. OpenZeppelin Contracts 5.6.1 is reused under MIT, pinned in package-lock.json. Token is a new explicitly test-only OpenZeppelin ERC20.

Compile Solidity 0.8.28, Cancun, optimizer 200. Export script preserves compiler metadata and immutable-reference locations. Unpatched compiled runtime contains immutable placeholders and MUST NOT be compared verbatim with deployed runtime; patch/verify constructor-derived immutable slots or compare normalized runtime plus all public immutable getters.
