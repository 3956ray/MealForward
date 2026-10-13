// Private signer subprocess only. Key bytes are an inherited private FD, never argv/env.
// This entry is not invoked by source checks or imported by the business API.
import {readFileSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256} from 'viem';

try {
  const raw=readFileSync(0);if(raw.length>131072)throw Error();
  const input=JSON.parse(raw);
  if(Object.keys(input).sort().join(',')!=='expected,registrar')throw Error();
  const e=input.expected;
  if(e.type!=='eip1559' || e.value!=='0' || !Number.isSafeInteger(e.chainId) || e.chainId<1)throw Error();
  if(process.argv.length!==3 || !/^(?:[3-9]|[1-9][0-9]+)$/.test(process.argv[2]))throw Error();
  const secret=readFileSync(Number(process.argv[2]),'utf8').trim();
  if(!/^0x[0-9a-fA-F]{64}$/.test(secret))throw Error();
  const account=privateKeyToAccount(secret);
  if(account.address.toLowerCase()!==input.registrar || e.from!==input.registrar)throw Error();
  for(const field of ['nonce','gas','maxFeePerGas','maxPriorityFeePerGas'])if(!/^(0|[1-9][0-9]*)$/.test(e[field]))throw Error();
  if(BigInt(e.nonce)>BigInt(Number.MAX_SAFE_INTEGER) || BigInt(e.gas)*BigInt(e.maxFeePerGas)>BigInt(e.gasBudgetWei))throw Error();
  const signed=await account.signTransaction({type:'eip1559',chainId:e.chainId,nonce:Number(e.nonce),to:e.to,
    value:0n,data:e.data,gas:BigInt(e.gas),maxFeePerGas:BigInt(e.maxFeePerGas),maxPriorityFeePerGas:BigInt(e.maxPriorityFeePerGas),accessList:[]});
  process.stdout.write(JSON.stringify({raw:signed,hash:keccak256(signed)}));
} catch {
  process.stdout.write('{"error":"REGISTRAR_SIGNING_REJECTED"}');process.exitCode=1;
}
