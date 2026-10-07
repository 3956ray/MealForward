#!/usr/bin/env python3
"""Run only the new CP24 instance. Ctrl-C performs a consistent, resumable stop."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import shlex
import shutil
import uuid
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import requests

ROOT=Path(__file__).resolve().parents[1]

def fingerprint(path): return hashlib.sha256(path.read_bytes()).hexdigest()

PORT_FLAGS=('ui','api','node','bridge')
SAVED_FILES=('node-launch.json','anvil.json','business/backend.sqlite3','business.cp24-anchor.json','business/config.json')

def arguments(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--new',action='store_true',help='Create a separate rehearsal with an automatic directory and four free loopback ports')
    mode.add_argument('--directory',help='Explicit new directory, or original directory with --resume')
    p.add_argument('--resume',action='store_true')
    for flag in PORT_FLAGS: p.add_argument('--'+flag+'-port',type=int)
    a=p.parse_args(argv)
    explicit=[getattr(a,flag+'_port') for flag in PORT_FLAGS]
    if a.new and (a.resume or any(v is not None for v in explicit)):
        p.error('--new cannot be combined with --resume or explicit ports')
    if a.resume and any(v is not None for v in explicit):
        p.error('--resume uses the original saved ports; omit port overrides')
    if any(v is not None and not 1<=v<=65535 for v in explicit): p.error('Ports must be between 1 and 65535')
    return a

def reserve_ports(ports):
    """Keep all candidates reserved until each owned service starts; never take a port."""
    held=[]
    try:
        for port in ports:
            sock=socket.socket();held.append(sock)
            sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            try: sock.bind(('127.0.0.1',port));sock.listen(1)
            except OSError as e: raise SystemExit(f'Port {port} unavailable; no existing process was stopped') from e
        return held
    except BaseException:
        for sock in held: sock.close()
        raise

def resume_record(root):
    try:
        saved=json.loads((root/'clean-stop.json').read_text())
        if not isinstance(saved,dict) or not isinstance(saved.get('files'),dict) or not isinstance(saved.get('ports'),list): raise ValueError()
        ports=saved['ports']
        if len(ports)!=4 or any(type(v) is not int or not 1<=v<=65535 for v in ports) or len(set(ports))!=4: raise ValueError()
        if set(saved['files'])!=set(SAVED_FILES): raise ValueError()
        if any(not (root/name).is_file() or fingerprint(root/name)!=value for name,value in saved['files'].items()): raise ValueError()
        return saved
    except (OSError,ValueError,KeyError,TypeError):
        raise SystemExit('QUARANTINE: missing or inconsistent saved stop evidence. Preserve this instance; do not reset/redeploy.') from None

def resume_command(root):
    return shlex.join([str(ROOT/'.venv/bin/python'),str(ROOT/'scripts/cp24-local.py'),'--directory',str(root),'--resume'])

def owns_rpc_listener(node,port,lsof):
    """Kernel socket ownership, not a response from whichever node won the port."""
    if node.poll() is not None: return False
    try:
        result=subprocess.run([lsof,'-nP','-a','-p',str(node.pid),'-iTCP:'+str(port),
                               '-sTCP:LISTEN','-Fpn'],capture_output=True,text=True,timeout=2)
    except (OSError,subprocess.TimeoutExpired) as e:
        raise RuntimeError('Cannot verify owned Anvil listener; no setup is permitted') from e
    lines=result.stdout.splitlines()
    return (result.returncode==0 and 'p'+str(node.pid) in lines
            and 'n127.0.0.1:'+str(port) in lines and node.poll() is None)

def main():
    a=arguments()
    lsof=shutil.which('lsof')
    if not lsof: raise SystemExit('lsof is required to verify owned Anvil sockets; no instance started')
    root=(ROOT/'.localbackend'/('rehearsal-'+time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex)) if a.new else Path(a.directory).resolve()
    if a.resume: ports=resume_record(root)['ports']
    else:
        if root.exists(): raise SystemExit('Fresh mode requires a new directory; original records were not changed.')
        ports=[0]*4 if a.new else [getattr(a,flag+'_port') or default for flag,default in zip(PORT_FLAGS,(15247,19115,19145,19146))]
    requested=[v for v in ports if v]
    if len(set(requested))!=len(requested): raise SystemExit('Use four distinct loopback ports')
    held=reserve_ports(ports)
    ports=[sock.getsockname()[1] for sock in held]
    a.ui_port,a.api_port,a.node_port,a.bridge_port=ports
    try:
        if not a.resume:
            root.parent.mkdir(parents=True,exist_ok=True)
            root.mkdir(mode=0o700,exist_ok=False)
            (root/'node-launch.json').write_text(json.dumps({'genesisTimestamp':int(time.time())})+'\n')
        genesis=json.loads((root/'node-launch.json').read_text())['genesisTimestamp']
    except BaseException:
        for sock in held: sock.close()
        raise
    children=[];stopping=False
    def stop_signal(*_):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGINT,stop_signal);signal.signal(signal.SIGTERM,stop_signal)
    def start(name,args,env=None):
        if name in ('ui','web','anvil','bridge'): held[{'ui':0,'web':1,'anvil':2,'bridge':3}[name]].close()
        log=open(root/(name+'.log'),'ab')
        proc=subprocess.Popen(args,cwd=ROOT,stdout=log,stderr=log,env=env,start_new_session=True)
        children.append((name,proc,log));return proc
    origin=f'http://127.0.0.1:{a.ui_port}';rpc=f'http://127.0.0.1:{a.node_port}'
    bridge=f'http://127.0.0.1:{a.bridge_port}';business=root/'business'
    ok=False
    try:
        if a.resume: (root/'clean-stop.json').unlink()
        arch={'arm64':'arm64','aarch64':'arm64','x86_64':'amd64'}.get(platform.machine())
        system={'darwin':'darwin','linux':'linux'}.get(sys.platform)
        binary=ROOT/f'node_modules/@foundry-rs/anvil-{system}-{arch}/bin/anvil'
        if not binary.is_file(): raise RuntimeError('Pinned native Anvil executable missing')
        node=start('anvil',[str(binary),'--host','127.0.0.1','--port',str(a.node_port),
                            '--chain-id','31337','--silent','--block-time','1','--slots-in-an-epoch','1',
                            '--timestamp',str(genesis),'--dump-state',str(root/'anvil.next.json'),'--preserve-historical-states',
                            *(['--load-state',str(root/'anvil.json')] if a.resume else [])],{**os.environ,'RUST_LOG':'error'})
        probe=requests.Session();probe.trust_env=False
        for _ in range(100):
            if node.poll() is not None: raise RuntimeError('Owned Anvil failed; see anvil.log')
            if not owns_rpc_listener(node,a.node_port,lsof):
                time.sleep(.1);continue
            try:
                if probe.post(rpc,json={'jsonrpc':'2.0','id':1,'method':'eth_chainId','params':[]},timeout=.2).json().get('result')=='0x7a69': break
            except requests.RequestException: time.sleep(.1)
        else: raise RuntimeError('Owned Anvil listener verification timeout; no setup performed')
        if not owns_rpc_listener(node,a.node_port,lsof):
            raise RuntimeError('Owned Anvil listener lost before setup; refusing initialization')
        if not a.resume:
            subprocess.run([sys.executable,'-m','server.local_e2e','setup','--directory',str(business),'--rpc-url',rpc,
                            '--origin',origin,'--bridge-origin',bridge],cwd=ROOT,check=True)
        else:
            # Validate original deployment and its finalized checkpoint before exposing the web UI.
            sys.path.insert(0,str(ROOT))
            from server.local_e2e.__main__ import load
            from server.projection import Projector
            b=load(json.loads((business/'config.json').read_text()));Projector(b).sync()
        for name,port in [('bridge',a.bridge_port),('web',a.api_port),('worker',None)]:
            args=[sys.executable,'-m','server.local_e2e',name,'--directory',str(business)]
            if port: args+=['--port',str(port)]
            start(name,args)
        env={**os.environ,'CP24_BACKEND_ORIGIN':f'http://127.0.0.1:{a.api_port}'}
        start('ui',[str(ROOT/'node_modules/.bin/vite'),'--config','local-e2e-harness/vite.config.ts','--port',str(a.ui_port)],env)
        if not owns_rpc_listener(node,a.node_port,lsof):
            raise RuntimeError('Owned Anvil listener lost; refusing READY')
        instance=json.loads((business/'config.json').read_text())['deployment']['deploymentId']
        # Do not advertise a ready URL until the actual UI proxy reaches this instance.
        for _ in range(100):
            failed=[name for name,proc,_ in children if proc.poll() is not None]
            if failed: raise RuntimeError('Owned service stopped during startup (possible port competition): '+','.join(failed))
            if stopping: raise RuntimeError('Startup interrupted; instance preserved')
            try:
                response=probe.get(origin+'/api/cp24/public',timeout=.3)
                if response.status_code==200 and response.json().get('instanceId')==instance: break
            except (requests.RequestException,ValueError): pass
            time.sleep(.1)
        else: raise RuntimeError('Owned preview readiness timeout; see instance logs')
        runtime={'supervisorPid':os.getpid(),'url':origin,'instanceId':instance,'directory':str(root),'ports':ports,
                 'resumeCommand':resume_command(root),'processes':{n:c.pid for n,c,_ in children}}
        (root/'runtime.json').write_text(json.dumps(runtime,indent=2)+'\n')
        print(f'Local rehearsal READY (Anvil 31337; fictional accounts)\nURL: {origin}\nInstance: {instance}\nDirectory: {root}\nStop: Ctrl-C in this terminal (or kill -TERM {os.getpid()} while this supervisor is running)\nResume after a normal stop: {resume_command(root)}\nA new round does not resolve UNKNOWN operations in any previous round.',flush=True)
        while not stopping:
            failed=[name for name,proc,_ in children if proc.poll() is not None]
            if failed: raise RuntimeError('Owned service stopped: '+','.join(failed))
            time.sleep(.25)
        ok=True
    finally:
        for sock in held: sock.close()
        # UI/web stops receiving; worker and bridge stop before chain snapshot.
        for name in ('ui','web','worker','bridge','anvil'):
            for n,proc,log in children:
                if n!=name: continue
                if proc.poll() is None:
                    os.killpg(proc.pid,signal.SIGINT if name=='anvil' else signal.SIGTERM)
                    try: proc.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        ok=False;os.killpg(proc.pid,signal.SIGKILL);proc.wait()
                log.close()
        if ok:
            db=business/'backend.sqlite3'
            conn=sqlite3.connect(db)
            try: conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            finally: conn.close()
            os.replace(root/'anvil.next.json',root/'anvil.json')
            names=SAVED_FILES
            record={'ports':ports,'files':{name:fingerprint(root/name) for name in names}}
            (root/'clean-stop.json').write_text(json.dumps(record,indent=2)+'\n')
            print('Normal stop saved. Resume: '+resume_command(root),flush=True)
        else: print('Incomplete stop: instance preserved; automatic resume disabled.',flush=True)
if __name__=='__main__': main()
