"""Create a fresh owned run and exact five-wheel isolated runtime."""
import hashlib,json,os,secrets,subprocess,sys,time,urllib.request,urllib.parse
from pathlib import Path
PYTHON=Path('/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')
CHILD=Path(__file__).resolve().parents[1]
BASE=Path('/Users/mili/Library/Caches/mcpay-c1')
def main():
    os.umask(0o077)
    BASE.mkdir(mode=0o700,parents=True,exist_ok=True)
    run=BASE/secrets.token_hex(6);run.mkdir(mode=0o700)
    (run/'OWNED.json').write_text(json.dumps({'run_id':run.name,'created':time.time(),'owner':os.getuid(),'phase':'RUNTIME_READY','baseline':'3cb717ec6fca60b80106783631a1e22b8abaff18','freeze':'b402bcbc50c353dde6abd0917725e5fe7dd5a0c861e956ce0dd6f427eec25802'}))
    env={'PATH':'/usr/bin:/bin:/opt/homebrew/bin','HOME':str(run/'home'),'PYTHONNOUSERSITE':'1','PIP_CONFIG_FILE':os.devnull};(run/'home').mkdir()
    subprocess.run([str(PYTHON),'-m','venv',str(run/'venv')],env=env,check=True,capture_output=True)
    # pip's configuration loader honors os.devnull before global/site loading,
    # including in isolated mode. Its installed implementation is poison-tested.
    result=subprocess.run([str(run/'venv/bin/python'),'-m','pip','--isolated','--disable-pip-version-check','--no-input','install','--keyring-provider','disabled','--no-cache-dir','--only-binary=:all:','--require-hashes','--index-url','https://pypi.org/simple','--report',str(run/'install-report.json'),'-r',str(CHILD/'requirements.lock')],env=env,capture_output=True,text=True)
    if result.returncode:
        (run/'install-status.json').write_text(json.dumps({'status':'FAILED','reason':'HASH_PINNED_PUBLIC_WHEEL_INSTALL_FAILED','exit_code':result.returncode})); print(json.dumps({'run':str(run),'status':'INSTALL_FAILED'}));return 1
    versions=subprocess.run([str(run/'venv/bin/python'),'-c','import importlib.metadata as m,json; print(json.dumps({n:m.version(n) for n in ["psycopg","psycopg-binary","psycopg-pool","typing-extensions","Pillow"]}))'],env=env,capture_output=True,text=True,check=True)
    report=json.loads((run/'install-report.json').read_text())
    expected={line.split('==')[0].lower().replace('_','-'):line.split('--hash=sha256:')[1].strip() for line in (CHILD/'requirements.lock').read_text().splitlines() if ' --hash=sha256:' in line}
    observed={item['metadata']['name'].lower().replace('_','-'):item['download_info']['archive_info']['hashes']['sha256'] for item in report['install']}
    if observed!=expected or any(urllib.parse.urlparse(item['download_info']['url']).hostname!='files.pythonhosted.org' for item in report['install']):
        (run/'install-status.json').write_text(json.dumps({'status':'FAILED','reason':'INSTALL_PROVENANCE_MISMATCH'}));print(json.dumps({'run':str(run),'status':'INSTALL_PROVENANCE_MISMATCH'}));return 1
    (run/'install-status.json').write_text(json.dumps({'status':'INSTALLED','versions':json.loads(versions.stdout),'lock_sha256':hashlib.sha256((CHILD/'requirements.lock').read_bytes()).hexdigest(),'report_sha256':hashlib.sha256((run/'install-report.json').read_bytes()).hexdigest(),'installer_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'isolation':{'environmentInherited':False,'pipConfigFile':'/dev/null','isolated':True,'keyring':'disabled','binaryOnly':True,'hashRequired':True,'publicIndex':'https://pypi.org/simple'},'wheels':observed}))
    print(json.dumps({'run':str(run),'status':'INSTALLED','versions':json.loads(versions.stdout)}))
    return 0
if __name__=='__main__':sys.exit(main())
