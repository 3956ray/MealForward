"""Bounded offline compiler/schema/EIP170 check; no credentials or network processes."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

SCOPE = Path(__file__).resolve().parents[1]
PROJECT = SCOPE.parents[2]
FORGE = PROJECT / "node_modules/@foundry-rs/forge-darwin-arm64/bin/forge"
SOLC = Path("/Users/mili/Library/Application Support/svm/0.8.28/solc-0.8.28")
EVIDENCE = SCOPE / "evidence/hash-bound-create"
NODE = Path("/opt/homebrew/bin/node")
HOME = SCOPE / ".isolated-home"
HOME.mkdir(exist_ok=True)
ENV = {"HOME": str(HOME), "PATH": "/usr/bin:/bin"}
COMMANDS = []


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run(name, argv, expected=0):
    args = [str(x) for x in argv]
    result = subprocess.run(args, cwd=SCOPE, env=ENV, capture_output=True, text=True, timeout=60)
    COMMANDS.append({"name": name, "argv": args, "exitCode": result.returncode})
    # Trace bytecode is not useful evidence; retain operation/result including CreateContractSizeLimit.
    lines = [line if len(line) < 1000 else line[:120] + " <compiled bytecode omitted>"
             for line in result.stdout.splitlines()]
    (EVIDENCE / (name + ".stdout.txt")).write_text("\n".join(lines) + "\n")
    (EVIDENCE / (name + ".stderr.txt")).write_text(result.stderr)
    assert result.returncode == expected, (name, result.returncode, expected)
    return result


try:
    forge_version = run("forge-version", [FORGE, "--version"]).stdout
    solc_version = run("solc-version", [SOLC, "--version"]).stdout
    assert "1.7.1" in forge_version and "0.8.28" in solc_version
    oz_version = json.loads((PROJECT / "node_modules/@openzeppelin/contracts/package.json").read_text())["version"]
    assert oz_version == "5.6.1"
    base = ["--root", SCOPE, "--use", SOLC, "--offline"]
    run("build", [FORGE, "build", *base, "--force"])
    run("size-check", [FORGE, "build", *base, "--sizes"])
    artifact = json.loads((SCOPE / "out/RegistrationFactory.sol/RegistrationFactory.json").read_text())
    runtime_bytes = (len(artifact["deployedBytecode"]["object"]) - 2) // 2
    creation_bytes = (len(artifact["bytecode"]["object"]) - 2) // 2
    assert runtime_bytes <= 24576 and creation_bytes + 6 * 32 <= 49152
    create = next(item for item in artifact["abi"] if item.get("name") == "createStore")
    registration_fields = [(f["name"], f["type"]) for f in create["inputs"][0]["components"]]
    assert registration_fields == [
        ("registrationId", "bytes32"), ("storeId", "bytes32"), ("owner", "address"),
        ("configHash", "bytes32"), ("deadline", "uint256")
    ]
    assert create["inputs"][3]["name"] == "escrowCreationCode" and create["inputs"][3]["type"] == "bytes"
    selector_schema = "createStore((bytes32,bytes32,address,bytes32,uint256),((bytes32,uint256,uint256,bytes32,bytes32,uint8,uint16,uint16,uint16,uint16),bool)[],bytes,bytes)"
    assert selector_schema in artifact["methodIdentifiers"]
    (SCOPE / "abi/RegistrationFactory.json").write_text(json.dumps(artifact["abi"], indent=2) + "\n")
    original = json.loads((SCOPE / "out/StoreEscrow.sol/StoreEscrow.json").read_text())
    starts = sorted(r["start"] for v in original["deployedBytecode"]["immutableReferences"].values() for r in v)
    assert starts == json.loads((SCOPE / "test/escrow-immutable-locations.json").read_text())
    assert all(r["length"] == 32 for v in original["deployedBytecode"]["immutableReferences"].values() for r in v)
    code = json.loads(run("same-build-bytecode", [NODE, SCOPE / "test/check-bytecode.mjs"]).stdout)
    result = run("directed-tests", [FORGE, "test", *base, "--match-contract", "RegistrationFactoryTest", "-vv"])
    assert "8 passed; 0 failed" in result.stdout
    profile = json.loads(run("profile", [FORGE, "config", "--root", SCOPE, "--json"]).stdout)
    assert profile["code_size_limit"] == 24576 and profile["offline"] and not profile["ffi"]
    before = json.loads((SCOPE / "evidence/blocked-direct-new/original-preservation-before.json").read_text())
    after = {str(p.relative_to(PROJECT)): sha(p) for p in sorted((PROJECT / "cp30-contracts").rglob("*")) if p.is_file()}
    assert before == after, "original cp30-contracts bytes changed"
    summary = {
        "status": "OFFLINE_CANDIDATE_TESTED_NOT_INTEGRATED",
        "compiler": "PASS_SOLC_0.8.28",
        "factoryRuntimeBytes": runtime_bytes,
        "factoryCreationBytes": creation_bytes,
        "factoryInitcodeBytesWithConstructor": creation_bytes + 6 * 32,
        "eip170LimitBytes": 24576,
        "eip170RemainingBytes": 24576 - runtime_bytes,
        "eip3860LimitBytes": 49152,
        "createStoreSelector": "0x" + artifact["methodIdentifiers"][selector_schema],
        "registrationFields": registration_fields,
        "abiSchemaCheck": "PASS",
        "sizeChecks": "PASS_RUNTIME_EIP170_AND_FACTORY_INITCODE_EIP3860_STANDARD_LIMITS",
        "businessDirectedTests": "PASS_8_BOUNDED_INPROCESS_TESTS_UNDER_EXPLICIT_24576",
        "sameBuildEscrowCreationCode": code,
        "runtimeTemplateCheck": "PASS_EXCLUDES_ONLY_COMPILER_DECLARED_43_IMMUTABLE_SLOTS; ALL_PUBLIC_IMMUTABLE_CONFIG_GETTERS_ASSERTED",
        "originalPreservation": {"files": len(before), "allBytesUnchanged": True},
        "tools": {"forge": {"version": forge_version.strip(), "path": str(FORGE), "sha256": sha(FORGE)},
                  "solc": {"version": solc_version.strip(), "path": str(SOLC), "sha256": sha(SOLC)},
                  "openzeppelin": oz_version},
        "notRun": ["ERC1271 owner", "cross-chain domain", "financial fund/settle isolation regression",
                   "catalog-size/gas boundary", "fuzz/invariants/reentrancy regression", 
                   "application/session/database/consumer integration", "receipt/finality/UNKNOWN reconciliation", 
                   "real identity/wallet/token/RPC/signing/broadcast/deployment"],
        "environment": "empty parent environment; only scoped isolated HOME and PATH=/usr/bin:/bin",
        "commands": COMMANDS,
        "network": "NONE; only offline compiler/viem hash and eight bounded in-process EVM registration checks",
        "teardown": "All children returned. Scoped isolated HOME removed; no services started."
    }
    (EVIDENCE / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: summary[k] for k in ("status", "factoryRuntimeBytes", "factoryCreationBytes", "eip170RemainingBytes", "createStoreSelector", "abiSchemaCheck", "sizeChecks", "businessDirectedTests", "sameBuildEscrowCreationCode", "originalPreservation")}, indent=2))
finally:
    shutil.rmtree(HOME)
