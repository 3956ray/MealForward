"""Only this new crypto slice: actual offline ETH inspection, not Runtime signing/broadcast."""
from pathlib import Path
import json
import subprocess

SCOPE = Path(__file__).resolve().parent
PROJECT = SCOPE.parents[2]
NODE = Path('/opt/homebrew/bin/node')
PYTHON = Path('/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')
node_args = [str(NODE), '--test', str(SCOPE / 'transaction-crypto.test.mjs')]
js = subprocess.run(node_args, cwd=PROJECT, env={}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    text=True, timeout=30, check=False)
code = ("import sys,unittest; sys.path[:0]=" + repr([str(PROJECT), str(SCOPE.parent)])
        + "; result=unittest.TextTestRunner(verbosity=2).run("
          "unittest.defaultTestLoader.loadTestsFromName('business.test_transaction_crypto')); print(result.testsRun); sys.exit(not result.wasSuccessful())")
python_args = [str(PYTHON), '-I', '-B', '-c', code]
py = subprocess.run(python_args, cwd=PROJECT, env={}, capture_output=True, text=True, timeout=30, check=False)
(SCOPE / 'transaction-crypto-node-checks.txt').write_text(js.stdout)
(SCOPE / 'transaction-crypto-python-checks.txt').write_text(py.stderr)
summary = {'nodeTests': 3, 'nodeExitCode': js.returncode, 'pythonTests': int(py.stdout.strip()),
           'pythonExitCode': py.returncode, 'network': 'NONE',
           'scope': 'Only new transaction crypto tests; no PrivateRuntime/PG/old suites invoked',
           'keyHandling': 'New synthetic in-memory test key; never returned or stored; raw fixture only in memory pipe',
           'sourceType': 'eip1559 only; empty access list; canonical reserialization; installed recovery/keccak',
           'environment': 'empty child environments; Python -I -B; explicit project/integrations source paths',
           'notRun': ['PrivateRuntime host composition', 'real approved ledger/nonce/grant/budget',
                      'PG/HTTP/RPC/provider/broadcast/deployment', 'actual identity/key/signature',
                      'on-chain nonce/balance/basefee/intrinsic-gas/finality verification'],
           'commands': [node_args, python_args]}
(SCOPE / 'transaction-crypto-checks.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: summary[k] for k in ('nodeTests', 'nodeExitCode', 'pythonTests', 'pythonExitCode', 'network')}, indent=2))
raise SystemExit(0 if js.returncode == 0 and py.returncode == 0 else 1)
