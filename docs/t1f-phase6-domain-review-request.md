# Draft: MetaMask dapp-scanning review request

**Status: ON HOLD at the user’s explicit request on2026-10-26 (“暂不提交”); NOT submitted.** Do not submit or repeat the authorization request unless the user revisits this decision. Intended recipient: MetaMask/eth-phishing-detect maintainers, via their public blocklist-removal issue template. External submission requires the user's explicit authorization; project development authorization alone does not authorize posting to a third party. This draft contains only the public domain, public source/deployment evidence and the requested review. Do not attach wallet screenshots, signatures, account activity, credentials, cookies or database identifiers.

Proposed title: **Domain classification review: mealforward-t1f-approval-laodao.onrender.com (dapp scan BLOCK)**

## Legitimate domains, IPs, IPFS hashes, or IPNS names

https://mealforward-t1f-approval-laodao.onrender.com/

## Please explain why this content is legitimate

We maintain mealforward, an experimental meal-voucher project. This specific hostname serves a restricted approval collector for Monad Testnet (chain10143). We are requesting investigation of a suspected incorrect domain classification, not asking users to disable warnings or assuming the scanner is wrong.

Observed on2026-10-26 around08:00UTC:

- MetaMask browser extension displayed a phishing/wallet-draining warning during account connection, before any signature request.
- A read-only request to `https://dapp-scanning.api.cx.metamask.io/v2/scan?url=https%3A%2F%2Fmealforward-t1f-approval-laodao.onrender.com` returned:
  `{"hostname":"mealforward-t1f-approval-laodao.onrender.com","recommendedAction":"BLOCK"}`.
- The current `MetaMask/eth-phishing-detect` `src/config.json` had no exact entry for this hostname or `onrender.com` in blocklist/allowlist/fuzzylist, and no entry containing `mealforward` in those three lists. This is a limited list comparison, not proof of safety or an evaluation of every provider rule.

Public implementation and verification:

- Served source commit: [8500627b890589e57f46362a805bce3f006892e1](https://github.com/3956ray/MealForward/commit/8500627b890589e57f46362a805bce3f006892e1).
- [Frontend](https://github.com/3956ray/MealForward/blob/8500627b890589e57f46362a805bce3f006892e1/t1-intents/public/t1f-approval.mjs) requests `wallet_requestPermissions` for `eth_accounts`, then checks the active account and chain. It never asks for seed phrases, private keys or wallet passwords.
- The separate, explicit formal-signature button uses only `eth_signTypedData_v4` for the pinned `MealForward T1F Recovery` version1 / `SuccessorIssueRelease` domain on chain10143. This is a custom approval schema, not ERC20 Permit, Permit2, token approval or a transaction. All signed fields are shown on the page for review. If a user signs, the signature is sent to the same-origin `/v1/approval/submit` endpoint for verification; the database stores the verified fingerprint and approval evidence, not the raw signature.
- The [server](https://github.com/3956ray/MealForward/blob/8500627b890589e57f46362a805bce3f006892e1/t1-intents/t1f-approval-server.mjs) and [service](https://github.com/3956ray/MealForward/blob/8500627b890589e57f46362a805bce3f006892e1/t1-intents/t1f-approval-service.mjs) operate in collection-only NO RELEASE mode. No wallet transaction method, automatic signing, token transfer, issue or settlement endpoint is enabled by this collector.
- At verification time the service was `NO_ROUND · 0/2 · NO RELEASE`; no formal signature round had been created and signature buttons were disabled. Future operational state can change; this is time-bound evidence.
- [CI](https://github.com/3956ray/MealForward/actions/runs/40306451109) passed211 tests and15 isolated PostgreSQL groups. A fresh31-check HTTPS smoke confirmed the served assets match that commit. These checks are project verification, not a third-party security certification or proof that all risk has been excluded.

Please review the exact hostname, identify the classification provider/rule or resource responsible if possible, and advise any remediation needed. If your review confirms an erroneous classification, please correct it. We will keep formal signing on hold while this warning is unresolved.

## Is this a duplicate request?

- [x] I have checked the issues page and confirmed this is not a duplicate request.

Search performed2026-10-26 for the exact hostname in `MetaMask/eth-phishing-detect`: zero matching issues. Recheck immediately before submission.
