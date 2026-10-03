"""Fixed private Alchemy destination and redacted, bounded JSON-RPC."""
import json
import re
import time
from pathlib import Path
import requests
from server.alchemy_readonly import load_endpoint

ROOT = Path(__file__).resolve().parents[2]
GENESIS = '0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9'
METHODS = frozenset(('eth_chainId', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_getCode',
                     'eth_getTransactionCount', 'eth_getTransactionReceipt', 'eth_getTransactionByHash',
                     'eth_estimateGas', 'eth_call', 'eth_sendRawTransaction'))

class Stop(Exception):
    """Only static non-secret codes may cross the CLI boundary."""


def number(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})', value):
        raise Stop('RPC_PROTOCOL')
    return int(value, 16)


def hexbytes(value, length=None):
    if not isinstance(value, str) or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})*', value):
        raise Stop('RPC_PROTOCOL')
    if length is not None and len(value) != 2+length*2:
        raise Stop('RPC_PROTOCOL')
    return bytes.fromhex(value[2:])


class Rpc:
    def __init__(self):
        try:
            self.endpoint = load_endpoint(ROOT / '.localbackend/alchemy/config.json')
        except Exception:
            raise Stop('CONFIG_UNAVAILABLE') from None
        self.session = requests.Session()
        self.session.trust_env = False

    def call(self, method, params):
        if method not in METHODS: raise Stop('METHOD_DENIED')
        deadline = time.monotonic()+10
        try:
            with self.session.post(self.endpoint, json={'jsonrpc':'2.0','id':1,'method':method,'params':params},
                                   headers={'Accept-Encoding':'identity'},
                                   timeout=(2,5), allow_redirects=False, stream=True) as response:
                if response.status_code != 200: raise Stop('RPC_UNAVAILABLE')
                # Reject compression rather than waiting inside a decompressor for output.
                if response.headers.get('Content-Encoding','identity').strip().lower() not in ('','identity'):
                    raise Stop('RPC_ENCODING_DENIED')
                body = bytearray()
                while True:
                    if time.monotonic()>=deadline: raise Stop('RPC_LIMIT')
                    # read(1024)/iter_content can wait for an entire chunk on a trickle stream.
                    # Read raw bytes without transparent decoding so each byte checks wall time.
                    chunk=response.raw.read(1,decode_content=False)
                    if time.monotonic()>=deadline: raise Stop('RPC_LIMIT')
                    if not chunk: break
                    body.extend(chunk)
                    if len(body)>1024*1024: raise Stop('RPC_LIMIT')
                value = json.loads(body)
                if not isinstance(value,dict) or value.get('jsonrpc')!='2.0' or type(value.get('id')) is not int or value['id']!=1:
                    raise Stop('RPC_PROTOCOL')
                if 'error' in value: raise Stop('RPC_REJECTED')
                if 'result' not in value: raise Stop('RPC_PROTOCOL')
                return value['result']
        except Stop: raise
        except Exception: raise Stop('RPC_UNAVAILABLE') from None

    def guard(self, genesis=GENESIS):
        if number(self.call('eth_chainId',[]))!=10143: raise Stop('WRONG_CHAIN')
        block=self.call('eth_getBlockByNumber',['0x0',False])
        if not isinstance(block,dict) or block.get('hash','').lower()!=genesis.lower(): raise Stop('GENESIS_CHANGED')
