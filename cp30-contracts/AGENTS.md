# CP30-C0 local contracts

- Current authority: Leader `BRIEF-CP30-C0.md`, local S0a only; sole Developer writer, no subagents.
- Only this directory and the root `.gitignore` evidence exception may change. Historical contracts/configuration/locks/services/JWT/DB/deployments remain unchanged.
- Use installed Foundry 1.7.1, solc 0.8.28 and root installed OpenZeppelin 5.6.1. No dependency install/upgrade, RPC/fork, key/profile reads, cloud, Anvil, real wallet, broadcast, deployment/grant or push.
- In-process chain 31337, synthetic tokens/identities and explicitly public synthetic `vm.sign` fixture only. Quote validation is not identity verification.
- Required tests: funding/refund unit negatives, >=10,000 total fuzz cases, >=64 invariant runs x256 depth with independent reference partition and demonstrated successful actions; Gas and historical root contract regression.
- Commands and interpretation live in this directory's README. Freeze a local commit and clean tree; independent acceptance belongs to Leader/reviewer. Do not begin lifecycle/DB/API slices.
