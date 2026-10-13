"""Independent pure-stub registrar tests. No crypto, new key, RPC, signer host or PG."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from onboarding.registrar_runtime import RegistrarRuntime, RegistrarRejected, REGISTRAR_PROTOCOL, PROFILE_FIELDS
from business.private_runtime import LEDGER_PROTOCOL, SIGNER_PROTOCOL, RAW_CODEC_PROTOCOL


def w(n): return '0x' + f'{n:064x}'
def a(n): return '0x' + f'{n:040x}'


class StubLedger:
    durability_protocol = LEDGER_PROTOCOL
    def __init__(self):
        self.rows, self.reservations, self.depth = {}, {}, 0
        self.signatures, self.gas = 0, 0
        self.lock = threading.RLock()
    @contextmanager
    def transaction(self, *, read_only=False):
        with self.lock:
            before = deepcopy((self.rows,self.reservations,self.signatures,self.gas))
            self.depth += 1
            try: yield self
            except Exception:
                self.rows,self.reservations,self.signatures,self.gas = before
                raise
            finally: self.depth -= 1
    def get(self,key): return deepcopy(self.rows.get(key))
    def insert(self,key,row):
        assert key not in self.rows
        self.rows[key] = deepcopy(row)
    def save(self,key,row): self.rows[key] = deepcopy(row)
    def reserve_original(self,key,grant,*,original,signature_units,gas_units):
        if key in self.reservations:
            assert self.reservations[key] == (original,signature_units,gas_units)
            return
        if self.signatures+signature_units>int(grant['signatureUnits']) or self.gas+gas_units>int(grant['gasUnits']):
            raise RegistrarRejected('STUB_BUDGET_EXHAUSTED')
        self.reservations[key] = (deepcopy(original),signature_units,gas_units)
        self.signatures += signature_units
        self.gas += gas_units


class StubPolicy:
    def __init__(self,record):
        self.record = deepcopy(record)
        self.revision = 1
        self.grant = {'id':'synthetic-gas-grant','revision':1,'enabled':True,'expiresAt':200,
                      'signatureUnits':'1','gasUnits':'100'}
    def authorize(self,tx,record,action):
        if record != self.record: raise RegistrarRejected('ORIGINAL_NOT_APPROVED')
        return {'original':deepcopy(self.record),'revision':self.revision,'systemRole':'registrar',
            'profile':{**{field:deepcopy(self.record['original'][field]) for field in PROFILE_FIELDS},
                       'factoryCodeHash':w(72),'chainProfileDigest':w(73)},
            'transaction':{'nonce':'0','gas':'10','maxFeePerGas':'10','maxPriorityFeePerGas':'1'},
            'grant':deepcopy(self.grant)}


class StubRegistrationCodec:
    def __init__(self,ledger,record): self.ledger,self.record = ledger,record
    def prepare(self,original):
        assert self.ledger.depth == 0
        return deepcopy(self.record['prepared'])
    def verify_owner_signature(self,original,signature):
        assert self.ledger.depth == 0
        return signature == self.record['ownerSignature']
    def prepare_deployment(self,original,signature):
        assert self.ledger.depth == 0
        return deepcopy(self.record['deployment'])


class StubTransactionCrypto:
    transaction_codec_protocol = RAW_CODEC_PROTOCOL
    def __init__(self,ledger): self.ledger=ledger
    def prepare_original_envelope(self,descriptor,plan):
        assert self.ledger.depth == 0
        return {**{field:descriptor[field] for field in ('chainId','from','to','value','data')},**plan}
    def inspect_signed_transaction(self,raw,expected):
        assert self.ledger.depth == 0
        assert raw == '0x1234'  # Inert bytes, not an actual signed transaction.
        return {**expected,'hash':w(80)}  # Deliberate stub result; no cryptography performed.


class StubSigner:
    original_signer_protocol = SIGNER_PROTOCOL
    def __init__(self,ledger):
        self.ledger,self.count,self.raw = ledger,0,None
        self.raise_response,self.on_sign = False,None
    def sign_original_transaction(self,record):
        assert self.ledger.depth == 0
        row=list(self.ledger.rows.values())[0]
        assert row['stage']=='TRANSACTION_SIGNING'
        assert record['transaction']['nonce']=='0'
        assert record['deployment']['from']==record['original']['registrar']
        self.count+=1
        if self.on_sign: self.on_sign()
        self.raw='0x1234'
        if self.raise_response: raise RuntimeError('stub sign response loss')
        return self.raw
    def lookup_original_transaction(self,record):
        assert self.ledger.depth == 0
        return self.raw


class StubBroadcaster:
    original_lookup_protocol = REGISTRAR_PROTOCOL
    def __init__(self,ledger): self.ledger,self.count,self.raise_response=ledger,0,False
    def broadcast_original(self,raw,transaction_hash,record):
        assert self.ledger.depth == 0
        row=list(self.ledger.rows.values())[0]
        assert row['raw']==raw and row['transactionHash']==transaction_hash and row['stage']=='BROADCAST_UNKNOWN'
        self.count+=1
        if self.raise_response: raise RuntimeError('stub broadcast response loss')
        return transaction_hash
    def lookup_original(self,record,transaction_hash):
        assert self.ledger.depth == 0
        return None


class RegistrarRuntimeTests(unittest.TestCase):
    def setUp(self):
        original={'chainId':'31337','factory':a(20),'registrar':a(26),'asset':a(21),
            'quoteAuthority':a(22),'catalogAuthority':a(23),'issuerAuthority':a(24),'operatorAuthority':a(25),
            'escrowCreationCodeHash':w(70),'registrationId':w(1),'storeId':w(2),'owner':a(10),
            'deadline':'200','catalog':[{'stub-real-catalog-required':True}]}
        self.record={'namespace':'synthetic','subject':'synthetic-owner','owner':a(10),'bindingRevision':1,
            'key':'synthetic-key-0001','request':{'stub':True},'requestDigest':'1'*64,
            'registrationId':w(1),'storeId':w(2),'original':original,
            'prepared':{'configHash':w(71),'parametersDigest':w(74),'typedData':{'stub':True}},
            'ownerSignature':'0x1234','deployment':{'chainId':31337,'from':a(26),'to':a(20),
                'value':'0','data':'0xabcd','callDataDigest':w(75)}}
        self.now=100
        self.ledger=StubLedger()
        self.policy=StubPolicy(self.record)
        self.codec=StubRegistrationCodec(self.ledger,self.record)
        self.crypto=StubTransactionCrypto(self.ledger)
        self.signer,self.broadcaster=StubSigner(self.ledger),StubBroadcaster(self.ledger)
        self.runtime=RegistrarRuntime(self.policy,self.ledger,self.signer,self.broadcaster,
                                     self.codec,self.crypto,lambda:self.now)

    def test_single_sign_broadcast_budget_and_replay_even_after_owner_expiry(self):
        def competing_send():
            with self.assertRaisesRegex(RegistrarRejected,'ORIGINAL_REGISTRAR_ATTEMPT_UNKNOWN'):
                self.runtime.send_original({**self.record,'state':'UNKNOWN'})
        self.signer.on_sign=competing_send
        self.assertEqual(self.runtime.send_original({**self.record,'state':'UNKNOWN'}),w(80))
        self.now=201
        self.assertEqual(self.runtime.send_original({**self.record,'state':'UNKNOWN','transactionHash':w(80)}),w(80))
        self.assertEqual(self.runtime.lookup_original({**self.record,'state':'UNKNOWN','transactionHash':w(80)}),w(80))
        self.assertEqual((self.signer.count,self.broadcaster.count),(1,1))
        self.assertEqual((self.ledger.signatures,self.ledger.gas),(1,100))
        list(self.ledger.rows.values())[0]['transactionHash']=w(99)
        with self.assertRaisesRegex(RegistrarRejected,'ORIGINAL_RETAINED_HASH_MISMATCH'):
            self.runtime.lookup_original(self.record)

    def test_uncertain_sign_and_broadcast_only_query_original(self):
        self.signer.raise_response=True
        with self.assertRaises(RuntimeError): self.runtime.send_original(self.record)
        self.assertEqual(self.runtime.lookup_original(self.record),w(80))
        self.assertEqual(self.runtime.send_original(self.record),w(80))
        self.assertEqual((self.signer.count,self.broadcaster.count),(1,0))
        self.setUp()
        self.broadcaster.raise_response=True
        with self.assertRaises(RuntimeError): self.runtime.send_original(self.record)
        self.assertEqual(self.runtime.lookup_original(self.record),w(80))
        self.assertEqual(self.runtime.send_original(self.record),w(80))
        self.assertEqual((self.signer.count,self.broadcaster.count),(1,1))

    def test_owner_deadline_grant_and_changed_original_prevent_signing(self):
        self.now=200
        with self.assertRaisesRegex(RegistrarRejected,'OWNER_AUTHORIZATION_EXPIRED'):
            self.runtime.send_original(self.record)
        self.now=100
        self.policy.grant['enabled']=False
        with self.assertRaisesRegex(RegistrarRejected,'REGISTRAR_GAS_SIGNING_GRANT_REQUIRED'):
            self.runtime.send_original(self.record)
        changed={**self.record,'ownerSignature':'0x9999'}
        with self.assertRaisesRegex(RegistrarRejected,'ORIGINAL_NOT_APPROVED'):
            self.runtime.send_original(changed)
        self.assertEqual((self.signer.count,self.broadcaster.count),(0,0))
        self.assertEqual(self.ledger.rows,{})

    def test_payload_policy_or_signed_sender_mismatch_never_broadcast(self):
        original_prepare=self.codec.prepare
        self.codec.prepare=lambda original:{**original_prepare(original),'parametersDigest':w(99)}
        with self.assertRaisesRegex(RegistrarRejected,'ORIGINAL_PARAMETERS_DIGEST_MISMATCH'):
            self.runtime.send_original(self.record)
        self.assertEqual(self.signer.count,0)
        self.setUp()
        original_deployment=self.codec.prepare_deployment
        def altered_profile(*args):
            self.policy.revision=2
            return original_deployment(*args)
        self.codec.prepare_deployment=altered_profile
        with self.assertRaisesRegex(RegistrarRejected,'REGISTRAR_APPROVAL_CHANGED'):
            self.runtime.send_original(self.record)
        self.assertEqual(self.signer.count,0)
        self.setUp()
        inspect=self.crypto.inspect_signed_transaction
        self.crypto.inspect_signed_transaction=lambda raw,expected:{**inspect(raw,expected),'from':a(99)}
        with self.assertRaisesRegex(RegistrarRejected,'REGISTRAR_SIGNED_TRANSACTION_MISMATCH'):
            self.runtime.send_original(self.record)
        self.assertEqual(self.broadcaster.count,0)
        self.assertEqual(list(self.ledger.rows.values())[0]['stage'],'TRANSACTION_SIGNING')


if __name__=='__main__': unittest.main()
