"""Owned bounded wallet checks only; no old identity/security suite or network services."""
from pathlib import Path
import hashlib
import json
import subprocess

SCOPE = Path(__file__).resolve().parent
PROJECT = SCOPE.parents[2]
PYTHON = Path("/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3")
NODE = Path("/opt/homebrew/bin/node")
EMAIL_FILES = ["adapter.py", "__init__.py", "test_adapter.py", "README.md", "run-offline.py",
               "mapping-tests.json", "mapping-tests.stdout.txt", "mapping-tests.stderr.txt"]
before = {name: hashlib.sha256((SCOPE / name).read_bytes()).hexdigest() for name in EMAIL_FILES}
code = ("import sys,unittest; sys.path[:0]=" + repr([str(PROJECT), str(SCOPE.parent)])
        + "; r=unittest.TextTestRunner(verbosity=2).run("
          "unittest.defaultTestLoader.loadTestsFromName('identity.test_wallet_proof')); print(r.testsRun); sys.exit(not r.wasSuccessful())")
python_args = [str(PYTHON), "-I", "-B", "-c", code]
py = subprocess.run(python_args, cwd=PROJECT, env={}, capture_output=True, text=True, timeout=30)
node_args = [str(NODE), "--test", str(SCOPE / "wallet-proof-codec.test.mjs")]
js = subprocess.run(node_args, cwd=PROJECT, env={}, capture_output=True, text=True, timeout=30)
(SCOPE / "wallet-proof-python.stdout.txt").write_text(py.stdout)
(SCOPE / "wallet-proof-python.stderr.txt").write_text(py.stderr)
(SCOPE / "wallet-proof-node.stdout.txt").write_text(js.stdout)
(SCOPE / "wallet-proof-node.stderr.txt").write_text(js.stderr)
after = {name: hashlib.sha256((SCOPE / name).read_bytes()).hexdigest() for name in EMAIL_FILES}
assert before == after, "Frozen email leaf files changed"
summary = {
    "pythonTests": int(py.stdout.strip()), "pythonExitCode": py.returncode, "nodeExitCode": js.returncode,
    "nodeTests": 2, "realInstalledViemSyntheticRecovery": py.returncode == 0 and js.returncode == 0,
    "frozenEmailFilesUnchanged": after,
    "environment": "empty child environments; Python -I -B; explicit project/integrations paths",
    "signatureHandling": "Public fixture signatures in memory pipes only; no signature/JWT/key persisted or logged",
    "notRun": ["PG/session/controller/authority integration", "live wallet EOA classification", "real wallet/provider/identity",
               "HTTP/RPC/network/broadcast/deployment", "SMART/ERC1271/multisig proof", "old identity/security suites"],
    "commands": [{"argv": python_args, "exitCode": py.returncode}, {"argv": node_args, "exitCode": js.returncode}],
}
(SCOPE / "wallet-proof-checks.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({key: summary[key] for key in ("pythonTests", "pythonExitCode", "nodeTests", "nodeExitCode", "realInstalledViemSyntheticRecovery")}, indent=2))
raise SystemExit(0 if py.returncode == 0 and js.returncode == 0 else 1)
