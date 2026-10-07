import asyncio
import json
import re
import time
from pathlib import Path
import aiohttp

PROFILE=json.loads(Path(__file__).with_name('network-profile.json').read_text())
METHODS=frozenset(('eth_chainId','eth_getBlockByNumber','eth_getBalance','eth_getCode'))
ADDRESS=re.compile(r'^0x[0-9a-fA-F]{40}$')
HASH=re.compile(r'^0x[0-9a-fA-F]{64}$')

class CheckError(Exception): pass

def number(value):
    if not isinstance(value,str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)',value): raise CheckError('RPC_SCHEMA')
    return int(value,16)

def block(value):
    if not isinstance(value,dict) or not HASH.fullmatch(str(value.get('hash',''))): raise CheckError('RPC_SCHEMA')
    return {'number':number(value.get('number')),'hash':value['hash'],'timestamp':number(value.get('timestamp'))}

class ReadRpc:
    methods=METHODS
    max_calls=12
    def __init__(self,session,clock=time.monotonic):
        self.session=session;self.clock=clock;self.deadline=clock()+20;self.calls=0
    async def call(self,method,params):
        if method not in self.methods: raise CheckError('METHOD_DENIED')
        self.validate(method,params)
        if self.calls>=self.max_calls or self.clock()>=self.deadline: raise CheckError('RPC_BUDGET')
        self.calls+=1
        try:
            async with asyncio.timeout(min(3,self.deadline-self.clock())):
                async with self.session.post(PROFILE['rpcUrl'],json={'jsonrpc':'2.0','id':self.calls,'method':method,'params':params},allow_redirects=False,headers={'Accept-Encoding':'identity'}) as response:
                    if response.status!=200: raise CheckError('RPC_UNAVAILABLE')
                    if response.headers.get('Content-Encoding','identity')!='identity': raise CheckError('RPC_ENCODING')
                    body=bytearray()
                    async for chunk in response.content.iter_chunked(8192):
                        body.extend(chunk)
                        if len(body)>1048576: raise CheckError('RPC_SIZE_LIMIT')
                    data=json.loads(body)
                    if not isinstance(data,dict) or data.get('jsonrpc')!='2.0' or type(data.get('id')) is not int or data['id']!=self.calls or 'error' in data or 'result' not in data: raise CheckError('RPC_SCHEMA')
                    return data['result']
        except CheckError: raise
        except TimeoutError: raise CheckError('RPC_TIMEOUT') from None
        except Exception: raise CheckError('RPC_UNAVAILABLE') from None
    def validate(self,method,params):pass

def item(status,reason,**fields):return {'status':status,'reason':reason,**fields}

async def inspect(rpc,address,now=time.time):
    start=now()
    result={'address':address,'profileId':PROFILE['profileId'],'sourceLabel':PROFILE['sourceLabel'],'targetChainId':10143,'rpcChainId':None,'startedAt':start,'checkedAt':None,'expiresAt':start+60,
            'network':item('NOT_CHECKED','NOT_CHECKED'),'account':item('NOT_CHECKED','NOT_CHECKED'),
            'deployment':item('NOT_CONFIGURED','NO_MANIFEST'),'roles':item('NOT_CHECKED','NO_MANIFEST')}
    try:
        chain=number(await rpc.call('eth_chainId',[]));result['rpcChainId']=chain
        if chain!=10143:raise CheckError('WRONG_RPC_CHAIN')
        genesis=block(await rpc.call('eth_getBlockByNumber',['0x0',False]))
        if genesis['hash'].lower()!=PROFILE['genesisHash']:raise CheckError('GENESIS_MISMATCH')
        latest=block(await rpc.call('eth_getBlockByNumber',['latest',False]))
        finalized=block(await rpc.call('eth_getBlockByNumber',['finalized',False]))
        current=now()
        if latest['timestamp']>current+30 or current-latest['timestamp']>120 or finalized['timestamp']>latest['timestamp'] or finalized['number']>latest['number']:raise CheckError('BLOCK_STALE_OR_CONFLICT')
        if latest['number']==finalized['number'] and (latest['hash'].lower()!=finalized['hash'].lower() or latest['timestamp']!=finalized['timestamp']):raise CheckError('BLOCK_CONFLICT')
        tag=hex(finalized['number'])
        balance=number(await rpc.call('eth_getBalance',[address,tag]))
        code=await rpc.call('eth_getCode',[address,tag])
        if not isinstance(code,str) or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})*',code):raise CheckError('RPC_SCHEMA')
        canonical=block(await rpc.call('eth_getBlockByNumber',[tag,False]))
        if canonical!=finalized:raise CheckError('BLOCK_CONFLICT')
        if now()>=start+60:raise CheckError('OBSERVATION_EXPIRED')
        result.update(checkedAt=now(),block=finalized,latestBlock=latest)
        result['network']=item('PASS','NETWORK_MATCH')
        result['account']=item('PASS' if code=='0x' else 'FAIL','EOA_OBSERVED' if code=='0x' else 'ACCOUNT_HAS_CODE',balanceWei=str(balance),hasCode=code!='0x')
    except CheckError as e:
        result['network']=item('FAIL',str(e));result['account']=item('NOT_CHECKED','CHECK_INCOMPLETE')
    return result

async def check(address):
    from .contract_check import ContractRpc,inspect_contract
    async with aiohttp.ClientSession(trust_env=False,auto_decompress=False,timeout=aiohttp.ClientTimeout(total=3)) as session:
        rpc=ContractRpc(session)
        return await inspect_contract(rpc,address)
