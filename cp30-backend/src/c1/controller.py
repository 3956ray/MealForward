"""Private controller: independent proof reads, durable fences, cancellation saga."""
from __future__ import annotations
import argparse
import copy
import json
import os
import re
import sys
from pathlib import Path
import stat
import signal
import threading
from .ipc import Client, Server
from .faults import hit
from .content import verify_original
from . import restore
from .journal import BINDINGS, Journal, Quarantined

ALLOWLIST = {
    'api': frozenset({'security', 'query', 'cancel'}),
    'worker': frozenset({'source_dispatch', 'source_query', 'cancel'}),
    'source': frozenset({'execution_prepare', 'execution_finish', 'execution_abort', 'query'}),
    'fixture': frozenset({'fixture', 'security', 'query', 'restore'}),
    'verified_identity': frozenset({'identity_exchange','wallet_binding','wallet_login_challenge','wallet_login','query'}),
    'runtime_ledger': frozenset({'runtime_ledger_begin','runtime_ledger_finish','runtime_ledger_resolve'}),
}
SECURITY_KINDS = frozenset({'pre_session', 'login', 'logout', 'session', 'csrf', 'reauth',
                          'recover', 'display', 'access', 'identity', 'email', 'grant',
                          'payer', 'credential', 'restore', 'rebuild', 'lock'})
API_KINDS = frozenset({'pre_session', 'login', 'logout', 'session', 'csrf', 'reauth', 'recover', 'display', 'access', 'lock'})
FIXTURES = {'init': ('business', 'fixture_init'), 'assertion': ('business', 'fixture_assertion'),
            'clock': ('business', 'fixture_clock'), 'fault': ('business', 'fixture_fault'),
            'snapshot': ('business', 'fixture_snapshot')}

def _error(code, status=503):
    return {'error': code, 'status': status}

class Controller:
    def __init__(self, journal, business, authority, source=None, *, namespaces=(),config=None,runtime_ledger=None):
        self.journal, self.business, self.authority, self.source = journal, business, authority, source
        self.namespaces = frozenset(namespaces)
        self.mutex = threading.RLock()
        self.quarantined = set()
        self.config=config
        self.runtime_ledger=runtime_ledger

    def startup(self):
        with self.mutex:
            retained = set(self.journal.floors) | set(self.journal.pending)
            for namespace in (self.namespaces or retained):
                snapshot = self.journal.snapshot(namespace)
                if snapshot.get('restore_pending'):
                    self.quarantined.add(namespace)
                    continue
                last_restore=next((row for row in reversed(self.journal.records) if row['namespace']==namespace),None)
                if last_restore and last_restore['event']=='RESTORE_COMMITTED':
                    prepared=next(row for row in self.journal.records if row['digest']==last_restore['data']['prepared_digest'])
                    try:restore.finish(self,namespace,self._reference(prepared))
                    except Exception:
                        self.quarantined.add(namespace)
                        continue
                if snapshot['pending']:
                    self.quarantined.add(namespace)
                    # Original retained proof may complete exactly this operation.
                    try:
                        prepared=snapshot['pending'];execution=prepared['event']=='EXECUTION_PREPARED'
                        database,prefix=(self.authority,'execution') if execution else (self.business,'security')
                        proof=database.call(prefix+'_proof',namespace,self._reference(prepared,execution))
                        if proof.get('aborted') is True and proof.get('absent') is True:
                            self._abort(namespace,prepared,execution)
                        else:
                            self._finish(namespace,prepared,execution)
                    except Exception:
                        continue
                else:
                    # A durable terminal frame may precede the final DB fence clear.
                    terminal=next((r for r in reversed(self.journal.records) if r['namespace']==namespace and r['event'] in {'COMMITTED','EXECUTION_COMMITTED','ABORTED','EXECUTION_ABORTED'}),None)
                    if terminal:
                        try:
                            prepared=next(r for r in self.journal.records if r['digest']==terminal['data']['prepared_digest'])
                            execution=terminal['event'].startswith('EXECUTION_')
                            if terminal['event'] in {'COMMITTED','EXECUTION_COMMITTED'}:
                                self._finish(namespace,prepared,execution)
                            else:
                                database,prefix=(self.authority,'execution') if execution else (self.business,'security')
                                reference=self._reference(prepared,execution)
                                proof=database.call(prefix+'_proof',namespace,reference)
                                if not proof.get('aborted') or not proof.get('absent') or any(proof.get(k)!=v for k,v in reference.items()):
                                    raise Quarantined('ABORT_NOT_INDEPENDENTLY_PROVEN')
                                anchor=self.journal.snapshot(namespace)
                                cleared=self.business.call('execution_clear' if execution else 'security_abort_finish',namespace,{**reference,'journal_sequence':anchor['sequence'],'journal_digest':anchor['digest']})
                                if cleared.get('error'):raise Quarantined('ABORT_FINISH_FAILED')
                        except Exception:
                            self.quarantined.add(namespace)
                            continue
                try:
                    self._compare(namespace)
                except Exception:
                    self.quarantined.add(namespace)

    def _compare(self, namespace):
        snapshot = self.journal.snapshot(namespace)
        if snapshot['pending'] or snapshot.get('restore_pending') or self.journal.failed:
            raise Quarantined('PENDING_OR_DAMAGED_JOURNAL')
        for database, method in ((self.business, 'security_startup'), (self.authority, 'startup_check')):
            value = database.call(method, namespace, snapshot)
            if value.get('matched') is not True:
                raise Quarantined('STARTUP_FLOOR_MISMATCH')
        self.quarantined.discard(namespace)
        return snapshot

    def _binding(self, reservation, namespace):
        # Only immutable opaque IDs, hashes and floors enter the journal.
        value = {key: reservation[key] for key in BINDINGS}
        value['floors'] = copy.deepcopy(reservation['floors'])
        previous = self.journal.snapshot(namespace)['floors']
        # The DB reservation must present at least each retained object floor.
        for domain, objects in previous.items():
            for object_id, revision in objects.items():
                if value['floors'].get(domain, {}).get(object_id, -1) < revision:
                    raise Quarantined('STALE_RESERVATION_FLOOR')
        return value

    def _prepared(self, namespace, request, execution=False):
        mutation_id = request.get('ticket_id') if execution else request.get('mutation_id')
        snapshot = self.journal.snapshot(namespace)
        prepared = snapshot['pending']
        if prepared is None:
            # Retry finalization of the original durable completion, not a new prepare.
            prepared = next((record for record in reversed(self.journal.records)
                             if record['namespace'] == namespace and record['event'] in {'PREPARED', 'EXECUTION_PREPARED'} and record['data']['mutation_id'] == mutation_id), None)
        if not prepared or prepared['data']['mutation_id'] != mutation_id or prepared['event'] != ('EXECUTION_PREPARED' if execution else 'PREPARED'):
            raise Quarantined('NO_ORIGINAL_PREPARATION')
        if request.get('sequence') != prepared['sequence'] or request.get('digest') != prepared['digest']:
            raise Quarantined('PREPARATION_MISMATCH')
        return prepared

    @staticmethod
    def _reference(prepared, execution=False):
        return {'mutation_id': prepared['data']['mutation_id'],
                **({'ticket_id': prepared['data']['mutation_id']} if execution else {}),
                'sequence': prepared['sequence'], 'digest': prepared['digest']}

    def _prepare(self, namespace, request, execution=False):
        database, prefix = (self.authority, 'execution') if execution else (self.business, 'security')
        if namespace in self.quarantined or self.journal.snapshot(namespace)['pending']:
            return _error('QUARANTINED')
        snapshot = self.journal.snapshot(namespace)
        trusted_request = {**request, 'retained_floors': snapshot['floors'], 'retained_epochs': snapshot['epochs']}
        if not execution:
            authority_state=self.authority.call('startup_check',namespace,snapshot)
            if authority_state.get('matched') is not True:
                return _error('QUARANTINED')
            trusted_request['authority_evidence']=authority_state
        if execution:
            fenced = self.business.call('execution_fence', namespace, {'ticket_id':request['ticket_id']})
            if fenced.get('reserved') is not True:
                return fenced
        reservation = database.call(prefix + '_reserve', namespace, trusted_request)
        if 'error' in reservation:
            return reservation
        if reservation.get('replay') is True:
            mutation_id = reservation.get('mutation_id')
            prepared = next((record for record in reversed(self.journal.records) if record['namespace'] == namespace and record['event'] == ('EXECUTION_PREPARED' if execution else 'PREPARED') and record['data']['mutation_id'] == mutation_id), None)
            if prepared is None:
                raise Quarantined('REPLAY_ORIGINAL_ANCHOR_MISSING')
            finished = self._finish(namespace, prepared, execution)
            return {**finished, 'replay': True}
        binding = self._binding(reservation, namespace)
        try:
            prepared = self.journal.prepare(namespace, binding, execution=execution)
            reference = self._reference(prepared, execution)
            registered = database.call(prefix + '_prepare', namespace, reference)
            if 'error' in registered or registered.get('prepared') is not True:
                raise Quarantined('PREPARATION_REGISTRATION_FAILED')
            return {**reference, 'expected_revision': binding['expected_revision'], 'reservation': reservation}
        except Exception:
            self.quarantined.add(namespace)
            raise

    def _finish(self, namespace, prepared, execution=False):
        database, prefix = (self.authority, 'execution') if execution else (self.business, 'security')
        reference = self._reference(prepared, execution)
        proof = database.call(prefix + '_proof', namespace, reference)
        if proof.get('committed') is not True or any(proof.get(key) != value for key, value in reference.items()):
            raise Quarantined('MISSING_OR_CONTRADICTORY_PROOF')
        if any(proof.get(key) != prepared['data'][key] for key in BINDINGS):
            raise Quarantined('PROOF_BINDING_MISMATCH')
        data = {key: proof[key] for key in BINDINGS}
        data.update(floors=proof['floors'], prepared_sequence=prepared['sequence'], prepared_digest=prepared['digest'])
        pending = self.journal.snapshot(namespace)['pending']
        if pending:
            if pending['digest'] != prepared['digest']:
                raise Quarantined('OTHER_PENDING_OPERATION')
            self.journal.finish(namespace, data, execution=execution)
        else:
            terminal = next((record for record in reversed(self.journal.records) if record['namespace'] == namespace and record['data'].get('prepared_digest') == prepared['digest']), None)
            if not terminal or terminal['event'] != ('EXECUTION_COMMITTED' if execution else 'COMMITTED') or terminal['data'] != data:
                raise Quarantined('MISSING_ORIGINAL_COMPLETION')
        snapshot = self.journal.snapshot(namespace)
        acknowledged={**reference,'journal_sequence':snapshot['sequence'],'journal_digest':snapshot['digest']}
        result = database.call(prefix + '_finish', namespace, {**acknowledged, 'retained_floors': snapshot['floors'], 'retained_epochs': snapshot['epochs']})
        if 'error' in result or result.get('finished') is not True:
            raise Quarantined('FINISH_CAS_FAILED')
        if execution:
            cleared=self.business.call('execution_clear', namespace, acknowledged)
            if cleared.get('cleared') is not True:
                raise Quarantined('EXECUTION_FENCE_CLEAR_FAILED')
        # Compare both DBs before any risk can resume.
        self._compare(namespace)
        return {**reference, 'finished': True, 'result': result.get('result')}

    def _abort(self, namespace, prepared, execution=False):
        database, prefix = (self.authority, 'execution') if execution else (self.business, 'security')
        reference = self._reference(prepared, execution)
        try:
            fence = database.call(prefix + '_abort', namespace, reference)
        except Exception:
            # A success that won the CAS is still an original fact; read it ourselves.
            proof = database.call(prefix + '_proof', namespace, reference)
            if proof.get('committed') is True:
                return self._finish(namespace, prepared, execution)
            raise Quarantined('ABORT_CAS_NOT_PROVEN') from None
        if fence.get('committed') is True:
            return self._finish(namespace, prepared, execution)
        if fence.get('aborted') is not True or any(fence.get(key) != value for key, value in reference.items()):
            raise Quarantined('ABORT_NOT_FENCED')
        proof = database.call(prefix + '_proof', namespace, reference)
        if proof.get('committed') is True:
            return self._finish(namespace, prepared, execution)
        if proof.get('absent') is not True or proof.get('aborted') is not True or any(proof.get(key) != value for key, value in reference.items()):
            raise Quarantined('ABORT_NOT_INDEPENDENTLY_PROVEN')
        data = copy.deepcopy(prepared['data'])
        data.update(prepared_sequence=prepared['sequence'], prepared_digest=prepared['digest'])
        self.journal.finish(namespace, data, execution=execution, aborted=True)
        anchor=self.journal.snapshot(namespace)
        acknowledged={**reference,'journal_sequence':anchor['sequence'],'journal_digest':anchor['digest']}
        # Release the namespace fence only after ABORTED is independently durable.
        if execution:
            cleared=self.business.call('execution_clear',namespace,acknowledged)
        else:
            cleared=self.business.call('security_abort_finish',namespace,acknowledged)
        if cleared.get('error'):
            raise Quarantined('ABORT_FINISH_FAILED')
        self._compare(namespace)
        return {**reference, 'aborted': True}

    def _cancel(self, namespace, request):
        begin = self.business.call('cancel_begin', namespace, request)
        if 'error' in begin:
            return begin
        ticket_id = begin.get('ticket_id')
        if not ticket_id:
            return _error('CANCELLATION_PROOF_MISSING')
        close = self.authority.call('ticket_close', namespace, {'ticket_id': ticket_id})
        if 'error' in close:
            return _error('CANCELLATION_PENDING')
        hit(self.config,'authority_closed',namespace,ticket_id)
        original = self.authority.call('ticket_query', namespace, {'ticket_id': ticket_id})
        if original.get('committed') is True or close.get('committed') is True:
            return {'state': 'UNKNOWN', 'ticket_id': ticket_id, 'observe_original': True}
        if close.get('closed') is not True or original.get('closed') is not True or close.get('close_proof') != original.get('close_proof') or not close.get('close_proof'):
            return _error('CANCELLATION_PENDING')
        return self.business.call('cancel_finish', namespace, {**begin, 'close_proof': close['close_proof']})

    def _actor(self, namespace, request):
        if set(request) != {'operation', 'intent_id', 'actor'} or not all(isinstance(request[key], str) and request[key] and len(request[key]) <= 128 for key in ('intent_id', 'actor')):
            return _error('IPC_BAD_REQUEST', 400)
        if self.source is None:
            return _error('SOURCE_UNAVAILABLE')
        if namespace in self.quarantined or self.journal.snapshot(namespace)['pending']:
            return _error('QUARANTINED')
        # Each call is a separate short committed transaction. Private fixture
        # confirmation grants no API/worker privilege and never spans DB locks.
        if self.config:
            verified=verify_original(self.business,namespace,{'purpose':'stage_actor','intent_id':request['intent_id']},self.config['run'])
            if verified.get('error'):return verified
        staged = self.business.call('stage_actor', namespace, {'intent_id': request['intent_id']})
        if 'error' in staged:
            return staged
        ticket = copy.deepcopy(staged['ticket'])
        if ticket.get('kind') not in {'fund', 'refund', 'settle'}:
            return _error('IPC_FORBIDDEN', 403)
        ticket_id = ticket.get('ticket_id')
        if not isinstance(ticket_id, str) or not ticket_id:
            raise Quarantined('ACTOR_ORIGINAL_TICKET_MISSING')
        # Identical pure hashing to the independent source, outside row locks.
        from .model import funding_hash, operation_hash
        original = {key: ticket[key] for key in ('op_id', 'kind', 'caller', 'payload')}
        ticket['payload_hash'] = (funding_hash(None, original) if ticket['kind'] == 'fund'
                                  else operation_hash(staged['manifest'], original))
        registered = self.authority.call('ticket_register', namespace, {'ticket': ticket})
        if 'error' in registered:
            return registered
        if registered.get('status') != 'REGISTERED':
            # An existing terminal or uncertain ticket is observed as original;
            # actor confirmation must never create fresh authority for it.
            try:
                return self.source.call(namespace, 'query', {'ticket_id': ticket_id})
            except Exception:
                return {'state': 'UNKNOWN', 'ticket_id': ticket_id}
        confirmed = self.authority.call('fixture_actor', namespace, {'ticket_id': ticket_id, 'actor': request['actor']})
        if 'error' in confirmed:
            return confirmed
        # The source invokes execution_prepare/finish on this controller; no
        # controller mutex may be held while waiting for that callback.
        try:
            return self.source.call(namespace, 'dispatch', {'ticket_id': ticket_id})
        except Exception:
            return {'state': 'UNKNOWN', 'ticket_id': ticket_id}

    def handle(self, namespace, method, request, *, role=None):
        if role not in ALLOWLIST or method not in ALLOWLIST[role]:
            return _error('IPC_FORBIDDEN', 403)
        if self.namespaces and namespace not in self.namespaces:
            return _error('IPC_FORBIDDEN', 403)
        if role=='runtime_ledger':
            # Separate external runtime journal/database; original capabilities
            # gain no new method and no runtime may self-acknowledge its write.
            if self.runtime_ledger is None:return _error('EXTERNAL_RESTORE_FLOOR_REQUIRED')
            try:
                if method=='runtime_ledger_begin' and set(request)=={'readOnly'} and type(request['readOnly']) is bool:
                    return self.runtime_ledger.begin(namespace,read_only=request['readOnly'])
                if method=='runtime_ledger_finish' and set(request)=={'ticket','proof'}:
                    return self.runtime_ledger.finish(namespace,request['ticket'],request['proof'])
                if method=='runtime_ledger_resolve' and set(request)=={'ticket'}:
                    return self.runtime_ledger.resolve(namespace,request['ticket'])
                return _error('IPC_BAD_REQUEST',400)
            except Exception:return _error('RUNTIME_LEDGER_QUARANTINED')
        if not self.namespaces and not (role == 'fixture' and method == 'fixture' and request.get('operation') == 'init'):
            try:
                # Existence is established by the narrow DB guard. This probe
                # neither clears quarantine nor substitutes for retained floors.
                probe = self.business.call('security_startup', namespace, {'namespace_probe': True, 'floors': {}, 'epochs': {}})
                if probe.get('exists') is False or 'error' in probe:
                    return _error('NAMESPACE_UNAVAILABLE')
            except Exception:
                return _error('NAMESPACE_UNAVAILABLE')
        if method == 'fixture' and request.get('operation') == 'actor':
            try:
                return self._actor(namespace, request)
            except Exception as exc:
                print('C1_DIAGNOSTIC '+json.dumps({'component':'controller','method':'actor','code':type(exc).__name__}),file=sys.stderr,flush=True)
                self.quarantined.add(namespace)
                return _error('QUARANTINED')
        # Source calls back into execution_prepare/finish on this controller.
        # Never hold the controller serialization lock across that private call.
        if method in {'source_dispatch', 'source_query'}:
            if method == 'source_dispatch' and (namespace in self.quarantined or self.journal.snapshot(namespace)['pending']):
                return _error('QUARANTINED')
            if self.source is None or set(request) != {'ticket_id'}:
                return _error('IPC_BAD_REQUEST', 400)
            try:
                return self.source.call(namespace, 'dispatch' if method == 'source_dispatch' else 'query', request)
            except Exception:
                return _error('SOURCE_UNAVAILABLE')
        if not self.mutex.acquire(timeout=2):
            return _error('CONTROLLER_BUSY')
        try:
            if method == 'query':
                snapshot = self.journal.snapshot(namespace)
                if not snapshot['pending'] and namespace not in self.quarantined:
                    self._compare(namespace)
                return {**snapshot, 'quarantined': namespace in self.quarantined,'riskBlocked':namespace in self.quarantined or bool(snapshot['pending'])}
            if method in {'identity_exchange','wallet_binding','wallet_login_challenge','wallet_login'}:
                # This capability belongs to the separate JWT/proof authority,
                # never the API/fixture processes. Existing role methods stay exact.
                if role!='verified_identity' or set(request)!={'mutation_id','command'}:
                    return _error('IPC_FORBIDDEN',403)
                kind={'identity_exchange':'external_login','wallet_binding':'owner_binding','wallet_login_challenge':'wallet_login_challenge','wallet_login':'wallet_login'}[method]
                prepared=self._prepare(namespace,{**request,'kind':kind,'private_identity':True})
                if prepared.get('error') or prepared.get('replay'):return prepared
                reference={key:prepared[key] for key in ('mutation_id','sequence','digest')}
                result=self.business.call('security_apply',namespace,reference)
                frame=self._prepared(namespace,prepared)
                if result.get('error'):
                    self._abort(namespace,frame)
                    return result
                self._finish(namespace,frame)
                return result
            if method == 'cancel':
                if role == 'api' and (set(request) != {'intent_id', 'session_hash', 'csrf_hash'} or not all(isinstance(v, str) and v for v in request.values())):
                    return _error('IPC_BAD_REQUEST', 400)
                if role == 'worker' and set(request) != {'job_id','worker_id','fencing_epoch'}:
                    return _error('IPC_BAD_REQUEST',400)
                return self._cancel(namespace, request)
            if method == 'execution_prepare':
                if set(request) != {'ticket_id'}:
                    return _error('IPC_BAD_REQUEST', 400)
                return self._prepare(namespace, request, execution=True)
            if method in {'execution_finish', 'execution_abort'}:
                prepared = self._prepared(namespace, request, execution=True)
                return (self._finish if method == 'execution_finish' else self._abort)(namespace, prepared, execution=True)
            if method in {'security', 'restore'}:
                phase = request.get('phase', 'prepare')
                if phase in {'finish', 'abort'}:
                    if set(request)!={'phase','mutation_id','sequence','digest'}:return _error('IPC_BAD_REQUEST',400)
                    prepared = self._prepared(namespace, request)
                    if role == 'api' and prepared['data']['kind'] not in API_KINDS:
                        return _error('IPC_FORBIDDEN', 403)
                    return (self._finish if phase == 'finish' else self._abort)(namespace, prepared)
                if phase != 'prepare':
                    return _error('IPC_BAD_REQUEST', 400)
                command = {key: value for key, value in request.items() if key != 'phase'}
                if set(command)!={'kind','mutation_id','command'}:return _error('IPC_BAD_REQUEST',400)
                kind = command.get('kind')
                if kind not in (API_KINDS if role == 'api' else SECURITY_KINDS) or (method == 'restore' and kind != 'restore'):
                    return _error('IPC_FORBIDDEN', 403)
                return self._prepare(namespace, {**command,'fixture':role=='fixture'})
            if method == 'fixture':
                operation = request.get('operation')
                payload = {key: value for key, value in request.items() if key != 'operation'}
                if operation=='restore_prepare':return restore.prepare(self,namespace,payload)
                if operation=='restore_finish':return restore.finish(self,namespace,payload)
                if operation in {'identity', 'grant', 'payer', 'credential', 'restore'}:
                    prepared = self._prepare(namespace, {**payload, 'kind': operation, 'fixture': True})
                    if 'error' in prepared:
                        return prepared
                    result = self.business.call('security_apply', namespace, {key: prepared[key] for key in ('mutation_id', 'sequence', 'digest')})
                    frame = self._prepared(namespace, prepared)
                    if 'error' in result:
                        return self._abort(namespace, frame)
                    return self._finish(namespace, frame)
                if operation not in FIXTURES:
                    return _error('IPC_BAD_REQUEST', 400)
                database, function = FIXTURES[operation]
                return (self.business if database == 'business' else self.authority).call(function, namespace, payload)
            return _error('IPC_BAD_REQUEST', 400)
        except Exception as exc:
            reason = str(exc) if isinstance(exc, Quarantined) and re.fullmatch('[A-Z_]{1,64}', str(exc)) else type(exc).__name__
            print('C1_DIAGNOSTIC '+json.dumps({'component':'controller','method':method,'code':reason}), file=sys.stderr, flush=True)
            self.quarantined.add(namespace)
            return _error('QUARANTINED')
        finally:
            self.mutex.release()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    if os.environ:
        raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    info = Path(args.config).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise SystemExit('PRIVATE_CONFIG_REQUIRED')
    config = json.loads(Path(args.config).read_text())
    from .db import Database
    business = Database(config, 'business', 'business', max_size=1)
    authority = Database(config, 'authority', 'authority', max_size=1)
    anchors=[database.call('journal_anchor','',{}) for database in (business,authority)]
    if any(value.get('error') for value in anchors):raise SystemExit('JOURNAL_ANCHOR_UNAVAILABLE')
    anchor=max(anchors,key=lambda value:value['sequence'])
    if any(value['sequence']==anchor['sequence'] and value['digest']!=anchor['digest'] for value in anchors):raise SystemExit('JOURNAL_ANCHOR_CONFLICT')
    journal = Journal(config['journal_path'], config['run_id'], config['cluster_id'],expected_sequence=anchor['sequence'],expected_digest=anchor['digest'])
    source = Client(config['source']['path'], config['source']['cap']) if config.get('source') else None
    runtime_ledger=None;runtime_database=None;runtime_journal=None
    if config.get('runtimeLedger'):
        from .runtime_ledger_controller import RuntimeLedgerJournal,RuntimeLedgerController
        settings=config['runtimeLedger']
        runtime_database=Database(config,settings['databaseRole'],'runtime_controller',max_size=1)
        if settings.get('journals'):
            runtime_journal={namespace:RuntimeLedgerJournal(directory,namespace) for namespace,directory in settings['journals'].items()}
        else:runtime_journal=RuntimeLedgerJournal(settings['directory'],settings['namespace'])
        runtime_ledger=RuntimeLedgerController(runtime_database,runtime_journal)
    controller = Controller(journal, business, authority, source, namespaces=config['namespaces'],config=config,runtime_ledger=runtime_ledger)
    controller.startup()
    capabilities = {role: {'cap': entry['cap'], 'methods': list(ALLOWLIST[role])}
                    for role, entry in config['capabilities'].items() if role in ALLOWLIST}
    server = Server(config['socket_path'], capabilities, controller.handle)
    stopped=threading.Event()
    signal.signal(signal.SIGTERM,lambda *_:stopped.set())
    signal.signal(signal.SIGINT,lambda *_:stopped.set())
    thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=0.1),daemon=True);thread.start()
    try:
        stopped.wait()
    finally:
        server.shutdown();thread.join(timeout=5);server.server_close()
        business.close()
        authority.close()
        journal.close()
        if runtime_database is not None:runtime_database.close()
        if isinstance(runtime_journal,dict):
            for value in runtime_journal.values():value.close()
        elif runtime_journal is not None:runtime_journal.close()

if __name__ == '__main__':
    main()
