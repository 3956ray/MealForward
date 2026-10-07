# CP27 historical contract and role observations

Run the existing locked environment with:

```sh
.venv/bin/python -m server.wallet_readiness --online
```

Use the new printed loopback URL, not the preserved CP26 or business rehearsal URL.
No flag leaves public RPC disabled. The backend holds no wallet key or business DB.
The `/api/cp26` route prefix is retained internally for the preparation tool; the
launcher and this version deliver CP27, not a replacement for the old live process.

Connect MetaMask yourself, select Monad Testnet 10143 manually, and click the read-only
check. Network/account observations and historical contract observations are separate.
No role means “does not have this on-chain role”, never a logout or permission request.
Unknown/error means not checked, not false. All results expire 60 seconds after start.
Account/network/disconnect/config changes invalidate old and pending observations.

The fixed CP19 contract is **historical reference only, not a new business target**.
The new business target remains unconfigured. SUPPORTER, ISSUER, OPERATOR, SETTLER and
DEFAULT_ADMIN are contract permissions, not real-world identities. The immutable
merchant comparison is separate from SETTLER membership. Paused=false, a matching
merchant, code or any role never implies a transaction can execute. No signing,
transaction construction/broadcast, deployment, grant, automatic chain switch or gas
funding exists. A recipient has no corresponding on-chain role.

## Public provenance and trust

`server/wallet_readiness/historical-manifest.json` preserves all fields approved by
Leader's CP27 APPROVED-TARGET.json and adds a versioned ID, compiler and artifact
provenance. Its complete canonical JSON SHA256 is pinned in manifest.py and the
frontend contract.ts. The artifact's exact original public bytes are included in
server/wallet_readiness/public/MealForwardTestnet.json, with raw file SHA256 and
canonical JSON SHA256 in the manifest. This is the historical artifact, not a rebuild.

The source commit, source/plan digests and deployment transaction/block are historical
public evidence. Source/constructor/artifact identity was separately audited in CP27
DESIGN; runtime trust does not come from copying an observed RPC hash into the pin.
Loading verifies the manifest pin, both artifact digests, and complete runtime Keccak
with merchant filled into the artifact's three immutable positions. Metadata is not
stripped. Runtime code at the observation block must match that exact expected hash.
The public source revision is 701b756009bfa8fb92d3cdba8b6e0762ac659b29.

Missing/untrusted configuration retains independent basic observations and refuses
contract calls. The browser cannot provide a target, ABI, selector, gas, block, RPC URL
or override. Only the connected public address is accepted. Manifest loading errors
never auto-select another deployment.

## Fixed reads and limits

Normal order: chain/genesis/latest/finalized; account balance/code at B; canonical B
recheck (7 total); contract code at B; ruleVersion/merchant/paused; five hasRole calls;
final canonical B recheck (17 total). All code/calls share the original finalized B.
The eth_call object contains only to/data/gas=0x186a0. Four fixed selectors, five fixed
role IDs, exact address encoding and canonical 32-byte returns; unknowns never decode
as false. ContractRpc rejects calls outside this exact context, including latest,
extra fields, arbitrary selectors/addresses or state overrides.

Max18 calls, 20 seconds total, 3 seconds per call limited by remaining budget, 1MiB
response. No retries/batches/redirects/compression/environment proxies. HTTP retains
loopback exact Host/Origin, 4KiB JSON, 10/min per peer and one inflight. There are no
address access logs, user history or cookies.

A dynamic read failure clears all five roles/merchant/paused/rule values together.
The independent basic observation can remain, with its own valid context and TTL.
Final block conflict or expiry withdraws all same-block facts, including basic balance
and code identity. An earlier code match never turns an incomplete role group green.
Height-tag reads with canonical rechecks are bounded observations, not immunity to a
malicious RPC or every transient reorganization. No multi-provider consensus is claimed.

## Validation

```sh
.venv/bin/python -m unittest tests.test_cp26_readiness tests.test_cp26_startup tests.test_cp27_readiness -v
node --experimental-strip-types --test tests/wallet-readiness/*.test.ts
node_modules/.bin/tsc --noEmit -p wallet-readiness-harness/tsconfig.json
node_modules/.bin/vite build --config wallet-readiness-harness/vite.config.ts
git diff --check
```

Explicit isolated browser fixture (never served by production HTML):

```sh
PYTHONPATH=. .venv/bin/python tests/cp27_browser_fixture.py
# Explicitly approved public RPC, still only a synthetic zero-address provider:
PYTHONPATH=. .venv/bin/python tests/cp27_browser_fixture.py --real-rpc
```

Open its separate URL and use the actual connect/check buttons. Fixture HTTP counters
at /api/cp26/fixture-counts prove native fetch reached the server. The first command
uses fake RPC; --real-rpc uses the approved public endpoint. Neither is a real wallet
connection. Stop the fixture supervisor to stop only its UI/API. Never run it against
or inject it into a user wallet session. Real-user evidence requires the human user's
own connection; never infer it from a synthetic result or copy a previously shared
wallet address. Independent fixed-SHA review, PM and Leader acceptance remain gates.
