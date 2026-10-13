"""One bounded original-only deployment queue step. No network or signer implementation."""
from __future__ import annotations
from copy import deepcopy
from typing import Protocol

from .service import Rejected, word

ORIGINAL_LOOKUP_V1 = 'CP30_ORIGINAL_REGISTRATION_V1'


class PersistentTaskSource(Protocol):
    def next_task(self) -> dict | None:
        """Return detached {namespace,registrationId}; close DB transaction before return.

        Revisit durable PENDING/UNKNOWN outbox records; duplicate delivery is permitted.
        Never return a signature, new registration id, or a browser-owned task descriptor.
        """
        ...


class RegistrarClient(Protocol):
    # Trusted composition pins this only for a reviewed registrar with durable original
    # attempt lookup. It is not a browser capability claim or success/finality flag.
    original_lookup_protocol: str

    def send_original(self, record: dict) -> str:
        """Submit saved deployment once; persist exact attempt BEFORE possible signing/send.

        Server independently binds original id/domain/digest/codehash/from/to/value/calldata;
        durable lookup survives response loss/restarts. Never return a fabricated hash.
        Private key and signing remain wholly outside this leaf module.
        """
        ...

    def lookup_original(self, record: dict) -> str | None:
        """Query the same durable registrar attempt+exact deployment, without any send.

        None means not yet known, NOT permission to re-sign/resubmit/replace ids/nonce.
        Original mismatch, missing retention or unavailable durable store must raise.
        """
        ...


class OnboardingDispatcher:
    def __init__(self, domain, registrar: RegistrarClient, tasks: PersistentTaskSource):
        if (registrar is None or getattr(registrar, 'original_lookup_protocol', None) != ORIGINAL_LOOKUP_V1
                or not callable(getattr(registrar, 'send_original', None))
                or not callable(getattr(registrar, 'lookup_original', None))):
            raise Rejected('REGISTRAR_ORIGINAL_LOOKUP_REQUIRED')
        if tasks is None or not callable(getattr(tasks, 'next_task', None)):
            raise Rejected('PERSISTENT_TASK_SOURCE_REQUIRED')
        self.domain, self.registrar, self.tasks = domain, registrar, tasks

    @staticmethod
    def _unknown(record, reason):
        return {'registrationId': record['registrationId'], 'state': 'UNKNOWN',
                'ready': False, 'reason': reason}

    def step(self):
        """At most one saved deployment send OR one original-only registrar lookup.

        Registrar/verifier calls happen outside domain transactions. The runtime owns
        scheduling/backoff and shutdown; this method starts no loop/process/thread.
        """
        task = self.tasks.next_task()
        if task is None: return None
        if (type(task) is not dict or set(task) != {'namespace', 'registrationId'}
                or type(task['namespace']) is not str or not task['namespace']):
            raise Rejected('INVALID_DURABLE_TASK')
        namespace, registration_id = task['namespace'], word(task['registrationId'])
        record = self.domain.original_attempt(namespace, registration_id)
        if record['state'] == 'CONFIRMED': return self.domain.reconcile(namespace, registration_id)
        if record['state'] not in {'PENDING', 'UNKNOWN'}: raise Rejected('INVALID_STATE')
        send = False
        if record['state'] == 'PENDING':
            try:
                attempt = self.domain.begin_attempt(namespace, registration_id)
            except Rejected as exc:
                if str(exc) != 'AUTHORIZATION_EXPIRED': raise
                return {'registrationId': registration_id, 'state': 'PENDING', 'ready': False,
                        'reason': 'AUTHORIZATION_EXPIRED'}
            if attempt is not None:
                record, send = attempt, True  # Only the durable UNKNOWN-transition winner can send.
            else:
                record = self.domain.original_attempt(namespace, registration_id)
                if record['state'] == 'CONFIRMED': return self.domain.reconcile(namespace, registration_id)
                if record['state'] != 'UNKNOWN': raise Rejected('INVALID_STATE')
        try:
            transaction_hash = (self.registrar.send_original(deepcopy(record)) if send
                                else self.registrar.lookup_original(deepcopy(record)))
        except Exception:
            # No raw exception, signature, private record or secret is returned/logged.
            # There is deliberately no automatic send retry on UNKNOWN, even before response/hash.
            return self._unknown(record, 'REGISTRAR_UNAVAILABLE')
        if send and transaction_hash is None:
            return self._unknown(record, 'ORIGINAL_TRANSACTION_UNAVAILABLE')
        if transaction_hash is not None:
            self.domain.observe_transaction(namespace, registration_id, word(transaction_hash))
        try:
            return self.domain.reconcile(namespace, registration_id)
        except Rejected as exc:
            if str(exc) != 'SNAPSHOT_CHANGED': raise
            return self._unknown(record, 'ORIGINAL_SNAPSHOT_CHANGED')
