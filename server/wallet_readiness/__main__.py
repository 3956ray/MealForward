"""Foreground local CP26 UI/API; no wallet, key or business data is loaded."""
import argparse
import os
from pathlib import Path
import signal
import socket
import subprocess
import threading
import time
import requests
from werkzeug.serving import make_server,WSGIRequestHandler
from .web import create_app
ROOT=Path(__file__).resolve().parents[2]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--online',action='store_true',help='Enable only the Leader-approved public Monad read-only endpoint');p.add_argument('--ui-port',type=int,default=0);a=p.parse_args()
    if not 0<=a.ui_port<=65535:p.error('Invalid port')
    reservation=socket.socket();reservation.bind(('127.0.0.1',a.ui_port));reservation.listen(1);port=reservation.getsockname()[1];origin=f'http://127.0.0.1:{port}'
    class Quiet(WSGIRequestHandler):
        def log(self,*args,**kwargs):pass
    api=make_server('127.0.0.1',0,create_app(origin,a.online),threaded=True,request_handler=Quiet)
    thread=threading.Thread(target=api.serve_forever,daemon=True);thread.start()
    stopped=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda *_:stopped.set())
    proc=None
    try:
        reservation.close()
        proc=subprocess.Popen([str(ROOT/'node_modules/.bin/vite'),'--config','wallet-readiness-harness/vite.config.ts','--port',str(port)],cwd=ROOT,env={**os.environ,'CP26_BACKEND_ORIGIN':f'http://127.0.0.1:{api.server_port}'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        with requests.Session() as probe:
            probe.trust_env=False
            for _ in range(100):
                if proc.poll() is not None:raise RuntimeError('Owned UI failed, possibly port competition')
                try:
                    r=probe.get(origin+'/api/cp26/config',timeout=.2)
                    if r.status_code==200 and r.json().get('online')==a.online:break
                except (requests.RequestException,ValueError):pass
                if stopped.wait(.1):raise RuntimeError('Startup cancelled')
            else:raise RuntimeError('UI readiness timeout')
        print(f'CP26 read-only page: {origin}\nApproved public RPC enabled: {a.online}\nSupervisor: {os.getpid()} | API loopback port: {api.server_port}\nCtrl-C stops this page only. No business state is created.',flush=True)
        while not stopped.wait(.25):
            if proc.poll() is not None:raise RuntimeError('Owned UI stopped')
    finally:
        reservation.close()
        if proc and proc.poll() is None:
            os.killpg(proc.pid,signal.SIGTERM)
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
        api.shutdown();api.server_close();thread.join(timeout=5)
if __name__=='__main__':main()
