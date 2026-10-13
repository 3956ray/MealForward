"""Functional registrar service domain; injected host adapters own persistence/keys/network.

No owner signing, arbitrary deployment, public success flags or automatic UNKNOWN resend.
"""
from __future__ import annotations
from copy import deepcopy
import re

from business.private_runtime import (LEDGER_PROTOCOL, SIGNER_PROTOCOL, RAW_CODEC_PROTOCOL,
                                      RuntimeRejected as RegistrarRejected, uint, word)
from .service import address

REGISTRAR_PROTOCOL = 'CP30_ORIGINAL_REGISTRATION_V1'
IMMUTABLE_FIELDS = ('namespace', 'subject', 'owner', 'bindingRevision', 'key', 'request',
                    'requestDigest', 'registrationId', 'storeId', 'original', 'prepared',
                    'ownerSignature', 'deployment')
PROFILE_FIELDS = ('chainId', 'factory', 'registrar', 'asset', 'quoteAuthority', 'catalogAuthority',
                  'issuerAuthority', 'operatorAuthority', 'escrowCreationCodeHash')


class RegistrarRuntime:
    original_lookup_protocol = REGISTRAR_PROTOCOL

    def __init__(self, policy, ledger, signer, broadcaster, registration_codec, transaction_crypto, clock):
        requirements = ((ledger, 'durability_protocol', LEDGER_PROTOCOL, ('transaction',)),
            (signer, 'original_signer_protocol', SIGNER_PROTOCOL,
             ('sign_original_transaction', 'lookup_original_transaction')),
            (broadcaster, 'original_lookup_protocol', REGISTRAR_PROTOCOL, ('broadcast_original', 'lookup_original')),
            (transaction_crypto, 'transaction_codec_protocol', RAW_CODEC_PROTOCOL,
             ('prepare_original_envelope', 'inspect_signed_transaction')))
        for dependency, marker, protocol, methods in requirements:
            if (dependency is None or getattr(dependency, marker, None) != protocol
                    or any(not callable(getattr(dependency, method, None)) for method in methods)):
                raise RegistrarRejected('REGISTRAR_HOST_ADAPTER_REQUIRED')
        if (policy is None or not callable(getattr(policy, 'authorize', None)) or not callable(clock)
                or registration_codec is None or any(not callable(getattr(registration_codec, method, None))
                   for method in ('prepare', 'verify_owner_signature', 'prepare_deployment'))):
            raise RegistrarRejected('REGISTRAR_POLICY_CODEC_REQUIRED')
        self.policy, self.ledger, self.signer, self.broadcaster = policy, ledger, signer, broadcaster
        self.registration_codec, self.transaction_crypto, self.clock = registration_codec, transaction_crypto, clock

    @staticmethod
    def _immutable(record):
        if type(record) is not dict or any(field not in record for field in IMMUTABLE_FIELDS):
            raise RegistrarRejected('INVALID_ORIGINAL_REGISTRATION')
        original = {field: deepcopy(record[field]) for field in IMMUTABLE_FIELDS}
        if (type(original['namespace']) is not str or not original['namespace']
                or type(original['subject']) is not str or not original['subject']
                or type(original['bindingRevision']) is not int or original['bindingRevision'] < 1
                or type(original['original']) is not dict or type(original['prepared']) is not dict):
            raise RegistrarRejected('INVALID_ORIGINAL_REGISTRATION')
        nested = original['original']
        if (word(original['registrationId']) != nested.get('registrationId')
                or word(original['storeId']) != nested.get('storeId')
                or address(original['owner']) != nested.get('owner')
                or uint(nested.get('chainId')) == 0 or uint(nested.get('deadline')) == 0):
            raise RegistrarRejected('ORIGINAL_BINDING_MISMATCH')
        word(original['prepared'].get('configHash')); word(original['prepared'].get('parametersDigest'))
        word(nested.get('escrowCreationCodeHash'))
        if type(original['ownerSignature']) is not str or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2}){1,4096}', original['ownerSignature']):
            raise RegistrarRejected('INVALID_OWNER_SIGNATURE')
        return original

    @staticmethod
    def _key(record):
        original = record['original']
        return ('registration', original['chainId'], original['factory'], record['registrationId'])

    def _approval(self, tx, record, action):
        # DB-only actual approved registration, subject+wallet revision, system role,
        # profile/restore guard and persisted immutable nonce/gas plan. No owner signing.
        approval = self.policy.authorize(tx, deepcopy(record), action)
        if (type(approval) is not dict or approval.get('original') != record
                or type(approval.get('revision')) is not int or approval['revision'] < 1
                or approval.get('systemRole') != 'registrar'):
            raise RegistrarRejected('REGISTRAR_NOT_APPROVED')
        profile = approval.get('profile')
        if type(profile) is not dict or any(profile.get(field) != record['original'].get(field) for field in PROFILE_FIELDS):
            raise RegistrarRejected('REGISTRAR_PROFILE_MISMATCH')
        word(profile.get('factoryCodeHash')); word(profile.get('chainProfileDigest'))
        if type(approval.get('transaction')) is not dict or set(approval['transaction']) != {
                'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'}:
            raise RegistrarRejected('REGISTRAR_TRANSACTION_PLAN_REQUIRED')
        plan = {key: uint(value) for key, value in approval['transaction'].items()}
        if plan['gas'] == 0 or plan['maxFeePerGas'] == 0 or plan['maxPriorityFeePerGas'] > plan['maxFeePerGas']:
            raise RegistrarRejected('INVALID_REGISTRAR_GAS_PLAN')
        return deepcopy(approval)

    @staticmethod
    def _same(row, record, approval):
        if row['original'] != record or row['approval'] != approval:
            raise RegistrarRejected('ORIGINAL_REGISTRATION_CONFLICT')

    def _fresh(self, record, approval):
        if uint(record['original']['deadline']) <= self.clock(): raise RegistrarRejected('OWNER_AUTHORIZATION_EXPIRED')
        grant = approval.get('grant')
        gas_units = uint(approval['transaction']['gas']) * uint(approval['transaction']['maxFeePerGas'])
        if (type(grant) is not dict or grant.get('enabled') is not True
                or type(grant.get('id')) is not str or not grant['id']
                or type(grant.get('revision')) is not int or grant['revision'] < 1
                or type(grant.get('expiresAt')) is not int or grant['expiresAt'] <= self.clock()
                or uint(grant.get('signatureUnits')) < 1 or uint(grant.get('gasUnits')) < gas_units):
            raise RegistrarRejected('REGISTRAR_GAS_SIGNING_GRANT_REQUIRED')
        return deepcopy(grant), gas_units

    def _preflight_payload(self, record):
        original = deepcopy(record['original'])
        if self.registration_codec.prepare(original) != record['prepared']:
            raise RegistrarRejected('ORIGINAL_PARAMETERS_DIGEST_MISMATCH')
        if self.registration_codec.verify_owner_signature(original, record['ownerSignature']) is not True:
            raise RegistrarRejected('OWNER_AUTHORIZATION_REJECTED')
        deployment = self.registration_codec.prepare_deployment(original, record['ownerSignature'])
        if (deployment != record['deployment'] or deployment.get('value') != '0'
                or deployment.get('from') != original['registrar'] or deployment.get('to') != original['factory']
                or type(deployment.get('chainId')) is not int or str(deployment['chainId']) != original['chainId']):
            raise RegistrarRejected('ORIGINAL_CREATESTORE_MISMATCH')
        word(deployment.get('callDataDigest'))
        # Node codec uses only wallet-owned original creation code and createStore ABI.

    @staticmethod
    def _signer_record(record, approval):
        return {**deepcopy(record), 'transaction': deepcopy(approval['transaction']),
                'profile': deepcopy(approval['profile']), 'grant': deepcopy(approval['grant'])}

    def _expected(self, record, approval):
        plan = {'type':'eip1559', **deepcopy(approval['transaction']),
                'gasBudgetWei': approval['grant']['gasUnits']}
        return self.transaction_crypto.prepare_original_envelope(deepcopy(record['deployment']), plan)

    def _raw(self, raw, expected):
        if type(raw) is not str or not re.fullmatch(r'0x(?:[0-9a-fA-F]{2})+', raw):
            raise RegistrarRejected('INVALID_REGISTRAR_RAW')
        observed = self.transaction_crypto.inspect_signed_transaction(raw, deepcopy(expected))
        fields = ('chainId','from','to','value','data','nonce','gas','maxFeePerGas','maxPriorityFeePerGas','type')
        if type(observed) is not dict or any(observed.get(field) != expected.get(field) for field in fields):
            raise RegistrarRejected('REGISTRAR_SIGNED_TRANSACTION_MISMATCH')
        return {'raw':raw.lower(), 'transactionHash':word(observed.get('hash'))}

    def _retained(self, row, record, approval):
        expected = self._expected(record, approval)
        if expected != row['expected']: raise RegistrarRejected('ORIGINAL_ENVELOPE_CONFLICT')
        verified = self._raw(row.get('raw'), expected)
        if verified['transactionHash'] != row.get('transactionHash') or verified['raw'] != row.get('raw'):
            raise RegistrarRejected('ORIGINAL_RETAINED_HASH_MISMATCH')
        return verified['transactionHash']

    def _retain(self, key, record, approval, expected, result):
        with self.ledger.transaction() as tx:
            current = self._approval(tx, record, 'registrar_result')
            if current != approval: raise RegistrarRejected('REGISTRAR_APPROVAL_CHANGED')
            row = tx.get(key)
            if row is None: raise RegistrarRejected('ORIGINAL_ATTEMPT_MISSING')
            self._same(row, record, approval)
            if row['expected'] != expected: raise RegistrarRejected('ORIGINAL_ENVELOPE_CONFLICT')
            if row.get('transactionHash'):
                if any(row.get(field) != value for field, value in result.items()):
                    raise RegistrarRejected('ORIGINAL_REGISTRAR_RESULT_CONFLICT')
                return deepcopy(row), False
            row.update(deepcopy(result), stage='BROADCAST_UNKNOWN')
            tx.save(key, deepcopy(row))  # Canonical original raw/hash precede possible broadcast.
            return deepcopy(row), True

    def _snapshot(self, incoming):
        record = self._immutable(incoming)
        with self.ledger.transaction(read_only=True) as tx:
            approval = self._approval(tx, record, 'registrar_lookup')
            key = self._key(record)
            row = tx.get(key)
            if row is not None: self._same(row, record, approval)
            if incoming.get('transactionHash') is not None:
                if row is None or incoming['transactionHash'] != row.get('transactionHash'):
                    raise RegistrarRejected('ORIGINAL_REGISTRAR_LOCATOR_CONFLICT')
        return record, approval, key, row

    def send_original(self, incoming):
        record, approval, key, row = self._snapshot(incoming)
        if row is not None:
            if row.get('transactionHash'): return self._retained(row, record, approval)
            raise RegistrarRejected('ORIGINAL_REGISTRAR_ATTEMPT_UNKNOWN')
        self._fresh(record, approval)
        self._preflight_payload(record)  # Owner verification, Node work and crypto are outside transactions.
        expected = self._expected(record, approval)
        with self.ledger.transaction() as tx:
            current = self._approval(tx, record, 'registrar_sign')
            if current != approval: raise RegistrarRejected('REGISTRAR_APPROVAL_CHANGED')
            row = tx.get(key)
            if row is not None:
                self._same(row, record, approval)
                if not row.get('transactionHash'): raise RegistrarRejected('ORIGINAL_REGISTRAR_ATTEMPT_UNKNOWN')
            else:
                grant, gas_units = self._fresh(record, approval)
                tx.reserve_original(key, grant, original=self._signer_record(record, approval),
                                    signature_units=1, gas_units=gas_units)
                tx.insert(key, {'original':record, 'approval':approval, 'expected':expected,
                                'reservation':grant, 'stage':'TRANSACTION_SIGNING'})
        if row is not None: return self._retained(row, record, approval)
        signer_record = self._signer_record(record, approval)
        raw = self.signer.sign_original_transaction(deepcopy(signer_record))  # Registrar only, never owner.
        result = self._raw(raw, expected)
        row, winner = self._retain(key, record, approval, expected, result)
        if winner:
            self._fresh(record, approval)  # Late owner/grant expiry blocks first broadcast too.
            returned = self.broadcaster.broadcast_original(row['raw'], row['transactionHash'], deepcopy(signer_record))
            if returned != row['transactionHash']: raise RegistrarRejected('REGISTRAR_BROADCAST_HASH_MISMATCH')
        return row['transactionHash']

    def lookup_original(self, incoming):
        record, approval, key, row = self._snapshot(incoming)
        if row is None: return None
        signer_record = self._signer_record(record, approval)
        if not row.get('transactionHash'):
            raw = self.signer.lookup_original_transaction(deepcopy(signer_record))
            if raw is None: return None
            expected = self._expected(record, approval)
            result = self._raw(raw, expected)
            row, _ = self._retain(key, record, approval, expected, result)
            # Recovery may retain original raw/hash, but may NEVER broadcast or sign again.
        transaction_hash = self._retained(row, record, approval)
        observed = self.broadcaster.lookup_original(deepcopy(signer_record), transaction_hash)
        if observed is not None and observed != transaction_hash:
            raise RegistrarRejected('ORIGINAL_REGISTRAR_RPC_HASH_MISMATCH')
        return transaction_hash  # Original locator only; domain's finalized verifier owns confirmation.
