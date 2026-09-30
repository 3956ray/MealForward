"""Public-chain-only adapter; no qualification, cookie or invitation data crosses this boundary."""
import json
import requests
from pathlib import Path
from urllib.parse import urlsplit
from eth_utils import event_abi_to_log_topic
from web3 import Web3, HTTPProvider
from web3.exceptions import TransactionNotFound
from web3._utils.events import get_event_data

ABI = json.loads((Path(__file__).resolve().parents[2] / 'shared/MealForward.abi.json').read_text())
PRICE = 10**15
RULE = Web3.to_hex(Web3.keccak(text='mealforward-cp13-local-v1'))
ZERO = '0x' + '0' * 64

def hx(value):
    return value if isinstance(value, str) else Web3.to_hex(value)

def plain(value):
    if isinstance(value, (bytes, bytearray)): return hx(value)
    if isinstance(value, dict) or hasattr(value, 'items'): return {k: plain(v) for k,v in value.items()}
    if isinstance(value, (list,tuple)): return [plain(v) for v in value]
    return value

class ChainUnavailable(Exception): pass
class ChainConflict(Exception): pass

class ChainRpc:
    def __init__(self, deployment):
        self.deployment = deployment
        u = urlsplit(deployment['rpcUrl'])
        if u.scheme != 'http' or u.hostname not in ('127.0.0.1','localhost','::1') or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
            raise ValueError('Only credential-free loopback RPC is allowed')
        if deployment['chainId'] != 31337: raise ValueError('Local chain only')
        # This endpoint is explicitly loopback. Never route signed transactions
        # through environment/system proxies (including on Flask request threads).
        session=requests.Session();session.trust_env=False
        self.w3 = Web3(HTTPProvider(deployment['rpcUrl'],session=session,request_kwargs={'timeout':3,'allow_redirects':False},exception_retry_configuration=None))
        self.contract = self.w3.eth.contract(address=Web3.to_checksum_address(deployment['contractAddress']),abi=ABI)
        self.event_abis = {hx(event_abi_to_log_topic(a)): a for a in ABI if a['type']=='event'}
        self.guard()
    def guard(self):
        if self.w3.eth.chain_id != 31337 or 'anvil' not in self.w3.client_version.lower(): raise ChainConflict('Wrong local chain')
        if hx(self.w3.keccak(self.w3.eth.get_code(self.contract.address))).lower() != self.deployment['codeHash'].lower(): raise ChainConflict('Contract code changed')
        if hx(self.w3.eth.get_block(0)['hash']).lower() != self.deployment['genesisHash'].lower(): raise ChainConflict('Node instance changed')
        if self.contract.functions.ruleVersion().call().hex() != RULE[2:] or self.contract.functions.priceWei().call()!=PRICE:
            raise ChainConflict('Rule changed')
    def receipt(self, tx_hash):
        try: return self.w3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound: return None
    def events(self, start, end):
        logs = self.w3.eth.get_logs({'address':self.contract.address,'fromBlock':start,'toBlock':end})
        result=[]
        for log in logs:
            abi = self.event_abis.get(hx(log['topics'][0]))
            if not abi: continue
            decoded = get_event_data(self.w3.codec,abi,log)
            result.append({'deploymentId':self.deployment['deploymentId'],'chainId':31337,'contract':self.contract.address,
                'blockNumber':log['blockNumber'],'blockHash':hx(log['blockHash']),'transactionHash':hx(log['transactionHash']),
                'transactionIndex':log['transactionIndex'],'logIndex':log['logIndex'],'eventName':decoded['event'],'args':plain(decoded['args'])})
        return sorted(result,key=lambda e:(e['blockNumber'],e['transactionIndex'],e['logIndex']))
    def verify_event(self, event):
        receipt=self.receipt(event['transactionHash'])
        if receipt is None: raise ChainUnavailable('Missing receipt')
        block=self.w3.eth.get_block(event['blockNumber'])
        if receipt['status']!=1 or hx(receipt['blockHash'])!=event['blockHash'] or hx(block['hash'])!=event['blockHash']:
            raise ChainConflict('Canonical receipt conflict')
        matching=[l for l in receipt['logs'] if l['logIndex']==event['logIndex'] and l['address'].lower()==self.contract.address.lower()]
        if len(matching)!=1:
            raise ChainConflict('Missing receipt log')
        log=matching[0]
        abi=self.event_abis.get(hx(log['topics'][0]))
        if not abi: raise ChainConflict('Unknown receipt event')
        decoded=get_event_data(self.w3.codec,abi,log)
        if (decoded['event']!=event['eventName'] or plain(decoded['args'])!=event['args']
                or event['deploymentId']!=self.deployment['deploymentId'] or event['chainId']!=31337
                or event['contract'].lower()!=self.contract.address.lower()
                or receipt['blockNumber']!=event['blockNumber'] or receipt['transactionIndex']!=event['transactionIndex']):
            raise ChainConflict('Receipt event payload conflict')
        return receipt
    def transaction_matches(self, tx_hash, *, sender, data, value):
        tx=self.w3.eth.get_transaction(tx_hash)
        return (tx['from'].lower()==sender.lower() and (tx.get('to') or '').lower()==self.contract.address.lower()
                and hx(tx['input']).lower()==data.lower() and tx['value']==value and tx.get('chainId')==31337)
    def broadcast_same_raw(self, raw):
        self.guard()
        return hx(self.w3.eth.send_raw_transaction(raw))
