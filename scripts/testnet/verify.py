"""Read-only canonical receipt, deployment identity, and one-voucher accounting checks."""
from eth_abi import decode
from eth_utils import event_abi_to_log_topic
from hexbytes import HexBytes
from web3 import Web3
from web3._utils.events import get_event_data
from .rpc import Stop, number, hexbytes
from .plan import artifact, contract, PRICE, CAP, RULE, ROLE_NAMES, hx


def read(rpc, address, name, args, types, block='latest'):
    data=contract().encode_abi(name,args=args)
    try: return decode(types,hexbytes(rpc.call('eth_call',[{'to':address,'data':data},block])))
    except Stop: raise
    except Exception: raise Stop('CONTRACT_PROTOCOL') from None


def identity(rpc, plan, records, block='finalized'):
    if block=='finalized':
        finalized=rpc.call('eth_getBlockByNumber',['finalized',False])
        if not isinstance(finalized,dict): raise Stop('FINALITY_UNAVAILABLE')
        block=finalized['number']
    address=plan['contractAddress']
    code=rpc.call('eth_getCode',[address,block])
    if hx(Web3.keccak(hexbytes(code)))!=plan['runtimeCodeHash']: raise Stop('CODE_CHANGED')
    checks=[('merchant',[],['address'],(plan['addresses']['owner'].lower(),)),
            ('priceWei',[],['uint256'],(PRICE,)),('fundingCapWei',[],['uint256'],(CAP,)),
            ('maxQuantity',[],['uint256'],(3,)),('ruleVersion',[],['bytes32'],(bytes(RULE),)),
            ('recoveryEnabled',[],['bool'],(False,))]
    for name,args,types,expected in checks:
        actual=read(rpc,address,name,args,types,block)
        if name=='merchant': actual=(actual[0].lower(),)
        if actual!=expected: raise Stop('CONTRACT_IDENTITY_CHANGED')
    if read(rpc,address,'hasRole',[b'\0'*32,plan['addresses']['deployer']],['bool'],block)!=(True,):
        raise Stop('ROLE_CHANGED')
    for role in ROLE_NAMES:
        grantee=plan['addresses']['operator' if role=='issuer' else role]
        grant=records.get('grant-'+role)
        # A submitted grant may be visible before its receipt can be finalized/reconciled.
        # Only its original receipt can resolve it; neither presence nor absence is a conflict yet.
        if grant and grant.get('state') not in ('FINALIZED','FAILED'):
            continue
        expected=records.get('grant-'+role,{}).get('state')=='FINALIZED'
        present=read(rpc,address,'hasRole',[Web3.keccak(text=ROLE_NAMES[role]),grantee],['bool'],block)[0]
        if present!=expected: raise Stop('ROLE_CHANGED')
    for role in ('deployer','supporter','operator'):
        if read(rpc,address,'hasRole',[Web3.keccak(text='SETTLER_ROLE'),plan['addresses'][role]],['bool'],block)[0]:
            raise Stop('ROLE_CHANGED')


def plain(value):
    if isinstance(value,(bytes,bytearray)): return hx(value).lower()
    if isinstance(value,str): return value.lower() if value.startswith('0x') else value
    if isinstance(value,(list,tuple)): return [plain(v) for v in value]
    if isinstance(value,dict) or hasattr(value,'items'): return {k:plain(v) for k,v in value.items()}
    return value


def event_matches(plan,step,receipt):
    if step['event'] is None: return
    abi=next(a for a in artifact()['abi'] if a.get('type')=='event' and a['name']==step['event'])
    topic=hx(event_abi_to_log_topic(abi)).lower()
    found=[]
    for item in receipt['logs']:
        if item['address'].lower()!=plan['contractAddress'].lower(): continue
        if not item['topics'] or item['topics'][0].lower()!=topic: continue
        converted=dict(item)
        for key in ('blockNumber','transactionIndex','logIndex'): converted[key]=number(converted[key])
        for key in ('blockHash','transactionHash','data'): converted[key]=HexBytes(converted[key])
        converted['topics']=[HexBytes(t) for t in converted['topics']]
        try: found.append(plain(get_event_data(Web3().codec,abi,converted)['args']))
        except Exception: raise Stop('EVENT_CONFLICT') from None
    if found!=[plain(step['eventArgs'])]: raise Stop('EVENT_CONFLICT')


def confirmed(rpc,plan,step,record):
    receipt=rpc.call('eth_getTransactionReceipt',[record['hash']])
    if receipt is None:
        if record['state'] in ('FINALIZED','FAILED'): raise Stop('FINALITY_CONFLICT')
        return None
    if not isinstance(receipt,dict) or receipt.get('transactionHash','').lower()!=record['hash'].lower(): raise Stop('RECEIPT_CONFLICT')
    block_number=number(receipt['blockNumber'])
    finalized=rpc.call('eth_getBlockByNumber',['finalized',False])
    if not isinstance(finalized,dict): raise Stop('FINALITY_UNAVAILABLE')
    if number(finalized['number'])<block_number:
        if record['state'] in ('FINALIZED','FAILED'): raise Stop('FINALITY_CONFLICT')
        return None
    canonical=rpc.call('eth_getBlockByNumber',[hex(block_number),False])
    if not isinstance(canonical,dict) or canonical.get('hash')!=receipt['blockHash']: raise Stop('FINALITY_CONFLICT')
    if 'receipt' in record and record['receipt']['blockHash']!=receipt['blockHash']: raise Stop('FINALITY_CONFLICT')
    transaction=rpc.call('eth_getTransactionByHash',[record['hash']])
    if not isinstance(transaction,dict): raise Stop('TRANSACTION_CONFLICT')
    expected=record['tx']
    if (transaction.get('hash','').lower()!=record['hash'].lower()
        or transaction.get('from','').lower()!=step['sender'].lower()
        or (transaction.get('to') or '').lower()!=(step['to'] or '').lower()
        or transaction.get('input','').lower()!=step['data'].lower()
        or number(transaction['nonce'])!=step['nonce'] or number(transaction['value'])!=int(step['value'])
        or number(transaction['chainId'])!=10143 or number(transaction['gas'])!=expected['gas']
        or number(transaction['maxFeePerGas'])!=expected['maxFeePerGas']
        or number(transaction['maxPriorityFeePerGas'])!=expected['maxPriorityFeePerGas']
        or number(transaction['blockNumber'])!=block_number
        or transaction.get('blockHash')!=receipt['blockHash']
        or receipt.get('from','').lower()!=step['sender'].lower()
        or (receipt.get('to') or '').lower()!=(step['to'] or '').lower()): raise Stop('TRANSACTION_CONFLICT')
    effective=number(receipt['effectiveGasPrice'])
    if effective>expected['maxFeePerGas']: raise Stop('FEE_CONFLICT')
    status=number(receipt['status'])
    if status not in (0,1): raise Stop('RECEIPT_CONFLICT')
    if status==1:
        if step['id']=='deploy' and (receipt.get('contractAddress') or '').lower()!=plan['contractAddress'].lower():
            raise Stop('DEPLOYMENT_CONFLICT')
        event_matches(plan,step,receipt)
    return {'blockNumber':block_number,'blockHash':receipt['blockHash'],'status':status,
            'gasUsed':str(number(receipt['gasUsed'])),'gasLimit':expected['gas'],
            'effectiveGasPrice':str(effective),'feeWei':str(expected['gas']*effective),
            'transactionHash':record['hash']}


def final_accounting(rpc,plan,records):
    if any(records.get(s['id'],{}).get('state')!='FINALIZED' for s in plan['steps']): raise Stop('FLOW_NOT_FINAL')
    block=rpc.call('eth_getBlockByNumber',['finalized',False])
    tag=block['number'];address=plan['contractAddress']
    identity(rpc,plan,records,tag)
    values=read(rpc,address,'getBatch',[plan['batchId']],['uint256']*7,tag)
    if values[:5]!=(PRICE,0,0,0,PRICE): raise Stop('ACCOUNTING_CONFLICT')
    voucher=read(rpc,address,'getVoucher',[plan['voucherId']],['bytes32','uint8','bytes32'],tag)
    if voucher!=(hexbytes(plan['batchId'],32),4,hexbytes(plan['lockId'],32)): raise Stop('ACCOUNTING_CONFLICT')
    for name,expected in (('totalFunded',PRICE),('liability',0),('unallocated',0)):
        if read(rpc,address,name,[],['uint256'],tag)!=(expected,): raise Stop('ACCOUNTING_CONFLICT')
    if number(rpc.call('eth_getBalance',[address,tag]))!=0: raise Stop('ACCOUNTING_CONFLICT')
    balances={role:number(rpc.call('eth_getBalance',[addr,tag])) for role,addr in plan['addresses'].items()}
    # Baseline is captured just before the first planned tx, after faucet funding matures.
    baseline=records['gas-supporter']['balancesBefore']
    expected={role:int(value) for role,value in baseline.items()}
    fees={role:0 for role in expected}
    for step in plan['steps']:
        fee=int(records[step['id']]['receipt']['feeWei']);fees[step['role']]+=fee
        expected[step['role']]-=fee+int(step['value'])
        for role,addr in plan['addresses'].items():
            if step['to']==addr: expected[role]+=int(step['value'])
    expected['owner']+=PRICE
    if balances!=expected: raise Stop('BALANCE_RECONCILIATION_REQUIRED')
    return {'chainId':10143,'contractAddress':address,'blockNumber':number(tag),'blockHash':block['hash'],
            'F':str(PRICE),'A':'0','R':'0','H':'0','S':str(PRICE),'liability':'0','contractBalance':'0',
            'voucherStatus':4,'ownerPrincipalWei':str(PRICE),'ownerSettlementNetWei':str(PRICE-fees['owner']),
            'feesByRoleWei':{k:str(v) for k,v in fees.items()},'totalFeeWei':str(sum(fees.values())),
            'balancesWei':{k:str(v) for k,v in balances.items()}}


def main():
    import sys
    from .runner import cli
    sys.exit(cli(['verify']))

if __name__=='__main__': main()
