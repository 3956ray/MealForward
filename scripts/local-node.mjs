import { spawn } from 'node:child_process'
// Deliberately no RPC/host/chain override. Do not use an existing wallet or public node.
const child = spawn('node_modules/.bin/anvil', ['--host', '127.0.0.1', '--port', '18545', '--chain-id', '31337', '--silent'], { stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
