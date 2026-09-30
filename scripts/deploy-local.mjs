import { mkdir, writeFile } from 'node:fs/promises'
import { build, connectLocal, deployFixture } from './local-chain-lib.mjs'
// Fixed node belongs only to the isolated wallet harness. Never a user's wallet/RPC.
build()
const manifest = await deployFixture(await connectLocal('http://127.0.0.1:18545'))
await mkdir('.localchain', { recursive: true })
await writeFile('.localchain/deployment.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(`Local-only fixture deployed at ${manifest.contractAddress}; manifest .localchain/deployment.json`)
