# CP28 implementation contract

Status: SAFE BUILD; actual identity selection and Runtime authorization absent. This document freezes the implementation before new modules. Existing CP13/24 local defaults and CP19/27 historical identities are unchanged. No real network access or real signatures are authorized by this document.

## Composition and identity

Only the server composition selects the chain policy. The legacy default is exactly Anvil/loopback/31337. New manual business uses exactly 10143, the reviewed MealForwardTestnet artifact, price 10^15 and rule mealforward-cp19-testnet-v1. A request, query string or environment variable cannot select a policy. A separate test fixture may compose the legacy local policy; evidence must label it local.

New deployment identity includes runId, chainId, genesis hash, artifact digest, constructor admin/merchant, original deploy sender/nonce, creation input, canonical successful deployment receipt, address and full immutable runtime hash. Predicted addresses are plans only. No old CP19 batch/manifest is a business target. Runtime registration requires creation input, address derivation, canonical receipt and full runtime bytes with artifact immutable slots bound to constructor values.

Work identities must come from an explicitly configured trusted authenticator and current mapping, including revision, partner/shop, enabled state and deployment. Authentication mode is not selected in BUILD. Owner proof includes origin, chain, contract/deployment, session, shop, wallet, nonce and expiry; consumption is atomic and once only. Configuration changes or revoked mapping invalidate old work, proof and review. Recipient sessions remain wallet-free, private links 72h, single active session 8h, QR/code 120s.

## Runtime authority and persistence

Runtime plan version 1 binds runId, configuration digest, network/genesis/deployment identity (or exact deployment plan), public participants, allowed actions and counts, per-action gas/maxFee/maxPriority/value caps, total value/fee caps and expiry. Every cap is mandatory; none is inferred. Invalid/missing/expired/changed authorization denies signing on both web and signer sides.

Under a single process/file writer lock and SQLite IMMEDIATE transaction, reserve count, sender nonce, value and worst fee and persist SIGNING_STARTED before requesting any signature. UNKNOWN retains the entire reservation. A reverted canonical transaction consumes actual gas. Actual fee/fields exceeding the reviewed limits halt dependent operations. Duplicate requests are original-operation queries, never another signature. After SIGNING_STARTED every error (including provider 4001, lost response and no hash) is UNKNOWN; no auto retry, nonce replacement or fresh intent. Observation by original sender/nonce is bounded and never evidence of non-submission just because absent.

Store, external anchor and run identity must all exist on resume and match. Fresh creation is explicit and exclusive. Anchor is fsynced before DB commit (crash gap quarantines); whole business/security/runtime tables are fingerprinted. Missing/moved/rolled-back state fails closed; no automatic reset. Normal restart retains UNKNOWN and consumed proofs.

## Signer IPC boundary

Unix domain socket only, within mode 0700 directory, socket mode 0600, same effective UID checked via peer credentials. Web and signer must run under that explicitly approved local user; this protects against other local users, not a compromised same-UID process. A dedicated signer process obtains only its service key from user-configured storage, never owner/admin keys. BUILD does not load a real key. Authentication also requires a mode-0600 256-bit capability provisioned by the operator; comparison is constant-time and never logged. No HTTP signer or remote bind.

Request exactly {version:1, operationId, capability}; max 4096 bytes, one newline-delimited JSON request and response per connection; 3s socket timeout. Signer independently opens approved configuration, runtime plan and durable state, rechecks trusted actor/mapping/stage and constructs fixed ABI issue/lock/report from persisted domain intent. No client to/data/value/chain/nonce/raw accepted. It checks sender not admin/merchant and permitted roles; missing caps/service configuration denies. One signer owns a nonblocking lifetime file lock. Atomic reservation precedes key invocation. Persist hash/raw before at most one broadcast; timeout/restart never signs again. Reconciliation does not invoke key APIs.

## Bounded RPC contract

Transport is configured server-side credential-free HTTPS, no redirects/proxies, no browser RPC proxy; fake transport is injected only in tests. Each workflow observation has max 48 calls, 30s total, 3s per call and 1 MiB per response. No automatic retries. Polling is explicit, at least 5s apart, at most 12 attempts per operation before manual reconciliation. No auto background indefinite polling.

Allowed exact methods/parameters:

- eth_chainId [] and eth_getBlockByNumber [0x0|finalized|explicit hex height, false]. Explicit heights are limited to the deployment/operation observation range; never pending/latest full transaction bodies.
- eth_getCode [approved contract, explicit finalized height].
- eth_getBalance [approved participant or the fixed contract, explicit finalized height] / eth_getTransactionCount [approved participant, explicit finalized height]; pending nonce query only [the original signing participant, pending] during signing preflight or original UNKNOWN observation.
- eth_call [{to:approved contract,data:independently ABI encoded read selector,gas:0x186a0}, explicit finalized height]. Reads restricted to merchant, ruleVersion, priceWei, paused, hasRole, getBatch, getVoucher, getOperation, liability, totalFunded and fundingCapWei/maxQuantity (the original artifact's exact getter names).
- eth_estimateGas [independently constructed reviewed transaction]; only during authorized preflight, never browser supplied calldata.
- eth_getTransactionByHash / eth_getTransactionReceipt [one persisted original operation hash].
- eth_getLogs [{address:approved contract,fromBlock:hex,toBlock:hex,topics:[one approved event signature]}]; span at most 256 blocks, at most 4 pages and 1024 logs per observation. Stop on larger results; do not widen.
- eth_sendRawTransaction [persisted signed raw matching original intent] is signer-only, once, after independent authorization. Web adapter has no broadcast method.

No gas-price oracle methods: missing fee caps reject. Chain/genesis/code/receipt/event/canonical/transaction-field mismatch stops projection and dependent actions. Empty receipt or index delay is pending/UNKNOWN, not success. Finalized receipt and exact event plus same-block accounting are required for success. Block conflict retracts the observation. Exhaustion/timeout/malformed/oversized response stops the current observation without resigning. Deployment checking uses a separate exact plan and original deployment hash, never arbitrary creation data.

Deployment registration is read-only and exactly at most eight calls in 30s (3s/call, 1MiB/response): chainId, genesis block, finalized block, original deployment transaction, original receipt, receipt-height block, code at the receipt contract at that finalized height, and repeat that finalized-height block. A missing receipt stops early. No predicted address becomes a registered target until all checks pass. Registration itself does not deploy or grant roles; those user-admin operations require the later separately approved ten-transaction Runtime plan.

## Delivery and tests

Shared injections: Backend policy, WorkCore action encoding, owner challenge/settlement chain, and LocalWork presentation prefix (default unchanged). Only exact server-owned policy objects are accepted; a separate explicit test composition uses LOCAL_POLICY with the local adapter. Default stays local and is regression tested. No mutation of ChainRpc guards, historical manifests or original contracts. New UI displays actual blocked prerequisites and the complete four-role workflow. Native fetch/provider tests cover account/chain change, duplicate clicks, 4001/no hash, original observation and runtime denial before provider signing. Python tests cover bounded fake RPC, mapping/proof isolation, fixed ABI IPC and restart/concurrent budget/anchor failures. Isolated Anvil31337 business evidence and fake10143 protocol evidence are separate. Real network and human wallet tests are NOT_RUN until a later explicit Runtime Gate.
