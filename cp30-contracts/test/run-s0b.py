"""Installed tools only; each child starts with a minimal isolated environment, never inherited credentials."""
from pathlib import Path
import hashlib,json,subprocess,tempfile
SOURCE=Path(__file__).resolve().parents[1]
PROJECT=SOURCE.parent
E=SOURCE/'evidence'/'s0b'
FORGE=PROJECT/'node_modules/@foundry-rs/forge-darwin-arm64/bin/forge'
SOLC=Path('/Users/mili/Library/Application Support/svm/0.8.28/solc-0.8.28')
NODE=Path('/opt/homebrew/bin/node')
BASELINE='f1f7de9401e30153a19b255e12a39323c882b4c0'
E.mkdir(parents=True,exist_ok=True)
def sha(b): return hashlib.sha256(b).hexdigest()
with tempfile.TemporaryDirectory(prefix='cp30-s0b-isolated-home-') as isolated_home:
    env={'HOME':isolated_home,'PATH':'/usr/bin:/bin'}
    commands=[]
    def run(name,args,cwd=SOURCE):
        commands.append({'file':name,'cwd':str(cwd),'argv':[str(x) for x in args]})
        print('Running '+name,flush=True)
        with (E/name).open('w') as out, (E/(name+'.stderr')).open('w') as err:
            done=subprocess.run([str(x) for x in args],cwd=cwd,env=env,stdout=out,stderr=err)
        if done.returncode: raise RuntimeError(name+' failed: see scoped evidence')
    def forge_args(command='test',root=SOURCE):
        return [FORGE,command,'--root',root,'--use',SOLC,'--offline','--out',SOURCE/'out'/'s0b-final', '--cache-path',SOURCE/'cache'/'s0b-final']
    for hook in ['c0-invariant-actions.jsonl','lifecycle-actions.jsonl']: (E/hook).write_text('')
    run('c0-vector-command.txt',[NODE,SOURCE/'test/write-vectors.mjs'])
    run('s0b-vector-command.txt',[NODE,SOURCE/'test/s0b-vectors.mjs'])
    run('unit.json',forge_args()+['--no-match-test','testFuzz|invariant','--json','-vv'])
    run('fuzz-c0.json',forge_args()+['--match-contract','FinancialFuzzTest','--match-test','testFuzz','--fuzz-runs','2500','--fuzz-seed','0xc030','--json'])
    run('fuzz-s0b.json',forge_args()+['--match-contract','S0bFuzzTest','--match-test','testFuzz','--fuzz-runs','5000','--fuzz-seed','0xc030','--json'])
    run('invariant.json',forge_args()+['--match-test','invariantIndependentOriginalUnitAndPayerReference','--fuzz-seed','0xc030','--json'])
    run('lifecycle.json',forge_args()+['--match-test','invariantIndependentFullLifecycle','--fuzz-seed','0xc030','--json'])
    run('gas-calls.json',forge_args()+['--match-contract','LocalGasTest|S0bGasTest','--json','-vv'])
    run('gas-report.txt',forge_args()+['--match-contract','LocalGasTest|S0bGasTest','--gas-report'])
    # Original source/configs/tests are unchanged; build output redirected inside this slice.
    for name,root in [('historical-root.json',PROJECT),('historical-testnet.json',PROJECT/'testnet')]:
        args=[FORGE,'test','--root',root,'--use',SOLC,'--offline','--out',SOURCE/'out'/name[:-5],'--cache-path',SOURCE/'cache'/name[:-5],'--fuzz-seed','0xc030','--json']
        run(name,args,cwd=SOURCE)
    run('profile.json',[FORGE,'config','--root',SOURCE,'--json'])
    versions={}
    for label,tool in [('forge',FORGE),('solc',SOLC),('node',NODE)]:
        p=subprocess.run([str(tool),'--version'],cwd=SOURCE,env=env,capture_output=True,text=True,check=True)
        versions[label]={'version':p.stdout.strip(),'path':str(tool),'sha256':sha(tool.read_bytes())}
    versions['openzeppelin']=json.loads((PROJECT/'node_modules/@openzeppelin/contracts/package.json').read_text())['version']
    versions['viem']=json.loads((PROJECT/'node_modules/viem/package.json').read_text())['version']
    (E/'toolchain.json').write_text(json.dumps(versions,indent=2)+'\n')
    (E/'commands.json').write_text(json.dumps({'environment':'env initially empty; only temporary isolated HOME and PATH=/usr/bin:/bin supplied','network':'none, offline in-process EVM; historical testnet chain IDs are cheatcode inputs only','seed':'0xc030','commands':commands,'teardown':'All subprocesses returned; temporary HOME automatically removed; no server, Anvil, signer or background worker started'},indent=2)+'\n')
    old={}
    for p in sorted((SOURCE/'evidence').glob('*')):
        if not p.is_file():continue
        relative=p.relative_to(PROJECT).as_posix()
        original=subprocess.run(['git','show',BASELINE+':'+relative],cwd=PROJECT,env=env,capture_output=True,check=True).stdout
        assert original==p.read_bytes(),relative
        old[relative]=sha(original)
    (E/'c0-preservation.json').write_text(json.dumps({'baseline':BASELINE,'unchangedFiles':old},indent=2)+'\n')
    changed=subprocess.run(['git','diff','--name-only',BASELINE],cwd=PROJECT,env=env,capture_output=True,text=True,check=True).stdout.splitlines()
    assert all(p.startswith('cp30-contracts/') for p in changed),changed
    (E/'historical-preservation.json').write_text(json.dumps({'baseline':BASELINE,'trackedDifferences':changed,'historicalContractsTestsConfigsLocksUnchanged':True},indent=2)+'\n')
print('All executions completed; run collect-evidence.py',flush=True)
