"""Private independently computing source; only immutable tickets can execute."""
from __future__ import annotations
import argparse
from .faults import hit
import json
import signal
import threading
from .model import ModelError, transition, operation_hash, funding_hash

class Source:
    def __init__(self, authority, business, controller,config=None):
        self.authority, self.business, self.controller = authority, business, controller
        self.config=config

    def _call(self, method, namespace, request):
        result = self.authority.call(method, namespace, request)
        if result.get('error'):
            raise ModelError(result['error'])
        return result

    def _final(self, namespace, ticket_id, result):
        """Publication follows the controller's independently verified finish."""
        if result.get('status') in {'COMMITTED','EXECUTED_PENDING'}:
            proof = self._call('execution_proof', namespace, {'ticket_id':ticket_id})
            if proof.get('committed') is not True:
                return {'status':'UNKNOWN','ticket_id':ticket_id}
            finished = self.controller.call(namespace, 'execution_finish', {'ticket_id':ticket_id,
                'sequence':proof['sequence'],'digest':proof['digest']})
            if finished.get('error') or finished.get('finished') is not True:
                return {'status':'UNKNOWN','ticket_id':ticket_id}
            result = self._call('ticket_query', namespace, {'ticket_id':ticket_id})
        if result.get('status') == 'FINAL_SUCCEEDED':
            receipt = result.get('receipt')
            if not receipt or receipt.get('final') is not True:
                return {'status':'UNKNOWN','ticket_id':ticket_id}
            stored = self.business.call('receipt_ingest', namespace, {'receipt':receipt})
            if stored.get('error'):
                return {'status':'UNKNOWN','ticket_id':ticket_id}
            hit(self.config,'receipt_ingested',namespace,ticket_id)
            return {'status':'FINAL_SUCCEEDED','ticket_id':ticket_id,'receipt_id':stored['receipt_id']}
        return result

    def query(self, namespace, ticket_id):
        # Never register, prepare, recompute or reexecute an unknown original.
        result = self._call('ticket_query', namespace, {'ticket_id':ticket_id})
        return self._final(namespace, ticket_id, result)

    def dispatch(self, namespace, ticket_id):
        original = self.business.call('source_ticket', namespace, {'ticket_id':ticket_id})
        if original.get('error'): return original
        ticket = original['ticket']
        # Hash original typed payload outside transaction locks, never worker-selected fields.
        operation = {key:ticket[key] for key in ('op_id','kind','caller','payload')}
        if ticket['kind'] == 'fund':
            ticket['payload_hash'] = funding_hash(None,operation)
        else:
            ticket['payload_hash'] = operation_hash(original['manifest'],operation)
        registered = self._call('ticket_register', namespace, {'ticket':ticket})
        if registered.get('status') != 'REGISTERED':
            return self._final(namespace, ticket_id, registered)
        view = self._call('execution_view', namespace, {'ticket_id':ticket_id})
        if view.get('requires_actor') and not view.get('actor_confirmed'):
            return {'status':'WAIT_ACTOR','ticket_id':ticket_id}
        pinned = view['ticket']
        operation = {key:pinned[key] for key in ('op_id','kind','caller','payload')}
        try:
            computed = transition(view['snapshot'], operation, commitments=pinned)
        except ModelError as exc:
            # A definitive source failure closes ALL copies before release can occur.
            closed = self._call('ticket_close', namespace, {'ticket_id':ticket_id,'reason':exc.code})
            return self._final(namespace, ticket_id, closed)
        if computed['noop']:
            # Existing operation must have retained immutable proof/receipt, never new prepare.
            return self.query(namespace, ticket_id)
        prepared = self.controller.call(namespace, 'execution_prepare', {'ticket_id':ticket_id})
        if prepared.get('error'):
            return {'status':'UNKNOWN','ticket_id':ticket_id}
        # Reservation revision and snapshot revision must agree. No cross-DB locks held.
        if prepared['expected_revision'] != view['revision']:
            return {'status':'UNKNOWN','ticket_id':ticket_id}
        committed = self._call('execution_commit', namespace, {'ticket_id':ticket_id,
            'expected_revision':view['revision'],'sequence':prepared['sequence'],
            'digest':prepared['digest'],'transition':computed})
        hit(self.config,'authority_committed',namespace,ticket_id)
        return self._final(namespace, ticket_id, committed)

    def handle(self, namespace, method, request, *, role=None):
        try:
            if method in {'dispatch','query','close'}:
                if type(request) is not dict or set(request) != {'ticket_id'}:
                    return {'error':'INVALID_REQUEST','status':422}
                ticket = request['ticket_id']
                if type(ticket) is not str or not ticket or len(ticket) > 128:
                    return {'error':'INVALID_REQUEST','status':422}
                if method == 'dispatch': return self.dispatch(namespace,ticket)
                if method == 'query': return self.query(namespace,ticket)
                return self._call('ticket_close',namespace,request)
            if method == 'actor' and role == 'fixture':
                if type(request) is not dict or set(request) != {'ticket_id','actor'}:
                    return {'error':'INVALID_REQUEST','status':422}
                return self._call('actor_confirm',namespace,request)
            return {'error':'FORBIDDEN','status':403}
        except ModelError as exc:
            return {'error':exc.code,'status':409}
        except Exception:
            # A lost response is UNKNOWN; exception text could contain private SQL data.
            return {'status':'UNKNOWN','ticket_id':request.get('ticket_id')}

def main():
    from .db import Database
    from .ipc import Client, Server
    parser=argparse.ArgumentParser(); parser.add_argument('--config',required=True)
    config=json.loads(open(parser.parse_args().config).read())
    if config.get('mode') != 'C1_SYNTHETIC_LOOPBACK' or any(config.get(k) for k in ('real_operations','rpc','wallet','signer')):
        raise SystemExit('SYNTHETIC_MODE_REQUIRED')
    authority=Database(config,'source_authority','authority',max_size=1)
    business=Database(config,'source_ingest','business',max_size=1)
    service=Source(authority,business,Client(config['controller_path'],config['controller_cap']),config)
    server=Server(config['source_path'],config['capabilities'],service.handle,max_handlers=1)
    stopped=threading.Event()
    signal.signal(signal.SIGTERM,lambda *_:stopped.set())
    signal.signal(signal.SIGINT,lambda *_:stopped.set())
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try: stopped.wait()
    finally:
        server.shutdown(); thread.join(timeout=5); server.server_close()
        authority.close(); business.close()

if __name__ == '__main__': main()
