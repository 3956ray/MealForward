"""Owned future HTTP worker. Offline checks never execute this production worker."""
import http.client
import math
from pathlib import Path
import ssl
import sys
import time

if __package__:
    from .original_broadcaster import fail, validate_request, endpoint_config, json_bytes, strict_json
    from .rpc_worker import _LimitedResponse
else:
    # -I imports only the fixed integrations package directory, never caller paths.
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from business.original_broadcaster import fail, validate_request, endpoint_config, json_bytes, strict_json
    from business.rpc_worker import _LimitedResponse


def perform(packet):
    if type(packet) is not dict or set(packet)!={'endpoint','allowedEndpoints','allowedHosts','scope','method','params','id','maxBytes','deadline'}: fail('BROADCAST_RPC_PACKET_REJECTED')
    host,path,query=endpoint_config(packet['endpoint'],packet['allowedEndpoints'],packet['allowedHosts'])
    validate_request(packet['method'],packet['params'],packet['scope'])
    cap,end=packet['maxBytes'],packet['deadline']
    if type(cap) is not int or not 1<=cap<=262144 or type(end) not in (int,float) or not math.isfinite(end) or not 0<end-time.monotonic()<=3 or type(packet['id']) is not int or not 1<=packet['id']<=6: fail('BROADCAST_RPC_PACKET_REJECTED')
    def remaining():
        n=end-time.monotonic()
        if n<=0: fail('BROADCAST_RPC_TIME_LIMIT')
        return n
    c=http.client.HTTPSConnection(host,port=443,timeout=remaining(),context=ssl.create_default_context())
    c.response_class=type('BoundedOriginalResponse',(_LimitedResponse,),{'max_bytes':cap})
    try:
        c.connect();c.sock.settimeout(remaining())
        body=json_bytes({'jsonrpc':'2.0','id':packet['id'],'method':packet['method'],'params':packet['params']})
        c.request('POST',path+('?' + query if query else ''),body=body,headers={'Content-Type':'application/json','Accept':'application/json','Accept-Encoding':'identity','Connection':'close'})
        c.sock.settimeout(remaining());r=c.getresponse()
        if r.status!=200 or r.getheader('Content-Encoding','identity').lower()!='identity' or r.getheader('Content-Type','').split(';')[0].strip().lower()!='application/json': fail('BROADCAST_RPC_HTTP_REJECTED')
        length=r.getheader('Content-Length')
        if length is not None and (not length.isdecimal() or int(length)>cap-r.reader.bytes): fail('BROADCAST_RPC_RESPONSE_LIMIT')
        out=bytearray()
        while True:
            if c.sock is not None: c.sock.settimeout(remaining())
            else: remaining()
            chunk=r.read(min(65536,cap+1-len(out)))
            if not chunk: break
            out.extend(chunk)
            if len(out)>cap: fail('BROADCAST_RPC_RESPONSE_LIMIT')
        remaining();v=strict_json(out)
        if type(v) is not dict or set(v)!={'jsonrpc','id','result'} or v['jsonrpc']!='2.0' or type(v['id']) is not int or v['id']!=packet['id']: fail('BROADCAST_RPC_RESPONSE_REJECTED')
        return json_bytes({'response':v,'responseBytes':r.reader.bytes})
    finally: c.close()

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(32769)
        if len(raw)>32768: fail('BROADCAST_RPC_INPUT_LIMIT')
        sys.stdout.buffer.write(perform(strict_json(raw)))
    except Exception:
        sys.stdout.write('{"error":"BROADCAST_RPC_UNAVAILABLE"}');sys.exit(1)
