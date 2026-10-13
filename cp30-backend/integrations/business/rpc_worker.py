"""Owned single HTTPS request worker. Real request code is NOT used by offline checks."""
import http.client
import math
from pathlib import Path
import ssl
import sys
import time

# -I: add only the fixed sibling source directory, never caller/config/module paths.
if __package__:
    from .rpc_transport import BusinessTransportError, endpoint_config, json_bytes, strict_json, validate_request
else:
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    from rpc_transport import BusinessTransportError, endpoint_config, json_bytes, strict_json, validate_request


class _LimitedReader:
    def __init__(self,stream,cap): self.stream=stream;self.cap=cap;self.bytes=0;self.headers=True
    def _size(self,size): return min(self.cap-self.bytes+1,size) if size>=0 else self.cap-self.bytes+1
    def _count(self,n):
        self.bytes+=n
        if self.bytes>self.cap or (self.headers and self.bytes>16384): raise BusinessTransportError('BUSINESS_RPC_RESPONSE_LIMIT')
    def readline(self,size=-1):
        value=self.stream.readline(min(self._size(size),16385-self.bytes) if self.headers else self._size(size));self._count(len(value));return value
    def read(self,size=-1):
        value=self.stream.read(self._size(size));self._count(len(value));return value
    def readinto(self,buffer):
        n=self.stream.readinto(memoryview(buffer)[:self._size(len(buffer))]);self._count(n or 0);return n
    def __getattr__(self,name): return getattr(self.stream,name)


class _LimitedResponse(http.client.HTTPResponse):
    max_bytes=1048576
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs);self.reader=_LimitedReader(self.fp,self.max_bytes);self.fp=self.reader
    def begin(self):
        super().begin();self.reader.headers=False


def perform(packet):
    if type(packet) is not dict or set(packet)!={'endpoint','allowedEndpoints','allowedHosts','scope','method','params','id','maxBytes','deadline'}: raise BusinessTransportError('BUSINESS_RPC_PACKET_REJECTED')
    host,path,query=endpoint_config(packet['endpoint'],packet['allowedEndpoints'],packet['allowedHosts'])
    validate_request(packet['method'],packet['params'],packet['scope'])
    cap,end=packet['maxBytes'],packet['deadline']
    if type(cap) is not int or not 1<=cap<=1048576 or type(end) not in (int,float) or not math.isfinite(end) or not 0<end-time.monotonic()<=5 or type(packet['id']) is not int or not 1<=packet['id']<=96: raise BusinessTransportError('BUSINESS_RPC_PACKET_REJECTED')
    def remaining():
        value=end-time.monotonic()
        if value<=0: raise BusinessTransportError('BUSINESS_RPC_TIME_LIMIT')
        return value
    connection=http.client.HTTPSConnection(host,port=443,timeout=remaining(),context=ssl.create_default_context())
    # Cap status+headers+body+chunk framing while parsing, not after a large header allocation.
    connection.response_class=type('BoundedBusinessResponse',(_LimitedResponse,),{'max_bytes':cap})
    try:
        connection.connect();connection.sock.settimeout(remaining())
        body=json_bytes({'jsonrpc':'2.0','id':packet['id'],'method':packet['method'],'params':packet['params']})
        connection.request('POST',path+('?' + query if query else ''),body=body,
                           headers={'Content-Type':'application/json','Accept':'application/json','Accept-Encoding':'identity','Connection':'close'})
        connection.sock.settimeout(remaining());response=connection.getresponse()
        # Direct stdlib connection has no redirect/proxy behavior; reject all non-200.
        if response.status!=200 or response.getheader('Content-Encoding','identity').lower()!='identity' or response.getheader('Content-Type','').split(';')[0].strip().lower()!='application/json': raise BusinessTransportError('BUSINESS_RPC_HTTP_REJECTED')
        length=response.getheader('Content-Length')
        if length is not None and (not length.isdecimal() or int(length)>cap-response.reader.bytes): raise BusinessTransportError('BUSINESS_RPC_RESPONSE_LIMIT')
        output=bytearray()
        while True:
            if connection.sock is not None: connection.sock.settimeout(remaining())
            else: remaining()
            chunk=response.read(min(65536,cap+1-len(output)))
            if not chunk: break
            output.extend(chunk)
            if len(output)>cap: raise BusinessTransportError('BUSINESS_RPC_RESPONSE_LIMIT')
        remaining();value=strict_json(output)
        if type(value) is not dict or set(value)!={'jsonrpc','id','result'} or value['jsonrpc']!='2.0' or type(value['id']) is not int or value['id']!=packet['id']: raise BusinessTransportError('BUSINESS_RPC_RESPONSE_REJECTED')
        return json_bytes({'response':value,'responseBytes':response.reader.bytes})
    finally: connection.close()


def failure_code(error):
    if isinstance(error,TimeoutError):return 'BUSINESS_RPC_TIMEOUT'
    if isinstance(error,ssl.SSLError):return 'BUSINESS_RPC_TLS_FAILED'
    if isinstance(error,OSError):return 'BUSINESS_RPC_CONNECTION_FAILED'
    if isinstance(error,BusinessTransportError) and str(error) in {'BUSINESS_RPC_HTTP_REJECTED','BUSINESS_RPC_RESPONSE_REJECTED','BUSINESS_RPC_RESPONSE_LIMIT','BUSINESS_RPC_TIME_LIMIT'}:return str(error)
    return 'BUSINESS_RPC_WORKER_EXIT'

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(16385)
        if len(raw)>16384: raise BusinessTransportError('BUSINESS_RPC_INPUT_LIMIT')
        sys.stdout.buffer.write(perform(strict_json(raw)))
    except Exception as error:
        sys.stdout.buffer.write(json_bytes({'error':failure_code(error)}));sys.exit(1)
