"""Explicit isolated browser fixture: synthetic provider and zero address only."""
import argparse,json,os,signal,socket,subprocess,threading,time
from pathlib import Path
import requests
from flask import jsonify
from werkzeug.serving import make_server,WSGIRequestHandler
from server.wallet_readiness.web import create_app
from server.wallet_readiness.check import check
from server.wallet_readiness.contract_check import inspect_contract
from tests.test_cp27_readiness import ContractFake
p=argparse.ArgumentParser();p.add_argument('--real-rpc',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parents[1]
reserve=socket.socket();reserve.bind(('127.0.0.1',0));port=reserve.getsockname()[1];origin=f'http://127.0.0.1:{port}'
counts={'posts':0,'mode':'real-approved-public-rpc' if args.real_rpc else 'fake-rpc','account':'synthetic-zero-only'}
async def checker(address):
    assert address=='0x'+'0'*40
    counts['posts']+=1
    return await check(address) if args.real_rpc else await inspect_contract(ContractFake(),address,now=lambda:time.time())
# Fake block timestamp must be fresh while all calls still share the same block.
if not args.real_rpc:
    from tests.test_cp26_readiness import BLOCK
    BLOCK['timestamp']=hex(int(time.time())-2)
app=create_app(origin,True,checker)
@app.get('/api/cp26/fixture-counts')
def fixture_counts():return jsonify(counts)
class Quiet(WSGIRequestHandler):
    def log(self,*args,**kwargs):pass
api=make_server('127.0.0.1',0,app,threaded=True,request_handler=Quiet);thread=threading.Thread(target=api.serve_forever,daemon=True);thread.start()
stop=threading.Event()
for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
proc=None
try:
 reserve.close();proc=subprocess.Popen([str(root/'node_modules/.bin/vite'),'--config','tests/browser-cp27/vite.config.ts','--port',str(port)],cwd=root,env={**os.environ,'CP27_FIXTURE_API':f'http://127.0.0.1:{api.server_port}'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 with requests.Session() as session:
  session.trust_env=False
  for _ in range(100):
   if proc.poll() is not None:raise RuntimeError('Fixture UI stopped')
   try:
    if session.get(origin+'/api/cp26/fixture-counts',timeout=.2).json()==counts:break
   except (requests.RequestException,ValueError):pass
   stop.wait(.1)
  else:raise RuntimeError('Fixture readiness timeout')
 print(json.dumps({'url':origin,'apiPort':api.server_port,'supervisor':os.getpid(),**counts}),flush=True)
 while not stop.wait(.25):
  if proc.poll() is not None:raise RuntimeError('Fixture UI stopped')
finally:
 reserve.close()
 if proc and proc.poll() is None:os.killpg(proc.pid,signal.SIGTERM);proc.wait(timeout=10)
 api.shutdown();api.server_close();thread.join(timeout=5)
