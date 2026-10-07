# CP26: real-wallet read-only preparation

This independent local page supports explicitly connecting one MetaMask injected
provider and reading the Leader-approved Monad Testnet profile. It never signs,
constructs transactions, sends transactions, switches/adds a chain, deploys or grants
roles. It is separate from the Anvil four-role rehearsal and does not migrate that flow.

## Run

Use the existing locked Python and npm environment from CP24/25. No new dependency:

```sh
.venv/bin/python -m server.wallet_readiness --online
```

Open the printed URL in a browser with MetaMask. The UI and API bind only 127.0.0.1.
Without `--online`, the page works but remote checks are disabled. `--ui-port PORT`
optionally selects a port; the default selects a free port. Ctrl-C stops this page's
UI/API only; it creates no business database, key, transaction or wallet history.
Before printing the URL, the launcher checks that the UI proxy returns this launch's
random API instance ID. A competing listener with generic configuration is rejected;
failure cleans up only the owned UI/API and never stops the competing listener.

1. Click **连接 MetaMask** and confirm account access yourself in the wallet.
2. Check the displayed account and wallet network. If wrong, switch manually inside
   the wallet to Monad Testnet 10143. This page never asks to switch a chain.
3. Click **核验准备状态（只读）**. This sends the public address to the approved RPC for
   read-only queries. Wallet chain and actual RPC chain are separate observations.
4. Results are scoped to that address/network/time/block. They expire after 60 seconds;
   account/network changes or disconnect clear them immediately. A failed/new check
   clears prior passes, and stale asynchronous responses cannot restore them.

No MetaMask means no simulated replacement. Open the same local URL in a supported
wallet browser. If the wallet is locked or awaiting permission, the human user must
complete that step; never provide keys, seed phrases or tokens. A page timeout does
not cancel the wallet's outstanding prompt.

## Frozen transport and result scope

The packaged `server/wallet_readiness/network-profile.json` is the Leader-approved
public endpoint and genesis. No private RPC configuration is read, and callers cannot
supply endpoints, methods, contract targets or calldata. Only eth_chainId,
eth_getBlockByNumber, eth_getBalance and eth_getCode exist in this adapter.
No manifest or eth_call implementation exists in this stage.

One explicit check uses at most 12 RPC calls, 20 seconds overall, 3 seconds per call,
1 MiB per response, no redirects/retries. Basic successful checks use 7 calls: chain,
genesis, latest/finalized blocks, balance/code at the finalized height, then canonical
block recheck. Old latest blocks (>120 seconds) and conflicting observations fail.
At the same height, latest and finalized must have the same hash and timestamp;
conflict stops before reading the account balance/code.
These are conservative observation policies, not protocol-finality guarantees.

HTTP checks enforce exact loopback Host/Origin, JSON ≤4 KiB, 10 checks/minute per direct
peer and one concurrent check per peer. No forwarded-IP trust or broad CORS. Access
logs omit requests; exceptions expose bounded codes, not addresses or upstream bodies.
There are no cookies, persisted accounts, workspace identity bindings or signer imports.

Client wallet permissions are requested only by the connect button; methods are
eth_requestAccounts/eth_accounts/eth_chainId. Connection waits at most 60 seconds;
context reads 5 seconds. Browser HTTP has a 21-second abort guard. Client generation
and request lifetimes discard late results; focus/visibility changes recheck expiry.

Deployment and roles remain unconfigured/unverified. Connected address does not prove
control or business identity; code/EOA and balance are observations, not permission or
ability to pay. Control proof, work identity, gas estimates and real business success
are explicitly outside this stage. No global "ready to transact" status.

## Validation

```sh
.venv/bin/python -m unittest tests.test_cp26_readiness tests.test_cp26_startup -v
node --experimental-strip-types --test tests/wallet-readiness/*.test.ts
node_modules/.bin/tsc --noEmit -p wallet-readiness-harness/tsconfig.json
node_modules/.bin/vite build --config wallet-readiness-harness/vite.config.ts
git diff --check
```

Automated fake providers/RPCs prove boundary behavior only. Actual remote reads may
use the explicitly synthetic zero address, labeled as such. Real MetaMask connection
and queries for its human-approved address require separate evidence. If absent,
mark NOT_RUN and accept only the preparation page after independent review, PM and
Leader checks. Do not wait for or request a signature to validate this no-signing stage.
