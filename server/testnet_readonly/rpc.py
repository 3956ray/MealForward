"""Fixed destination, read-only method admission, bounded attempts. No retry."""
import json
import time
import requests
from server.alchemy_readonly import load_endpoint
from .identity import ROOT, ReadError

METHODS = frozenset(('eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance',
                     'eth_getLogs','eth_getTransactionReceipt'))
class ReadRpc:
    def __init__(self, *, session=None, clock=time.monotonic):
        try: self.endpoint=load_endpoint(ROOT/'.localbackend/alchemy/config.json')
        except Exception: raise ReadError('CONFIG_UNAVAILABLE') from None
        self.session=session or requests.Session(); self.session.trust_env=False
        self.clock=clock; self.deadline=clock()+30; self.attempts=0
    def call(self, method, params):
        if method not in METHODS: raise ReadError('METHOD_DENIED')
        if self.attempts>=40 or self.clock()>=self.deadline: raise ReadError('SYNC_BUDGET')
        self.attempts+=1; deadline=min(self.deadline,self.clock()+6)
        try:
            remaining=max(.01,deadline-self.clock())
            with self.session.post(self.endpoint,json={'jsonrpc':'2.0','id':self.attempts,'method':method,'params':params},
                                   headers={'Accept-Encoding':'identity'},timeout=(min(2,remaining),min(3,remaining)),
                                   allow_redirects=False,stream=True) as response:
                if response.status_code==429: raise ReadError('RPC_RATE_LIMITED')
                if response.status_code!=200: raise ReadError('RPC_UNAVAILABLE')
                if response.headers.get('Content-Encoding','identity').lower()!='identity': raise ReadError('RPC_ENCODING_DENIED')
                body=bytearray()
                while True:
                    if self.clock()>=deadline: raise ReadError('RPC_TIMEOUT')
                    part=response.raw.read(1,decode_content=False)
                    if self.clock()>=deadline: raise ReadError('RPC_TIMEOUT')
                    if not part: break
                    body.extend(part)
                    if len(body)>1024*1024: raise ReadError('RPC_LIMIT')
                result=json.loads(body)
                if not isinstance(result,dict) or result.get('jsonrpc')!='2.0' or type(result.get('id')) is not int or result['id']!=self.attempts:
                    raise ReadError('RPC_PROTOCOL')
                if 'error' in result or 'result' not in result: raise ReadError('RPC_REJECTED')
                return result['result']
        except ReadError: raise
        except requests.Timeout: raise ReadError('RPC_TIMEOUT') from None
        except Exception: raise ReadError('RPC_UNAVAILABLE') from None
    def close(self): self.session.close()
