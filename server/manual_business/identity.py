"""Pure new-deployment identity validation against the unchanged reviewed artifact."""
import hashlib
import json
import re
from pathlib import Path
import rlp
from eth_abi import encode
from eth_utils import keccak
from web3 import Web3
from server.backend import canonical, digest
from server.chain.client import ChainConflict

CHAIN_ID = 10143
GENESIS = '0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9'
PRICE = 10**15
RULE = Web3.to_hex(keccak(text='mealforward-cp19-testnet-v1'))
ARTIFACT_SHA = '05147baaee71b2d4e34cf5a32a390bd0ae63361e2e98a579d98a1e867e24f59b'
ARTIFACT_FILE = Path(__file__).parents[1]/'wallet_readiness/public/MealForwardTestnet.json'
# Deny-only historical reference; never a business target or manifest default.
HISTORICAL_ADDRESS = '0x724eab33ff67b06716913ceb1c03581f4bba9721'


def artifact():
    raw = ARTIFACT_FILE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ARTIFACT_SHA: raise ChainConflict('Reviewed artifact changed')
    return json.loads(raw)


def expected_runtime(merchant):
    a = artifact()
    code = bytearray.fromhex(a['deployedBytecode']['object'].removeprefix('0x'))
    refs = a['deployedBytecode']['immutableReferences']
    if len(refs) != 1: raise ChainConflict('Unexpected immutable layout')
    for positions in refs.values():
        for pos in positions:
            if pos['length'] != 32 or not 0 <= pos['start'] <= len(code)-32:
                raise ChainConflict('Invalid immutable reference')
            code[pos['start']:pos['start']+32] = encode(['address'], [merchant])
    return '0x'+code.hex()


def deployment_plan(run_id, admin, merchant, nonce):
    if not run_id or not Web3.is_address(admin) or not Web3.is_address(merchant) or type(nonce) is not int or nonce < 0:
        raise ValueError('Explicit deployment participants and nonce required')
    creation = artifact()['bytecode']['object'].removeprefix('0x') + encode(['address', 'address'], [admin, merchant]).hex()
    predicted = Web3.to_checksum_address(keccak(rlp.encode([bytes.fromhex(admin[2:]), nonce]))[-20:])
    if predicted.lower() == HISTORICAL_ADDRESS: raise ChainConflict('Historical CP19 deployment cannot become a new business target')
    return {'version': 1, 'runId': run_id, 'chainId': CHAIN_ID, 'genesisHash': GENESIS,
            'artifactSha256': ARTIFACT_SHA, 'admin': admin, 'merchant': merchant, 'sender': admin,
            'nonce': nonce, 'creationInput': '0x'+creation, 'predictedAddress': predicted}


def verify_deployment(plan, tx, receipt, block, runtime, finalized_height):
    expected = deployment_plan(plan['runId'], plan['admin'], plan['merchant'], plan['nonce'])
    if plan != expected: raise ChainConflict('Deployment plan changed')
    # A finalized height alone cannot bind mixed-provider transaction/receipt data.
    for value in (tx, receipt, block):
        fields = ('number',) if value is block else ('blockNumber', 'transactionIndex')
        if any(type(value.get(k)) is not int or value[k] < 0 for k in fields):
            raise ChainConflict('Missing or invalid deployment position')
        hashes = ('hash',) if value is block else ('hash', 'blockHash') if value is tx else ('transactionHash', 'blockHash')
        if any(not isinstance(value.get(k), str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', value[k]) for k in hashes):
            raise ChainConflict('Missing or invalid deployment hash')
    position = tx['transactionIndex']
    transactions = block.get('transactions')
    if (tx['blockNumber'] != receipt['blockNumber'] or tx['blockHash'] != receipt['blockHash'] or
            position != receipt['transactionIndex'] or not isinstance(transactions, list) or
            position >= len(transactions) or transactions[position] != tx['hash']):
        raise ChainConflict('Original deployment position conflict')
    if (tx['from'].lower() != plan['sender'].lower() or tx.get('to') not in (None, '', '0x') or
            tx['nonce'] != plan['nonce'] or tx['chainId'] != CHAIN_ID or tx['value'] != 0 or
            tx['input'].lower() != plan['creationInput'].lower()):
        raise ChainConflict('Original deployment transaction mismatch')
    if (type(finalized_height) is not int or finalized_height < block['number'] or
            receipt['status'] != 1 or receipt['blockHash'] != block['hash'] or
            receipt['blockNumber'] != block['number'] or receipt['transactionHash'] != tx['hash'] or
            receipt['contractAddress'].lower() != plan['predictedAddress'].lower() or
            runtime.lower() != expected_runtime(plan['merchant']).lower()):
        raise ChainConflict('Canonical deployment/runtime mismatch')
    # Caller must obtain this block at or below a verified finalized head.
    identity = {'chainId': CHAIN_ID, 'genesisHash': GENESIS, 'runId': plan['runId'],
                'contractAddress': receipt['contractAddress'], 'merchant': plan['merchant'], 'admin': plan['admin'],
                'deploymentBlock': block['number'], 'deploymentBlockHash': block['hash'],
                'deploymentTransaction': tx['hash'], 'artifactSha256': ARTIFACT_SHA,
                'codeHash': Web3.to_hex(keccak(hexstr=runtime)), 'planDigest': digest(canonical(plan))}
    return {**identity, 'deploymentId': digest(canonical(identity))}
