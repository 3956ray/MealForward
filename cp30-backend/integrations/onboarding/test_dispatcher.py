"""Bounded memory-only dispatcher tests; no server, keys, signer or network."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from onboarding.dispatcher import OnboardingDispatcher, ORIGINAL_LOOKUP_V1
from onboarding.service import FactoryConfig, Onboarding, OwnerIdentity, Rejected
from test_service import SyntheticCatalog, SyntheticCodec, SyntheticIdentity, SyntheticStorage, SyntheticVerifier, SessionContext, w, a


class LockedMemoryStorage(SyntheticStorage):
    def __init__(self):
        super().__init__()
        self.lock, self.local = threading.RLock(), threading.local()

    @contextmanager
    def transaction(self, *, read_only=False):
        with self.lock:
            self.local.depth = getattr(self.local, 'depth', 0) + 1
            try:
                with super().transaction(read_only=read_only) as tx: yield tx
            finally: self.local.depth -= 1


class MemoryTasks:
    def __init__(self, task): self.task = task
    def next_task(self): return deepcopy(self.task)


class SyntheticRegistrar:
    original_lookup_protocol = ORIGINAL_LOOKUP_V1
    def __init__(self, storage):
        self.storage = storage
        self.sent, self.looked_up, self.attempts = [], [], {}
        self.raise_after_recording = False

    def _outside(self):
        assert getattr(self.storage.local, 'depth', 0) == 0

    def send_original(self, record):
        self._outside()
        rid = record['registrationId']
        assert record['state'] == 'UNKNOWN'
        assert self.storage.by_id(record['namespace'], rid)['state'] == 'UNKNOWN'
        assert rid not in self.attempts
        self.sent.append(rid)
        self.attempts[rid] = deepcopy(record)
        if self.raise_after_recording: raise RuntimeError('synthetic response loss')
        return w(80)

    def lookup_original(self, record):
        self._outside()
        self.looked_up.append(record['registrationId'])
        original = self.attempts.get(record['registrationId'])
        if original is None: return None
        assert original['deployment'] == record['deployment']
        assert original['prepared']['parametersDigest'] == record['prepared']['parametersDigest']
        return w(80)


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.storage, self.verifier = LockedMemoryStorage(), SyntheticVerifier()
        self.now = 100
        ids = iter((w(1), w(2)))
        self.domain = Onboarding(self.storage, SyntheticIdentity(), SyntheticCatalog(), SyntheticCodec(),
            self.verifier, FactoryConfig(31337, a(20), a(26), a(21), a(22), a(23), a(24), a(25), w(71)),
            lambda: next(ids), lambda: self.now)
        self.context = SessionContext('synthetic', w(90), w(91))
        result = self.domain.register(self.context, 'synthetic-key-0001', {
            'name': 'Synthetic cafe', 'deadline': '200', 'firstMeal': {'name': 'Synthetic lunch',
            'description': 'Synthetic first meal', 'unitPrice': '1', 'imageRef': 'synthetic-image', 'windows': [[600, 720]]}})
        self.rid = result['registrationId']
        self.domain.enable(self.context, self.rid, '0x1234')
        self.registrar = SyntheticRegistrar(self.storage)
        self.tasks = MemoryTasks({'namespace': 'synthetic', 'registrationId': self.rid})
        self.dispatcher = OnboardingDispatcher(self.domain, self.registrar, self.tasks)

    def test_two_competing_workers_have_one_send_winner(self):
        barrier = threading.Barrier(2)
        original = self.domain.original_attempt
        first = threading.local()
        def competing_snapshot(*args):
            record = original(*args)
            if not getattr(first, 'seen', False):
                first.seen = True
                barrier.wait(timeout=3)
            return record
        self.domain.original_attempt = competing_snapshot
        results, errors = [], []
        def run():
            try: results.append(self.dispatcher.step())
            except Exception as exc: errors.append(exc)
        workers = [threading.Thread(target=run) for _ in range(2)]
        for worker in workers: worker.start()
        for worker in workers: worker.join(timeout=5)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(len(self.registrar.sent), 1)
        self.assertIsNone(self.domain.begin_attempt('synthetic', self.rid))
        self.assertEqual(self.storage.by_id('synthetic', self.rid)['state'], 'UNKNOWN')

    def test_response_loss_remains_unknown_then_only_looks_up_original(self):
        self.registrar.raise_after_recording = True
        result = self.dispatcher.step()
        self.assertEqual(result['state'], 'UNKNOWN')
        self.assertEqual(result['reason'], 'REGISTRAR_UNAVAILABLE')
        self.assertNotIn('transactionHash', self.storage.by_id('synthetic', self.rid))
        for _ in range(2): self.assertEqual(self.dispatcher.step()['state'], 'UNKNOWN')
        self.assertEqual(len(self.registrar.sent), 1)
        self.assertEqual(len(self.registrar.looked_up), 2)
        self.assertEqual(self.storage.by_id('synthetic', self.rid)['transactionHash'], w(80))
        self.assertEqual(self.storage.published, {})

    def test_expired_or_missing_original_lookup_never_sends(self):
        with self.assertRaisesRegex(Rejected, 'REGISTRAR_ORIGINAL_LOOKUP_REQUIRED'):
            OnboardingDispatcher(self.domain, None, self.tasks)
        self.now = 200
        result = self.dispatcher.step()
        self.assertEqual(result['reason'], 'AUTHORIZATION_EXPIRED')
        self.assertEqual(result['state'], 'PENDING')
        self.assertEqual(self.registrar.sent, [])
        self.assertEqual(self.storage.by_id('synthetic', self.rid)['state'], 'PENDING')

    def test_attempt_and_transaction_locator_reauthorize_internal_owner(self):
        class ChangedIdentity(SyntheticIdentity):
            def authorize_internal(self, tx, record):
                return OwnerIdentity('synthetic-owner', a(10), 2)
        identity = self.domain.identity
        self.domain.identity = ChangedIdentity()
        with self.assertRaisesRegex(Rejected, 'OWNER_BINDING_CHANGED'):
            self.domain.begin_attempt('synthetic', self.rid)
        self.assertEqual(self.storage.by_id('synthetic', self.rid)['state'], 'PENDING')
        self.domain.identity = identity
        self.domain.begin_attempt('synthetic', self.rid)
        self.domain.identity = ChangedIdentity()
        with self.assertRaisesRegex(Rejected, 'OWNER_BINDING_CHANGED'):
            self.domain.observe_transaction('synthetic', self.rid, w(80))
        self.assertNotIn('transactionHash', self.storage.by_id('synthetic', self.rid))


if __name__ == '__main__': unittest.main()
