"""Fault tests use only fresh temporary owner-private synthetic paths."""
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from c1.journal import Journal, Quarantined, BINDINGS, canonical
from c1.controller import Controller
from c1.ipc import Client, Server


def binding(mutation='m1', floors=None):
    return dict(mutation_id=mutation, kind='logout', object_id='s1', expected_revision=1,
                command_digest=hashlib.sha256(b'synthetic typed command').hexdigest(),
                restore_generation=0, source_epoch=1, deployment_generation=1,
                credential_epoch=1, authority_checkpoint=0, authority_highwater=0,
                floors=floors or {'session': {'s1': 1}, 'grant': {'g1': 4}})


def completion(prepared, floors=None):
    value = copy.deepcopy(prepared['data'])
    value.update(prepared_sequence=prepared['sequence'], prepared_digest=prepared['digest'])
    if floors is not None:
        value['floors'] = floors
    return value


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='c1-journal-synthetic-')
        os.chmod(self.directory.name, 0o700)
        self.path = Path(self.directory.name) / 'journal'
        self.journal = Journal(self.path, 'run-synthetic', 'cluster-synthetic', initialize=True, empty_cluster=True)

    def tearDown(self):
        self.journal.close()
        self.directory.cleanup()

    def reopen(self, **kwargs):
        self.journal.close()
        return Journal(self.path, 'run-synthetic', 'cluster-synthetic', **kwargs)

    def test_roundtrip_and_independent_object_floors(self):
        prepared = self.journal.prepare('ns', binding())
        self.journal.finish('ns', completion(prepared))
        self.journal.checkpoint('ns', {'session': {'s1': 2, 's2': 1}, 'grant': {'g1': 5}})
        reopened = self.reopen()
        try:
            self.assertEqual(reopened.snapshot('ns')['floors']['session'], {'s1': 2, 's2': 1})
            self.assertIsNone(reopened.snapshot('ns')['pending'])
            self.assertEqual(reopened.sequence, 4)
        finally:
            reopened.close()

    def test_controlled_restore_preserves_unresolved_original_frame(self):
        original=self.journal.prepare('ns',binding())
        restore=binding('restore-1');restore.update(kind='restore',restore_generation=1,credential_epoch=2,
            expected_revision={'restore_generation':0,'pending_digest':original['digest']})
        prepared=self.journal.restore_prepare('ns',restore)
        with self.assertRaises(Quarantined):self.journal.finish('ns',completion(original))
        with self.assertRaises(Quarantined):self.journal.restore_finish('ns',completion(prepared))
        reopened=self.reopen()
        try:
            self.assertEqual(reopened.snapshot('ns')['pending']['digest'],original['digest'])
            self.assertEqual(reopened.snapshot('ns')['restore_pending']['digest'],prepared['digest'])
            self.assertEqual(reopened.snapshot('ns')['epochs']['credential_epoch'],2)
        finally:reopened.close()

    def test_controlled_restore_commit_requires_exact_original_and_new_epoch(self):
        original=self.journal.prepare('ns',binding());self.journal.finish('ns',completion(original))
        restore=binding('restore-1');restore.update(kind='restore',restore_generation=1,credential_epoch=2,
            expected_revision={'restore_generation':0,'pending_digest':'0'*64})
        lower={**restore,'credential_epoch':1}
        with self.assertRaises(Quarantined):self.journal.restore_prepare('ns',lower)
        prepared=self.journal.restore_prepare('ns',restore)
        with self.assertRaises(Quarantined):self.journal.prepare('ns',binding('new-mutation'))
        bad=completion(prepared);bad['prepared_digest']='0'*64
        with self.assertRaises(Quarantined):self.journal.restore_finish('ns',bad)
        self.journal.restore_finish('ns',completion(prepared))
        self.assertIsNone(self.journal.snapshot('ns')['restore_pending'])
        self.assertEqual(self.journal.snapshot('ns')['epochs']['credential_epoch'],2)

    def test_epoch_lowering_and_original_replay_are_rejected(self):
        prepared = self.journal.prepare('ns', binding())
        self.journal.finish('ns', completion(prepared))
        with self.assertRaises(Quarantined):
            self.journal.prepare('ns', binding())
        lower = binding('m2')
        lower['source_epoch'] = 0
        with self.assertRaises(Quarantined):
            self.journal.prepare('ns', lower)
        self.assertEqual(self.journal.sequence, 3)

    def test_restore_prepares_strictly_new_generation_and_credentials(self):
        data = binding()
        data.update(kind='restore', expected_revision={'restore_generation': 0})
        with self.assertRaises(Quarantined):
            self.journal.prepare('ns', data)
        data.update(restore_generation=1, credential_epoch=2)
        prepared = self.journal.prepare('ns', data)
        self.journal.finish('ns', completion(prepared))
        second = copy.deepcopy(data)
        second.update(mutation_id='m2', expected_revision={'restore_generation': 1}, restore_generation=2)
        with self.assertRaises(Quarantined):
            self.journal.prepare('ns', second)

    def test_missing_existing_journal_never_recreated(self):
        self.journal.close()
        self.path.unlink()
        with self.assertRaises(Quarantined):
            self.reopen()
        self.assertFalse(self.path.exists())

    def test_explicit_empty_initialization_required(self):
        with self.assertRaises(Quarantined):
            Journal(self.path.parent / 'other', 'r', 'c', initialize=True)
        with self.assertRaises(Quarantined):
            Journal(self.path, 'r', 'c', initialize=True, empty_cluster=True)

    def test_only_one_writer(self):
        with self.assertRaises((Quarantined, BlockingIOError)):
            Journal(self.path, 'run-synthetic', 'cluster-synthetic')

    def test_pending_survives_restart_and_blocks_second_prepare(self):
        prepared = self.journal.prepare('ns', binding())
        reopened = self.reopen()
        try:
            self.assertEqual(reopened.snapshot('ns')['pending']['digest'], prepared['digest'])
            with self.assertRaises(Quarantined):
                reopened.prepare('ns', binding('m2'))
        finally:
            reopened.close()

    def test_torn_length_tail_and_payload_tail_fail_closed(self):
        original = self.path.read_bytes()
        self.journal.close()
        for suffix in (b'\x00', struct.pack('!I', 10) + b'{}', struct.pack('!I', 1000000)):
            self.path.write_bytes(original + suffix)
            with self.assertRaises(Quarantined):
                Journal(self.path, 'run-synthetic', 'cluster-synthetic')
            self.assertEqual(self.path.read_bytes(), original + suffix)

    def test_checksum_corruption_and_other_cluster_fail_closed(self):
        self.journal.close()
        with self.assertRaises(Quarantined):
            Journal(self.path, 'run-synthetic', 'other-cluster')
        content = bytearray(self.path.read_bytes())
        content[-1] ^= 1
        self.path.write_bytes(content)
        with self.assertRaises(Quarantined):
            self.reopen()

    def test_valid_checksum_cannot_hide_sequence_or_chain_conflict(self):
        self.journal.close()
        original = self.path.read_bytes()
        length = struct.unpack('!I', original[:4])[0]
        record = json.loads(original[4:4+length])
        record['sequence'] = 2
        body = canonical(record)
        self.path.write_bytes(struct.pack('!I', len(body)) + body + hashlib.sha256(body).digest())
        with self.assertRaises(Quarantined):
            self.reopen()

    def test_monotonic_floors_reject_omission_and_lower_object(self):
        prepared = self.journal.prepare('ns', binding())
        self.journal.finish('ns', completion(prepared))
        for floors in ({'session': {'s1': 100}}, {'session': {'s1': 1}, 'grant': {'g1': 3}}):
            with self.assertRaises(Quarantined):
                self.journal.prepare('ns', binding('m2', floors))
        self.assertEqual(self.journal.sequence, 3)

    def test_completion_must_match_original_prepared_frame(self):
        prepared = self.journal.prepare('ns', binding())
        data = completion(prepared)
        data['prepared_digest'] = '0' * 64
        with self.assertRaises(Quarantined):
            self.journal.finish('ns', data)
        self.assertEqual(self.journal.sequence, 2)
        self.assertIsNotNone(self.journal.snapshot('ns')['pending'])

    def test_execution_preparation_is_independent_and_persistent(self):
        prepared = self.journal.prepare('ns', binding(), execution=True)
        with self.assertRaises(Quarantined):
            self.journal.finish('ns', completion(prepared))
        self.journal.finish('ns', completion(prepared), execution=True)
        self.assertEqual(self.journal.records[-1]['event'], 'EXECUTION_COMMITTED')

    def test_fsync_failure_cannot_ack_or_continue(self):
        with patch('c1.journal.os.fsync', side_effect=OSError('synthetic failure')):
            with self.assertRaises(Quarantined):
                self.journal.prepare('ns', binding())
        self.assertEqual(self.journal.sequence, 1)
        self.assertTrue(self.journal.failed)
        with self.assertRaises(Quarantined):
            self.journal.prepare('ns', binding())

    def test_creation_fsyncs_file_then_parent(self):
        path = self.path.parent / 'new-journal'
        calls = []
        real = os.fsync
        def fsync(fd):
            calls.append(os.fstat(fd).st_mode)
            real(fd)
        with patch('c1.journal.os.fsync', side_effect=fsync):
            journal = Journal(path, 'r', 'c', initialize=True, empty_cluster=True)
            journal.close()
        import stat
        self.assertTrue(stat.S_ISREG(calls[0]))
        self.assertTrue(stat.S_ISDIR(calls[1]))

    def test_lower_external_anchor_rejected(self):
        with self.assertRaises(Quarantined):
            self.reopen(expected_sequence=10)

    def test_external_torn_tail_stops_open_writer(self):
        with self.path.open('ab') as stream:
            stream.write(b'partial')
        with self.assertRaises(Quarantined):
            self.journal.prepare('ns', binding())
        self.assertTrue(self.journal.failed)

    def test_partial_write_never_acknowledged(self):
        real_write = os.write
        calls = 0
        def write(fd, value):
            nonlocal calls
            calls += 1
            if calls == 1:
                return real_write(fd, value[:8])
            raise OSError('synthetic interruption')
        with patch('c1.journal.os.write', side_effect=write):
            with self.assertRaises(Quarantined):
                self.journal.prepare('ns', binding())
        with self.assertRaises(Quarantined):
            self.reopen()

    def test_removed_open_journal_does_not_write_or_ack(self):
        self.path.unlink()
        with self.assertRaises((Quarantined, FileNotFoundError)):
            self.journal.prepare('ns', binding())
        self.assertEqual(self.journal.sequence, 1)


class FakeDatabase:
    def __init__(self):
        self.calls = []
        self.reservation = binding()
        self.reference = None
        self.committed = False
        self.aborted = False
        self.lost_proof = False
        self.mismatch = False
        self.closed = False

    def call(self, method, namespace, request):
        self.calls.append((method, copy.deepcopy(request)))
        if method == 'execution_fence':return {'reserved':True}
        if method == 'execution_clear':return {'cleared':True}
        if method.endswith('_reserve'):
            return copy.deepcopy(self.reservation)
        if method.endswith('_prepare'):
            self.reference = copy.deepcopy(request)
            return {'prepared': True}
        if method.endswith('_proof'):
            if self.lost_proof:
                return {'absent': True}
            if self.committed:
                value = {**self.reservation, **self.reference, 'committed': True}
                if self.mismatch:
                    value['command_digest'] = '0' * 64
                return value
            return {**self.reference, 'absent': True, 'aborted': self.aborted}
        if method.endswith('_abort'):
            if self.committed:
                return {'committed': True}
            self.aborted = True
            return {**self.reference, 'aborted': True}
        if method == 'cancel_finish':
            return {'cancelled': True, 'ticket_id': request['ticket_id']}
        if method.endswith('_finish'):
            return {'finished': True}
        if method in {'security_startup', 'startup_check'}:
            return {'matched': True}
        if method == 'cancel_begin':
            return {'ticket_id': 'ticket1', 'fence': 2}
        if method == 'ticket_close':
            self.closed = True
            return {'closed': True, 'close_proof': {'ticket_id': 'ticket1', 'fence': 3}}
        if method == 'ticket_query':
            return {'closed': self.closed, 'close_proof': {'ticket_id': 'ticket1', 'fence': 3}}
        raise AssertionError(method)


class ControllerTests(unittest.TestCase):
    def setUp(self):
        JournalTests.setUp(self)
        self.business, self.authority = FakeDatabase(), FakeDatabase()
        self.controller = Controller(self.journal, self.business, self.authority, namespaces=['ns'])

    tearDown = JournalTests.tearDown

    def prepare(self):
        result=self.controller.handle('ns', 'security', {'kind':'logout','mutation_id':'m1','command':{}}, role='api')
        return {key:value for key,value in result.items() if key not in {'expected_revision','reservation'}}

    def test_finish_independently_reads_proof_and_durably_completes(self):
        prepared = self.prepare()
        self.business.committed = True
        result = self.controller.handle('ns', 'security', {**prepared, 'phase': 'finish'}, role='api')
        self.assertTrue(result['finished'])
        methods = [item[0] for item in self.business.calls]
        self.assertLess(methods.index('security_proof'), methods.index('security_finish'))
        self.assertEqual(self.journal.records[-1]['event'], 'COMMITTED')

    def test_producer_claim_of_success_does_not_replace_proof(self):
        prepared = self.prepare()
        result = self.controller.handle('ns', 'security', {**prepared, 'phase': 'finish', 'committed': True}, role='api')
        self.assertEqual(result['status'],400)
        result = self.controller.handle('ns', 'security', {**prepared, 'phase': 'finish'}, role='api')
        self.assertEqual(result['error'], 'QUARANTINED')
        self.assertEqual(self.journal.records[-1]['event'], 'PREPARED')

    def test_abort_fences_then_reads_independent_absence(self):
        prepared = self.prepare()
        result = self.controller.handle('ns', 'security', {**prepared, 'phase': 'abort'}, role='api')
        self.assertTrue(result['aborted'])
        self.assertTrue(self.business.aborted)
        methods = [item[0] for item in self.business.calls]
        self.assertLess(methods.index('security_abort'), methods.index('security_proof'))
        self.assertLess(methods.index('security_proof'), methods.index('security_abort_finish'))
        self.assertEqual(self.journal.records[-1]['event'], 'ABORTED')

    def test_absence_without_abort_proof_stays_pending(self):
        prepared = self.prepare()
        self.business.lost_proof = True
        result = self.controller.handle('ns', 'security', {**prepared, 'phase': 'abort'}, role='api')
        self.assertEqual(result['error'], 'QUARANTINED')
        self.assertEqual(self.journal.records[-1]['event'], 'PREPARED')

    def test_late_success_wins_abort_and_is_recorded(self):
        prepared = self.prepare()
        self.business.committed = True
        result = self.controller.handle('ns', 'security', {**prepared, 'phase': 'abort'}, role='api')
        self.assertTrue(result['finished'])
        self.assertEqual(self.journal.records[-1]['event'], 'COMMITTED')

    def test_restore_losing_original_proof_keeps_quarantine(self):
        self.prepare()
        self.business.lost_proof = True
        restarted = Controller(self.journal, self.business, self.authority, namespaces=['ns'])
        restarted.startup()
        self.assertIn('ns', restarted.quarantined)
        self.assertEqual(self.journal.records[-1]['event'], 'PREPARED')

    def test_restart_recovers_only_exact_original_proof(self):
        self.prepare()
        self.business.committed = True
        restarted = Controller(self.journal, self.business, self.authority, namespaces=['ns'])
        restarted.startup()
        self.assertNotIn('ns', restarted.quarantined)
        self.assertEqual(self.journal.records[-1]['event'], 'COMMITTED')

    def test_api_cannot_execute_or_mutate_identity_or_fixture(self):
        for method, request in (('execution_prepare', {'ticket_id': 't1'}), ('fixture', {'operation': 'actor'}), ('security', {'kind': 'grant'}), ('security', {'kind': 'identity'})):
            if method=='security':request={**request,'mutation_id':'m1','command':{}}
            result = self.controller.handle('ns', method, request, role='api')
            self.assertEqual(result['status'], 403)
        self.assertEqual(self.business.calls, [])
        self.assertEqual(self.authority.calls, [])

    def test_execution_proof_finishes_original_ticket_only(self):
        self.authority.reservation['mutation_id'] = 'ticket1'
        prepared = self.controller.handle('ns', 'execution_prepare', {'ticket_id': 'ticket1'}, role='source')
        self.authority.committed = True
        result = self.controller.handle('ns', 'execution_finish', prepared, role='source')
        self.assertTrue(result['finished'])
        self.assertEqual(self.journal.records[-1]['event'], 'EXECUTION_COMMITTED')
        again = self.controller.handle('ns', 'execution_finish', prepared, role='source')
        self.assertTrue(again['finished'])
        self.assertEqual(self.journal.sequence, 3)

    def test_cancellation_releases_only_after_independent_close_proof(self):
        result = self.controller.handle('ns', 'cancel', {'job_id':'ticket1','worker_id':'a','fencing_epoch':1}, role='worker')
        self.assertTrue(result['cancelled'])
        self.assertEqual([item[0] for item in self.authority.calls], ['ticket_close', 'ticket_query'])
        self.assertEqual([item[0] for item in self.business.calls], ['cancel_begin', 'cancel_finish'])

    def test_cancellation_outage_does_not_release(self):
        original = self.authority.call
        def call(method, namespace, request):
            if method == 'ticket_close':
                raise OSError('synthetic outage')
            return original(method, namespace, request)
        self.authority.call = call
        result = self.controller.handle('ns', 'cancel', {'job_id':'ticket1','worker_id':'a','fencing_epoch':1}, role='worker')
        self.assertEqual(result['error'], 'QUARANTINED')
        self.assertEqual([item[0] for item in self.business.calls], ['cancel_begin'])

    def test_two_producers_cannot_pass_one_pending_fence(self):
        barrier = threading.Barrier(3)
        results = []
        def producer():
            barrier.wait()
            results.append(self.prepare())
        threads = [threading.Thread(target=producer) for _ in range(2)]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()
        self.assertEqual(sum('sequence' in result for result in results), 1)
        self.assertEqual(self.journal.sequence, 2)

    def test_security_replay_reads_original_proof_without_new_frame(self):
        prepared = self.prepare()
        self.business.committed = True
        self.controller.handle('ns', 'security', {**prepared, 'phase': 'finish'}, role='api')
        original = self.business.call
        def call(method, namespace, request):
            if method == 'security_reserve':
                return {'replay': True, 'mutation_id': 'm1'}
            return original(method, namespace, request)
        self.business.call = call
        replay = self.prepare()
        self.assertTrue(replay['replay'])
        self.assertTrue(replay['finished'])
        self.assertEqual(self.journal.sequence, 3)
        self.assertNotIn('reservation', replay)

    def test_api_cannot_abort_private_grant_preparation(self):
        self.business.reservation['kind'] = 'grant'
        prepared = self.controller.handle('ns', 'security', {'kind':'grant','mutation_id':'m1','command':{}}, role='fixture')
        prepared={key:prepared[key] for key in ('mutation_id','sequence','digest')}
        response = self.controller.handle('ns', 'security', {**prepared, 'phase': 'abort'}, role='api')
        self.assertEqual(response['status'], 403)
        self.assertFalse(self.business.aborted)
        self.assertEqual(self.journal.records[-1]['event'], 'PREPARED')

    def test_private_ipc_rejects_wrong_cap_and_role_operation(self):
        path = self.path.parent / 'ipc.sock'
        caps = {'api': {'cap': 'a' * 64, 'methods': ['query', 'security']},
                'fixture': {'cap': 'f' * 64, 'methods': ['fixture']}}
        server = Server(path, caps, self.controller.handle)
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01})
        thread.start()
        try:
            self.assertEqual(Client(path, 'wrong' * 16).call('ns', 'query')['status'], 403)
            self.assertEqual(Client(path, 'a' * 64).call('ns', 'fixture', {'operation': 'actor'})['status'], 403)
            self.assertFalse(Client(path, 'a' * 64).call('ns', 'query')['quarantined'])
        finally:
            server.shutdown()
            thread.join()
            server.server_close()
        self.assertFalse(path.exists())

if __name__ == '__main__':
    unittest.main()
