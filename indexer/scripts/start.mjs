import { spawnSync } from 'node:child_process';
const env = process.env;
if (!env.ENVIO_DEPLOYMENT_ID || !/^0x[0-9a-fA-F]{40}$/.test(env.ENVIO_CONTRACT_ADDRESS ?? '') || env.ENVIO_CONTRACT_ADDRESS === '0x0000000000000000000000000000000000000001') throw Error('Explicit deployment identity and deployed contract required');
if (!/^\d+$/.test(env.ENVIO_START_BLOCK ?? '')) throw Error('Deployment start block required');
const rpc = new URL(env.ENVIO_RPC_URL ?? '');
if (rpc.protocol !== 'http:' || !['127.0.0.1', 'localhost', 'host.docker.internal'].includes(rpc.hostname) || rpc.username || rpc.password) throw Error('Only local RPC is authorized');
const response = await fetch(rpc, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(5000)});
const chain = await response.json();
if (chain.result !== '0x7a69') throw Error('Expected chain 31337');
for (const args of [['run','abi'], ['exec','envio','start']]) {
  const result = spawnSync('npm', args, {stdio:'inherit',env});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
