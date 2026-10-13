"""Pure in-memory adapter/protocol checks; never imports PG, signs or calls RPC."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import importlib.util
import re
from types import SimpleNamespace
import unittest

from pg_runtime_ledger import (PgRuntimeLedger,PgRuntimePolicy,LedgerRejected,
    DB_PROTOCOL,CONTROLLER_PROTOCOL,RUNTIME_METHODS,CONTROLLER_METHODS)

KEY=('operation','31337','0x'+'11'*20,'0x'+'22'*32)
EPOCHS={'source_epoch':1,'credential_epoch':1,'restore_generation':1}
FLOORS={name:{} for name in ('runtime_attempt','runtime_reservation','runtime_budget',
                            'runtime_authorization','runtime_nonce')}


class DatabaseStub:
    database='runtime_internal'
    runtime_ledger_protocol=DB_PROTOCOL
    def __init__(self):
        self.depth=0;self.calls=[];self.rows={};self.approval=None
    @contextmanager
    def transaction(self,namespace,*,read_only=False):
        previous=deepcopy(self.rows);self.depth+=1
        try: yield self
        except BaseException: self.rows=previous;raise
        finally:self.depth-=1
    def call(self,method,request):
        self.calls.append((method,deepcopy(request)))
        key=tuple(request.get('key',KEY))
        if method=='ledger_open':return {'opened':True}
        if method=='ledger_get':
            revision,row=self.rows.get(key,(None,None))
            return {'row':deepcopy(row),'revision':revision}
        if method=='ledger_authorization':return {'approval':deepcopy(self.approval)}
        if method=='ledger_reserve':return {'reserved':True,'replay':False}
        if method=='ledger_insert':self.rows[key]=(1,deepcopy(request['row']));return {'revision':1}
        if method=='ledger_save':
            if self.rows[key]!=(request['expectedRevision'],request['expectedRow']):
                raise LedgerRejected('ORIGINAL_LEDGER_CAS_CONFLICT')
            revision=request['expectedRevision']+1
            self.rows[key]=(revision,deepcopy(request['row']));return {'revision':revision}
        if method=='ledger_seal':return {'ledgerRevision':1,'ledgerHead':'a'*64}
        raise AssertionError(method)


class ControllerStub:
    runtime_ledger_protocol=CONTROLLER_PROTOCOL
    def __init__(self,database):self.database=database;self.events=[];self.omit_global=False;self.short_ack=False
    def begin(self,namespace,*,read_only):
        assert self.database.depth==0
        self.events.append('begin')
        checkpoint={'ledgerRevision':0,'ledgerHead':'0'*64,'materialHash':'0'*64,
            'epochs':deepcopy(EPOCHS),'floors':deepcopy(FLOORS),
            'globalFloors':{'runtime_nonce':{}},'journalSequence':1,'journalDigest':'b'*64}
        if self.omit_global:checkpoint.pop('globalFloors')
        result={'protocol':CONTROLLER_PROTOCOL,'namespace':namespace,'readOnly':read_only,'checkpoint':checkpoint}
        if not read_only:result['mutation']={'id':'00000000-0000-0000-0000-000000000001','sequence':2,'digest':'c'*64}
        return result
    def finish(self,namespace,ticket,proof):
        assert self.database.depth==0
        self.events.append('finish')
        if self.short_ack:return {'finished':True}
        return {'finished':True,'mutation_id':ticket['mutation']['id'],**proof,
                'journalSequence':3,'journalDigest':'d'*64}
    def resolve(self,namespace,ticket):
        assert self.database.depth==0
        self.events.append('resolve')


class LedgerTests(unittest.TestCase):
    def fixture(self):
        database=DatabaseStub();controller=ControllerStub(database)
        return database,controller,PgRuntimeLedger(database,'synthetic',controller)

    def test_callbacks_outside_transaction_and_original_cas(self):
        database,controller,ledger=self.fixture();original={'namespace':'synthetic'}
        with ledger.transaction() as tx:
            self.assertIsNone(tx.get(KEY))
            tx.reserve_original(KEY,{'id':'synthetic'},original=original,signature_units=1,gas_units=9)
            tx.insert(KEY,{'original':original,'stage':'TRANSACTION_SIGNING'})
            row=tx.get(KEY);row['stage']='BROADCAST_UNKNOWN';tx.save(KEY,row)
        self.assertEqual(controller.events,['begin','finish'])
        saved=[request for method,request in database.calls if method=='ledger_save'][0]
        self.assertEqual(saved['expectedRevision'],1)
        self.assertEqual(saved['expectedRow']['stage'],'TRANSACTION_SIGNING')
        reserved=[request for method,request in database.calls if method=='ledger_reserve'][0]
        self.assertEqual((reserved['signatureUnits'],reserved['gasUnits']),('1','9'))

    def test_missing_floor_and_incomplete_terminal_ack_close(self):
        database,controller,ledger=self.fixture();controller.omit_global=True
        with self.assertRaisesRegex(LedgerRejected,'EXTERNAL_RESTORE_FLOOR_REQUIRED'):
            with ledger.transaction():pass
        self.assertEqual(database.calls,[])
        controller.omit_global=False;controller.short_ack=True
        with self.assertRaisesRegex(LedgerRejected,'EXTERNAL_RUNTIME_COMMIT_ACK_REQUIRED'):
            with ledger.transaction():pass
        self.assertEqual(controller.events[-2:],['finish','resolve'])

    def test_preflight_change_rejected_and_resolved_without_retry(self):
        database,controller,ledger=self.fixture()
        database.rows[KEY]=(1,{'original':{'namespace':'synthetic'},'stage':'TRANSACTION_SIGNING'})
        with self.assertRaisesRegex(LedgerRejected,'CAS_CONFLICT'):
            with ledger.transaction() as tx:
                row=tx.get(KEY)
                database.rows[KEY]=(2,{'original':{'namespace':'changed'},'stage':'TRANSACTION_SIGNING'})
                row['stage']='BROADCAST_UNKNOWN';tx.save(KEY,row)
        self.assertEqual(controller.events,['begin','resolve'])
        self.assertFalse(any(method=='ledger_seal' for method,_ in database.calls))

    def test_policy_uses_normalized_original_not_enriched_signer_record(self):
        database,controller,ledger=self.fixture()
        record={'namespace':'synthetic','registrationId':KEY[3],
                'original':{'chainId':KEY[1],'factory':KEY[2]}}
        database.approval={'original':deepcopy(record),'revision':1,'systemRole':'registrar'}
        with ledger.transaction(read_only=True) as tx:
            self.assertEqual(PgRuntimePolicy().authorize(tx,record,'registrar_lookup'),database.approval)
            self.assertIs(type(record['original']['chainId']),str)
            self.assertEqual(database.calls[-1][1]['key'],['registration',*KEY[1:]])
            with self.assertRaisesRegex(LedgerRejected,'IMMUTABLE_ORIGINAL_AUTHORIZATION'):
                PgRuntimePolicy().authorize(tx,{**record,'transaction':{'nonce':'0'}},'registrar_lookup')
            with self.assertRaisesRegex(LedgerRejected,'ACTION_FORBIDDEN'):
                PgRuntimePolicy().authorize(tx,record,'operation_sign')
        self.assertEqual(controller.events,['begin'])

    def test_business_integer_chain_keys_match_actual_runtime_helpers(self):
        # Only import the pure domain's definitions and call its key/approval
        # helpers. No runtime, signer, broadcaster or codec is constructed.
        path=Path(__file__).parents[1]/'business'/'private_runtime.py'
        spec=importlib.util.spec_from_file_location('private_runtime_policy_check',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        for quote in (True,False):
            for chain_id in (31337,2**53-1):
                with self.subTest(quote=quote,chain_id=chain_id):
                    database,controller,ledger=self.fixture()
                    binding={'chainId':chain_id,'escrow':KEY[2]}
                    record={'namespace':'synthetic','binding':binding,'escrowCodeHash':KEY[3],
                        'chainProfileDigest':KEY[3],'quoteId' if quote else 'opId':KEY[3]}
                    database.approval={'original':deepcopy(record),'revision':1,'profile':{
                        'binding':deepcopy(binding),'escrowCodeHash':KEY[3],'chainProfileDigest':KEY[3]}}
                    original=deepcopy(record)
                    with ledger.transaction(read_only=True) as tx:
                        approval=module.PrivateBusinessRuntime._approval(
                            SimpleNamespace(policy=PgRuntimePolicy()),tx,record,
                            'quote_lookup' if quote else 'operation_lookup')
                        self.assertEqual(tuple(database.calls[-1][1]['key']),
                            module.PrivateBusinessRuntime._key(record,quote=quote))
                        self.assertIs(type(approval['original']['binding']['chainId']),int)
                        self.assertIs(type(approval['profile']['binding']['chainId']),int)
                    self.assertEqual(record,original)

    def test_business_chain_normalization_rejects_bool_and_non_safe_integer(self):
        for quote in (True,False):
            for chain_id in (True,False,'31337',31337.0,0,-1,2**53):
                with self.subTest(quote=quote,chain_id=chain_id):
                    database,controller,ledger=self.fixture()
                    record={'namespace':'synthetic','binding':{'chainId':chain_id,'escrow':KEY[2]},
                            'quoteId' if quote else 'opId':KEY[3]}
                    with ledger.transaction(read_only=True) as tx:
                        with self.assertRaisesRegex(LedgerRejected,'INVALID_ORIGINAL_LEDGER_KEY'):
                            PgRuntimePolicy().authorize(tx,record,'quote_lookup' if quote else 'operation_lookup')
                    self.assertFalse(any(method=='ledger_authorization' for method,_ in database.calls))

    def test_sql_source_allowlist_and_original_only_guards(self):
        sql=Path(__file__).with_name('runtime-ledger.sql').read_text()
        names=set(re.findall(r'CREATE FUNCTION c1_runtime_internal\.(\w+)\(',sql))
        self.assertEqual(names,RUNTIME_METHODS|CONTROLLER_METHODS)
        self.assertIn('FULL REPLACEMENT',sql)
        self.assertNotIn('CREATE TABLE c1_private.private_execution_grants',sql)
        self.assertIn("current_setting('transaction_isolation')<>'serializable'",sql)
        self.assertIn('ORIGINAL_RUNTIME_MUTATION_ALREADY_SEALED',sql)
        self.assertIn('ORIGINAL_LEDGER_CAS_CONFLICT',sql)
        self.assertIn("'reserved',true,'replay',true",sql)
        self.assertIn('NEW.signature_spent<OLD.signature_spent',sql)
        self.assertIn('PRIMARY KEY(chain_id,system_account,nonce)',sql)
        self.assertIn("t->'checkpoint'->'globalFloors' IS DISTINCT FROM global_floors()",sql)
        self.assertNotRegex(sql,r'(?i)\b(?:DELETE|TRUNCATE|DROP|EXECUTE\s+FORMAT)\b')
        self.assertIn('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_runtime_internal FROM PUBLIC',sql)


if __name__=='__main__':unittest.main()
