# CP30-S0b local voucher fulfillment

- Current authority: Leader `BRIEF-CP30-S0B.md` and `FREEZE-CP30-S0B.md`, formally FROZEN_FOR_LOCAL_BUILD with sole Developer dispatch. This supersedes C0's lifecycle prohibition only; no subagents or cross-thread messages.
- Only this directory and the root `.gitignore` evidence exception may change. Historical contracts/configuration/locks/services/JWT/DB/deployments remain unchanged.
- Use installed Foundry 1.7.1, solc 0.8.28 and root installed OpenZeppelin 5.6.1. No dependency install/upgrade, RPC/fork, key/profile reads, cloud, Anvil, real wallet, broadcast, deployment/grant or push.
- In-process chain 31337, synthetic tokens/identities and explicitly public synthetic `vm.sign` fixture only. Quote validation is not identity verification.
- Implement the complete frozen catalog/control, A/R/H/S/X, voucher72h/window/unique lock/chain-time marker/late report/owner settlement/safe expiry/refund ABI and operation kinds1..11. catalogAuthority is separate; no owner catalog fallback, role rotation, unlock/reopen/rescue or client backdating.
- All accepted C0 evidence files remain byte-identical. New results/hooks/manifests only under `evidence/s0b/`; adapt every output destination before running tests. Preserve 46 C0 safety behaviors and historical13+4 byte-identical offline tests.
- Required tests: complete T01-T10/Leader matrix, independent original-input five-bucket reference, >=10,000 fuzz cases and >=64x256 stateful actions with real successful lifecycle distribution, vectors/Gas/EIP170/init-size/bounded loops. Do not disable code size limits.
- Execute with an empty environment and explicit installed tool/HOME-free compiler paths; no inherited real configuration or secrets. Only public synthetic vm.sign/mock roles/token on in-process31337.
- Commands and interpretation live in this directory's README. Freeze a clean local commit, deliver S0B-DELIVERY and stop source/test processes. Independent acceptance belongs to Leader/reviewer. DB/API/global-email/login/recovery/QR120s/providers/worker/NFT and any real operations remain later NOT_RUN; no automatic next slice.
