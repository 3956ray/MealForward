"""One fixed issue, one signature and one send attempt; no retry or restore unlock."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import stat
from pathlib import Path

from eth_abi import encode
from eth_account import Account
from eth_account.typed_transactions import TypedTransaction
from eth_utils import keccak
from hexbytes import HexBytes
from server.testnet_issuance.chain import (
    ADDRESS, BATCH, GAS_CAP, ISSUER, ISSUED, MAX_FEE, OPERATOR, PRICE, TIP, ZERO,
    IssuanceError, block, contract_read, derive, guard, hex_data, issue_data,
    payload_hash, rpc_number, verify_transaction,
)
from server.testnet_issuance.rpc import IssuanceRpc, METHODS
from server.testnet_issuance.store import validate_config

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / '.localbackend/cp22-admin'
from server.testnet_readonly.identity import MANIFEST

DEPLOYMENT = {key: MANIFEST[key] for key in ('contractAddress', 'genesisHash', 'runtimeCodeHash', 'ruleVersion')}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


MAX_JOURNAL_BYTES = 1024 * 1024


def private_stat(info):
    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or
        info.st_size > MAX_JOURNAL_BYTES or info.st_nlink != 1):
        raise IssuanceError('RESTORE_QUARANTINE')


def private_read(path):
    private_stat(path.lstat())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'r') as stream:
        private_stat(os.fstat(stream.fileno()))
        content = stream.read(MAX_JOURNAL_BYTES + 1)
        if len(content.encode()) > MAX_JOURNAL_BYTES: raise IssuanceError('RESTORE_QUARANTINE')
        return json.loads(content)


def private_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
        raise IssuanceError('RESTORE_QUARANTINE')


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


def load_approved(path):
    """Leader-approved issuance config; contains no key, token or recipient secret."""
    value = private_read(Path(path))
    validate_config(value)
    return value


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
        except Exception: raise IssuanceError('RESTORE_QUARANTINE') from None

    def save(self, value):
        if not os.path.lexists(self.directory): self.directory.mkdir(mode=0o700)
        private_directory(self.directory)
        atomic(self.anchor, {'digest': digest(value)})
        atomic(self.path, value)


def validate_plan(plan):
    tx = plan['transaction']
    operation_id, voucher_id = derive(plan['issuanceId'])
    labels = all(isinstance(plan[key], str) and re.fullmatch('[a-z0-9][a-z0-9-]{0,31}', plan[key])
                 for key in ('partnerLabel', 'recipientRef'))
    if (plan['deployment'] != DEPLOYMENT or plan['version'] != 1 or not labels or
        plan['batchId'].lower() != BATCH.lower() or plan['operator'].lower() != OPERATOR.lower() or
        plan['operationId'] != operation_id or plan['voucherId'] != voucher_id or
        tx['from'].lower() != OPERATOR.lower() or tx['to'].lower() != ADDRESS.lower() or
        tx['data'] != issue_data(operation_id, BATCH, voucher_id) or
        tx['chainId'] != 10143 or tx['value'] != 0 or tx['type'] != 2 or
        not 0 < tx['gas'] <= GAS_CAP or not 0 < tx['maxFeePerGas'] <= MAX_FEE or
        not 0 <= tx['maxPriorityFeePerGas'] <= min(TIP, tx['maxFeePerGas']) or
        type(tx['nonce']) is not int or tx['nonce'] < 0):
        raise IssuanceError('PLAN_CONFLICT')


def request(tx):
    return {key: hex(value) if type(value) is int else value for key, value in tx.items()}


def check_issued(rpc, plan):
    """payloadHash tri-state: zero passes, same payload converges read-only, other payload halts."""
    operation_id, voucher_id = derive(plan['issuanceId'])
    payload, _result = contract_read(rpc, 'getOperation', [1, operation_id])
    if payload == hex_data(ZERO, 32): return
    if payload == hex_data(payload_hash(BATCH, [voucher_id]), 32): raise IssuanceError('ISSUED_ALREADY')
    raise IssuanceError('INTENT_CONFLICT')


def preflight(rpc, plan, tx=None):
    guard(rpc)
    if contract_read(rpc, 'paused', [])[0]: raise IssuanceError('CONTRACT_PAUSED')
    if not contract_read(rpc, 'hasRole', [ISSUER, OPERATOR])[0]: raise IssuanceError('ISSUER_ROLE_REQUIRED')
    final = block(rpc, 'finalized'); final_height = rpc_number(final['number'])
    if not contract_read(rpc, 'hasRole', [ISSUER, OPERATOR], final_height)[0]:
        raise IssuanceError('ISSUER_ROLE_NOT_FINALIZED')
    if block(rpc, final_height)['hash'].lower() != final['hash'].lower(): raise IssuanceError('FINALITY_CONFLICT')
    check_issued(rpc, plan)
    operation_id, voucher_id = derive(plan['issuanceId'])
    if contract_read(rpc, 'getVoucher', [voucher_id])[1] != 0: raise IssuanceError('DUPLICATE_VOUCHER')
    f, available, reserved, held, settled, _x, _l = contract_read(rpc, 'getBatch', [BATCH])
    if f != PRICE or available < PRICE or (reserved, held, settled) != (0, 0, 0):
        raise IssuanceError('BATCH_STATE_CONFLICT')
    latest = rpc_number(rpc.call('eth_getTransactionCount', [OPERATOR, 'latest']))
    pending = rpc_number(rpc.call('eth_getTransactionCount', [OPERATOR, 'pending']))
    if latest != pending or (tx is not None and latest != tx['nonce']): raise IssuanceError('NONCE_CONFLICT')
    head = block(rpc, 'latest')
    base = rpc_number(head['baseFeePerGas'])
    candidate = tx or {'from': OPERATOR, 'to': ADDRESS, 'chainId': 10143, 'type': 2,
                       'nonce': latest, 'value': 0, 'gas': GAS_CAP,
                       'maxFeePerGas': (base*125+99)//100+TIP, 'maxPriorityFeePerGas': TIP,
                       'data': issue_data(operation_id, BATCH, voucher_id)}
    if candidate['maxFeePerGas'] > MAX_FEE or base + candidate['maxPriorityFeePerGas'] > candidate['maxFeePerGas']:
        raise IssuanceError('FEE_CAP_EXCEEDED')
    estimated = rpc_number(rpc.call('eth_estimateGas', [request(candidate)]))
    gas = (estimated * 1075 + 999) // 1000
    if gas <= 0 or gas > candidate['gas']: raise IssuanceError('GAS_CAP_EXCEEDED')
    if tx is None: candidate['gas'] = gas
    rpc.call('eth_call', [request(candidate), 'latest'])
    balance = rpc_number(rpc.call('eth_getBalance', [OPERATOR, 'latest']))
    if balance < candidate['gas'] * candidate['maxFeePerGas']: raise IssuanceError('INSUFFICIENT_BALANCE')
    return candidate


def presend(rpc, plan, tx):
    """Repeat volatile safety guards after signing, without repeating estimation."""
    guard(rpc)
    if contract_read(rpc, 'paused', [])[0]: raise IssuanceError('CONTRACT_PAUSED')
    if not contract_read(rpc, 'hasRole', [ISSUER, OPERATOR])[0]: raise IssuanceError('ISSUER_ROLE_REQUIRED')
    check_issued(rpc, plan)
    for tag in ('latest', 'pending'):
        if rpc_number(rpc.call('eth_getTransactionCount', [OPERATOR, tag])) != tx['nonce']:
            raise IssuanceError('NONCE_CONFLICT')
    base = rpc_number(block(rpc, 'latest')['baseFeePerGas'])
    if base + tx['maxPriorityFeePerGas'] > tx['maxFeePerGas']: raise IssuanceError('FEE_CAP_EXCEEDED')
    if rpc_number(rpc.call('eth_getBalance', [OPERATOR, 'latest'])) < tx['gas'] * tx['maxFeePerGas']:
        raise IssuanceError('INSUFFICIENT_BALANCE')


def load_signer():
    # This import and the private loader are reached only after all execute guards.
    from scripts.testnet.runner import load_main_account
    return load_main_account('operator')


def verify_raw(raw, tx):
    parsed = TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
    candidate = {key: hex(value) if type(value) is int else value for key, value in parsed.items()}
    candidate['from'] = Account.recover_transaction(raw)
    candidate['to'] = '0x' + bytes(parsed['to']).hex()
    candidate['data'] = '0x' + bytes(parsed['data']).hex()
    verify_transaction(candidate, tx)
    if parsed.get('accessList') not in ([], (), None): raise IssuanceError('SIGNED_TRANSACTION_CONFLICT')
    for key in ('gas', 'maxFeePerGas', 'maxPriorityFeePerGas'):
        if parsed[key] != tx[key]: raise IssuanceError('SIGNED_TRANSACTION_CONFLICT')


class Client:
    def __init__(self, rpc, journal=None, signer_loader=load_signer):
        self.rpc, self.journal, self.signer_loader = rpc, journal or Journal(), signer_loader

    def plan(self, approved_config_path):
        config = load_approved(approved_config_path)
        with self.journal.locked():
            value = self.journal.load(fresh=True)
            if value is not None:
                existing = value['plan']
                if (existing['issuanceId'] != config['issuanceId'] or
                    existing['partnerLabel'] != config['partnerLabel'] or
                    existing['recipientRef'] != config['recipientRef']): raise IssuanceError('PLAN_CONFLICT')
                return public(value)
            seed = {'version': 1, 'deployment': DEPLOYMENT, 'issuanceId': config['issuanceId'],
                    'operator': OPERATOR, 'batchId': BATCH, 'partnerLabel': config['partnerLabel'],
                    'recipientRef': config['recipientRef']}
            operation_id, voucher_id = derive(config['issuanceId'])
            plan = {**seed, 'operationId': operation_id, 'voucherId': voucher_id,
                    'transaction': preflight(self.rpc, seed)}
            validate_plan(plan)
            value = {'plan': plan, 'planHash': digest(plan), 'state': 'PREPARED', 'attempt': 0}
            self.journal.save(value)
            return public(value)

    def execute(self, plan_hash, approved_plan_hash):
        with self.journal.locked():
            value = self.journal.load()
            if not plan_hash or plan_hash != value['planHash'] or approved_plan_hash != plan_hash:
                raise IssuanceError('LEADER_APPROVAL_REQUIRED')
            if value['state'] != 'PREPARED' or value['attempt'] != 0:
                raise IssuanceError('ORIGINAL_TRANSACTION_ONLY')
            tx = value['plan']['transaction']
            preflight(self.rpc, value['plan'], tx)
            # Consume signing eligibility durably before loading any private material.
            value['state'] = 'SIGNING_STARTED'
            self.journal.save(value)
            try:
                signer = self.signer_loader()
                if signer.address.lower() != OPERATOR.lower(): raise IssuanceError('SIGNER_IDENTITY_CONFLICT')
                signed = signer.sign_transaction({k: v for k, v in tx.items() if k != 'from'})
                raw = '0x' + bytes(signed.raw_transaction).hex()
                verify_raw(raw, tx)
                value.update(raw=raw, txHash='0x' + keccak(bytes.fromhex(raw[2:])).hex(), state='SIGNED')
                self.journal.save(value)
                presend(self.rpc, value['plan'], tx)
                value.update(state='UNKNOWN', attempt=1)
                self.journal.save(value)
                returned = self.rpc.send(raw)
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
            canonical_block = block(self.rpc, height)
            if (receipt['transactionHash'].lower() != tx_hash or tx.get('hash', '').lower() != tx_hash or
                receipt['blockHash'].lower() != canonical_block['hash'].lower() or
                tx.get('blockHash', '').lower() != canonical_block['hash'].lower() or
                rpc_number(tx.get('blockNumber')) != height): raise IssuanceError('RECEIPT_CONFLICT')
            status = rpc_number(receipt['status'])
            if value['state'].startswith('FINALIZED_') and (
                value['receipt']['status'] != status or value['receipt']['blockHash'] != canonical_block['hash'] or
                value['receipt']['blockNumber'] != height): raise IssuanceError('FINALITY_CONFLICT')
            if status not in (0, 1): raise IssuanceError('RECEIPT_CONFLICT')
            used = rpc_number(receipt['gasUsed']); price = rpc_number(receipt['effectiveGasPrice'])
            if used > value['plan']['transaction']['gas'] or price > value['plan']['transaction']['maxFeePerGas']:
                raise IssuanceError('BUDGET_EXCEEDED')
            plan = value['plan']
            if status:
                topics = [ISSUED, plan['operationId'], BATCH]
                matching = [log for log in receipt['logs'] if log.get('address', '').lower() == ADDRESS.lower()
                            and [x.lower() for x in log.get('topics', [])] == topics]
                if (len(matching) != 1 or matching[0].get('removed') is True or
                    matching[0].get('data') != '0x' + encode(['bytes32[]'], [[hex_data(plan['voucherId'], 32)]]).hex() or
                    matching[0].get('transactionHash', '').lower() != tx_hash or
                    matching[0].get('blockHash', '').lower() != canonical_block['hash'].lower() or
                    rpc_number(matching[0].get('blockNumber')) != height): raise IssuanceError('EVENT_CONFLICT')
            finalized = block(self.rpc, 'finalized')
            is_final = rpc_number(finalized['number']) >= height
            if value['state'].startswith('FINALIZED_') and not is_final: raise IssuanceError('FINALITY_CONFLICT')
            if is_final and status:
                tag = rpc_number(finalized['number'])
                operation = contract_read(self.rpc, 'getOperation', [1, plan['operationId']], tag)
                if list(operation) != [hex_data(payload_hash(BATCH, [plan['voucherId']]), 32), hex_data(BATCH, 32)]:
                    raise IssuanceError('FINALIZED_OPERATION_MISSING')
                voucher = contract_read(self.rpc, 'getVoucher', [plan['voucherId']], tag)
                if list(voucher) != [hex_data(BATCH, 32), 1, hex_data(ZERO, 32)]:
                    raise IssuanceError('FINALIZED_VOUCHER_MISSING')
                batch = contract_read(self.rpc, 'getBatch', [BATCH], tag)
                if tuple(batch[:5]) != (PRICE, 0, PRICE, 0, 0): raise IssuanceError('FINALIZED_BATCH_CONFLICT')
                if block(self.rpc, tag)['hash'] != finalized['hash']: raise IssuanceError('REORG_DETECTED')
            if block(self.rpc, height)['hash'] != canonical_block['hash']: raise IssuanceError('REORG_DETECTED')
            value.update(state=('FINALIZED_' if is_final else 'INCLUDED_') + ('SUCCESS' if status else 'REVERT'),
                         receipt={'blockNumber': height, 'blockHash': canonical_block['hash'], 'status': status,
                                  'gasFeeWei': str(used*price), 'finalizedBlock': rpc_number(finalized['number'])})
            self.journal.save(value)
            return public(value)


def public(value):
    return {key: value[key] for key in ('plan', 'planHash', 'state', 'attempt', 'txHash', 'receipt', 'errorCode') if key in value}


class AdminRpc(IssuanceRpc):
    """Read admission extended with estimation and nonce reads; one audited send slot."""
    def __init__(self):
        super().__init__(methods=METHODS | {'eth_estimateGas', 'eth_getTransactionCount'})
        self.sent = False

    def send(self, raw):
        if self.sent or self.attempts >= 40 or self.clock() >= self.deadline:
            raise IssuanceError('RPC_BUDGET')
        self.sent = True
        return self._post('eth_sendRawTransaction', [raw])


def cli(argv=None):
    parser = argparse.ArgumentParser(description='CP22 standalone one-attempt testnet voucher issue')
    parser.add_argument('command', choices=('plan', 'execute', 'reconcile'))
    parser.add_argument('--approved-config')
    parser.add_argument('--plan-hash')
    parser.add_argument('--leader-approved-plan-hash')
    args = parser.parse_args(argv)
    try:
        client = Client(AdminRpc())
        if args.command == 'plan':
            if not args.approved_config: raise IssuanceError('APPROVED_ISSUANCE_REQUIRED')
            result = client.plan(args.approved_config)
        elif args.command == 'execute': result = client.execute(args.plan_hash, args.leader_approved_plan_hash)
        else: result = client.reconcile()
        print(json.dumps(result, sort_keys=True))
        return 0
    except IssuanceError as error:
        print(json.dumps({'code': error.code}))
        return 1
    except Exception:
        # Never serialize RPC, signer, key-loader or malformed-file exception objects.
        print(json.dumps({'code': 'ADMIN_OPERATION_STOPPED'}))
        return 1
