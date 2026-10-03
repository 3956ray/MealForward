import hashlib
import json
from pathlib import Path
from eth_abi import encode, decode
from eth_utils import keccak

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
MANIFEST = json.loads((HERE/'manifest.json').read_text())
if hashlib.sha256((HERE/'abi.json').read_bytes()).hexdigest() != MANIFEST['abiSha256']:
    raise RuntimeError('Read ABI identity mismatch')
ABI = json.loads((HERE/'abi.json').read_text())
FUNCTIONS = {a['name']: a for a in ABI if a['type']=='function'}
EVENTS = {'0x'+keccak(text=a['name']+'('+','.join(i['type'] for i in a['inputs'])+')').hex(): a
          for a in ABI if a['type']=='event'}
ADDRESS = MANIFEST['contractAddress']
BATCH = MANIFEST['batchId']
START = MANIFEST['deploymentBlock']
SCOPE_IDENTITY = {k: MANIFEST[k] for k in ('chainId','genesisHash','contractAddress','runtimeCodeHash')}

class ReadError(Exception):
    def __init__(self, code, conflict=False): self.code, self.conflict = code, conflict

def hx(value): return '0x'+bytes(value).hex()
def raw(value):
    try:
        if not isinstance(value,str) or not value.startswith('0x') or len(value)%2: raise ValueError()
        return bytes.fromhex(value[2:])
    except Exception: raise ReadError('RPC_PROTOCOL') from None

def number(value):
    import re
    if not isinstance(value,str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})',value):
        raise ReadError('RPC_PROTOCOL')
    return int(value,16)

def read(rpc, name, args, block):
    a=FUNCTIONS[name]; types=[i['type'] for i in a['inputs']]
    data=hx(keccak(text=name+'('+','.join(types)+')')[:4]+encode(types,args))
    try: return decode([i['type'] for i in a['outputs']],raw(rpc.call('eth_call',[{'to':ADDRESS,'data':data},hex(block)])))
    except ReadError: raise
    except Exception: raise ReadError('CONTRACT_PROTOCOL') from None

def block(rpc, tag):
    b=rpc.call('eth_getBlockByNumber',[tag,False])
    if not isinstance(b,dict) or len(raw(b.get('hash')))!=32: raise ReadError('FINALITY_UNAVAILABLE')
    height=number(b.get('number'))
    if tag.startswith('0x') and height!=number(tag): raise ReadError('BLOCK_CONFLICT',True)
    return height,b['hash'].lower()

def guard(rpc, height):
    if number(rpc.call('eth_chainId',[]))!=10143: raise ReadError('WRONG_CHAIN',True)
    if block(rpc,'0x0')[1]!=MANIFEST['genesisHash']: raise ReadError('GENESIS_CONFLICT',True)
    if hx(keccak(raw(rpc.call('eth_getCode',[ADDRESS,hex(height)]))))!=MANIFEST['runtimeCodeHash']:
        raise ReadError('CODE_CONFLICT',True)
    expected={'merchant':MANIFEST['merchant'].lower(),'priceWei':int(MANIFEST['priceWei']),
              'fundingCapWei':int(MANIFEST['fundingCapWei']),'maxQuantity':3,
              'ruleVersion':raw(MANIFEST['ruleVersion']),'recoveryEnabled':False}
    for name,value in expected.items():
        if read(rpc,name,[],height)[0]!=value: raise ReadError('IDENTITY_CONFLICT',True)

def public_config():
    return dict(chainId=10143,network='Monad Testnet',asset='MON',testOnly=True,contract=ADDRESS,
                deploymentBlock=START,ruleVersion=MANIFEST['ruleVersion'],priceWei=MANIFEST['priceWei'],
                merchant=MANIFEST['merchant'],readOnly=True,transactionsEnabled=False,batchId=BATCH)
