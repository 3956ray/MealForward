"""Sole-writer retained journal. A damaged or uncertain journal is never repaired."""
from __future__ import annotations
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import struct
import threading

MAX_FRAME = 65536
ZERO = '0' * 64
PREPARES = {'PREPARED', 'EXECUTION_PREPARED'}
FINISHES = {'COMMITTED': 'PREPARED', 'ABORTED': 'PREPARED',
            'EXECUTION_COMMITTED': 'EXECUTION_PREPARED', 'EXECUTION_ABORTED': 'EXECUTION_PREPARED'}
EPOCH_FIELDS = ('restore_generation', 'source_epoch', 'deployment_generation',
                'credential_epoch', 'authority_highwater')
BINDINGS = ('mutation_id', 'kind', 'object_id', 'expected_revision', 'command_digest',
            'restore_generation', 'source_epoch', 'deployment_generation',
            'credential_epoch', 'authority_checkpoint', 'authority_highwater')

class Quarantined(RuntimeError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                      allow_nan=False).encode('ascii')


def _integer(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise Quarantined('INVALID_REVISION')
    return value


def _floors(value):
    # Domain/object pairs remain separate; no global revision can hide a lower object.
    if not isinstance(value, dict) or len(value) > 1000:
        raise Quarantined('INVALID_FLOORS')
    result = {}
    for domain, objects in value.items():
        if not isinstance(domain, str) or not domain or not isinstance(objects, dict):
            raise Quarantined('INVALID_FLOORS')
        result[domain] = {}
        for object_id, revision in objects.items():
            if not isinstance(object_id, str) or not object_id:
                raise Quarantined('INVALID_FLOORS')
            result[domain][object_id] = _integer(revision)
    return result


class Journal:
    def __init__(self, path, run_id, cluster_id, *, initialize=False,
                 empty_cluster=False, expected_sequence=None, expected_digest=None):
        self.path = Path(path)
        self.run_id, self.cluster_id = run_id, cluster_id
        self.lock = threading.RLock()
        self.records, self.floors, self.pending, self.epochs, self.restores = [], {}, {}, {}, {}
        self.failed = False
        self._size = 0
        parent = self.path.parent
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise Quarantined('UNSAFE_JOURNAL_DIRECTORY')
        flags = os.O_RDWR | os.O_APPEND | os.O_NOFOLLOW
        if initialize:
            if not empty_cluster:
                raise Quarantined('INITIALIZATION_REQUIRES_EMPTY_CLUSTER')
            flags |= os.O_CREAT | os.O_EXCL
        try:
            self.fd = os.open(self.path, flags, 0o600)
        except OSError as exc:
            raise Quarantined('MISSING_OR_UNAVAILABLE_JOURNAL') from exc
        try:
            info = os.fstat(self.fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
                raise Quarantined('UNSAFE_JOURNAL_FILE')
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise Quarantined('ANOTHER_JOURNAL_WRITER') from None
            if initialize:
                self._append('HEADER', '', {'floors': {}})
                directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            else:
                self._scan()
            if expected_sequence is not None and self.sequence < expected_sequence:
                raise Quarantined('OLDER_JOURNAL')
            if expected_sequence == self.sequence and expected_digest is not None and self.digest != expected_digest:
                raise Quarantined('JOURNAL_ANCHOR_MISMATCH')
        except BaseException:
            os.close(self.fd)
            self.fd = None
            raise

    @property
    def sequence(self):
        return self.records[-1]['sequence'] if self.records else 0

    @property
    def digest(self):
        return self.records[-1]['digest'] if self.records else ZERO

    def close(self):
        with self.lock:
            if self.fd is not None:
                os.close(self.fd)
                self.fd = None

    def snapshot(self, namespace):
        with self.lock:
            try:
                info,named=os.fstat(self.fd),self.path.lstat()
                if self.failed or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size!=self._size or (info.st_dev,info.st_ino)!=(named.st_dev,named.st_ino) or info.st_nlink!=1:
                    raise Quarantined('JOURNAL_REMOVED_OR_REPLACED')
            except (OSError,TypeError):
                self.failed=True
                raise Quarantined('JOURNAL_UNAVAILABLE') from None
            return {'sequence': self.sequence, 'digest': self.digest,
                    'floors': copy.deepcopy(self.floors.get(namespace, {})),
                    'epochs': copy.deepcopy(self.epochs.get(namespace, {})),
                    'pending': copy.deepcopy(self.pending.get(namespace)),
                    'restore_pending': copy.deepcopy(self.restores.get(namespace))}

    def _apply(self, record):
        event, namespace, data = record['event'], record['namespace'], record['data']
        if event == 'HEADER':
            if self.records or namespace or data != {'floors': {}}:
                raise Quarantined('INVALID_HEADER')
            return
        if not self.records or not namespace:
            raise Quarantined('MISSING_HEADER_OR_NAMESPACE')
        if not isinstance(data, dict):
            raise Quarantined('INVALID_FRAME_DATA')
        incoming = _floors(data.get('floors', {}))
        existing = self.floors.get(namespace, {})
        for domain, objects in existing.items():
            for key, floor in objects.items():
                if incoming.get(domain, {}).get(key, -1) < floor:
                    raise Quarantined('LOWER_FLOOR')
        if event in PREPARES or event == 'RESTORE_PREPARED':
            restoring=event == 'RESTORE_PREPARED'
            if namespace in self.restores or (not restoring and namespace in self.pending):
                raise Quarantined('PENDING_PREPARATION')
            if set(data) != set(BINDINGS) | {'floors'}:
                raise Quarantined('INCOMPLETE_BINDING')
            if not isinstance(data['command_digest'], str) or len(data['command_digest']) != 64 or any(c not in '0123456789abcdef' for c in data['command_digest']):
                raise Quarantined('INVALID_COMMAND_DIGEST')
            for key in EPOCH_FIELDS:
                _integer(data[key])
            expectations = data['expected_revision']
            if isinstance(expectations, dict):
                if not expectations or len(expectations) > 32 or any(not isinstance(key, str) or not isinstance(value, (str, int)) or isinstance(value, bool) for key, value in expectations.items()):
                    raise Quarantined('INVALID_EXPECTED_REVISION')
                for value in expectations.values():
                    if isinstance(value, int):
                        _integer(value)
            else:
                _integer(expectations)
            if data['kind'] in {'restore', 'rebuild'}:
                old_generation = expectations.get('restore_generation') if isinstance(expectations, dict) else expectations
                _integer(old_generation)
                if data['restore_generation'] <= old_generation or data['restore_generation'] <= self.epochs.get(namespace, {}).get('restore_generation', 0) or data['credential_epoch'] <= self.epochs.get(namespace, {}).get('credential_epoch', 0):
                    raise Quarantined('RESTORE_REQUIRES_NEW_GENERATION_AND_CREDENTIAL_EPOCH')
            if restoring:
                prior=self.pending.get(namespace)
                if data['kind']!='restore' or not isinstance(expectations,dict) or expectations.get('pending_digest')!=(prior['digest'] if prior else ZERO):
                    raise Quarantined('RESTORE_ORIGINAL_PENDING_MISMATCH')
            checkpoint = data['authority_checkpoint']
            if isinstance(checkpoint, int):
                _integer(checkpoint)
            elif not isinstance(checkpoint, str) or not checkpoint or len(checkpoint) > 256:
                raise Quarantined('INVALID_AUTHORITY_CHECKPOINT')
            for key in ('mutation_id', 'kind', 'object_id'):
                if not isinstance(data[key], str) or not data[key] or len(data[key]) > 256:
                    raise Quarantined('INVALID_BINDING')
            for key in EPOCH_FIELDS:
                if data[key] < self.epochs.get(namespace, {}).get(key, 0):
                    raise Quarantined('LOWER_EPOCH_OR_AUTHORITY_FLOOR')
            if any(item['namespace'] == namespace and item['event'] == event and item['data']['mutation_id'] == data['mutation_id'] for item in self.records):
                raise Quarantined('ORIGINAL_MUTATION_REPLAY')
            self.epochs[namespace] = {key: data[key] for key in EPOCH_FIELDS}
            (self.restores if restoring else self.pending)[namespace] = copy.deepcopy(record)
        elif event == 'RESTORE_COMMITTED':
            prepared=self.restores.get(namespace)
            if not prepared or namespace in self.pending:
                raise Quarantined('RESTORE_ORIGINAL_PENDING_UNRESOLVED')
            if data.get('prepared_sequence')!=prepared['sequence'] or data.get('prepared_digest')!=prepared['digest'] or any(data.get(key)!=prepared['data'][key] for key in BINDINGS):
                raise Quarantined('RESTORE_PROOF_MISMATCH')
            del self.restores[namespace]
        elif event in FINISHES:
            if namespace in self.restores:
                raise Quarantined('RESTORE_PENDING')
            prepared = self.pending.get(namespace)
            if not prepared or prepared['event'] != FINISHES[event]:
                raise Quarantined('NO_ORIGINAL_PREPARATION')
            if data.get('prepared_sequence') != prepared['sequence'] or data.get('prepared_digest') != prepared['digest']:
                raise Quarantined('PREPARATION_MISMATCH')
            if any(data.get(key) != prepared['data'][key] for key in BINDINGS):
                raise Quarantined('MUTATION_MISMATCH')
            del self.pending[namespace]
        elif event == 'CHECKPOINT':
            if namespace in self.pending or namespace in self.restores:
                raise Quarantined('PENDING_PREPARATION')
        else:
            raise Quarantined('INVALID_EVENT')
        self.floors[namespace] = incoming

    def _scan(self):
        size, offset = os.fstat(self.fd).st_size, 0
        if not size:
            raise Quarantined('EMPTY_JOURNAL')
        while offset < size:
            prefix = os.pread(self.fd, 4, offset)
            if len(prefix) != 4:
                raise Quarantined('TORN_LENGTH')
            length = struct.unpack('!I', prefix)[0]
            if length < 2 or length > MAX_FRAME:
                raise Quarantined('INVALID_LENGTH')
            chunk = os.pread(self.fd, length + 32, offset + 4)
            if len(chunk) != length + 32:
                raise Quarantined('TORN_FRAME')
            body, checksum = chunk[:-32], chunk[-32:]
            if hashlib.sha256(body).digest() != checksum:
                raise Quarantined('CHECKSUM_MISMATCH')
            try:
                record = json.loads(body)
                if canonical(record) != body or set(record) != {'run_id', 'cluster_id', 'sequence', 'previous_digest', 'event', 'namespace', 'data'}:
                    raise ValueError()
            except (ValueError, TypeError) as exc:
                raise Quarantined('INVALID_FRAME') from exc
            _integer(record['sequence'])
            if not isinstance(record['namespace'], str) or not isinstance(record['event'], str) or not isinstance(record['data'], dict):
                raise Quarantined('INVALID_FRAME_SCHEMA')
            if record['run_id'] != self.run_id or record['cluster_id'] != self.cluster_id or record['sequence'] != self.sequence + 1 or record['previous_digest'] != self.digest:
                raise Quarantined('CHAIN_MISMATCH')
            record['digest'] = checksum.hex()
            self._apply(record)
            self.records.append(record)
            offset += 4 + length + 32
        self._size = offset

    def _append(self, event, namespace, data):
        if self.failed or self.fd is None:
            raise Quarantined('JOURNAL_UNAVAILABLE')
        try:
            info, named = os.fstat(self.fd), self.path.lstat()
        except OSError:
            self.failed = True
            raise Quarantined('JOURNAL_REMOVED_OR_REPLACED') from None
        if info.st_size != self._size:
            self.failed = True
            raise Quarantined('JOURNAL_SIZE_CHANGED')
        if (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino) or info.st_nlink != 1:
            self.failed = True
            raise Quarantined('JOURNAL_REMOVED_OR_REPLACED')
        record = {'run_id': self.run_id, 'cluster_id': self.cluster_id,
                  'sequence': self.sequence + 1, 'previous_digest': self.digest,
                  'event': event, 'namespace': namespace, 'data': copy.deepcopy(data)}
        body = canonical(record)
        if len(body) > MAX_FRAME:
            raise Quarantined('FRAME_TOO_LARGE')
        checksum = hashlib.sha256(body).digest()
        record['digest'] = checksum.hex()
        # Validate without publishing state before fsync succeeds.
        floors, pending, epochs, restores = copy.deepcopy(self.floors), copy.deepcopy(self.pending), copy.deepcopy(self.epochs), copy.deepcopy(self.restores)
        try:
            self._apply(record)
        except BaseException:
            self.floors, self.pending, self.epochs, self.restores = floors, pending, epochs, restores
            raise
        self.floors, self.pending, self.epochs, self.restores = floors, pending, epochs, restores
        frame = struct.pack('!I', len(body)) + body + checksum
        try:
            view = memoryview(frame)
            while view:
                count = os.write(self.fd, view)
                if count <= 0:
                    raise OSError('SHORT_WRITE')
                view = view[count:]
            os.fsync(self.fd)
        except BaseException:
            self.failed = True
            raise Quarantined('JOURNAL_DURABILITY_FAILURE') from None
        self._size += len(frame)
        self._apply(record)
        self.records.append(record)
        return copy.deepcopy(record)

    def prepare(self, namespace, data, *, execution=False):
        with self.lock:
            return self._append('EXECUTION_PREPARED' if execution else 'PREPARED', namespace, data)

    def finish(self, namespace, data, *, execution=False, aborted=False):
        with self.lock:
            event = ('EXECUTION_' if execution else '') + ('ABORTED' if aborted else 'COMMITTED')
            return self._append(event, namespace, data)

    def checkpoint(self, namespace, floors):
        with self.lock:
            return self._append('CHECKPOINT', namespace, {'floors': floors})

    def restore_prepare(self,namespace,data):
        with self.lock:return self._append('RESTORE_PREPARED',namespace,data)

    def restore_finish(self,namespace,data):
        with self.lock:return self._append('RESTORE_COMMITTED',namespace,data)
