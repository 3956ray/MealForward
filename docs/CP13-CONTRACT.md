# CP13 C0 — local contract and wallet ownership

Only Anvil 31337 on loopback. Local native unit, NOT Monad testnet. No real meals,
refund, replacement, unlock or address recovery. Existing App.tsx and local Python
simulation stay unchanged. CP13 is not persistent backend/auth/outbox or a full DApp.

## Shared source and local fixture

`src/chain-contract.ts` is the only wallet ABI/DTO/fixture source. Import it, do not
copy ABI or create another payment state machine. Solidity implementation must match
this interface. Native decimals 18; price 10^15 wei, quantity 1–20, cumulative funding
cap 10^17 wei. `ruleVersion=keccak256("mealforward-cp13-local-v1")`.
Constructor will be `(address admin,address merchant)` and rejects non-31337 chains.
Roles SUPPORTER_ROLE/ISSUER_ROLE/OPERATOR_ROLE/SETTLER_ROLE are keccak256 of their
names; admin uses OZ DEFAULT_ADMIN_ROLE. Admin can manage roles and pause, never
withdraw or change merchant/price/history. Recovery is false. Deployment scripts
register ONLY local Anvil test addresses. No imported wallet keys.

Every fund creates independent batchId=keccak256(abi.encode(chainId,contract,payer,intentId)).
Same payer+intent cannot accept a second payment (revert/refund msg.value); another
payer cannot occupy that domain. Zero IDs rejected. Business work actions 1 issue,
2 lock, 3 report, 4 settle use getOperation(action,id) => payloadHash,resultId;
same payload replay reverts AlreadyProcessed, different payload IntentConflict.
issue hash=keccak256(abi.encode(batchId,voucherIds)); lock/report hash=keccak256(abi.encode(voucherId,lockId));
settle hash=keccak256(abi.encode(voucherId)). Result is batchId for issue, voucherId for others.
Voucher states NONE=0/ACTIVE=1/LOCKED=2/REPORTED=3/SETTLED=4. Unknown getters return
zero values; zero is NOT proof that an in-flight transaction was never sent.
F=A+R+H+S+X, X=L=0. report preserves original lock, R→H; settle only fixed merchant,
H→S atomically with native send, failure reverts all. liability=sum(A+R+H); any forced
extra value is unallocated and never F. Direct transfers rejected. pause checks at
execution for fund/issue/lock/settle; old locked voucher report remains allowed.

## Wallet worker contract

Worker owns ONLY `src/wallet/`, `src/components/WalletSupport.tsx`, `wallet-harness/`,
`tests/wallet/`. Main owns dependencies, `src/chain-contract.ts`, contracts/scripts,
existing app and shared docs. Request shared changes; do not modify them independently.
Worker branches from fixed C0 in separate worktree. It is not alone; do not revert others.

Export a React WalletSupport component accepting `{deployment: LocalDeployment}`.
Its isolated harness imports it; do not mount into current App/main. Worker owns
`wallet-harness/index.html`, `main.tsx`, `vite.config.ts`, and `tests/wallet/*.test.ts`.
Vite config must bind 127.0.0.1:5195 strictPort, allow repo source imports, and serve
main's generated `.localchain/deployment.json` as GET `/__localchain/deployment.json`
(read-only, exact file; never directory or keys). Main deployment script writes this
public manifest after deploy and role grants. Worktree runs its own fresh node/manifest,
never main's shared demo DB. Port collision is a failure, not permission to kill a process.

Commands after respective deliverables exist:
- `npm ci` then `npm run chain:node` starts fixed node18545; `npm run chain:deploy`
  builds/deploys core and writes `.localchain/deployment.json` (main owns script).
- `npm run dev:wallet` starts worker isolated Vite config5195.
- `npm run test:wallet` runs worker Node24 TypeScript tests in `tests/wallet/`.
- `npm run chain:test` contract tests; `npm run chain:e2e` main's fresh isolated Anvil
  automatic real transaction flow (own18546, no shared node/reset).

Wallet: explicit connect/switch/review/sign. Check configured RPC loopback and
eth_chainId=31337 before any signing/send; validate manifest codeHash vs RPC bytecode.
Use prepareSupportIntent before signature; persist non-secret original intent first.
quoteExpiresAt milliseconds is UI review only, never chain deadline. Unsubmitted
chain/account changes require review; possibly submitted retains original domain.
No API backend in this slice: harness adapter prepares original intent locally and
persists it. Clearly label this limitation; later slice replaces preparation with API.

States exactly shared ChainOperationStatus. Before provider send persist
SUBMISSION_UNKNOWN; rejected before broadcast can be NOT_SUBMITTED; timeout/refresh
/disconnect/no hash stays unknown, query fundedBatch(original payer,intent) and
Funded logs, never amount/time guessing or a new automatic send. Returned hash means
BROADCAST only. A receipt is INCLUDED_SUCCESS/REVERT; FINALIZED requires matching
canonical blockHash and blockNumber <= getBlock('finalized'), proper contract event
and intent match. Polling timeout never means business failed. Local mining/finality
must be labeled local, not Monad evidence. Preserve original ID on account switch.

Prefer isolated EIP1193 provider against real Anvil, no user wallet interaction.
A test provider may use Anvil unlocked dev accounts only after local guard; distinguish
provider fault injection from a real extension test. No public mnemonic/private keys
in UI, manifest or evidence. Cover success, refusal, wrong chain, account change,
response dropped after real send, unresolved no-send, reload and no blind replay.
Write exact scope/limitations in worker evidence; main consolidates CP13-VERIFICATION.
