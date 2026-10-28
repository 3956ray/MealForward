#!/usr/bin/env python3
"""Run forge build first; export deterministic public deployment inputs only."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ('MvpStoreEscrow', 'MvpTestToken')


def canonical_immutable_references(references):
    """AST IDs vary with compiler input ordering; only runtime ranges are public.

    Group by immutable as solc does, but assign stable keys ordered by ranges.
    Consumers iterate Object.values and do not interpret these keys as AST IDs.
    """
    groups = [sorted(refs, key=lambda r: (r['start'], r['length']))
              for refs in references.values()]
    groups.sort(key=lambda refs: tuple((r['start'], r['length']) for r in refs))
    return {f'immutable_{i}': refs for i, refs in enumerate(groups)}


def export_artifact(name, compiled, source):
    return {
        'contractName': name, 'compiler': '0.8.28', 'optimizerRuns': 200,
        'evmVersion': 'cancun', 'sourceSha256': hashlib.sha256(source).hexdigest(),
        'abi': compiled['abi'], 'bytecode': compiled['bytecode']['object'],
        'deployedBytecode': compiled['deployedBytecode']['object'],
        'immutableReferences': canonical_immutable_references(
            compiled['deployedBytecode'].get('immutableReferences', {})),
        'metadata': (json.loads(compiled['metadata'])
                     if isinstance(compiled['metadata'], str) else compiled['metadata'])}


def main():
    checksums = {}
    for name in NAMES:
        compiled = json.loads((ROOT/'out'/f'{name}.sol'/f'{name}.json').read_text())
        out = export_artifact(name, compiled, (ROOT/'contracts'/f'{name}.sol').read_bytes())
        path = ROOT/'artifacts'/f'{name}.json'
        path.write_text(json.dumps(out, indent=2, sort_keys=True)+'\n')
        checksums[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        print(f'{name}: creation {len(out["bytecode"][2:])//2} bytes, '
              f'runtime {len(out["deployedBytecode"][2:])//2} bytes')
    (ROOT/'artifacts'/'export-sha256.json').write_text(json.dumps(checksums, indent=2)+'\n')


if __name__ == '__main__':
    main()
