"""Private original-request service domain. Host policy/storage/crypto/transport are injected.

No keys, HTTP endpoints, network clients, default grants, or success setters exist here.
Every injected IO call is outside the short ledger transaction.
"""
from __future__ import annotations
from copy import deepcopy
import re

OPERATION_PROTOCOL = 'CP30_ORIGINAL_OPERATION_V1'
LEDGER_PROTOCOL = 'CP30_DURABLE_ORIGINAL_LEDGER_V1'
SIGNER_PROTOCOL = 'CP30_ORIGINAL_SIGNER_V1'
RAW_CODEC_PROTOCOL = 'CP30_CANONICAL_SIGNED_TRANSACTION_V1'
OPERATIONS = {'publish': ('catalogAuthority', 'preparePublish'), 'setListed': ('catalogAuthority', 'prepareSetListed'),'issue': ('issuerAuthority', 'prepareIssue'),
              'lock': ('operatorAuthority', 'prepareLock'),
              'markHandover': ('operatorAuthority', 'prepareMarkHandover'),
              'report': ('operatorAuthority', 'prepareReport')}


class RuntimeRejected(ValueError):
    pass


def word(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{64}', value) or int(value, 16) == 0:
        raise RuntimeRejected('INVALID_DIGEST')
    return value


def uint(value):
    if type(value) is not str or not re.fullmatch(r'(0|[1-9][0-9]*)', value) or int(value) >= 2**256:
        raise RuntimeRejected('INVALID_INTEGER')
    return int(value)


class PrivateBusinessRuntime:
    original_lookup_protocol = OPERATION_PROTOCOL

    def __init__(self, *, policy, ledger, signer, broadcaster, codec, clock, expected_role):
        if expected_role not in {'quoteAuthority', 'issuerAuthority', 'operatorAuthority', 'catalogAuthority'}:
            raise RuntimeRejected('INVALID_PRIVATE_ROLE')
        dependencies = ((ledger, 'durability_protocol', LEDGER_PROTOCOL, ('transaction',)),
            (signer, 'original_signer_protocol', SIGNER_PROTOCOL,
             ('sign_original_quote', 'lookup_original_quote', 'sign_original_transaction', 'lookup_original_transaction')),
            (broadcaster, 'original_lookup_protocol', OPERATION_PROTOCOL, ('broadcast_original', 'lookup_original')),
            (codec, 'transaction_codec_protocol', RAW_CODEC_PROTOCOL,
             ('prepare_quote', 'verify_quote_signature', 'prepare_operation', 'verify_signed_transaction')))
        for dependency, attribute, protocol, methods in dependencies:
            if (dependency is None or getattr(dependency, attribute, None) != protocol
                    or any(not callable(getattr(dependency, method, None)) for method in methods)):
                raise RuntimeRejected('PRIVATE_HOST_ADAPTER_REQUIRED')
        if policy is None or not callable(getattr(policy, 'authorize', None)) or not callable(clock):
            raise RuntimeRejected('PRIVATE_POLICY_REQUIRED')
        self.policy, self.ledger, self.signer = policy, ledger, signer
        self.broadcaster, self.codec, self.clock = broadcaster, codec, clock
        self.expected_role = expected_role

    def _approval(self, tx, record, action):
        # DB-only trusted policy reads the actual approved intent, guard, role, profile,
        # nonce and grant revision. No caller-owned approval booleans are consumed.
        approval = self.policy.authorize(tx, deepcopy(record), action)
        if (type(approval) is not dict or approval.get('original') != record
                or type(approval.get('revision')) is not int or approval['revision'] < 1):
            raise RuntimeRejected('ORIGINAL_NOT_APPROVED')
        profile = approval.get('profile')
        binding = record.get('binding', {})
        if (type(profile) is not dict or profile.get('binding') != binding
                or profile.get('escrowCodeHash') != word(record.get('escrowCodeHash'))
                or profile.get('chainProfileDigest') != word(record.get('chainProfileDigest'))
                or type(binding.get('chainId')) is not int or not 0 < binding['chainId'] < 2**53):
            raise RuntimeRejected('PROFILE_MISMATCH')
        if type(record.get('namespace')) is not str or not record['namespace']:
            raise RuntimeRejected('INVALID_NAMESPACE')
        return deepcopy(approval)

    @staticmethod
    def _key(record, quote=False):
        binding = record['binding']
        return ('quote' if quote else 'operation', str(binding['chainId']), binding['escrow'],
                word(record['quoteId' if quote else 'opId']))

    @staticmethod
    def _same(row, record):
        if row['original'] != record: raise RuntimeRejected('ORIGINAL_CONFLICT')

    def _grant(self, approval, gas_units):
        grant = approval.get('grant')
        if (type(grant) is not dict or grant.get('enabled') is not True
                or type(grant.get('id')) is not str or not grant['id']
                or type(grant.get('revision')) is not int or grant['revision'] < 1
                or type(grant.get('expiresAt')) is not int or grant['expiresAt'] <= self.clock()
                or uint(grant.get('signatureUnits')) < 1 or uint(grant.get('gasUnits')) < gas_units):
            raise RuntimeRejected('SIGNING_GRANT_REQUIRED')
        return deepcopy(grant)

    @staticmethod
    def _transaction(record):
        transaction = record.get('transaction')
        fields = {'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'}
        if type(transaction) is not dict or set(transaction) != fields:
            raise RuntimeRejected('APPROVED_TRANSACTION_REQUIRED')
        values = {name: uint(value) for name, value in transaction.items()}
        if (values['gas'] == 0 or values['maxFeePerGas'] == 0
                or values['maxPriorityFeePerGas'] > values['maxFeePerGas']):
            raise RuntimeRejected('INVALID_GAS_PLAN')
        return values['gas'] * values['maxFeePerGas']

    def _operation(self, record):
        operation = record.get('operation')
        if operation not in OPERATIONS: raise RuntimeRejected('PRIVATE_OPERATION_FORBIDDEN')
        role, method = OPERATIONS[operation]
        if role != self.expected_role: raise RuntimeRejected('PRIVATE_ROLE_MISMATCH')
        prepared = self.codec.prepare_operation(deepcopy(record), method, self.clock())
        deployment, binding = record.get('deployment'), record['binding']
        if (prepared != deployment or prepared.get('functionName') != operation
                or prepared.get('expectedRole') != role or prepared.get('opId') != word(record.get('opId'))
                or prepared.get('from') != binding.get(role) or prepared.get('to') != binding.get('escrow')
                or prepared.get('chainId') != binding['chainId'] or prepared.get('value') != '0'):
            raise RuntimeRejected('ORIGINAL_DEPLOYMENT_MISMATCH')
        for name in ('paramsDigest', 'parametersHash', 'callDataDigest'): word(prepared.get(name))
        return deepcopy(prepared)

    def _raw(self, record, raw):
        if type(raw) is not str or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})+', raw):
            raise RuntimeRejected('INVALID_SIGNED_RAW')
        # Host codec MUST decode/recover canonical signed EIP1559 tx and keccak(raw).
        # Runtime independently compares every approved transaction field before retaining/broadcast.
        observed = self.codec.verify_signed_transaction(deepcopy(record), raw)
        expected = {name: record['deployment'][name] for name in ('chainId', 'from', 'to', 'value', 'data')}
        expected.update(record['transaction'])
        if type(observed) is not dict or any(observed.get(name) != value for name, value in expected.items()):
            raise RuntimeRejected('SIGNED_TRANSACTION_MISMATCH')
        return {'raw': raw.lower(), 'transactionHash': word(observed.get('transactionHash'))}

    def _retained_hash(self, record, row):
        verified = self._raw(record, row.get('raw'))
        if verified['transactionHash'] != row.get('transactionHash') or verified['raw'] != row.get('raw'):
            raise RuntimeRejected('ORIGINAL_RETAINED_HASH_MISMATCH')
        return verified['transactionHash']

    def _retained_quote(self, record, row):
        prepared = row['prepared']
        if (prepared.get('typedData') != record.get('typedData') or prepared.get('digest') != record.get('digest')
                or self.codec.verify_quote_signature(deepcopy(record), deepcopy(prepared), row['signature']) is not True):
            raise RuntimeRejected('ORIGINAL_RETAINED_SIGNATURE_MISMATCH')
        return row['signature']

    def _commit_result(self, key, record, approval, result, quote=False):
        with self.ledger.transaction() as tx:
            current = self._approval(tx, record, 'quote_result' if quote else 'operation_result')
            if current != approval: raise RuntimeRejected('APPROVAL_CHANGED')
            row = tx.get(key)
            if row is None: raise RuntimeRejected('ORIGINAL_ATTEMPT_MISSING')
            self._same(row, record)
            field = 'signature' if quote else 'transactionHash'
            if row.get(field) is not None:
                if any(row.get(name) != value for name, value in result.items()):
                    raise RuntimeRejected('ORIGINAL_RESULT_CONFLICT')
                return deepcopy(row), False
            row.update(deepcopy(result), stage='QUOTE_RETAINED' if quote else 'BROADCAST_UNKNOWN')
            tx.save(key, deepcopy(row))  # raw/hash retained before any possible broadcast.
            return deepcopy(row), True

    def sign_original_quote(self, record):
        if self.expected_role != 'quoteAuthority': raise RuntimeRejected('PRIVATE_ROLE_MISMATCH')
        record = deepcopy(record)
        with self.ledger.transaction(read_only=True) as tx:
            approval = self._approval(tx, record, 'quote_lookup')
            key = self._key(record, quote=True)
            row = tx.get(key)
            if row is not None:
                self._same(row, record)
        if row is not None and row.get('signature') is not None:
            return self._retained_quote(record, row)
        fresh = row is None
        if fresh:
            prepared = self.codec.prepare_quote(deepcopy(record), self.clock())
            if (prepared.get('typedData') != record.get('typedData') or prepared.get('digest') != word(record.get('digest'))
                    or prepared.get('quote') != record.get('quote') or record['quoteId'] != record['quote'].get('quoteId')):
                raise RuntimeRejected('ORIGINAL_QUOTE_MISMATCH')
        else:
            prepared = deepcopy(row['prepared'])
        with self.ledger.transaction() as tx:
            current = self._approval(tx, record, 'quote_sign' if fresh else 'quote_lookup')
            if current != approval: raise RuntimeRejected('APPROVAL_CHANGED')
            row = tx.get(key)
            if row is not None:
                self._same(row, record)
                fresh, prepared = False, deepcopy(row['prepared'])
            else:
                grant = self._grant(approval, 0)
                tx.reserve_original(key, grant, original=deepcopy(record), signature_units=1, gas_units=0)
                row = {'original': record, 'prepared': prepared, 'stage': 'QUOTE_SIGNING', 'reservation': grant}
                tx.insert(key, deepcopy(row))  # Signing intent and reservation are one durable commit.
        if row.get('signature') is not None: return self._retained_quote(record, row)
        signature = (self.signer.sign_original_quote(deepcopy(record), deepcopy(prepared)) if fresh
                     else self.signer.lookup_original_quote(deepcopy(record)))
        if signature is None: raise RuntimeRejected('ORIGINAL_QUOTE_UNKNOWN')
        if type(signature) is not str or not re.fullmatch(r'0x[0-9a-fA-F]{130}', signature):
            raise RuntimeRejected('INVALID_QUOTE_SIGNATURE')
        if self.codec.verify_quote_signature(deepcopy(record), deepcopy(prepared), signature) is not True:
            raise RuntimeRejected('QUOTE_AUTHORITY_MISMATCH')
        row, _ = self._commit_result(key, record, approval, {'signature': signature}, quote=True)
        return row['signature']

    def send_original(self, record):
        if self.expected_role not in {'issuerAuthority', 'operatorAuthority', 'catalogAuthority'}: raise RuntimeRejected('PRIVATE_ROLE_MISMATCH')
        record = deepcopy(record)
        if record.get('operation') not in OPERATIONS or OPERATIONS[record['operation']][0] != self.expected_role:
            raise RuntimeRejected('PRIVATE_OPERATION_FORBIDDEN')
        with self.ledger.transaction(read_only=True) as tx:
            approval = self._approval(tx, record, 'operation_lookup')
            key = self._key(record)
            row = tx.get(key)
            if row is not None:
                self._same(row, record)
        if row is not None:
            if row.get('transactionHash'): return self._retained_hash(record, row)
            raise RuntimeRejected('ORIGINAL_ATTEMPT_UNKNOWN')
        self._operation(record)
        gas_units = self._transaction(record)
        with self.ledger.transaction() as tx:
            current = self._approval(tx, record, 'operation_sign')
            if current != approval: raise RuntimeRejected('APPROVAL_CHANGED')
            row = tx.get(key)
            if row is not None:
                self._same(row, record)
                if not row.get('transactionHash'): raise RuntimeRejected('ORIGINAL_ATTEMPT_UNKNOWN')
            else:
                grant = self._grant(approval, gas_units)
                tx.reserve_original(key, grant, original=deepcopy(record), signature_units=1, gas_units=gas_units)
                tx.insert(key, {'original': record, 'stage': 'TRANSACTION_SIGNING', 'reservation': grant})
        if row is not None: return self._retained_hash(record, row)
        raw = self.signer.sign_original_transaction(deepcopy(record))
        result = self._raw(record, raw)
        row, winner = self._commit_result(key, record, approval, result)
        if winner:
            self._grant(approval, gas_units)  # Expiry after signing still forbids a fresh broadcast.
            # UNKNOWN persisted first. Errors keep original raw/hash and never trigger another send.
            observed_hash = self.broadcaster.broadcast_original(row['raw'], row['transactionHash'], deepcopy(record))
            if observed_hash != row['transactionHash']: raise RuntimeRejected('BROADCAST_HASH_MISMATCH')
        return row['transactionHash']

    def lookup_original(self, record):
        if self.expected_role not in {'issuerAuthority', 'operatorAuthority', 'catalogAuthority'}: raise RuntimeRejected('PRIVATE_ROLE_MISMATCH')
        record = deepcopy(record)
        if record.get('operation') not in OPERATIONS or OPERATIONS[record['operation']][0] != self.expected_role:
            raise RuntimeRejected('PRIVATE_OPERATION_FORBIDDEN')
        with self.ledger.transaction(read_only=True) as tx:
            approval = self._approval(tx, record, 'operation_lookup')
            key = self._key(record)
            row = tx.get(key)
            if row is None: return None
            self._same(row, record)
        if not row.get('transactionHash'):
            raw = self.signer.lookup_original_transaction(deepcopy(record))
            if raw is None: return None
            result = self._raw(record, raw)
            row, _ = self._commit_result(key, record, approval, result)
            # Recovered original raw is retained only; a lookup NEVER broadcasts it.
        original_hash = self._retained_hash(record, row)
        observed = self.broadcaster.lookup_original(deepcopy(record), original_hash)
        if observed is not None and observed != original_hash:
            raise RuntimeRejected('ORIGINAL_RPC_HASH_MISMATCH')
        return original_hash  # Known local original hash is a locator, not success/finality.
