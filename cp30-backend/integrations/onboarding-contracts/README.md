# Owner-authorized store registration — offline candidate

The revised `RegistrationFactory` is compiled and passes eight bounded offline registration checks under the explicit standard EIP170 limit of **24,576 bytes**. Factory runtime is **5,543 bytes**, creation code **32,566 bytes**, and initcode with its six static constructor arguments **32,758 bytes**, below EIP3860's **49,152 bytes**. This is a module candidate, not Leader acceptance or an integrated/deployed onboarding system.

The original `cp30-contracts/contracts/StoreEscrow.sol` is imported unchanged. SHA256 checks preserve all 233 preexisting cp30-contracts files. The earlier direct-`new` candidate exceeded EIP170 by 6,017 bytes; its source, ABI, README and measurements remain under `evidence/blocked-direct-new/` and `abi/RegistrationFactory-direct-new.json` as historical evidence. Current evidence is exclusively `evidence/hash-bound-create/`.

## Fixed original code without a proxy

Only the Factory constructor uses `type(StoreEscrow).creationCode`, assigning its keccak256 to public immutable `escrowCreationCodeHash`. Factory runtime carries that hash, not the Escrow creation code. The fourth createStore argument supplies this exact public compiled code; Factory checks its hash before any successful replay and builds all constructor arguments itself from the validated, owner-authorized store/config/catalog. It then uses ordinary CREATE to create an independent original escrow. Empty, changed or appended code rejects; clients cannot choose another contract or append their own constructor arguments. There is no proxy, separate deployer, upgrade, code injection or increased size limit.

The pinned code is from **this same build**, not the old accepted build's artifact: metadata/remappings can change bytecode while accepted source remains byte-identical. The current original Escrow creation code is 25,501 bytes with keccak256:

```text
0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e
```

`abi/StoreEscrow.creationCode.json` contains the exact public code/hash and compiler metadata/settings. Wallet integration must pin this artifact and compare the Factory getter; the owner must never supply arbitrary bytecode. The compiler artifact stays in ignored `out/StoreEscrow.sol/StoreEscrow.json`. StoreEscrow runtime remains 21,459 bytes. One tested initial catalog entry adds 640 constructor bytes, giving 26,141 escrow initcode bytes; arbitrary catalog-size/gas boundaries are not tested.

## Shared contract

```text
EIP712 domain:
  name: MealForward Store Registration
  version: 1
  chainId: current execution chain
  verifyingContract: RegistrationFactory address

Registration(bytes32 registrationId,bytes32 storeId,address owner,bytes32 configHash,uint256 deadline)

configHash = keccak256(abi.encode(
  asset, quoteAuthority, catalogAuthority, issuerAuthority, operatorAuthority,
  storeId, owner, catalog
))

createStore(Registration registration, StoreEscrow.CatalogEntry[] catalog,
            bytes ownerSignature, bytes escrowCreationCode)
  returns (address escrow)
selector: 0xed89c3b2
```

The compiled full ABI is `abi/RegistrationFactory.json`. Every original CatalogEntry/TermsInput field, entry order and current flag is included in configHash. The constructor's six parameters are asset, registrar, quoteAuthority, catalogAuthority, issuerAuthority and operatorAuthority, all immutable and nonzero; asset must have code. Registrar is the platform's dedicated deployment account. Only registrar may create or replay; fresh creation requires owner authorization through installed OZ EIP712/SignatureChecker and `block.timestamp < deadline`. Owner remains the original escrow's receiver.

`registrationUses(registrationId)` returns the complete successful digest and escrow. Its digest retains deadline and binds Factory/chain. Exact successful replay returns the existing escrow without another CREATE/event even after deadline, but still checks registrar, registration/config and exact original bytecode. Signature bytes are authorization evidence rather than request identity; an already-successful lookup may use an empty signature. Conflicting registration/catalog/deadline rejects. A new registrationId cannot reuse a storeId; at most three distinct original escrows are created. Failed validation/signature/CREATE does not retain a request or slot; original constructor revert data is propagated. There are no role/configuration setters or recovery withdrawals.

`StoreCreated` indexes registrationId, storeId and escrow and records owner, configHash and zero-based slot. `escrowFor`, `escrows`, `storeCount` and `escrowCreationCodeHash` support integration verification. Backend must bind the original request/transaction, verify its event and each immutable configuration, and query the original tx/registrationId for UNKNOWN without replacing the id. No receipt/finality adapter is implemented here.

## Real draft and publication gate

Original Escrow rejects an empty catalog. Registration therefore uses the owner's **real saved first-meal draft** as initial catalog. Synthetic fixtures here are tests only, not product seed data or placeholder meals. The original constructor makes current entries **listed on chain** immediately. Backend/frontend must keep the real draft private and block public listing and funding quote issuance until deployment/event/configuration verification and publication readiness are complete. Those guards are not integrated here. Empty-store immediate deployment would require a separately reviewed constructor/design.

## Reproduce and evidence

From the project root:

```sh
python3 cp30-backend/integrations/onboarding-contracts/test/run-offline.py
```

Only installed Forge1.7.1, native solc0.8.28, OpenZeppelin5.6.1 and viem are used. Each child gets an empty inherited environment with only scoped disposable HOME and PATH=/usr/bin:/bin. Compiler/tests/ABI/cache/evidence stay inside this module; HOME is removed after completion. There is no wallet/provider, Signer service, credential reading, PostgreSQL, browser, Anvil, RPC, broadcast, network deployment or earlier blocked C1/PG test.

`evidence/hash-bound-create/summary.json` records exact sizes, public code/hash, tools, commands, checks and preservation. Eight tests passed: exact replay after deadline without CREATE/event; owner/store/deadline/catalog conflict; registrar-only create/replay; wrong-owner/wrong-Factory signature; three stores/duplicate/fourth-store rejection with original runtime and immutable configuration checks; expiry/invalid-constructor failure without occupation and retry; wrong/empty/altered/appended code including an expired successful replay; independent configHash and EIP712 reference. Runtime comparison zeroes only the 43 immutable words declared by the compiler, compares the rest against the unchanged-source template, and separately checks all public escrow immutable configuration getters. No code-size override or injected code is used.

NOT_RUN: ERC1271 owners, cross-chain/reentrancy/fuzz/invariant regressions, financial fund/settle isolation regression, catalog-size/gas boundaries; application/session/database/consumer integration and durable requests; receipt/finality/UNKNOWN reconciliation; real first-meal publication readiness; real identity/token/chain/wallet/signing/deployment and gas budgets. Prior original escrow evidence is preserved, not extended by these registration-only checks. No independent acceptance or complete user-facing onboarding claim is made.
