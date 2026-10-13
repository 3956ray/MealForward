"""Bounded dedicated registrar JSON-RPC. No connection is made at import/init."""
import http.client
import json
from pathlib import Path
import re
import ssl
import subprocess
import sys
import time
from urllib.parse import urlsplit

class RegistrarRpcClosed(ValueError):pass
def encode(value):return json.dumps(value,separators=(',',':'),allow_nan=False).encode()
def endpoint(settings):
    url=settings['endpoint'];parsed=urlsplit(url)
    if url not in settings['allowedEndpoints'] or parsed.scheme!='https' or parsed.hostname not in settings['allowedHosts'] or parsed.username or parsed.password or parsed.fragment or parsed.port not in (None,443):raise RegistrarRpcClosed('REVIEWED_RPC_ENDPOINT_REQUIRED')
    return parsed.hostname,(parsed.path or '/')+('?' + parsed.query if parsed.query else '')
def validate(method,params,settings):
    word=lambda x:isinstance(x,str) and re.fullmatch('0x[0-9a-f]{64}',x)
    registrar=settings['registrar'];factory=settings['factory']
    ok=False
    if method=='eth_chainId':ok=params==[]
    elif method=='eth_getBlockByNumber':ok=len(params)==2 and params[1] is False and (params[0] in ('0x0','finalized') or re.fullmatch('0x[0-9a-f]+',str(params[0])))
    elif method=='eth_getCode':ok=len(params)==2 and params[0]==factory and type(params[1]) is dict and set(params[1])=={'blockHash','requireCanonical'} and word(params[1]['blockHash']) and params[1]['requireCanonical'] is True
    elif method=='eth_call':ok=len(params)==2 and type(params[0]) is dict and set(params[0])=={'to','data'} and params[0]['to']==factory and params[0]['data'] in settings['factorySelectors'] and type(params[1]) is dict and set(params[1])=={'blockHash','requireCanonical'} and word(params[1]['blockHash']) and params[1]['requireCanonical'] is True
    elif method=='eth_getTransactionCount':ok=params==[registrar,'pending']
    elif method=='eth_getTransactionByHash':ok=len(params)==1 and word(params[0])
    elif method=='eth_sendRawTransaction':ok=settings.get('broadcastEnabled') is True and len(params)==1 and isinstance(params[0],str) and re.fullmatch('0x(?:[0-9a-f]{2})+',params[0]) and len(params[0])<=131072
    if not ok:raise RegistrarRpcClosed('REGISTRAR_RPC_METHOD_DENIED')

def perform(packet):
    settings=packet['settings'];method=packet['method'];params=packet['params'];validate(method,params,settings)
    host,path=endpoint(settings);timeout=packet['timeout'];cap=packet['responseLimit']
    if type(timeout) not in (int,float) or not 0<timeout<=3 or type(cap) is not int or not 1<=cap<=262144:raise RegistrarRpcClosed('REGISTRAR_RPC_BUDGET_REQUIRED')
    end=time.monotonic()+timeout
    def remaining():
        value=end-time.monotonic()
        if value<=0:raise RegistrarRpcClosed('REGISTRAR_RPC_TIMEOUT')
        return value
    connection=http.client.HTTPSConnection(host,443,timeout=remaining(),context=ssl.create_default_context())
    try:
        connection.connect();connection.sock.settimeout(remaining())
        connection.request('POST',path,body=encode({'jsonrpc':'2.0','id':1,'method':method,'params':params}),headers={'Content-Type':'application/json','Accept':'application/json','Accept-Encoding':'identity','Connection':'close'})
        connection.sock.settimeout(remaining());response=connection.getresponse()
        if response.status!=200 or response.getheader('Content-Encoding','identity')!='identity' or response.getheader('Content-Type','').split(';')[0]!='application/json':raise RegistrarRpcClosed('REGISTRAR_RPC_UNAVAILABLE')
        if sum(len(k)+len(v)+4 for k,v in response.getheaders())>16384:raise RegistrarRpcClosed('REGISTRAR_RPC_RESPONSE_LIMIT')
        raw=bytearray()
        while True:
            if connection.sock is not None:connection.sock.settimeout(remaining())
            data=response.read(min(65536,cap+1-len(raw)))
            if not data:break
            raw.extend(data)
            if len(raw)>cap:raise RegistrarRpcClosed('REGISTRAR_RPC_RESPONSE_LIMIT')
        remaining();value=json.loads(raw)
        if type(value) is not dict or value.get('jsonrpc')!='2.0' or value.get('id')!=1 or 'error' in value or 'result' not in value:raise RegistrarRpcClosed('REGISTRAR_RPC_REJECTED')
        return value['result']
    finally:connection.close()

class RegistrarRpc:
    def __init__(self,settings):
        self.settings=dict(settings);endpoint(settings)
        if not 1<=settings['maxCalls']<=48 or not 1<=settings['maxTotalSeconds']<=20:raise RegistrarRpcClosed('REGISTRAR_RPC_BUDGET_REQUIRED')
        self.calls=0;self.started=time.monotonic()
    def request(self,method,params):
        validate(method,params,self.settings);self.calls+=1
        remaining=min(3,self.started+self.settings['maxTotalSeconds']-time.monotonic())
        if self.calls>self.settings['maxCalls'] or remaining<=0:raise RegistrarRpcClosed('REGISTRAR_RPC_BUDGET_EXHAUSTED')
        packet={'settings':self.settings,'method':method,'params':params,'timeout':remaining,'responseLimit':262144}
        child=None
        try:
            child=subprocess.Popen([sys.executable,'-I',str(Path(__file__).resolve()),'--one-request'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={})
            raw,_=child.communicate(encode(packet),timeout=remaining+.1)
            if child.returncode or len(raw)>262144:raise RegistrarRpcClosed('REGISTRAR_RPC_UNAVAILABLE')
            value=json.loads(raw)
            if set(value)!={'result'}:raise RegistrarRpcClosed('REGISTRAR_RPC_REJECTED')
            return value['result']
        except (OSError,subprocess.TimeoutExpired,json.JSONDecodeError):raise RegistrarRpcClosed('REGISTRAR_RPC_UNAVAILABLE') from None
        finally:
            if child is not None:
                if child.poll() is None:child.kill()
                child.wait()

if __name__=='__main__':
    try:
        if sys.argv[1:]!=['--one-request']:raise RegistrarRpcClosed('EXPLICIT_WORKER_REQUIRED')
        raw=sys.stdin.buffer.read(262145)
        if len(raw)>262144:raise RegistrarRpcClosed('REGISTRAR_RPC_REQUEST_LIMIT')
        sys.stdout.buffer.write(encode({'result':perform(json.loads(raw))}))
    except Exception:sys.stdout.write('{"error":"REGISTRAR_RPC_UNAVAILABLE"}');sys.exit(1)
