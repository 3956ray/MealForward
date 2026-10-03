"""Own read-only admission; CP20 transport and method set remain unchanged."""
import json
import time
import requests
from pathlib import Path
from server.alchemy_readonly import load_endpoint
from .chain import FundingError

ROOT=Path(__file__).resolve().parents[2]
METHODS=frozenset(('eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance',
                  'eth_getLogs','eth_getTransactionReceipt','eth_estimateGas','eth_getTransactionCount','eth_getTransactionByHash'))
class FundingRpc:
    def __init__(self,*,session=None,clock=time.monotonic):
        try: self.endpoint=load_endpoint(ROOT/'.localbackend/alchemy/config.json')
        except Exception: raise FundingError('CONFIG_UNAVAILABLE',503) from None
        self.session=session or requests.Session();self.session.trust_env=False
        self.clock=clock;self.deadline=clock()+30;self.attempts=0
    def call(self,method,params):
        if method not in METHODS: raise FundingError('METHOD_DENIED',405)
        if self.attempts>=40 or self.clock()>=self.deadline: raise FundingError('SYNC_BUDGET',503)
        self.attempts+=1;deadline=min(self.deadline,self.clock()+6)
        try:
            with self.session.post(self.endpoint,json={'jsonrpc':'2.0','id':self.attempts,'method':method,'params':params},
                                   headers={'Accept-Encoding':'identity'},timeout=(2,3),allow_redirects=False,stream=True) as response:
                if response.status_code!=200: raise FundingError('RPC_UNAVAILABLE',503)
                if response.headers.get('Content-Encoding','identity')!='identity': raise FundingError('RPC_ENCODING_DENIED',503)
                body=bytearray()
                while True:
                    if self.clock()>=deadline: raise FundingError('RPC_TIMEOUT',503)
                    part=response.raw.read(1,decode_content=False)
                    if self.clock()>=deadline: raise FundingError('RPC_TIMEOUT',503)
                    if not part: break
                    body.extend(part)
                    if len(body)>1024*1024: raise FundingError('RPC_LIMIT',503)
                data=json.loads(body)
                if (not isinstance(data,dict) or data.get('jsonrpc')!='2.0' or type(data.get('id')) is not int or
                    data['id']!=self.attempts or 'error' in data or 'result' not in data): raise FundingError('RPC_PROTOCOL',503)
                return data['result']
        except FundingError: raise
        except Exception: raise FundingError('RPC_UNAVAILABLE',503) from None
    def close(self): self.session.close()
