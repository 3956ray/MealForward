"""Run only the bounded mapping checks with an installed interpreter and empty environment."""
from pathlib import Path
import json
import subprocess

SCOPE = Path(__file__).resolve().parent
PROJECT = SCOPE.parents[2]
RUNTIME = Path("/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3")
version = subprocess.run([str(RUNTIME), "--version"], env={}, capture_output=True, text=True, check=True)
probe = subprocess.run([str(RUNTIME), "-I", "-B", "-c",
    "import importlib.util; print(importlib.util.find_spec('jwt') is not None)"],
    env={}, capture_output=True, text=True, check=True)
code = ("import sys,unittest; sys.path[:0]=" + repr([str(PROJECT), str(SCOPE.parent)])
        + "; result=unittest.TextTestRunner(verbosity=2).run("
          "unittest.defaultTestLoader.loadTestsFromName('identity.test_adapter')); print(result.testsRun); sys.exit(not result.wasSuccessful())")
result = subprocess.run([str(RUNTIME), "-I", "-B", "-c", code], cwd=PROJECT,
    env={}, capture_output=True, text=True, timeout=60)
(SCOPE / "mapping-tests.stdout.txt").write_text(result.stdout)
(SCOPE / "mapping-tests.stderr.txt").write_text(result.stderr)
summary = {"runtime": str(RUNTIME), "version": version.stdout.strip(),
           "pyjwtImportAvailable": probe.stdout.strip() == "True", "testExitCode": result.returncode,
           "mappingTestsRun": int(result.stdout.strip()),
           "scope": "Only identity.test_adapter mapping tests; no old suite, HTTP, PG or networking",
           "productionVerifierTested": False,
           "environment": "empty; -I -B; explicit project and integrations source paths"}
(SCOPE / "mapping-tests.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
raise SystemExit(result.returncode)
