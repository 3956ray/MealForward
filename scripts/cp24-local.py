#!/usr/bin/env python3
"""Run only the new CP24 instance. Ctrl-C performs a consistent, resumable stop."""
import argparse
import hashlib
import json
import os
import platform
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import time
import requests

ROOT=Path(__file__).resolve().parents[1]

def fingerprint(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory',required=True);p.add_argument('--resume',action='store_true')
    p.add_argument('--ui-port',type=int,default=15247);p.add_argument('--api-port',type=int,default=19115)
    p.add_argument('--node-port',type=int,default=19145);p.add_argument('--bridge-port',type=int,default=19146)
    a=p.parse_args();root=Path(a.directory).resolve();root.parent.mkdir(parents=True,exist_ok=True)
    if a.resume:
        marker=root/'clean-stop.json'
        if not marker.exists(): raise SystemExit('QUARANTINE: no consistent stop record. Preserve this instance; do not reset/redeploy.')
        saved=json.loads(marker.read_text())
        if any(not (root/name).exists() or fingerprint(root/name)!=value for name,value in saved['files'].items()):
            raise SystemExit('QUARANTINE: saved chain/database/anchor differs. Preserve original records.')
        ports=saved['ports']
        a.ui_port,a.api_port,a.node_port,a.bridge_port=ports
    elif root.exists(): raise SystemExit('Fresh mode requires a new directory; use --resume after a normal stop.')
    ports=[a.ui_port,a.api_port,a.node_port,a.bridge_port]
    if len(set(ports))!=4: raise SystemExit('Use four distinct loopback ports')
    for port in ports:
        with socket.socket() as sock:
            try:
                sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
                sock.bind(('127.0.0.1',port));sock.listen(1)
            except OSError: raise SystemExit(f'Port {port} occupied; no process was stopped')
    root.mkdir(exist_ok=True);root.chmod(0o700)
    if a.resume: (root/'clean-stop.json').unlink()
    else: (root/'node-launch.json').write_text(json.dumps({'genesisTimestamp':int(time.time())})+'\n')
    genesis=json.loads((root/'node-launch.json').read_text())['genesisTimestamp']
    children=[];stopping=False
    def stop_signal(*_):
        nonlocal stopping
        stopping=True
    signal.signal(signal.SIGINT,stop_signal);signal.signal(signal.SIGTERM,stop_signal)
    def start(name,args,env=None):
        log=open(root/(name+'.log'),'ab')
        proc=subprocess.Popen(args,cwd=ROOT,stdout=log,stderr=log,env=env,start_new_session=True)
        children.append((name,proc,log));return proc
    origin=f'http://127.0.0.1:{a.ui_port}';rpc=f'http://127.0.0.1:{a.node_port}'
    bridge=f'http://127.0.0.1:{a.bridge_port}';business=root/'business'
    ok=False
    try:
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
            try:
                if probe.post(rpc,json={'jsonrpc':'2.0','id':1,'method':'eth_chainId','params':[]},timeout=.2).json().get('result')=='0x7a69': break
            except requests.RequestException: time.sleep(.1)
        else: raise RuntimeError('Owned Anvil startup timeout')
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
        (root/'runtime.json').write_text(json.dumps({'supervisorPid':os.getpid(),'url':origin,'ports':ports,'processes':{n:c.pid for n,c,_ in children}},indent=2))
        print(f'CP24 local fictional preview: {origin}\nCtrl-C stops only this instance and saves restart evidence.',flush=True)
        while not stopping:
            failed=[name for name,proc,_ in children if proc.poll() is not None]
            if failed: raise RuntimeError('Owned service stopped: '+','.join(failed))
            time.sleep(.25)
        ok=True
    finally:
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
            names=['node-launch.json','anvil.json','business/backend.sqlite3','business.cp24-anchor.json','business/config.json']
            record={'ports':ports,'files':{name:fingerprint(root/name) for name in names}}
            (root/'clean-stop.json').write_text(json.dumps(record,indent=2)+'\n')
            print('Normal stop saved. Resume with the same command plus --resume.',flush=True)
        else: print('Incomplete stop: instance preserved; automatic resume disabled.',flush=True)
if __name__=='__main__': main()
