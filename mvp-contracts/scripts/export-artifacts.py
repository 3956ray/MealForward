#!/usr/bin/env python3
"""Run forge build first; export deterministic public deployment inputs only."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
for name in ('MvpStoreEscrow','MvpTestToken'):
    a=json.loads((root/'out'/f'{name}.sol'/f'{name}.json').read_text())
    out={
      'contractName':name,'compiler':'0.8.28','optimizerRuns':200,'evmVersion':'cancun',
      'sourceSha256':hashlib.sha256((root/'contracts'/f'{name}.sol').read_bytes()).hexdigest(),
      'abi':a['abi'],'bytecode':a['bytecode']['object'],
      'deployedBytecode':a['deployedBytecode']['object'],
      'immutableReferences':a['deployedBytecode'].get('immutableReferences',{}),
      'metadata':json.loads(a['metadata']) if isinstance(a['metadata'],str) else a['metadata']}
    (root/'artifacts'/f'{name}.json').write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
    print(f'{name}: creation {len(out["bytecode"][2:])//2} bytes, runtime {len(out["deployedBytecode"][2:])//2} bytes')
