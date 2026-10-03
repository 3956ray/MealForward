"""One fixed 13-step plan; no generic wallet/transaction forwarding interface."""
import hashlib
import json
from eth_abi import encode
from web3 import Web3
import rlp
from .rpc import ROOT, GENESIS, Stop, number, hexbytes
from .journal import digest

PRICE=10**15
CAP=10**16
FEE_CAP=2*10**18
MAX_FEE=200*10**9
TIP=2*10**9
RULE=Web3.keccak(text='mealforward-cp19-testnet-v1')
ARTIFACT=ROOT/'.localbackend/cp19-build/out/MealForwardTestnet.sol/MealForwardTestnet.json'
ROLE_NAMES={'supporter':'SUPPORTER_ROLE','issuer':'ISSUER_ROLE','operator':'OPERATOR_ROLE','owner':'SETTLER_ROLE'}


def hx(value): return Web3.to_hex(value)


def source_digest():
    paths=[ROOT/'contracts/MealForwardTestnet.sol',ROOT/'testnet/foundry.toml',ROOT/'package-lock.json',ROOT/'requirements.lock']
    paths+=sorted((ROOT/'scripts/testnet').glob('*.py'))
    h=hashlib.sha256()
    for path in paths:
        h.update(str(path.relative_to(ROOT)).encode()+b'\0'+path.read_bytes()+b'\0')
    return h.hexdigest()


def artifact():
    try: return json.loads(ARTIFACT.read_text())
    except Exception: raise Stop('BUILD_REQUIRED') from None


def runtime_code(art, merchant):
    code=bytearray(hexbytes(art['deployedBytecode']['object']))
    refs=art['deployedBytecode']['immutableReferences']
    if len(refs)!=1: raise Stop('IMMUTABLE_LAYOUT_CHANGED')
    for positions in refs.values():
        for position in positions:
            if position['length']!=32: raise Stop('IMMUTABLE_LAYOUT_CHANGED')
            start=position['start']
            if start<0 or start+32>len(code): raise Stop('IMMUTABLE_LAYOUT_CHANGED')
            code[start:start+32]=bytes.fromhex(merchant[2:]).rjust(32,b'\0')
    return hx(code)


def contract(art=None): return Web3().eth.contract(abi=(art or artifact())['abi'])


def make_plan(rpc, addresses, *, genesis=GENESIS):
    rpc.guard(genesis)
    if set(addresses)!=set(('deployer','supporter','operator','owner')): raise Stop('ADDRESSES_INVALID')
    if len({a.lower() for a in addresses.values()})!=4: raise Stop('ADDRESSES_INVALID')
    for address in addresses.values():
        if not Web3.is_checksum_address(address): raise Stop('ADDRESSES_INVALID')
        if number(rpc.call('eth_getTransactionCount',[address,'latest']))!=0: raise Stop('FRESH_IDENTITY_REQUIRED')
        if rpc.call('eth_getCode',[address,'latest'])!='0x': raise Stop('DELEGATED_IDENTITY_DENIED')
    art=artifact();c=contract(art)
    predicted=Web3.to_checksum_address(Web3.keccak(rlp.encode([bytes.fromhex(addresses['deployer'][2:]),3]))[-20:])
    intent=hx(Web3.keccak(text='mealforward-cp19-one-voucher-fund-v1'))
    voucher=hx(Web3.keccak(text='mealforward-cp19-one-voucher-v1'))
    lock_id=hx(Web3.keccak(text='mealforward-cp19-one-lock-v1'))
    batch=hx(Web3.keccak(encode(['uint256','address','address','bytes32'],[10143,predicted,addresses['supporter'],hexbytes(intent,32)])))
    steps=[]
    def add(name,role,to,data='0x',value=0,gas=100000,event=None,args=None):
        nonce=sum(s['sender']==addresses[role] for s in steps)
        steps.append({'id':name,'role':role,'sender':addresses[role],'nonce':nonce,'to':to,
                      'data':data,'value':str(value),'gasCap':gas,'maxFeeCap':str(MAX_FEE),
                      'event':event,'eventArgs':args or {}})
    # Amounts cover the role's worst approved fees plus principal and a small retained margin.
    add('gas-supporter','deployer',addresses['supporter'],value=7*10**16,gas=21000)
    add('gas-operator','deployer',addresses['operator'],value=18*10**16,gas=21000)
    add('gas-owner','deployer',addresses['owner'],value=5*10**16,gas=21000)
    initcode=art['bytecode']['object']+encode(['address','address'],[addresses['deployer'],addresses['owner']]).hex()
    add('deploy','deployer',None,data=initcode,gas=8000000)
    for role in ('supporter','issuer','operator','owner'):
        address=addresses['operator' if role=='issuer' else role]
        role_id=hx(Web3.keccak(text=ROLE_NAMES[role]))
        add('grant-'+role,'deployer',predicted,c.encode_abi('grantRole',args=[role_id,address]),
            event='RoleGranted',args={'role':role_id,'account':address,'sender':addresses['deployer']})
    add('fund','supporter',predicted,c.encode_abi('fund',args=[intent,1,RULE]),PRICE,300000,
        'Funded',{'batchId':batch,'payer':addresses['supporter'],'intentId':intent,'amount':PRICE})
    add('issue','operator',predicted,c.encode_abi('issue',args=[voucher,batch,[voucher]]),gas=400000,
        event='Issued',args={'operationId':voucher,'batchId':batch,'voucherIds':[voucher]})
    add('lock','operator',predicted,c.encode_abi('lock',args=[voucher,voucher,lock_id]),gas=200000,
        event='Locked',args={'operationId':voucher,'voucherId':voucher,'lockId':lock_id})
    add('report','operator',predicted,c.encode_abi('report',args=[voucher,voucher,lock_id]),gas=200000,
        event='Reported',args={'operationId':voucher,'voucherId':voucher,'lockId':lock_id})
    add('settle','owner',predicted,c.encode_abi('settle',args=[voucher,voucher]),gas=200000,
        event='Settled',args={'operationId':voucher,'voucherId':voucher,'merchant':addresses['owner'],'amount':PRICE})
    latest=rpc.call('eth_getBlockByNumber',['latest',False])
    worst=sum(s['gasCap']*MAX_FEE for s in steps)
    if len(steps)!=13 or worst>FEE_CAP: raise Stop('PLAN_BUDGET_INVALID')
    balances={role:str(number(rpc.call('eth_getBalance',[addr,'latest']))) for role,addr in addresses.items()}
    return {'version':1,'chainId':10143,'genesisHash':genesis,'addresses':addresses,'contractAddress':predicted,
            'sourceDigest':source_digest(),'artifactDigest':digest(art),'runtimeCodeHash':hx(Web3.keccak(hexbytes(runtime_code(art,addresses['owner'])))),
            'compiler':'0.8.28','optimizerRuns':200,'evmVersion':'cancun','executionModel':'Generic EVM local; Monad RPC authoritative',
            'ruleVersion':hx(RULE),'priceWei':str(PRICE),'fundingCapWei':str(CAP),'maxQuantity':3,
            'principalCapWei':str(PRICE),'feeCapWei':str(FEE_CAP),'maximumPlannedFeeWei':str(worst),
            'executionDelayBlocks':3,'executionDelaySourceDate':'2026-10-03',
            'initialBalances':balances,'observedBlock':number(latest['number']),
            'batchId':batch,'voucherId':voucher,'lockId':lock_id,'intentId':intent,
            'estimation':'Per-step actual Monad estimate required before signing; undeployed downstream state pending',
            'steps':steps}


def validate_plan(plan):
    if plan['sourceDigest']!=source_digest() or plan['artifactDigest']!=digest(artifact()): raise Stop('BUILD_IDENTITY_CHANGED')
    if plan['chainId']!=10143 or plan['feeCapWei']!=str(FEE_CAP) or plan['principalCapWei']!=str(PRICE): raise Stop('PLAN_CHANGED')
