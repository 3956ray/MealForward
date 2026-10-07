"""Eight-call bounded read-only registration of an already approved original deployment."""
import json
import time
from server.chain.client import ChainConflict, ChainUnavailable
from .identity import CHAIN_ID, GENESIS, deployment_plan, verify_deployment
from .rpc import number, hash32, MAX_BYTES


def register_deployment(plan, original_hash, transport, clock=time.monotonic):
    if plan != deployment_plan(plan['runId'], plan['admin'], plan['merchant'], plan['nonce']):
        raise ChainConflict('Only the exact reviewed deployment plan can be registered')
    hash32(original_hash); calls = 0; deadline = clock()+30
    def call(method, params):
        nonlocal calls
        if calls >= 8 or clock() >= deadline: raise ChainUnavailable('Deployment read budget exhausted')
        calls += 1
        value = transport({'jsonrpc': '2.0', 'id': calls, 'method': method, 'params': params}, min(3, deadline-clock()))
        if (clock() > deadline or len(json.dumps(value).encode()) > MAX_BYTES or not isinstance(value, dict) or
                value.get('jsonrpc') != '2.0' or value.get('id') != calls or 'result' not in value or 'error' in value):
            raise ChainUnavailable('Deployment RPC unavailable')
        return value['result']
    if number(call('eth_chainId', [])) != CHAIN_ID: raise ChainConflict('Wrong deployment chain')
    if call('eth_getBlockByNumber', ['0x0', False])['hash'].lower() != GENESIS: raise ChainConflict('Wrong deployment genesis')
    final = call('eth_getBlockByNumber', ['finalized', False]); final_height = number(final['number'])
    tx = call('eth_getTransactionByHash', [original_hash]); receipt = call('eth_getTransactionReceipt', [original_hash])
    if not tx or not receipt or receipt.get('blockNumber') is None: raise ChainUnavailable('Original deployment remains unknown')
    height = number(receipt['blockNumber'])
    if height > final_height: raise ChainUnavailable('Original deployment not finalized')
    if (receipt['transactionHash'].lower() != original_hash.lower() or tx['hash'].lower() != original_hash.lower() or
            (receipt.get('contractAddress') or '').lower() != plan['predictedAddress'].lower()):
        raise ChainConflict('Deployment hash/address mismatch')
    block = call('eth_getBlockByNumber', [hex(height), False])
    code = call('eth_getCode', [receipt['contractAddress'], hex(final_height)])
    if call('eth_getBlockByNumber', [hex(final_height), False])['hash'] != final['hash']:
        raise ChainConflict('Finalized deployment observation changed')
    normalized_tx = {**tx, **{k: number(tx.get(k)) for k in ('nonce', 'chainId', 'value', 'blockNumber', 'transactionIndex')}}
    normalized_receipt = {**receipt, 'status': number(receipt['status']), 'blockNumber': height,
                          'transactionIndex': number(receipt.get('transactionIndex'))}
    normalized_block = {**block, 'number': number(block['number'])}
    return verify_deployment(plan, normalized_tx, normalized_receipt, normalized_block, code, final_height)
