"""Offline protocol fixture: JSON-RPC wire responses, no node/provider/network.

It models only the five approved single-voucher transitions. Production TestnetRpc
still performs all ABI decoding, allowlisting, budgets and finality checks.
"""
import copy
from eth_abi import encode
from eth_utils import keccak, event_abi_to_log_topic
from web3 import Web3
from server.manual_business.identity import artifact, deployment_plan, verify_deployment, expected_runtime, GENESIS, RULE, PRICE


def hx(value): return Web3.to_hex(value)


class Fake10143:
    def __init__(self, participants):
        self.participants = participants
        plan = deployment_plan('fake10143-offline', participants['admin'], participants['merchant'], 0)
        self.height = self.final = 10
        self.blocks = {10: {'number': '0xa', 'hash': hx(keccak(text='block10')), 'transactions': [hx(keccak(text='deployment'))]}}
        block = self.blocks[10]
        tx = {'hash': block['transactions'][0], 'from': plan['sender'], 'to': None, 'nonce': 0, 'chainId': 10143,
              'value': 0, 'input': plan['creationInput'], 'blockNumber': 10, 'blockHash': block['hash'], 'transactionIndex': 0}
        receipt = {'transactionHash': tx['hash'], 'status': 1, 'blockNumber': 10, 'blockHash': block['hash'],
                   'transactionIndex': 0, 'contractAddress': plan['predictedAddress']}
        self.code = expected_runtime(participants['merchant'])
        self.deployment = verify_deployment(plan, tx, receipt, {**block, 'number': 10}, self.code, 10)
        self.contract = Web3().eth.contract(address=plan['predictedAddress'], abi=artifact()['abi'])
        self.functions = {a['name']: a for a in artifact()['abi'] if a['type'] == 'function'}
        self.events = {a['name']: a for a in artifact()['abi'] if a['type'] == 'event'}
        self.nonces = {a.lower(): 0 for a in participants.values()}
        self.txs = {}; self.receipts = {}; self.calls = []; self.snapshots = {10: [0]*7}
        self.amounts = [0]*7; self.batch = None; self.logs = []; self.fault = None
        self.roles = {keccak(text=r+'_ROLE'): participants[p].lower() for r, p in
                      [('SUPPORTER', 'supporter'), ('ISSUER', 'issuer'), ('OPERATOR', 'operator'), ('SETTLER', 'merchant')]}
        self.roles[bytes(32)] = participants['admin'].lower()

    def submit(self, tx, raw=None):
        assert tx['chainId'] == 10143 and tx['to'].lower() == self.contract.address.lower()
        assert tx['nonce'] == self.nonces[tx['from'].lower()]
        fn, args = self.contract.decode_function_input(tx['data'])
        kind = fn.fn_name
        if kind == 'fund':
            assert args['quantity'] == 1 and hx(args['version']) == RULE and tx['value'] == PRICE
            self.batch = keccak(encode(['uint256', 'address', 'address', 'bytes32'], [10143, tx['to'], tx['from'], args['intentId']]))
            self.amounts = [PRICE, PRICE, 0, 0, 0, 0, 0]
            name = 'Funded'; values = dict(batchId=self.batch, payer=tx['from'], intentId=args['intentId'], amount=PRICE)
        elif kind == 'issue':
            assert args['batchId'] == self.batch and len(args['voucherIds']) == 1
            self.amounts[1] -= PRICE; self.amounts[2] += PRICE
            name = 'Issued'; values = args
        elif kind == 'lock': name = 'Locked'; values = args
        elif kind == 'report':
            self.amounts[2] -= PRICE; self.amounts[3] += PRICE
            name = 'Reported'; values = args
        elif kind == 'settle':
            self.amounts[3] -= PRICE; self.amounts[4] += PRICE
            name = 'Settled'; values = {**args, 'merchant': self.participants['merchant'], 'amount': PRICE}
        else: raise AssertionError('Unexpected synthetic write')
        self.height += 1; self.final = self.height
        tx_hash = hx(keccak(raw)) if raw is not None else hx(keccak(text=str(tx)))
        block = {'number': hex(self.height), 'hash': hx(keccak(text='block'+str(self.height))), 'transactions': [tx_hash]}
        self.blocks[self.height] = block; self.snapshots[self.height] = list(self.amounts)
        pos = dict(blockNumber=block['number'], blockHash=block['hash'], transactionIndex='0x0', transactionHash=tx_hash)
        event = self.events[name]
        indexed = [a for a in event['inputs'] if a['indexed']]; data = [a for a in event['inputs'] if not a['indexed']]
        log = {**pos, 'address': self.contract.address, 'logIndex': '0x0', 'removed': False,
               'topics': [hx(event_abi_to_log_topic(event))]+[hx(encode([a['type']], [values[a['name']]])) for a in indexed],
               'data': hx(encode([a['type'] for a in data], [values[a['name']] for a in data]))}
        self.logs.append(log)
        self.txs[tx_hash] = {**pos, 'hash': tx_hash, 'from': tx['from'], 'to': tx['to'], 'input': tx['data'],
                             **{k: hex(tx[k]) for k in ('chainId', 'nonce', 'value', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas')}}
        self.receipts[tx_hash] = {**pos, 'status': '0x1', 'gasUsed': '0x5208', 'effectiveGasPrice': '0x1', 'logs': [log]}
        self.nonces[tx['from'].lower()] += 1
        return tx_hash

    def __call__(self, payload, timeout):
        self.calls.append(copy.deepcopy(payload)); method, params = payload['method'], payload['params']
        assert 0 < timeout <= 3
        if method == 'eth_chainId': result = '0x279f'
        elif method == 'eth_getBlockByNumber':
            height = self.final if params[0] == 'finalized' else int(params[0], 16)
            result = {'number': '0x0', 'hash': GENESIS, 'transactions': []} if height == 0 else self.blocks[height]
        elif method == 'eth_getCode': result = self.code
        elif method == 'eth_getTransactionCount': result = hex(self.nonces[params[0].lower()])
        elif method == 'eth_getBalance':
            amounts = self.snapshots[int(params[1], 16)]
            result = hex(sum(amounts[1:4]) if params[0].lower() == self.contract.address.lower() else 10**20)
        elif method == 'eth_estimateGas': result = '0x186a0'
        elif method == 'eth_call':
            fn, args = self.contract.decode_function_input(params[0]['data']); name = fn.fn_name
            amounts = self.snapshots[int(params[1], 16)]
            values = {'merchant': self.participants['merchant'], 'priceWei': PRICE, 'ruleVersion': bytes.fromhex(RULE[2:]),
                      'paused': False, 'totalFunded': amounts[0], 'liability': sum(amounts[1:4])}
            if name == 'hasRole': value = self.roles.get(args['role']) == args['account'].lower()
            elif name == 'getBatch': value = amounts if args['id'] == self.batch else [0]*7
            else: value = values[name]
            outputs = self.functions[name]['outputs']
            result = hx(encode([a['type'] for a in outputs], value if len(outputs) > 1 else [value]))
        elif method == 'eth_getTransactionByHash': result = self.txs.get(params[0])
        elif method == 'eth_getTransactionReceipt': result = self.receipts.get(params[0])
        elif method == 'eth_getLogs':
            p = params[0]
            result = [l for l in self.logs if int(p['fromBlock'], 16) <= int(l['blockNumber'], 16) <= int(p['toBlock'], 16)
                      and l['topics'][0] == p['topics'][0]]
        else: raise AssertionError('Network/write/unapproved RPC: '+method)
        result = copy.deepcopy(result)
        if self.fault: result = self.fault(method, params, result)
        return {'jsonrpc': '2.0', 'id': payload['id'], 'result': result}
