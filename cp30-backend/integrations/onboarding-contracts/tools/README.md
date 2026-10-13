# One fixed new-run Factory bootstrap

Source candidate for Root review; author ran only syntax and unsigned local
checks. **No key read, RPC, signing, sending, execute or observe was run by the
author.** No contracts/artifacts/other source/run files were changed.

The CLI accepts exactly `prepare`, `preflight`, `execute`, or `observe`; it has no endpoint,
key/from, bytecode, calldata, nonce, gas, fee or output-path arguments. It is
bound to `/Users/mili/.mf-cp30-20261013`, the exact reviewed preview file SHA256,
same-build Factory/StoreEscrow artifacts, approved public accounts/custody
metadata, chain 10143, retained genesis, reviewed asset runtime code hash, nonce
zero and expected Factory `0x645d1176e8315afd04fe40f0c528e5370545acfb`.

Root runs with an empty environment from the project root:

```sh
env -i /opt/homebrew/bin/node cp30-backend/integrations/onboarding-contracts/tools/bootstrap-factory.mjs prepare
env -i /opt/homebrew/bin/node cp30-backend/integrations/onboarding-contracts/tools/bootstrap-factory.mjs preflight
env -i /opt/homebrew/bin/node cp30-backend/integrations/onboarding-contracts/tools/bootstrap-factory.mjs execute
env -i /opt/homebrew/bin/node cp30-backend/integrations/onboarding-contracts/tools/bootstrap-factory.mjs observe
```

Those last two commands are **reviewable future execution instructions**, not
author verification. On this macOS host, Node receives `__CF_USER_TEXT_ENCODING`
even from `env={}`. Only that OS marker is accepted, its value is never inspected,
and it is deleted before runtime work; all other environment keys cause closure.

`prepare` reads only the public plan/artifacts/public metadata and stats the
owned run/custody directories. It rebuilds initcode and CREATE address with
installed viem, compares every constructor/core transaction/budget field, and
outputs only public pins/addresses/budget/planDigest. It neither stats nor opens
the key, creates a journal, calls RPC nor signs. Root's reviewed preview status
label still mentions awaiting test MON; fixed byte/field pins, not that prose
label, govern this explicit action. Updated plan bytes require new source review;
there is no automatic pin update or permissive status fallback.

`preflight` performs only the same original unsigned network guards listed below,
using a transport that independently rejects sending. It never reads/creates the
original journal, opens/stats a key, signs or sends, including its error path.
It returns `READONLY_PREFLIGHT_PASSED` with public block/gas/fee checks; this is
not deployment authority and execute must redo every guard. Failures return
`UNKNOWN` plus a fixed logical stage, whitelisted method/call number, error
category, allowlisted SDK class names/system/RPC codes and numeric HTTP status.
Exception messages/stacks/URLs/bodies/params/raw/environment never enter that
diagnostic. No failure triggers a retry.

Root's first attempted execute stopped before journal creation. Source diagnosis
found viem canonicalizes the root endpoint to a trailing slash; the original
fetch guard compared it with the noncanonical spelling. The guard now compares
exactly `new URL(fixedEndpoint).href`, preserving HTTPS/host/root/no-query pins.
The author tested only local mocked fetch: canonical URL reaches the mock,
genesis mismatch stops after two calls, and a synthetic network error stops after
one call without leaking the exception canary. Author did not run live preflight.

## Single fresh execute

- HTTP uses only `https://testnet-rpc.monad.xyz`, retryCount zero, no batching,
  redirects/cookies or inherited proxy environment. Requests have a four-second
  timeout, combined absolute sixty-second operation deadline, at most 24 calls,
  and one-MiB response cap. Methods/addresses/selectors and original hash/raw are
  scoped inside the tool; no external RPC method or target can be passed.
- Before signing: recheck chain/genesis, pending nonce zero, finalized native
  balance at least **252000000000000000 wei**, same-block canonical asset code,
  registrar EOA and absent expected Factory code; current base fee plus approved
  priority must fit max fee. Re-estimate the fixed original initcode under the
  approved gas cap, recheck the canonical finalized header and pending nonce.
  There is no raise-budget/nonce-replacement/fallback endpoint path.
- Gas is fixed **2100000**, max fee **120000000000**, priority **2000000000**,
  value zero, type EIP1559. Worst cost remains **0.252 test MON**. A fee/gas/network
  failure before the first journal does not sign/send; a later separately
  authorized invocation can repeat only the original unsigned preflight.
- Exclusively create `factory-deploy.original.jsonl` (0600/O_EXCL/O_NOFOLLOW).
  Fsync `SIGNING` and the containing directory **before** opening the dedicated
  registrar key. Validate key FD regular-file/uid/0600/nlink/device/inode/67-byte
  metadata and the expected recovered account. There is no owner/backend business
  key path; no other custody key is opened. Buffer bytes are cleared after use;
  immutable JS/account internals rely on the short-lived process lifetime.
- Installed viem signs only the fixed deployment. Verify its serialized original
  envelope, sender and keccak hash, then fsync `RETAINED` with private raw/hash.
  Fsync `BROADCAST_UNKNOWN` before the **single possible** send. Matching returned
  hash adds `SEND_RETURNED`, but does not declare successful deployment.
- Any existing journal blocks execute signing/sending, including SIGNING without
  a retained hash, RETAINED without a send marker, RPC failure or restart. Only
  `observe` may look up the retained original. No delete/reset/adopt/retry-send,
  key generation, redeploy or change-nonce command exists. Missing/torn/conflicting
  journal closes the tool; SIGNING without retained raw stays UNKNOWN. The private
  raw is never returned or logged. Preserve this journal and run directory.

## Original-only observe

Observe reads/validates the append-only digest chain and retained raw/hash,
verifies sender/exact original signed envelope, then queries only that hash.
It never opens keys, signs, sends or changes the original journal. Root retains
its public stdout evidence separately. Concurrent changes to the journal close
the observation; a subsequent explicit observe can look up the same original.

`VERIFIED` requires all of:

1. Fixed chain/genesis; actual original RPC transaction hash/from/to-null/type/
   chain/value-zero/input/nonce/gas/fees/signature/access-list match retained raw.
2. Successful deployment receipt, matching sender, `to:null`, exact computed
   contract address, same tx block number/hash/index and bounded actual gas/cost;
   receipt at or below finalized height with its exact canonical header.
3. Actual Factory runtime matches the pinned compiler template outside **only**
   declared 32-byte immutable ranges; exact runtime size remains below EIP170.
   Same finalized canonical block asset code matches its approved hash.
4. Six actual immutable address getters equal original constructor parameters,
   same-build `escrowCreationCodeHash` equals its fixed code hash, and actual
   EIP712 domain name/version/chain/address/fields/salt/extensions are exact.
5. Finalized and receipt headers plus original receipt remain canonical after
   all same-block EIP1898 `requireCanonical:true` code/getter reads.

Success outputs the real Factory code hash, original transaction hash, exact
Factory/address pins, receipt/finalized block hashes/heights and actual gas cost.
Pending/missing/reverted/nonfinalized/mismatched/budget-exhausted results return
fixed `UNKNOWN` closure; no replacement or synthetic success is emitted. This
is configured RPC finality evidence, not a consensus/light-client proof. It does
not create stores, grants, runtime-ledger state, owner authority or business seed.

## Offline checks

`node --check` passes. Actual `prepare` in an empty process environment passes:
32758-byte initcode, artifact SHA256
`ae31889a9ebc4440317ec107262b05ef9193de9560980764c812b3e1265748bf`,
initcode keccak `0x25a0e972e8a1509ed72a8ee76fa6f221c075bb796ac33a7bea4586ed654f16ac`,
planDigest `22b4266bc6f7eddb9647f9af9bc4c5835126bd35ada9e68d2cd8e7894c788215`.
Pure template checks accept a declared immutable-byte change and reject a
non-immutable code change. Actual execute/observe, journal IO/fsync failures,
key handling/signing and live transport/finality/getters remain **NOT_RUN**.
No Forge suites, old C1 matrix or other test run was started.
