"""Private domain tests with pure stubs. NO cryptography, key, signer process, RPC or PG."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from business.private_runtime import (PrivateBusinessRuntime, RuntimeRejected, OPERATION_PROTOCOL,
                                     LEDGER_PROTOCOL, SIGNER_PROTOCOL, RAW_CODEC_PROTOCOL)


def w(n): return '0x' + f'{n:064x}'
def a(n): return '0x' + f'{n:040x}'
STUB_SIGNATURE = '0x' + '0' * 63 + '1' + '0' * 63 + '1' + '1b'


class StubLedger:
    durability_protocol = LEDGER_PROTOCOL  # Test-only claim; not a usable durable adapter.
    def __init__(self):
        self.rows, self.reservations = {}, {}
        self.depth, self.signature_spent, self.gas_spent = 0, 0, 0
        self.lock = threading.RLock()

    @contextmanager
    def transaction(self, *, read_only=False):
        with self.lock:
            before = deepcopy((self.rows, self.reservations, self.signature_spent, self.gas_spent))
            self.depth += 1
            try: yield self
            except Exception:
                self.rows, self.reservations, self.signature_spent, self.gas_spent = before
                raise
            finally: self.depth -= 1

    def get(self, key): return deepcopy(self.rows.get(key))
    def insert(self, key, row):
        assert key not in self.rows
        self.rows[key] = deepcopy(row)
    def save(self, key, row): self.rows[key] = deepcopy(row)
    def reserve_original(self, key, grant, *, original, signature_units, gas_units):
        assert self.depth == 1
        if key in self.reservations:
            assert self.reservations[key] == (original, signature_units, gas_units)
            return
        if self.signature_spent + signature_units > int(grant['signatureUnits']):
            raise RuntimeRejected('SIGNATURE_BUDGET_EXHAUSTED')
        if self.gas_spent + gas_units > int(grant['gasUnits']):
            raise RuntimeRejected('GAS_BUDGET_EXHAUSTED')
        self.reservations[key] = (deepcopy(original), signature_units, gas_units)
        self.signature_spent += signature_units
        self.gas_spent += gas_units


class StubPolicy:
    def __init__(self, original):
        self.original = deepcopy(original)
        self.grant = {'id':'synthetic-grant', 'revision':1, 'enabled':True, 'expiresAt':200,
                      'signatureUnits':'1', 'gasUnits':'100'}
    def authorize(self, tx, record, action):
        if record != self.original: raise RuntimeRejected('ORIGINAL_NOT_APPROVED')
        return {'original':deepcopy(self.original), 'revision':1, 'grant':deepcopy(self.grant),
                'profile':{name:deepcopy(self.original[name]) for name in ('binding','escrowCodeHash','chainProfileDigest')}}


class StubCodec:
    transaction_codec_protocol = RAW_CODEC_PROTOCOL
    def __init__(self, ledger): self.ledger = ledger
    def outside(self): assert self.ledger.depth == 0
    def prepare_quote(self, record, now):
        self.outside()
        return {name:deepcopy(record[name]) for name in ('typedData','digest','quote')}
    def verify_quote_signature(self, record, prepared, signature):
        self.outside()
        return signature == STUB_SIGNATURE
    def prepare_operation(self, record, method, now):
        self.outside()
        return deepcopy(record['deployment'])
    def verify_signed_transaction(self, record, raw):
        self.outside()
        assert raw == '0x1234'  # Explicit inert stub bytes, not an actual signed transaction.
        return {**{name:record['deployment'][name] for name in ('chainId','from','to','value','data')},
                **record['transaction'], 'transactionHash':w(80)}  # Stub hash; no cryptography executed.


class StubSigner:
    original_signer_protocol = SIGNER_PROTOCOL
    def __init__(self, ledger):
        self.ledger, self.quote_count, self.tx_count = ledger, 0, 0
        self.quote_signature, self.raw = None, None
        self.fail_response = False
        self.on_sign = None
    def sign_original_quote(self, record, prepared):
        assert self.ledger.depth == 0
        self.quote_count += 1
        self.quote_signature = STUB_SIGNATURE
        return self.quote_signature
    def lookup_original_quote(self, record):
        assert self.ledger.depth == 0
        return self.quote_signature
    def sign_original_transaction(self, record):
        assert self.ledger.depth == 0
        assert list(self.ledger.rows.values())[0]['stage'] == 'TRANSACTION_SIGNING'
        self.tx_count += 1
        if self.on_sign: self.on_sign()
        self.raw = '0x1234'
        if self.fail_response: raise RuntimeError('stub sign response lost')
        return self.raw
    def lookup_original_transaction(self, record):
        assert self.ledger.depth == 0
        return self.raw


class StubBroadcaster:
    original_lookup_protocol = OPERATION_PROTOCOL
    def __init__(self, ledger): self.ledger, self.count, self.fail_response = ledger, 0, False
    def broadcast_original(self, raw, transaction_hash, record):
        assert self.ledger.depth == 0
        row = list(self.ledger.rows.values())[0]
        assert row['raw'] == raw and row['transactionHash'] == transaction_hash
        assert row['stage'] == 'BROADCAST_UNKNOWN'
        self.count += 1
        if self.fail_response: raise RuntimeError('stub broadcast response lost')
        return transaction_hash
    def lookup_original(self, record, transaction_hash):
        assert self.ledger.depth == 0
        return None  # Missing observation never causes signing/broadcast retry.


class PrivateRuntimeTests(unittest.TestCase):
    def setUp(self):
        binding = {'chainId':31337, 'escrow':a(20), 'issuerAuthority':a(24),
                   'operatorAuthority':a(25), 'quoteAuthority':a(22)}
        self.record = {'namespace':'synthetic', 'binding':binding, 'opId':w(40), 'operation':'issue',
            'escrowCodeHash':w(70), 'chainProfileDigest':w(71), 'parameters':{'opId':w(40)},
            'transaction':{'nonce':'0','gas':'10','maxFeePerGas':'10','maxPriorityFeePerGas':'1'},
            'deployment':{'chainId':31337,'from':a(24),'to':a(20),'value':'0','data':'0xabcd',
                'functionName':'issue','expectedRole':'issuerAuthority','opId':w(40),
                'paramsDigest':w(41),'parametersHash':w(42),'callDataDigest':w(43)}}
        self.ledger = StubLedger()
        self.policy, self.codec = StubPolicy(self.record), StubCodec(self.ledger)
        self.signer, self.broadcaster = StubSigner(self.ledger), StubBroadcaster(self.ledger)
        self.runtime = self.build('issuerAuthority')
    def build(self, role):
        return PrivateBusinessRuntime(policy=self.policy, ledger=self.ledger, signer=self.signer,
            broadcaster=self.broadcaster, codec=self.codec, clock=lambda:100, expected_role=role)

    def test_original_quote_retained_once_and_changed_original_rejected(self):
        quote = {**{name:self.record[name] for name in ('namespace','binding','escrowCodeHash','chainProfileDigest')},
            'quoteId':w(30),'quote':{'quoteId':w(30)}, 'typedData':{'stub':True}, 'digest':w(31)}
        self.policy.original = deepcopy(quote)
        runtime = self.build('quoteAuthority')
        self.assertEqual(runtime.sign_original_quote(quote), STUB_SIGNATURE)
        self.assertEqual(runtime.sign_original_quote(quote), STUB_SIGNATURE)
        self.assertEqual(self.signer.quote_count, 1)
        self.assertEqual(self.ledger.signature_spent, 1)
        changed = {**quote,'digest':w(99)}
        with self.assertRaises(RuntimeRejected): runtime.sign_original_quote(changed)

    def test_one_signer_winner_reservation_and_hash_retained_before_broadcast(self):
        def compete():
            with self.assertRaisesRegex(RuntimeRejected,'ORIGINAL_ATTEMPT_UNKNOWN'):
                self.runtime.send_original(self.record)
        self.signer.on_sign = compete
        self.assertEqual(self.runtime.send_original(self.record), w(80))
        self.assertEqual(self.runtime.send_original(self.record), w(80))
        self.assertEqual(self.runtime.lookup_original(self.record), w(80))
        self.assertEqual((self.signer.tx_count,self.broadcaster.count), (1,1))
        self.assertEqual((self.ledger.signature_spent,self.ledger.gas_spent), (1,100))
        list(self.ledger.rows.values())[0]['transactionHash'] = w(99)
        with self.assertRaisesRegex(RuntimeRejected,'ORIGINAL_RETAINED_HASH_MISMATCH'):
            self.runtime.lookup_original(self.record)
        self.assertEqual((self.signer.tx_count,self.broadcaster.count), (1,1))

    def test_uncertain_sign_or_broadcast_only_queries_original_never_resends(self):
        self.signer.fail_response = True
        with self.assertRaises(RuntimeError): self.runtime.send_original(self.record)
        self.assertEqual(self.runtime.lookup_original(self.record), w(80))
        self.assertEqual(self.runtime.send_original(self.record), w(80))
        self.assertEqual((self.signer.tx_count,self.broadcaster.count), (1,0))
        self.setUp()
        self.broadcaster.fail_response = True
        with self.assertRaises(RuntimeError): self.runtime.send_original(self.record)
        self.assertEqual(self.runtime.lookup_original(self.record), w(80))
        self.assertEqual(self.runtime.send_original(self.record), w(80))
        self.assertEqual((self.signer.tx_count,self.broadcaster.count), (1,1))

    def test_missing_grant_owner_operation_or_mismatched_signed_raw_never_broadcast(self):
        self.policy.grant['enabled'] = False
        with self.assertRaisesRegex(RuntimeRejected,'SIGNING_GRANT_REQUIRED'): self.runtime.send_original(self.record)
        self.assertEqual((self.signer.tx_count,self.broadcaster.count), (0,0))
        with self.assertRaisesRegex(RuntimeRejected,'PRIVATE_OPERATION_FORBIDDEN'):
            self.runtime.send_original({**self.record,'operation':'settle'})
        self.policy.grant['enabled'] = True
        original = self.codec.verify_signed_transaction
        self.codec.verify_signed_transaction = lambda record,raw: {**original(record,raw),'from':a(99)}
        with self.assertRaisesRegex(RuntimeRejected,'SIGNED_TRANSACTION_MISMATCH'): self.runtime.send_original(self.record)
        self.assertEqual(self.broadcaster.count, 0)
        self.assertEqual(list(self.ledger.rows.values())[0]['stage'],'TRANSACTION_SIGNING')


if __name__ == '__main__': unittest.main()
