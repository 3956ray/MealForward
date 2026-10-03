"""One fixed grant, one signature and one send attempt; no retry or restore unlock."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import stat
from pathlib import Path

from eth_account import Account
from eth_account.typed_transactions import TypedTransaction
from eth_utils import keccak
from hexbytes import HexBytes
from server.testnet_funding.chain import (
    ADDRESS, ADMIN, SUPPORTER, MAX_FEE, TIP, FundingError, address, block,
    contract_read, encode_call, guard, rpc_number, verify_transaction,
)

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / '.localbackend/cp21-admin'
from server.testnet_readonly.identity import MANIFEST

DEPLOYMENT = {key: MANIFEST[key] for key in ('contractAddress', 'genesisHash', 'runtimeCodeHash', 'ruleVersion')}
ROLE_EVENT = '0x' + keccak(text='RoleGranted(bytes32,address,address)').hex()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


MAX_JOURNAL_BYTES = 1024 * 1024


def private_stat(info):
    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or
        info.st_size > MAX_JOURNAL_BYTES or info.st_nlink != 1):
        raise FundingError('RESTORE_QUARANTINE')


def private_read(path):
    private_stat(path.lstat())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'r') as stream:
        private_stat(os.fstat(stream.fileno()))
        content = stream.read(MAX_JOURNAL_BYTES + 1)
        if len(content.encode()) > MAX_JOURNAL_BYTES: raise FundingError('RESTORE_QUARANTINE')
        return json.loads(content)


def private_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
        raise FundingError('RESTORE_QUARANTINE')


def atomic(path, value):
    if os.path.lexists(path): private_stat(path.lstat())
    temporary = path.with_suffix(path.suffix + '.tmp')
    if os.path.lexists(temporary): private_stat(temporary.lstat())
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        private_stat(os.fstat(stream.fileno()))
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


class Journal:
    """External anchor advances first: any interrupted/older restore is quarantined."""
    def __init__(self, directory=DIRECTORY):
        self.directory = Path(directory)
        self.path = self.directory / 'journal.json'
        self.anchor = self.directory.parent / (self.directory.name + '-anchor.json')
        self.lock = self.directory.parent / (self.directory.name + '.lock')

    @contextlib.contextmanager
    def locked(self):
        self.directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            private_stat(os.fstat(fd))
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally: os.close(fd)

    def load(self, *, fresh=False):
        if not any(os.path.lexists(p) for p in (self.path, self.anchor, self.directory)):
            if fresh: return None
        try:
            private_directory(self.directory)
            value = private_read(self.path)
            anchor = private_read(self.anchor)
            if anchor != {'digest': digest(value)} or value['planHash'] != digest(value['plan']):
                raise ValueError()
            validate_plan(value['plan'])
            return value
        except Exception: raise FundingError('RESTORE_QUARANTINE') from None

    def save(self, value):
        if not os.path.lexists(self.directory): self.directory.mkdir(mode=0o700)
        private_directory(self.directory)
        atomic(self.anchor, {'digest': digest(value)})
        atomic(self.path, value)


def validate_plan(plan):
    tx = plan['transaction']
    payer = address(plan['payer'])
    if (plan['deployment'] != DEPLOYMENT or plan['role'] != SUPPORTER or plan['version'] != 1 or
        tx['from'].lower() != ADMIN.lower() or tx['to'].lower() != ADDRESS.lower() or
        tx['data'] != encode_call('grantRole', [SUPPORTER, payer]) or
        tx['chainId'] != 10143 or tx['value'] != 0 or tx['type'] != 2 or
        not 0 < tx['gas'] <= 120000 or not 0 < tx['maxFeePerGas'] <= MAX_FEE or
        not 0 <= tx['maxPriorityFeePerGas'] <= min(TIP, tx['maxFeePerGas']) or
        type(tx['nonce']) is not int or tx['nonce'] < 0):
        raise FundingError('PLAN_CONFLICT')


def request(tx):
    return {key: hex(value) if type(value) is int else value for key, value in tx.items()}


def preflight(rpc, payer, tx=None):
    guard(rpc)
    if contract_read(rpc, 'paused', [])[0]: raise FundingError('CONTRACT_PAUSED')
    if not contract_read(rpc, 'hasRole', ['0x' + '00'*32, ADMIN])[0]:
        raise FundingError('ADMIN_ROLE_MISSING')
    if contract_read(rpc, 'hasRole', [SUPPORTER, payer])[0]: raise FundingError('ROLE_ALREADY_PRESENT')
    if rpc.call('eth_getCode', [ADMIN, 'latest']) != '0x': raise FundingError('ADMIN_IDENTITY_CONFLICT')
    latest = rpc_number(rpc.call('eth_getTransactionCount', [ADMIN, 'latest']))
    pending = rpc_number(rpc.call('eth_getTransactionCount', [ADMIN, 'pending']))
    if latest != pending or (tx is not None and latest != tx['nonce']): raise FundingError('NONCE_CONFLICT')
    head = block(rpc, 'latest')
    base = rpc_number(head['baseFeePerGas'])
    candidate = tx or {'from': ADMIN, 'to': ADDRESS, 'chainId': 10143, 'type': 2,
                       'nonce': latest, 'value': 0, 'gas': 120000,
                       'maxFeePerGas': MAX_FEE, 'maxPriorityFeePerGas': TIP,
                       'data': encode_call('grantRole', [SUPPORTER, payer])}
    if base + candidate['maxPriorityFeePerGas'] > candidate['maxFeePerGas']:
        raise FundingError('FEE_CAP_EXCEEDED')
    estimated = rpc_number(rpc.call('eth_estimateGas', [request(candidate)]))
    gas = (estimated * 1075 + 999) // 1000
    if gas <= 0 or gas > candidate['gas']: raise FundingError('GAS_CAP_EXCEEDED')
    if tx is None: candidate['gas'] = gas
    rpc.call('eth_call', [request(candidate), 'latest'])
    balance = rpc_number(rpc.call('eth_getBalance', [ADMIN, 'latest']))
    if balance < candidate['gas'] * candidate['maxFeePerGas']: raise FundingError('INSUFFICIENT_BALANCE')
    return candidate


def presend(rpc, payer, tx):
    """Repeat volatile safety guards after signing, without repeating estimation."""
    guard(rpc)
    if contract_read(rpc, 'paused', [])[0]: raise FundingError('CONTRACT_PAUSED')
    if not contract_read(rpc, 'hasRole', ['0x' + '00'*32, ADMIN])[0]:
        raise FundingError('ADMIN_ROLE_MISSING')
    if contract_read(rpc, 'hasRole', [SUPPORTER, payer])[0]: raise FundingError('ROLE_ALREADY_PRESENT')
    if rpc.call('eth_getCode', [ADMIN, 'latest']) != '0x': raise FundingError('ADMIN_IDENTITY_CONFLICT')
    for tag in ('latest', 'pending'):
        if rpc_number(rpc.call('eth_getTransactionCount', [ADMIN, tag])) != tx['nonce']:
            raise FundingError('NONCE_CONFLICT')
    base = rpc_number(block(rpc, 'latest')['baseFeePerGas'])
    if base + tx['maxPriorityFeePerGas'] > tx['maxFeePerGas']: raise FundingError('FEE_CAP_EXCEEDED')
    if rpc_number(rpc.call('eth_getBalance', [ADMIN, 'latest'])) < tx['gas'] * tx['maxFeePerGas']:
        raise FundingError('INSUFFICIENT_BALANCE')


def load_signer():
    # This import and the private loader are reached only after all execute guards.
    from scripts.testnet.runner import load_main_account
    return load_main_account('deployer')


def verify_raw(raw, tx):
    parsed = TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
    candidate = {key: hex(value) if type(value) is int else value for key, value in parsed.items()}
    candidate['from'] = Account.recover_transaction(raw)
    candidate['to'] = '0x' + bytes(parsed['to']).hex()
    candidate['data'] = '0x' + bytes(parsed['data']).hex()
    verify_transaction(candidate, tx)
    if parsed.get('accessList') not in ([], (), None): raise FundingError('SIGNED_TRANSACTION_CONFLICT')
    for key in ('gas', 'maxFeePerGas', 'maxPriorityFeePerGas'):
        if parsed[key] != tx[key]: raise FundingError('SIGNED_TRANSACTION_CONFLICT')


class Client:
    def __init__(self, rpc, journal=None, signer_loader=load_signer):
        self.rpc, self.journal, self.signer_loader = rpc, journal or Journal(), signer_loader

    def plan(self, payer):
        payer = address(payer)
        with self.journal.locked():
            value = self.journal.load(fresh=True)
            if value is not None:
                if value['plan']['payer'] != payer: raise FundingError('PLAN_CONFLICT')
                return public(value)
            plan = {'version': 1, 'deployment': DEPLOYMENT, 'payer': payer, 'role': SUPPORTER,
                    'transaction': preflight(self.rpc, payer)}
            validate_plan(plan)
            value = {'plan': plan, 'planHash': digest(plan), 'state': 'PREPARED', 'attempt': 0}
            self.journal.save(value)
            return public(value)

    def execute(self, plan_hash, approved_plan_hash):
        with self.journal.locked():
            value = self.journal.load()
            if not plan_hash or plan_hash != value['planHash'] or approved_plan_hash != plan_hash:
                raise FundingError('LEADER_APPROVAL_REQUIRED')
            if value['state'] != 'PREPARED' or value['attempt'] != 0:
                raise FundingError('ORIGINAL_TRANSACTION_ONLY')
            tx = value['plan']['transaction']
            preflight(self.rpc, value['plan']['payer'], tx)
            # Consume signing eligibility durably before loading any private material.
            value['state'] = 'SIGNING_STARTED'
            self.journal.save(value)
            try:
                signer = self.signer_loader()
                if signer.address.lower() != ADMIN.lower(): raise FundingError('SIGNER_IDENTITY_CONFLICT')
                signed = signer.sign_transaction({k: v for k, v in tx.items() if k != 'from'})
                raw = '0x' + bytes(signed.raw_transaction).hex()
                verify_raw(raw, tx)
                value.update(raw=raw, txHash='0x' + keccak(bytes.fromhex(raw[2:])).hex(), state='SIGNED')
                self.journal.save(value)
                presend(self.rpc, value['plan']['payer'], tx)
                value.update(state='UNKNOWN', attempt=1)
                self.journal.save(value)
                returned = self.rpc.call('eth_sendRawTransaction', [raw])
                if str(returned).lower() == value['txHash']: value['state'] = 'BROADCAST'
                else: value['errorCode'] = 'SEND_HASH_CONFLICT'
                self.journal.save(value)
            except Exception:
                # SIGNING_STARTED, SIGNED, or UNKNOWN remains consumed on every failure.
                return public(self.journal.load())
            return public(value)

    def reconcile(self):
        with self.journal.locked():
            value = self.journal.load()
            tx_hash = value.get('txHash')
            if not tx_hash: return public(value)
            guard(self.rpc)
            receipt = self.rpc.call('eth_getTransactionReceipt', [tx_hash])
            if receipt is None: return public(value)
            tx = self.rpc.call('eth_getTransactionByHash', [tx_hash])
            verify_transaction(tx, value['plan']['transaction'])
            height = rpc_number(receipt['blockNumber'])
            canonical = block(self.rpc, height)
            if (receipt['transactionHash'].lower() != tx_hash or tx.get('hash', '').lower() != tx_hash or
                receipt['blockHash'].lower() != canonical['hash'].lower() or
                tx.get('blockHash', '').lower() != canonical['hash'].lower() or
                rpc_number(tx.get('blockNumber')) != height): raise FundingError('RECEIPT_CONFLICT')
            status = rpc_number(receipt['status'])
            if value['state'].startswith('FINALIZED_') and (
                value['receipt']['status'] != status or value['receipt']['blockHash'] != canonical['hash'] or
                value['receipt']['blockNumber'] != height): raise FundingError('FINALITY_CONFLICT')
            if status not in (0, 1): raise FundingError('RECEIPT_CONFLICT')
            used = rpc_number(receipt['gasUsed']); price = rpc_number(receipt['effectiveGasPrice'])
            if used > value['plan']['transaction']['gas'] or price > value['plan']['transaction']['maxFeePerGas']:
                raise FundingError('BUDGET_EXCEEDED')
            if status:
                topics = [ROLE_EVENT, SUPPORTER, '0x'+value['plan']['payer'][2:].rjust(64, '0'),
                          '0x'+ADMIN[2:].lower().rjust(64, '0')]
                matching = [log for log in receipt['logs'] if log.get('address', '').lower() == ADDRESS.lower()
                            and [x.lower() for x in log.get('topics', [])] == topics]
                if (len(matching) != 1 or matching[0].get('removed') is True or
                    matching[0].get('data') != '0x' or matching[0].get('transactionHash', '').lower() != tx_hash or
                    matching[0].get('blockHash', '').lower() != canonical['hash'].lower() or
                    rpc_number(matching[0].get('blockNumber')) != height): raise FundingError('EVENT_CONFLICT')
            finalized = block(self.rpc, 'finalized')
            is_final = rpc_number(finalized['number']) >= height
            if value['state'].startswith('FINALIZED_') and not is_final: raise FundingError('FINALITY_CONFLICT')
            if is_final and status:
                tag = rpc_number(finalized['number'])
                if not contract_read(self.rpc, 'hasRole', [SUPPORTER, value['plan']['payer']], tag)[0]:
                    raise FundingError('FINALIZED_ROLE_MISSING')
                if block(self.rpc, tag)['hash'] != finalized['hash']: raise FundingError('REORG_DETECTED')
            if block(self.rpc, height)['hash'] != canonical['hash']: raise FundingError('REORG_DETECTED')
            value.update(state=('FINALIZED_' if is_final else 'INCLUDED_') + ('SUCCESS' if status else 'REVERT'),
                         receipt={'blockNumber': height, 'blockHash': canonical['hash'], 'status': status,
                                  'gasFeeWei': str(used*price), 'finalizedBlock': rpc_number(finalized['number'])})
            self.journal.save(value)
            return public(value)


def public(value):
    return {key: value[key] for key in ('plan', 'planHash', 'state', 'attempt', 'txHash', 'receipt', 'errorCode') if key in value}


class AdminRpc:
    """Own admission and transport: at most 40 calls / 30 seconds, no retry."""
    def __init__(self):
        from server.testnet_funding.rpc import FundingRpc
        self.reader = FundingRpc()
        self.sent = False

    def call(self, method, params):
        if method != 'eth_sendRawTransaction': return self.reader.call(method, params)
        rpc = self.reader
        if self.sent or rpc.attempts >= 40 or rpc.clock() >= rpc.deadline:
            raise FundingError('RPC_BUDGET')
        self.sent = True
        rpc.attempts += 1
        deadline = min(rpc.deadline, rpc.clock() + 6)
        try:
            with rpc.session.post(rpc.endpoint,
                    json={'jsonrpc': '2.0', 'id': rpc.attempts, 'method': method, 'params': params},
                    headers={'Accept-Encoding': 'identity'}, timeout=(2, 3),
                    allow_redirects=False, stream=True) as response:
                if response.status_code != 200 or response.headers.get('Content-Encoding', 'identity') != 'identity':
                    raise FundingError('RPC_UNAVAILABLE')
                body = bytearray()
                while True:
                    if rpc.clock() >= deadline: raise FundingError('RPC_TIMEOUT')
                    part = response.raw.read(1, decode_content=False)
                    if rpc.clock() >= deadline: raise FundingError('RPC_TIMEOUT')
                    if not part: break
                    body.extend(part)
                    if len(body) > 1024*1024: raise FundingError('RPC_LIMIT')
                result = json.loads(body)
                if (not isinstance(result, dict) or result.get('jsonrpc') != '2.0' or
                    type(result.get('id')) is not int or result['id'] != rpc.attempts or
                    'error' in result or 'result' not in result): raise FundingError('RPC_PROTOCOL')
                return result['result']
        except FundingError: raise
        except Exception: raise FundingError('RPC_UNAVAILABLE') from None


def cli(argv=None):
    parser = argparse.ArgumentParser(description='CP21 standalone one-attempt SUPPORTER grant')
    parser.add_argument('command', choices=('plan', 'execute', 'reconcile'))
    parser.add_argument('--payer')
    parser.add_argument('--plan-hash')
    parser.add_argument('--leader-approved-plan-hash')
    args = parser.parse_args(argv)
    try:
        client = Client(AdminRpc())
        if args.command == 'plan': result = client.plan(args.payer)
        elif args.command == 'execute': result = client.execute(args.plan_hash, args.leader_approved_plan_hash)
        else: result = client.reconcile()
        print(json.dumps(result, sort_keys=True))
        return 0
    except FundingError as error:
        print(json.dumps({'code': error.code}))
        return 1
    except Exception:
        # Never serialize RPC, signer, key-loader or malformed-file exception objects.
        print(json.dumps({'code': 'ADMIN_OPERATION_STOPPED'}))
        return 1
