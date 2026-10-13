# Fresh full-app inputs and first-run checklist

Do not execute these runtime steps in the current source-only authorization.
No JWT/OTP/private key should be pasted into chat. Custody, TLS and generated
server secrets stay in the new owned0700 run with private0600 files.

The reviewable starting schema is `config/full-app.disabled.json`. All activation
is initially false. Copy it only into a completely new run using the new prepare
source action; approved inputs are handled internally, not through new broker code.
No per-store registrationId or manual store initialization is part of this path.

| Input | Exact required form / provenance |
| --- | --- |
| Namespace | new bounded lowercase namespace, no scope_file or old data import |
| Runtime | explicit absolute private Python; exact requirements-connection.lock versions/hash-pinned provisioning; installed pure Node/viem helpers; PG17.11 bin directory |
| Origin | canonical `https://localhost:<explicit-new-port>` or `https://127.0.0.1:<explicit-new-port>`, port1024–65535, no path/query/fragment; same approved Dynamic allowedOrigin |
| TLS | new private cert/key files under this run's tls directory, same public key, current validity and exact origin hostname/IP SAN; approved trust is a separate browser prerequisite |
| ClaimProfile | public environmentId7fe95f70-e5cc-4c3c-beed-a133e81268dc, exact issuer app.dynamicauth.com/7fe95f70-e5cc-4c3c-beed-a133e81268dc plus reviewed audiences/verified flag and explicit absence policies; never prepend HTTPS |
| Signed email | approved SignedEmailClaimProfile signed_boolean/signed_verified_credentials paths, or explicit dynamic_verified_profile with email_path=[email], email_type=string, other evidence fields null; strictly verified JWT then fixed official verified-email provider |
| Wallet proof | explicit name/version, safe integer chainId, selected factory verifyingContract, ttlSeconds≤300; backendOriginHash derived from approved origin |
| Registrar profile | modeTESTNET, canonical decimal-string chainId, exact factory/registrar/asset/all authorities, assetDecimals/symbol, genesis/factoryCodeHash/creation/template/chain-profile pins |
| Registration observer | concrete trusted endpoint/allowlists/absolute Python, exact14-field profile and seven compiler pins required by NodeReceiptVerifier; finality/EIP1898 and bounded readonly budget |
| Wallet-kind RPC | reviewed readonly endpoint/allowlists and profile with same chain/genesis/factory, canonical finalized policy and bounded registration-read transport budget |
| Business observer | exact genesis/rpc-finalized/EIP1898/runtimeTemplatePin/compilerPins/budget; maxSnapshotAgeSeconds1–300; concrete separate business readonly transport endpoint/allowlists/Python |
| Asset metadata | `{chainId:int,address,decimals:int0..36,symbol,codeHash,reviewed:true}` matching registrar profile; all money remains canonical integer base-unit strings |
| Approval reads | concrete dedicated approve/allowance observer budget, max12calls/20s/3s/1MiB response and total; no hash-as-funded flag |
| System roles | three preapproved accounts equal factory quote/issuer/operator addresses; profileCaps exactly registrar/maxGas/maxFeePerGas/maxPriorityFeePerGas/maxTransactionCostWei as canonical strings |
| Role custody | each role's new owned directory, approved `authority.key` name/device/inode metadata; independent registrar handle, never owner fund/settle key; no role response journal pre-created outside fresh setup/binder |
| Grants | unique new IDs, enabled:true only when expressly approved, explicit future expiry≤24h, signatureUnits/gasUnits positive canonical decimal strings; template budgets are fixed before registration |
| Broadcast RPC | dedicated authority-only endpoint/allowlists/Python and exact broadcaster budget, max6calls/20s/3s/256KiB response/1MiB total |
| Activation | explicit identity, ownerWalletBinding, storeDeployment, payerWalletTransactions, ownerSettlement and bounded expiry; disabled choices remain disabled |

The initializer generates fresh email/subject HMAC and cursor secrets, DB passwords,
private capabilities and journal/config digests internally. It does not obtain or
reuse any old signer/configuration. The new source does not install system tools,
copy production keys, select a test asset or guess account responsibilities.

Future authorized sequence:

Use the fixed launcher for these source CLIs on macOS:
`env -i /absolute/pinned/python -I -B /absolute/cp30-backend/tools/isolated-entry.py full-app <action> <new-run> [--plan <private-plan>]`.
It rejects other inherited configuration and clears interpreter-generated locale
entries before importing the selected source entry. Service children also use
isolated Python and clear their environment before importing their host.

Fresh bootstrap PG binary calls (`postgres --version`, `initdb`, `pg_ctl start`
and partial-initialization cleanup `pg_ctl stop`) receive only the fixed public
environment `{'LC_ALL':'C'}`, matching `initdb --locale=C`. This is an explicit
locale input for new PG resources, not inherited environment configuration.
Application/private signer launch isolation is unchanged. Actual PG startup and
schema execution remain separate runtime verification steps.

1. Prepare one new run; provision its pinned dependencies and internally approved
   new custody/TLS; review the completed private plan against the table.
2. Before initialization, deploy and independently verify the one platform
   RegistrationFactory from the same-build artifact described below. Complete the
   reviewed factory address/code hash and identity inputs, then initialize that
   new cluster once. Partial failure stays closed; never rerun it
   over existing PG/journals or reset counters.
3. Start the six owned apps. Verify the fixed bound origin and private startup
   replies; no store or funds are fabricated by startup.
4. Owner signs in through email/OTP, explicitly proves wallet control, saves the
   first meal with UTC hours, signs the original store permit and enables its
   original deployment. Dispatcher observes only the original locator.
5. Only a fully VERIFIED registration triggers automatic first-store profile/code
   probing, original journal creation and authority composition. Wait for actual
   facts/roles ready; no per-store administrator script or pasted token/key.
6. Exercise the existing explicit original contribution, approval/fund, issue,
   short display/link, check/lock/handover/report and owner-settle flow under its
   separate later transaction authorization. Pending/UNKNOWN never resends.
7. Stop only recorded owned app PIDs; retain all original journals/config/custody
   for restart. Missing or conflicting restore state requires independent work,
   never an initialization/reset workaround.

The one-time platform Factory bootstrap is separate from each owner's registration.
The current registrar host only authorizes `createStore`; it has no Factory CREATE
execution entry. The public compiled candidate is
`integrations/onboarding-contracts/out/RegistrationFactory.sol/RegistrationFactory.json`
(creation bytecode under `bytecode.object`, ABI under `abi`, immutable references
under `deployedBytecode.immutableReferences`). Its six static constructor arguments
are asset, registrar, quoteAuthority, catalogAuthority, issuerAuthority,
operatorAuthority, in that order. The artifact is ignored build output and must be
present and independently pinned before preparing a private bounded bootstrap
packet. Use the same build's `abi/StoreEscrow.creationCode.json`; the accepted
ThreeStoreFactory predeploys stores and is not this onboarding Factory. A separate
private bootstrap tool may encode this public initcode and retain/sign one original
CREATE transaction with the new registrar, but cannot reuse or widen the
createStore-only signer scope. Full initialization requires the actual resulting
Factory address, deployed code hash and verified getters, not a guessed address or
the template hash in place of the deployed code hash.

Current public candidate artifact pins, recomputed locally without signing/RPC:

| Material | Pin |
| --- | --- |
| Factory artifact SHA256 | `ae31889a9ebc4440317ec107262b05ef9193de9560980764c812b3e1265748bf` |
| Factory creation code keccak256 | `0xd036ef002d8cc0f0dc536777bda6cada442f1cd97345f53798af05dcd6cd8497` |
| Factory runtime template keccak256 | `0xcc94e6dd8c3e594ed94ef9221e7b3c55e941321285afcd39966f04c36231fb1a` |
| Same-build Escrow creation artifact SHA256 | `b61cd842ab12e61beedc0cef7a6ed0e92dc55f7ea8076c34f69972ab715b50b8` |
| Same-build Escrow creation code keccak256 | `0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e` |

Factory creation is32,566 bytes; six constructor words add192 bytes, for32,758-byte
initcode. Runtime is5,543 bytes. These size checks do not establish gas sufficiency
or network acceptance. The template contains immutable placeholders and must not
be used as the deployed `factoryCodeHash`.

Still missing external inputs: reviewed new ClaimProfile/email/origin, actual
selected asset/chain/provider pins, new custody/budgets/TLS and exact installed
runtime provenance. Still unverified: actual PG privileges/DDL, positive startup,
JWT/wallet/RPC/receipt behavior, complete user flow, formal restore and acceptance.
These are not evidence that any runtime or deployment was executed this turn.
