# CP16 owner wallet — isolated local harness

This is a separate Anvil31337 owner-wallet module. It does not replace P01–P14,
connect an existing user wallet automatically, or demonstrate real food delivery.
The backend owns the settlement state machine and finality. The controller stores
only an original intent pointer, backend DTO, attempted-start guard and known hash.
Cookies, CSRF tokens, identity signatures and private keys are not stored there.

## Behavior

- Explicit connect, identity proof, review and transaction confirmation are separate.
- `personal_sign` signs the exact identity-only UTF-8 challenge, encoded as hex.
  It is EIP191, not a claim of SIWE or transaction authorization.
- The current account must match the configured immutable merchant. Chain31337,
  contract bytecode hash and genesis hash are checked before review and send.
- The review displays contract, merchant, meal amount, transaction value0 and
  separate wallet gas. Calldata must decode to `settle(originalOperation,voucher)`.
- Web Locks serialize the journal across tabs. The original key is stored before
  prepare; attempted-start is stored before the start HTTP request. Only the first
  successful response with `maySubmit=true` can invoke `eth_sendTransaction`.
- Any uncertainty after start, including4001, missing hash, offline responses or
  storage errors, remains query-only. No second send or automatic new intent.
- Account/chain/disconnect events invalidate the review and revoke backend proof.
  A late identity verification response is revoked again. Failed revocation blocks
  new proof until an explicit retry succeeds.
- Original lookup requires no wallet prompt. Re-reporting is restricted to the
  same locally retained hash. Only backend FINALIZED_SUCCESS means H→S.

The backend must be the owner-mode C0 or later and the exact browser origin must
be allowed. The harness uses the same-origin `/api/v1` cookie/CSRF transport.

## Run against a dedicated local backend

Use existing root dependencies; do not change the root lock. Pick an unused local
port and a dedicated backend/database. Never point this at the old8765 simulator.

```sh
OWNER_BACKEND_ORIGIN=http://127.0.0.1:18875 \
  node_modules/.bin/vite --config owner-wallet-harness/vite.config.ts --port 15197
```

The backend origin allowlist must be `http://127.0.0.1:15197`. Log in with an explicit
local owner fixture account; the page does not provide or install a wallet. An
EIP1193 provider with account/chain events must be explicitly available. Do not use
real accounts or wallets in this local harness.

```sh
npm run build
OWNER_BACKEND_ORIGIN=http://127.0.0.1:18875 \
  node_modules/.bin/vite build --config owner-wallet-harness/vite.config.ts
node --experimental-strip-types --test tests/wallet/owner-controller.test.ts
```

## Reproducible isolated real-chain tests

`test-server.py` creates its own random-port Anvil, temporary DB, HTTP server and
C0 finalized payable. It prepares lock/report via C0 helpers; therefore this is
wallet HTTP/transaction evidence, not full redemption-module HTTP acceptance.
It serves the built harness at the API's own origin and exposes a test-only worker
tick route. Do not run this driver as a deployed service.

Set `OWNER_TEST_PYTHON` to the pinned project venv. If dependencies/artifacts are
reused from another checkout, set `OWNER_TEST_RESOURCES` to that checkout; only its
Anvil binary and compiled contract artifact are read. All imported Python code
remains from this worktree. Each driver stops only its own HTTP server and node.

```sh
CP16_OWNER_REAL_CHAIN=1 OWNER_TEST_PYTHON=/absolute/project/.venv/bin/python \
 OWNER_TEST_RESOURCES=/absolute/project \
 node --experimental-strip-types --test tests/wallet/owner-anvil.test.ts
```

Browser verification uses an externally available Playwright module and dedicated
Chrome executable; they are not added to the application dependencies:

```sh
OWNER_TEST_PYTHON=/absolute/project/.venv/bin/python \
 OWNER_TEST_RESOURCES=/absolute/project \
 OWNER_PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs \
 OWNER_BROWSER_EXECUTABLE=/absolute/chrome \
 OWNER_BROWSER_OUTPUT=/tmp/mealforward-owner-browser \
 node --experimental-strip-types owner-wallet-harness/browser-check.mts
```

The browser driver injects a controlled EIP1193 bridge. Its disposable Anvil owner
signer lives in the external Node test driver, never backend/browser storage. It
checks no automatic signing, explicit identity proof, fixed review, one actual
transaction with deliberately lost hash, reload/original finality recovery, desktop
rendering and390px overflow. It does not test real extension UI, human confirmation,
biometrics, hardware wallets, smart accounts or a public network.

Sources checked for this implementation: [EIP1193](https://eips.ethereum.org/EIPS/eip-1193),
[MetaMask signing guidance](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/).
