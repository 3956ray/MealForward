"""Concrete fixed-function adapter; no connection creation, credentials, SQL or IO defaults.

Requires Main's serializable private Database mode and external controller ledger
checkpoint integration. SQL under this leaf is an uninstalled companion candidate.
"""
from __future__ import annotations
from contextlib import contextmanager
from copy import deepcopy
import re

LEDGER_PROTOCOL = 'CP30_DURABLE_ORIGINAL_LEDGER_V1'
DB_PROTOCOL = 'CP30_RUNTIME_LEDGER_DB_V1'
CONTROLLER_PROTOCOL = 'CP30_RUNTIME_LEDGER_CONTROLLER_V1'
RUNTIME_METHODS = frozenset(('ledger_open','ledger_get','ledger_insert','ledger_save',
                            'ledger_reserve','ledger_seal','ledger_authorization'))
CONTROLLER_METHODS = frozenset(('ledger_status','ledger_proof','ledger_finish','ledger_abort','ledger_abort_finish'))


class LedgerRejected(ValueError):
    pass


def _key(key):
    if (not isinstance(key,(tuple,list)) or len(key)!=4 or key[0] not in {'quote','operation','registration'}
            or any(type(item) is not str for item in key)
            or not re.fullmatch(r'[1-9][0-9]{0,77}',key[1])
            or not re.fullmatch(r'0x[0-9a-f]{40}',key[2]) or int(key[2],16)==0
            or not re.fullmatch(r'0x[0-9a-f]{64}',key[3]) or int(key[3],16)==0):
        raise LedgerRejected('INVALID_ORIGINAL_LEDGER_KEY')
    return tuple(key)


class PgRuntimeTransaction:
    def __init__(self,fixed,namespace,ticket,read_only):
        self.fixed,self.namespace,self.ticket,self.read_only=fixed,namespace,deepcopy(ticket),read_only
        self.snapshots={}
        self.dirty=False

    def _call(self,method,**request):
        return self.fixed.call(method,{'ticket':deepcopy(self.ticket),**deepcopy(request)})

    def get(self,key):
        key=_key(key)
        result=self._call('ledger_get',key=list(key))
        row=deepcopy(result['row'])
        self.snapshots[key]=(result.get('revision'),deepcopy(row))
        return row

    def _write(self):
        if self.read_only: raise LedgerRejected('READ_ONLY_LEDGER')
        self.dirty=True

    def insert(self,key,row):
        self._write();key=_key(key)
        if key not in self.snapshots or self.snapshots[key]!=(None,None):
            raise LedgerRejected('ORIGINAL_ABSENCE_SNAPSHOT_REQUIRED')
        result=self._call('ledger_insert',key=list(key),row=row)
        self.snapshots[key]=(result['revision'],deepcopy(row))

    def save(self,key,row):
        self._write();key=_key(key)
        snapshot=self.snapshots.get(key)
        if snapshot is None or snapshot[0] is None: raise LedgerRejected('ORIGINAL_CAS_SNAPSHOT_REQUIRED')
        result=self._call('ledger_save',key=list(key),row=row,expectedRevision=snapshot[0],expectedRow=snapshot[1])
        self.snapshots[key]=(result['revision'],deepcopy(row))

    def reserve_original(self,key,grant,*,original,signature_units,gas_units):
        self._write();key=_key(key)
        if type(signature_units) is not int or signature_units!=1 or type(gas_units) is not int or gas_units<0:
            raise LedgerRejected('INVALID_LEDGER_RESERVATION')
        return self._call('ledger_reserve',key=list(key),grant=grant,original=original,
                          signatureUnits='1',gasUnits=str(gas_units))

    def authorization(self,key):
        """DB-only Main policy material; not a permission/binding/success setter."""
        return self._call('ledger_authorization',key=list(_key(key)))

    def seal(self):
        if self.read_only: raise LedgerRejected('READ_ONLY_LEDGER')
        return self._call('ledger_seal',changed=self.dirty)


class PgRuntimeLedger:
    durability_protocol=LEDGER_PROTOCOL

    def __init__(self,database,namespace,controller):
        if (getattr(database,'database',None)!='runtime_internal'
                or getattr(database,'runtime_ledger_protocol',None)!=DB_PROTOCOL
                or not callable(getattr(database,'transaction',None))):
            raise LedgerRejected('SERIALIZABLE_PRIVATE_DATABASE_REQUIRED')
        if (controller is None or getattr(controller,'runtime_ledger_protocol',None)!=CONTROLLER_PROTOCOL
                or any(not callable(getattr(controller,method,None)) for method in ('begin','finish','resolve'))):
            raise LedgerRejected('EXTERNAL_RESTORE_FLOOR_REQUIRED')
        if type(namespace) is not str or not namespace: raise LedgerRejected('INVALID_NAMESPACE')
        self.database,self.namespace,self.controller=database,namespace,controller

    def _ticket(self,ticket,read_only):
        if (type(ticket) is not dict or ticket.get('protocol')!=CONTROLLER_PROTOCOL
                or ticket.get('namespace')!=self.namespace or ticket.get('readOnly') is not read_only
                or type(ticket.get('checkpoint')) is not dict):
            raise LedgerRejected('EXTERNAL_RESTORE_FLOOR_REQUIRED')
        checkpoint=ticket['checkpoint']
        if (type(checkpoint.get('ledgerRevision')) is not int or checkpoint['ledgerRevision']<0
                or type(checkpoint.get('ledgerHead')) is not str or not re.fullmatch(r'[0-9a-f]{64}',checkpoint['ledgerHead'])
                or not re.fullmatch(r'[0-9a-f]{64}',str(checkpoint.get('materialHash','')))
                or type(checkpoint.get('epochs')) is not dict or type(checkpoint.get('floors')) is not dict
                or type(checkpoint.get('globalFloors')) is not dict
                or type(checkpoint.get('journalSequence')) is not int or checkpoint['journalSequence']<1
                or type(checkpoint.get('journalDigest')) is not str or not re.fullmatch(r'[0-9a-f]{64}',checkpoint['journalDigest'])):
            raise LedgerRejected('EXTERNAL_RESTORE_FLOOR_REQUIRED')
        if (set(checkpoint['epochs'])!={'source_epoch','credential_epoch','restore_generation'}
                or any(type(value) is not int or value<0 for value in checkpoint['epochs'].values())
                or set(checkpoint['floors'])!={'runtime_attempt','runtime_reservation','runtime_budget',
                                              'runtime_authorization','runtime_nonce'}
                or set(checkpoint['globalFloors'])!={'runtime_nonce'}
                or any(type(objects) is not dict or any(type(key) is not str or not key
                       or type(revision) is not int or revision<0 for key,revision in objects.items())
                       for objects in (*checkpoint['floors'].values(),*checkpoint['globalFloors'].values()))):
            raise LedgerRejected('EXTERNAL_RESTORE_FLOOR_REQUIRED')
        if not read_only:
            mutation=ticket.get('mutation')
            if (type(mutation) is not dict or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',str(mutation.get('id','')))
                    or type(mutation.get('sequence')) is not int or mutation['sequence']<1
                    or not re.fullmatch(r'[0-9a-f]{64}',str(mutation.get('digest','')))):
                raise LedgerRejected('CONTROLLER_PREPARATION_REQUIRED')
        return deepcopy(ticket)

    @contextmanager
    def transaction(self,*,read_only=False):
        # begin includes the independent journal/floor check and, for writes,
        # original controller PREPARED frame. Neither callback runs in a DB tx.
        ticket=self._ticket(self.controller.begin(self.namespace,read_only=read_only),read_only)
        try:
            with self.database.transaction(self.namespace,read_only=read_only) as fixed:
                fixed.call('ledger_open',{'ticket':deepcopy(ticket)})
                transaction=PgRuntimeTransaction(fixed,self.namespace,ticket,read_only)
                yield transaction
                proof=None if read_only else transaction.seal()
            if not read_only:
                # Must independently reread ledger_proof, retain the exact COMMITTED
                # Journal frame/floors, then controller-only ledger_finish. Errors
                # quarantine, so a caller never reaches signing after unfinished anchoring.
                ack=self.controller.finish(self.namespace,deepcopy(ticket),deepcopy(proof))
                if (type(ack) is not dict or ack.get('finished') is not True
                        or ack.get('mutation_id')!=ticket['mutation']['id']
                        or ack.get('ledgerRevision')!=proof['ledgerRevision'] or ack.get('ledgerHead')!=proof['ledgerHead']
                        or type(ack.get('journalSequence')) is not int or ack['journalSequence']<=ticket['mutation']['sequence']
                        or not re.fullmatch(r'[0-9a-f]{64}',str(ack.get('journalDigest','')))):
                    raise LedgerRejected('EXTERNAL_RUNTIME_COMMIT_ACK_REQUIRED')
        except BaseException:
            if not read_only:
                # Independent proof resolution, not a caller assertion that rollback
                # occurred. It cannot reset a grant or release a reservation.
                self.controller.resolve(self.namespace,deepcopy(ticket))
            raise


class PgRuntimePolicy:
    """Read the sole durable approval through the opened, fenced transaction."""
    def authorize(self,transaction,record,action):
        if type(record) is not dict or record.get('namespace')!=transaction.namespace:
            raise LedgerRejected('PRIVATE_RUNTIME_NAMESPACE_REQUIRED')
        if 'registrationId' in record:
            kind='registration';binding=record.get('original',{})
            key=(kind,binding.get('chainId'),binding.get('factory'),record['registrationId'])
            actions={'registrar_lookup','registrar_sign','registrar_result'}
        elif 'quoteId' in record:
            kind='quote';binding=record.get('binding',{})
            key=(kind,binding.get('chainId'),binding.get('escrow'),record['quoteId'])
            actions={'quote_lookup','quote_sign','quote_result'}
        else:
            kind='operation';binding=record.get('binding',{})
            key=(kind,binding.get('chainId'),binding.get('escrow'),record.get('opId'))
            actions={'operation_lookup','operation_sign','operation_result'}
        if action not in actions: raise LedgerRejected('PRIVATE_POLICY_ACTION_FORBIDDEN')
        if kind!='registration':
            chain_id=binding.get('chainId')
            if type(chain_id) is not int or not 0<chain_id<2**53:
                raise LedgerRejected('INVALID_ORIGINAL_LEDGER_KEY')
            # Business records retain safe integer chainId; only the ledger key
            # uses its decimal string, matching PrivateBusinessRuntime._key.
            key=(kind,str(chain_id),key[2],key[3])
        material=transaction.authorization(key)
        approval=material.get('approval')
        if type(approval) is not dict or approval.get('original')!=record:
            raise LedgerRejected('IMMUTABLE_ORIGINAL_AUTHORIZATION')
        return deepcopy(approval)
