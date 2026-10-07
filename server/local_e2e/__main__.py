"""Explicit, isolated CP24 setup/web/worker/wallet bridge commands."""
import argparse
import json
import secrets
import signal
import threading
import time
from urllib.parse import urlsplit
from pathlib import Path
from server.local import fixture, load_worker_keys
from server.backend import Backend, random_id
from server.chain.client import ChainRpc
from server.local_e2e.store import LocalStore
from server.local_e2e.credentials import LocalWork


def load(config):
    key=Path(config['secretKeyFile']).read_bytes()
    backend=Backend(LocalStore(config['databasePath']),ChainRpc(config['deployment']),key,config['deployment']['issuer'],
                    signers=config['workSigners'],owner_mode=True)
    backend.work=LocalWork(backend,key)
    return backend

def setup(directory,rpc,origin,bridge):
    for value in (origin,bridge):
        u=urlsplit(value)
        if u.scheme!='http' or u.hostname!='127.0.0.1' or not u.port or u.path or u.query or u.fragment or u.username or u.password:
            raise ValueError('CP24 UI and bridge require exact loopback HTTP origins')
    config=fixture(directory,rpc,origin,owner_mode=True)
    config.update(cp24=True,bridgeOrigin=bridge,bridgeToken=secrets.token_urlsafe(32))
    path=Path(directory)/'config.json';path.write_text(json.dumps(config,indent=2)+'\n');path.chmod(0o600)
    b=load(config)
    with b.store.transaction() as db:
        db.execute("UPDATE users SET enabled=0 WHERE id='partner-b'")
        db.execute('DELETE FROM qualifications')
        ref=random_id()
        db.execute('INSERT INTO qualifications VALUES(?,?,1,1,1,0,0)',('partner-a',ref))
        db.execute('INSERT INTO cp24_instance VALUES(1,NULL,?,?,?)',(random_id(),random_id(),ref))
    return config

def serve(app,port):
    from werkzeug.serving import make_server, WSGIRequestHandler
    class Quiet(WSGIRequestHandler):
        def log(self,*args,**kwargs): pass
    server=make_server('127.0.0.1',port,app,threaded=False,request_handler=Quiet)
    def stop(*_): threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    try: server.serve_forever()
    finally: server.server_close()

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['setup','web','worker','bridge'])
    p.add_argument('--directory',required=True);p.add_argument('--rpc-url',default='http://127.0.0.1:19145')
    p.add_argument('--origin',default='http://127.0.0.1:15247');p.add_argument('--bridge-origin',default='http://127.0.0.1:19146')
    p.add_argument('--port',type=int,default=19115);a=p.parse_args()
    if a.command=='setup': setup(a.directory,a.rpc_url,a.origin,a.bridge_origin);print('Fresh CP24 local instance ready');return
    c=json.loads((Path(a.directory)/'config.json').read_text())
    if c.get('cp24') is not True: raise ValueError('Explicit CP24 instance required')
    if a.command=='bridge':
        from server.local_e2e.bridge import create_bridge
        serve(create_bridge(c),a.port);return
    b=load(c)
    if a.command=='web':
        from server.local_e2e.web import create_app
        serve(create_app(b,c),a.port)
    else:
        from server.outbox import Worker
        worker=Worker(b,load_worker_keys(c))
        stopping=threading.Event()
        signal.signal(signal.SIGTERM,lambda *_:stopping.set());signal.signal(signal.SIGINT,lambda *_:stopping.set())
        while not stopping.is_set():
            try: worker.tick()
            except Exception: print('CP24 worker unavailable; original operations preserved',flush=True)
            stopping.wait(0.5)
if __name__=='__main__': main()
