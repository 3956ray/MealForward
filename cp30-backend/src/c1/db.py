"""Fixed-function, structured PostgreSQL access; no ambient configuration."""
from __future__ import annotations
import json
from contextlib import contextmanager
import logging
logging.getLogger('psycopg.pool').disabled=True
import re
import sys
import psycopg
from pathlib import Path
from psycopg import sql
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

BUSINESS = frozenset('journal_anchor restore_material_list restore_status restore_install restore_proof restore_finish content_material content_verify review_material intent_retry stage_actor execution_fence execution_clear '.split()) | frozenset('fixture_init fixture_assertion fixture_identity fixture_grant fixture_payer fixture_clock fixture_fault fixture_snapshot security_reserve security_prepare security_apply security_proof security_finish security_abort security_abort_finish security_startup auth_pre_session auth_login auth_me auth_touch public_stores public_meals public_meal public_ledger public_image my_orders order_get intent_get support_review support_confirm refund_review refund_confirm claim_review claim_confirm my_vouchers voucher_get draft_get draft_save draft_image draft_review draft_publish control_confirm workbench code_check lock_confirm handover_confirm case_get payouts settle_review settle_confirm claim_job stage_job job_query continuation cancel_begin cancel_finish source_ticket receipt_ingest receipt_list apply_receipt observer_status restore_begin restore_check rate_limit'.split())
AUTHORITY = frozenset('journal_anchor restore_status restore_install restore_proof restore_finish fixture_init fixture_clock fixture_actor execution_view ticket_register ticket_query ticket_close actor_confirm execution_reserve execution_prepare execution_commit execution_proof execution_finish execution_abort receipt_list receipt_get checkpoint startup_check'.split())
READ_MODELS=frozenset('journal_anchor restore_material_list restore_status restore_proof content_material auth_me public_stores public_meals public_meal public_ledger public_image my_orders order_get intent_get my_vouchers voucher_get draft_get workbench case_get payouts receipt_list receipt_get source_ticket fixture_snapshot'.split())
ONBOARDING_API=frozenset('onboarding_authorize onboarding_get_by_key onboarding_get_by_id onboarding_insert onboarding_save onboarding_reserve_slot onboarding_enqueue onboarding_image_save onboarding_image_get onboarding_public_catalog onboarding_public_image wallet_material wallet_attempt_begin wallet_transaction_observe'.split())
ONBOARDING_INTERNAL=frozenset('registration_get registration_save registration_publish registration_authorize registration_next factory_capacity wallet_session wallet_challenge_create wallet_challenge_get wallet_login_status wallet_login_material'.split())
ONBOARDING_API=ONBOARDING_API | {'onboarding_list_owned'}
BUSINESS=BUSINESS | ONBOARDING_API
RUNTIME_METHODS=frozenset('ledger_open ledger_get ledger_insert ledger_save ledger_reserve ledger_seal ledger_authorization registrar_admission_material registrar_admit live_api live_material live_result live_projection live_approval business_admission_material business_admit business_fence business_provision first_binding_material first_binding_begin first_binding_finish'.split())
RUNTIME_CONTROLLER_METHODS=frozenset('ledger_status ledger_proof ledger_finish ledger_abort ledger_abort_finish runtime_clock'.split())
RUNTIME_METHODS=RUNTIME_METHODS | {'live_draft','live_catalog_image'}

class DatabaseRejected(ValueError):
    def __init__(self,code,status=409):
        self.code,self.status=code,status
        super().__init__(code)

class FixedTransaction:
    def __init__(self,database,connection,namespace,read_only=False):
        self.database,self.connection,self.namespace,self.read_only=database,connection,namespace,read_only
    def call(self,method,request=None):
        allowed,schema=self.database.methods()
        if method not in allowed:raise DatabaseRejected('UNSUPPORTED_METHOD',422)
        value=self.connection.execute(sql.SQL('SELECT {}.{}(%s,%s)').format(sql.Identifier(schema),sql.Identifier(method)),(self.namespace,Jsonb(request or {}))).fetchone()[0]
        if value is None:raise DatabaseRejected('NOT_FOUND',404)
        if value.get('error'):raise DatabaseRejected(value['error'],value.get('status',409))
        return value

class Database:
    def __init__(self, config, role=None, database='business', *, max_size=1):
        if isinstance(config, (str, Path)):
            config = json.loads(Path(config).read_text())
        role_config = config['db'][role or database]
        self.database = database
        self.runtime_ledger_protocol='CP30_RUNTIME_LEDGER_DB_V1' if database=='runtime_internal' else None
        self.pool = ConnectionPool(conninfo='', kwargs=dict(host=role_config['host'], port=role_config['port'], dbname=role_config['dbname'], user=role_config['user'], password=role_config['password'], connect_timeout=2, application_name=role_config['application_name'], options='-c statement_timeout=3000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000'), min_size=0, max_size=max_size, timeout=2, open=True)
    def methods(self):
        if self.database=='identity_security':return frozenset('identity_security_checkpoint journal_anchor security_startup security_reserve security_prepare security_apply security_proof security_finish security_abort security_abort_finish'.split()),'c1_api'
        if self.database=='runtime_internal':return RUNTIME_METHODS,'c1_runtime_internal'
        if self.database=='runtime_controller':return RUNTIME_CONTROLLER_METHODS,'c1_runtime_internal'
        if self.database=='onboarding_internal':return ONBOARDING_INTERNAL,'c1_onboarding_internal'
        return (BUSINESS,'c1_api') if self.database=='business' else (AUTHORITY,'c1_authority')
    @contextmanager
    def transaction(self,namespace,*,read_only=False):
        # No user-supplied SQL and no automatic retry of uncertain mutations.
        try:
            with self.pool.connection(timeout=2) as conn:
                with conn.transaction():
                    # Mutations lock the namespace guard, binding, original row
                    # and cross-namespace factory capacity inside fixed functions.
                    conn.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY' if read_only else 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
                    yield FixedTransaction(self,conn,namespace,read_only)
        except psycopg.Error as exc:
            primary=getattr(getattr(exc,'diag',None),'message_primary','')
            code=primary if exc.sqlstate=='P0001' and re.fullmatch('[A-Z_]{1,64}',primary) else 'DB_UNAVAILABLE'
            raise DatabaseRejected(code,{'UNAUTHENTICATED':401,'CSRF':403,'NOT_FOUND':404,'NOT_CONFIGURED':503,'DB_UNAVAILABLE':503}.get(code,409)) from None
    def call(self, method, namespace, request=None):
        allowed,schema = self.methods()
        if method not in allowed:
            raise ValueError('UNSUPPORTED_METHOD')
        try:
            with self.pool.connection(timeout=2) as conn:
                with conn.transaction():
                    if method in READ_MODELS:
                        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                    value = conn.execute(sql.SQL('SELECT {}.{}(%s,%s)').format(sql.Identifier(schema), sql.Identifier(method)), (namespace, Jsonb(request or {}))).fetchone()[0]
                    return value if value is not None else {'error':'NOT_FOUND','status':404}
        except psycopg.Error as exc:
            primary=getattr(getattr(exc,'diag',None),'message_primary','')
            code=primary if exc.sqlstate=='P0001' and re.fullmatch('[A-Z_]{1,64}',primary) else 'DB_UNAVAILABLE'
            print('C1_DIAGNOSTIC '+json.dumps({'component':'database','method':method,'sqlstate':exc.sqlstate,'code':code}),file=sys.stderr,flush=True)
            status={'UNAUTHENTICATED':401,'CSRF':403,'FORBIDDEN':403,'NOT_FOUND':404,'INVALID_INTEGER':422,'INVALID_WINDOWS':422,'INVALID_BODY':422,'INVALID_KEY':422,'UNAVAILABLE':503,'FENCE_PENDING':503,'DB_UNAVAILABLE':503,'QUEUE_FULL':429,'CONTENT_UNAVAILABLE':503}.get(code,409)
            return {'error':code,'status':status}
    def close(self):
        self.pool.close()
