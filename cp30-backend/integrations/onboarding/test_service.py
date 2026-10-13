"""Bounded synthetic offline tests. Fakes do NOT provide real auth/crypto/finality."""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import unittest

from service import (FactoryConfig, Onboarding, OwnerIdentity, Rejected,
                     SessionContext, canonical)


def w(n): return '0x' + f'{n:064x}'
def a(n): return '0x' + f'{n:040x}'


class SyntheticStorage:
    """Test-only rollback store; never exported as a persistence adapter."""
    def __init__(self):
        self.records, self.queue, self.published, self.slots = {}, {}, {}, set()
        self.depth = 0
        self.publish_count = 0
        self.read_only = []

    @contextmanager
    def transaction(self, *, read_only=False):
        before = deepcopy((self.records, self.queue, self.published, self.slots))
        self.depth += 1
        self.read_only.append(read_only)
        try: yield self
        except Exception:
            self.records, self.queue, self.published, self.slots = before
            raise
        finally:
            self.depth -= 1
            self.read_only.pop()

    def _write(self):
        assert self.read_only and not self.read_only[-1]

    def by_key(self, namespace, subject, key):
        return next((deepcopy(r) for r in self.records.values()
                     if (r['namespace'], r['subject'], r['key']) == (namespace, subject, key)), None)

    def by_id(self, namespace, registration_id):
        return deepcopy(self.records.get((namespace, registration_id)))

    def insert(self, record):
        self._write()
        key = (record['namespace'], record['registrationId'])
        if key in self.records: raise Rejected('ID_CONFLICT')
        self.records[key] = deepcopy(record)

    def save(self, record):
        self._write()
        self.records[(record['namespace'], record['registrationId'])] = deepcopy(record)

    def reserve_slot(self, record, maximum):
        self._write()
        slot = (record['namespace'], record['original']['chainId'], record['original']['factory'], record['registrationId'])
        if slot not in self.slots and len(self.slots) >= maximum: raise Rejected('FACTORY_CAPACITY')
        self.slots.add(slot)

    def enqueue_once(self, record):
        self._write()
        self.queue.setdefault(record['registrationId'], deepcopy(record))

    def publish_confirmed(self, record):
        self._write()
        assert record['state'] == 'CONFIRMED'
        self.publish_count += 1
        self.published[record['storeId']] = deepcopy(record)


class SyntheticIdentity:
    def authorize(self, tx, context, action):
        if context != SessionContext('synthetic', w(90), w(91)):
            raise Rejected('UNAUTHENTICATED')
        return OwnerIdentity('synthetic-owner', a(10), 1)

    def authorize_internal(self, tx, record):
        return OwnerIdentity('synthetic-owner', a(10), 1)


class SyntheticCatalog:
    def build(self, tx, identity, draft):
        windows = draft['windows'] + [[0, 0]] * (2 - len(draft['windows']))
        return [{'current': True, 'terms': {
            'mealId': w(60), 'version': '1', 'unitPrice': draft['unitPrice'],
            'bodyDigest': w(61), 'imageDigest': w(62), 'windowCount': len(draft['windows']),
            'startMinute0': windows[0][0], 'endMinute0': windows[0][1],
            'startMinute1': windows[1][0], 'endMinute1': windows[1][1]}}]


class SyntheticCodec:
    """Deterministic test labels; deliberately not EIP712 or keccak implementations."""
    def prepare(self, original):
        digest = '0x' + hashlib.sha256(canonical(original).encode()).hexdigest()
        return {'configHash': w(70), 'parametersDigest': digest, 'typedData': {'synthetic': True}}

    def verify_owner_signature(self, original, signature): return signature == '0x1234'

    def prepare_deployment(self, original, signature):
        return {'chainId': int(original['chainId']), 'from': original['registrar'], 'to': original['factory'],
                'value': '0', 'data': '0x1234', 'callDataDigest': w(72)}


class SyntheticVerifier:
    def __init__(self): self.evidence = None
    def verify_original(self, original, tx_hash, deployment): return deepcopy(self.evidence)


class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.storage, self.verifier = SyntheticStorage(), SyntheticVerifier()
        self.context = SessionContext('synthetic', w(90), w(91))
        ids = iter((w(1), w(2), w(3), w(4)))
        config = FactoryConfig(31337, a(20), a(26), a(21), a(22), a(23), a(24), a(25), w(71))
        self.service = Onboarding(self.storage, SyntheticIdentity(), SyntheticCatalog(),
                                  SyntheticCodec(), self.verifier, config, lambda: next(ids), lambda: 100)
        self.request = {'name': 'Synthetic cafe', 'deadline': '200', 'firstMeal': {
            'name': 'Synthetic lunch', 'description': 'Synthetic first meal for unit testing',
            'unitPrice': '1', 'imageRef': 'synthetic-owned-image', 'windows': [[600, 720]]}}

    def registered(self):
        return self.service.register(self.context, 'synthetic-key-0001', self.request)

    def unknown(self):
        registered = self.registered()
        rid = registered['registrationId']
        self.service.enable(self.context, rid, '0x1234')
        record = self.service.begin_attempt('synthetic', rid)
        self.service.observe_transaction('synthetic', rid, w(80))
        self.verifier.evidence = {**record['original'], 'configHash': record['prepared']['configHash'],
            'parametersDigest': record['prepared']['parametersDigest'], 'receiver': record['owner'], 'deployment': record['deployment'],
            'escrow': a(30), 'transactionHash': w(80), 'blockHash': w(81), 'blockNumber': 1, 'logIndex': 0}
        return rid

    def test_same_key_same_parameters_returns_original(self):
        original = self.registered()
        self.assertEqual(original, self.registered())
        self.assertEqual(len(self.storage.records), 1)

    def test_same_key_changed_parameters_rejected(self):
        self.registered()
        self.request['deadline'] = '201'
        with self.assertRaisesRegex(Rejected, 'IDEMPOTENCY_CONFLICT'): self.registered()
        self.assertEqual(len(self.storage.records), 1)

    def test_unknown_never_enqueues_or_starts_second_deployment(self):
        rid = self.unknown()
        self.service.enable(self.context, rid, '0x1234')
        self.assertIsNone(self.service.begin_attempt('synthetic', rid))
        self.verifier.evidence = None
        self.assertEqual(self.service.reconcile('synthetic', rid)['state'], 'UNKNOWN')
        self.assertEqual(len(self.storage.queue), 1)

    def test_wrong_original_receipt_object_rejected(self):
        rid = self.unknown()
        self.verifier.evidence['registrationId'] = w(99)
        with self.assertRaisesRegex(Rejected, 'ORIGINAL_RECEIPT_MISMATCH'):
            self.service.reconcile('synthetic', rid)
        self.assertEqual(self.service.get(self.context, rid)['state'], 'UNKNOWN')
        self.assertEqual(self.storage.published, {})

    def test_not_ready_until_verified_original_confirmed(self):
        registered = self.registered()
        rid = registered['registrationId']
        self.assertFalse(registered['ready'])
        pending = self.service.enable(self.context, rid, '0x1234')
        self.assertFalse(pending['ready'])
        record = self.service.begin_attempt('synthetic', rid)
        self.assertFalse(self.service.reconcile('synthetic', rid)['ready'])
        self.verifier.evidence = {**record['original'], 'configHash': record['prepared']['configHash'],
            'parametersDigest': record['prepared']['parametersDigest'], 'receiver': record['owner'], 'deployment': record['deployment'],
            'escrow': a(30), 'transactionHash': w(80), 'blockHash': w(81), 'blockNumber': 1, 'logIndex': 0}
        confirmed = self.service.reconcile('synthetic', rid)
        self.assertTrue(confirmed['ready'])
        self.assertEqual(confirmed['escrow'], a(30))
        self.assertEqual(len(self.storage.published), 1)

    def test_external_codec_and_verifier_have_no_active_transaction(self):
        calls = []
        codec, verifier = self.service.codec, self.verifier
        for method in ('prepare', 'verify_owner_signature', 'prepare_deployment'):
            original_method = getattr(codec, method)
            def checked(*args, _name=method, _method=original_method):
                self.assertEqual(self.storage.depth, 0)
                calls.append(_name)
                return _method(*args)
            setattr(codec, method, checked)
        original_verify = verifier.verify_original
        def checked_verify(*args):
            self.assertEqual(self.storage.depth, 0)
            calls.append('verify_original')
            return original_verify(*args)
        verifier.verify_original = checked_verify
        # A competing registration wins while the outer candidate is being prepared.
        original_prepare = codec.prepare
        def competing_prepare(*args):
            codec.prepare = original_prepare
            winner = self.registered()
            self.assertEqual(winner['registrationId'], w(3))
            return original_prepare(*args)
        codec.prepare = competing_prepare
        rid = self.unknown()
        self.assertEqual(rid, w(3))  # Final commit returns original winner, not outer candidate ids.
        self.assertEqual(len(self.storage.records), 1)
        self.assertTrue(self.service.reconcile('synthetic', rid)['ready'])
        self.assertTrue(self.service.reconcile('synthetic', rid)['ready'])
        self.assertEqual(self.storage.publish_count, 1)
        self.assertEqual(set(calls), {'prepare', 'verify_owner_signature', 'prepare_deployment', 'verify_original'})
        self.assertEqual(self.storage.depth, 0)

    def test_preflight_permission_or_original_change_rejects_commit(self):
        rid = self.registered()['registrationId']
        codec = self.service.codec
        class MutableIdentity(SyntheticIdentity):
            revision = 1
            def authorize(self, tx, context, action):
                base = super().authorize(tx, context, action)
                return OwnerIdentity(base.subject, base.owner, self.revision)
        identity = MutableIdentity()
        self.service.identity = identity
        def revoked_after_preflight(*args):
            self.assertEqual(self.storage.depth, 0)
            identity.revision = 2
            return True
        codec.verify_owner_signature = revoked_after_preflight
        with self.assertRaisesRegex(Rejected, 'NOT_FOUND'):
            self.service.enable(self.context, rid, '0x1234')
        self.assertEqual(self.storage.by_id('synthetic', rid)['state'], 'DRAFT')
        self.assertEqual(self.storage.queue, {})
        identity.revision = 1
        codec.verify_owner_signature = lambda *args: True
        original_deployment = codec.prepare_deployment
        def changed_after_preflight(*args):
            self.assertEqual(self.storage.depth, 0)
            self.storage.records[('synthetic', rid)]['prepared']['parametersDigest'] = w(99)
            return original_deployment(*args)
        codec.prepare_deployment = changed_after_preflight
        with self.assertRaisesRegex(Rejected, 'SNAPSHOT_CHANGED'):
            self.service.enable(self.context, rid, '0x1234')
        self.assertEqual(self.storage.by_id('synthetic', rid)['state'], 'DRAFT')
        self.assertEqual(self.storage.queue, {})


if __name__ == '__main__': unittest.main()
