"""Memory-only HTTP/parser and subprocess protocol checks. Never DNS/TLS/HTTP/RPC IO."""
from copy import deepcopy
import io
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from business import rpc_transport as rpc, rpc_worker as worker
from business.codec import BusinessCodec
from business.observer import PINS, RUNTIME_PIN

NODE='/opt/homebrew/bin/node'
ROOT=Path(__file__).resolve().parent


def w(n): return '0x'+f'{n:064x}'
def a(n): return '0x'+f'{n:040x}'


def profile():
    binding={'chainId':10143,'escrow':a(1),'asset':a(2),'storeId':w(3),'owner':a(4),'receiver':a(4),
             'quoteAuthority':a(5),'catalogAuthority':a(6),'issuerAuthority':a(7),'operatorAuthority':a(8)}
    evidence={**binding,'chainId':'10143','configHash':w(9),'parametersDigest':w(10),'transactionHash':w(11),
              'blockHash':w(12),'registrationId':w(13),'catalog':[{'terms':{'mealId':w(14)}}],'deployment':{'synthetic':True}}
    return {'binding':binding,'registrationState':'CONFIRMED','registrationEvidence':evidence,'genesisHash':w(15),
            'finality':'rpc-finalized','eip1898':True,'runtimeTemplatePin':RUNTIME_PIN,'compilerPins':PINS,
            'budget':{'maxCalls':96,'maxTotalMs':20000,'maxCallMs':3000,'maxResponseBytes':1048576,'maxTotalBytes':1048576,'maxMealIds':1}}


class FakeProcess:
    """All request bytes remain memory; no Python worker is actually launched."""
    provider=None
    def __init__(self,args,**kwargs):
        assert kwargs['env']=={} and kwargs['stderr']==subprocess.DEVNULL and args[1]=='-I'
        self.returncode=0;self.stdin=io.BytesIO();self.stdout=io.BytesIO()
    def communicate(self,raw,timeout):
        packet=rpc.strict_json(raw)
        assert timeout>0
        result=self.provider(packet['method'],packet['params'])
        return rpc.json_bytes({'response':{'jsonrpc':'2.0','id':packet['id'],'result':result},'responseBytes':128}),None
    def poll(self): return self.returncode
    def wait(self,timeout): return self.returncode
    def kill(self): self.returncode=-9


class FakeSocket:
    def __init__(self,raw): self.raw=raw
    def makefile(self,*args): return io.BytesIO(self.raw)
    def settimeout(self,value): assert value>0


class FakeConnection:
    raw=b''
    seen=[]
    def __init__(self,host,port,timeout,context):
        assert host=='rpc.synthetic.invalid' and port==443 and timeout>0
        self.sock=FakeSocket(self.raw);self.closed=False
    def connect(self): pass
    def request(self,method,path,body,headers):
        self.seen.append((method,path,headers));assert method=='POST' and headers['Accept-Encoding']=='identity'
    def getresponse(self):
        response=self.response_class(self.sock,method='POST');response.begin();return response
    def close(self): self.closed=True


class BusinessTransportTest(unittest.TestCase):
    def transport(self,**changes):
        values={'endpoint':'https://rpc.synthetic.invalid/only','allowed_endpoints':['https://rpc.synthetic.invalid/only'],
                'allowed_hosts':['rpc.synthetic.invalid'],'python_executable':sys.executable,'profile':profile()}
        values.update(changes)
        return rpc.ReadOnlyBusinessRpcTransport(**values)

    def test_actual_codec_selector_scope_and_exact_snapshot_arguments(self):
        code="import{toFunctionSelector}from'viem';import{businessEscrowAbi}from'./index.mjs';console.log(JSON.stringify(businessEscrowAbi.filter(x=>x.type==='function'&&x.stateMutability==='view').map(x=>[x.name,toFunctionSelector(x),x.inputs.map(y=>y.type)])));"
        done=subprocess.run([NODE,'--input-type=module','-e',code],env={},cwd=str(ROOT),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=2,check=True)
        actual={selector:(name,tuple(inputs)) for name,selector,inputs in json.loads(done.stdout)}
        self.assertTrue(all(actual[selector]==entry for selector,entry in rpc.READ_ABI.items()))
        codec=BusinessCodec(NODE);p=profile();block={'number':'10','hash':w(16)}
        scope={'binding':p['binding'],'stateBlockHash':w(16),'originalTransactionHash':None,'allowedBlockNumbers':[0,10]}
        for name,args in [('getAccounting',[]),('getUnit',['0']),('getOperation',[w(17)]),('operationPayloadHash',['5',p['binding']['issuerAuthority'],w(17),w(18)])]:
            read=codec.call('prepareRead',{'binding':p['binding'],'functionName':name,'args':args,'block':block})
            params=[{'to':read['to'],'data':read['data']},read['blockTag']]
            rpc.validate_request('eth_call',params,scope)
            with self.assertRaises(rpc.BusinessTransportError): rpc.validate_request('eth_call',[{**params[0],'to':a(99)},params[1]],scope)
        for method,params in [('eth_sendRawTransaction',['0x1234']),('eth_getCode',[a(1),'latest']),('eth_getTransactionReceipt',[w(2)])]:
            with self.assertRaises(rpc.BusinessTransportError): rpc.validate_request(method,params,scope)
        bad=[{'to':a(1),'data':'0x2bb7c0f4'+f'{10:064x}'},{'blockHash':w(16),'requireCanonical':True}]
        with self.assertRaises(rpc.BusinessTransportError): rpc.validate_request('eth_call',bad,scope)

    def test_fresh_session_canonical_headers_and_exact_original_transport_protocol(self):
        p=profile();codec=BusinessCodec(NODE)
        prepared=codec.call('prepareIssue',{'binding':p['binding'],'caller':a(7),'now':'0','parameters':{'opId':w(17),'mealId':w(14),'expectedUnitSeq':'0','expectedNextGeneration':'1','expectedTermsHash':w(18),'deadline':'200'}})
        deployment={key:prepared[key] for key in ('chainId','from','to','value','data','callDataDigest')}
        transaction={'hash':w(19),'from':a(7),'to':a(1),'value':'0x0','chainId':'0x279f','input':deployment['data']}
        receipt={'transactionHash':w(19),'from':a(7),'to':a(1),'blockHash':w(16),'blockNumber':'0xa','status':'0x1'}
        def provider(method,params):
            if method=='eth_chainId': return '0x279f'
            if method=='eth_getTransactionByHash': return transaction
            if method=='eth_getTransactionReceipt': return receipt
            if method=='eth_getBlockByNumber': return {'number':'0x0','hash':w(15)} if params[0]=='0x0' else {'number':'0xa','hash':w(16)}
            if method=='eth_getCode': return '0x1234'
            raise AssertionError('unexpected memory request')
        FakeProcess.provider=staticmethod(provider)
        with patch.object(rpc.subprocess,'Popen',FakeProcess):
            transport=self.transport(original_transaction_hash=w(19),original_deployment=deployment)
            deadline=time.monotonic()+3
            with self.assertRaises(rpc.BusinessTransportError): transport.request('eth_getCode',[a(1),{'blockHash':w(16),'requireCanonical':True}],deadline=deadline)
            self.assertEqual(transport.request('eth_getTransactionByHash',[w(19)],deadline=deadline),transaction)
            transport.request('eth_getTransactionReceipt',[w(19)],deadline=deadline)
            transport.request('eth_chainId',[],deadline=deadline)
            transport.request('eth_getBlockByNumber',['0x0',False],deadline=deadline)
            transport.request('eth_getBlockByNumber',['finalized',False],deadline=deadline)
            transport.request('eth_getBlockByNumber',['0xa',False],deadline=deadline)
            self.assertEqual(transport.request('eth_getCode',[a(1),{'blockHash':w(16),'requireCanonical':True}],deadline=deadline),'0x1234')
            self.assertEqual(transport.calls,7)
            with self.assertRaises(rpc.BusinessTransportError): transport.request('eth_getTransactionReceipt',[w(99)],deadline=deadline)
            self.assertEqual(self.transport().calls,0)
            with self.assertRaises(rpc.BusinessTransportError): transport.request('eth_chainId',[],deadline=time.monotonic()-1)
            closed=self.transport()
            FakeProcess.provider=staticmethod(lambda method,params:'0x1')
            with self.assertRaises(rpc.BusinessTransportError): closed.request('eth_chainId',[],deadline=deadline)
            with self.assertRaisesRegex(rpc.BusinessTransportError,'BUSINESS_RPC_SESSION_CLOSED'): closed.request('eth_chainId',[],deadline=deadline)

    def test_memory_http_no_redirect_and_response_header_byte_limits(self):
        scope={'binding':profile()['binding'],'stateBlockHash':None,'originalTransactionHash':None,'allowedBlockNumbers':[0]}
        packet={'endpoint':'https://rpc.synthetic.invalid/only','allowedEndpoints':['https://rpc.synthetic.invalid/only'],'allowedHosts':['rpc.synthetic.invalid'],
                'scope':scope,'method':'eth_chainId','params':[],'id':1,'maxBytes':1048576,'deadline':time.monotonic()+3}
        body=b'{"jsonrpc":"2.0","id":1,"result":"0x279f"}'
        response=b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body
        with patch.object(worker.http.client,'HTTPSConnection',FakeConnection):
            FakeConnection.raw=response
            result=rpc.strict_json(worker.perform(packet))
            self.assertEqual(result['response']['result'],'0x279f');self.assertEqual(result['responseBytes'],len(response))
            with patch.object(worker.time,'monotonic',return_value=100):
                self.assertEqual(rpc.strict_json(worker.perform({**packet,'deadline':105}))['response']['result'],'0x279f')
                with self.assertRaisesRegex(rpc.BusinessTransportError,'BUSINESS_RPC_PACKET_REJECTED'):
                    worker.perform({**packet,'deadline':105.001})
            FakeConnection.raw=b'HTTP/1.1 302 Found\r\nLocation: https://elsewhere.invalid/\r\nContent-Length: 0\r\n\r\n'
            with self.assertRaises(rpc.BusinessTransportError): worker.perform(packet)
            FakeConnection.raw=response
            with self.assertRaises(rpc.BusinessTransportError): worker.perform({**packet,'maxBytes':len(response)-1})
            FakeConnection.raw=b'HTTP/1.1 200 OK\r\nX-Fill: '+b'x'*16400+b'\r\n\r\n'
            with self.assertRaises(rpc.BusinessTransportError): worker.perform(packet)
            self.assertTrue(all(method=='POST' and path=='/only' for method,path,_ in FakeConnection.seen))

    def test_invalid_config_and_budget_reject_without_worker_or_network(self):
        for endpoint in ('http://rpc.synthetic.invalid/only','https://other.invalid/only','https://rpc.synthetic.invalid:444/only','https://user:pass@rpc.synthetic.invalid/only','https://@rpc.synthetic.invalid/only'):
            with self.assertRaises(rpc.BusinessTransportError): self.transport(endpoint=endpoint,allowed_endpoints=[endpoint])
        p=profile();p['budget']['maxCalls']=97
        with self.assertRaises(rpc.BusinessTransportError): self.transport(profile=p)
        with self.assertRaises(rpc.BusinessTransportError): self.transport(original_transaction_hash=w(1))
        with self.assertRaises(rpc.BusinessTransportError): rpc.strict_json('{"id":1,"id":2}')


if __name__=='__main__': unittest.main()
