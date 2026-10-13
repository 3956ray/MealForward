"""Actual runtime-role SQL denials; every attempted mutation is rolled back."""
import argparse,json,sys
import psycopg
from psycopg import sql
from smoke import Harness,IntegrationFailure

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
    h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        # The test driver uses at most one connection during this matrix.
        h.b.close();h.a.close()
        for role,config in h.settings['roles'].items():
            authority=config['dbname']=='c1_authority'
            schema,table=('c1_authority','namespaces') if authority else ('c1_private','sessions')
            connect={k:v for k,v in config.items() if k in {'host','port','dbname','user','password','application_name'}}
            with psycopg.connect(**connect,connect_timeout=2,autocommit=True,options='-c statement_timeout=3000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000') as connection:
                flags=connection.execute('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
                if any(flags):raise IntegrationFailure('ROLE_FLAGS')
                checks=[
                    ('private_select',sql.SQL('SELECT * FROM {}.{} LIMIT 0').format(sql.Identifier(schema),sql.Identifier(table))),
                    ('private_update',sql.SQL('UPDATE {}.{} SET ns=ns WHERE false').format(sql.Identifier(schema),sql.Identifier(table))),
                    ('private_insert',sql.SQL("INSERT INTO {}.{}(ns) SELECT 'synthetic-denial' WHERE false").format(sql.Identifier(schema),sql.Identifier(table))),
                    ('public_create','CREATE TABLE public.c1_denial_probe(x int)'),
                    ('temp_create','CREATE TEMP TABLE c1_denial_probe(x int)'),
                    ('owner_escalation','SET ROLE c1_table_owner'),
                    ('bootstrap_escalation','SET ROLE c1_bootstrap'),
                    ('auth_catalog','SELECT rolpassword FROM pg_authid WHERE false'),
                    ('role_creation','CREATE ROLE c1_denial_probe NOLOGIN'),
                ]
                if role.startswith('c1_api_') or role.startswith('c1_worker_') or role=='c1_reconciler':
                    checks.append(('fixture_execution',"SELECT c1_api.fixture_init('synthetic-denial','{}'::jsonb)"))
                if role.startswith('c1_worker_'):
                    checks.append(('worker_settlement',"SELECT c1_api.settle_confirm('synthetic-denial','{}'::jsonb)"))
                if role=='c1_source_service' or role=='c1_reconciler_authority':
                    checks.append(('actor_impersonation',"SELECT c1_authority.fixture_actor('synthetic-denial','{}'::jsonb)"))
                denials=[]
                for label,query in checks:
                    connection.execute('BEGIN')
                    code=None
                    try:connection.execute(query)
                    except psycopg.Error as exc:code=exc.sqlstate
                    finally:connection.execute('ROLLBACK')
                    if code!='42501':raise IntegrationFailure('ROLE_DENIAL:'+role+':'+label)
                    denials.append({'operation':label,'sqlstate':code})
                h.records.append({'scenario':'C13-runtime-role-denials','role':role,'status':'PASS','denials':denials,'privilegeFlags':list(flags)})
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='ROLE_EXCEPTION:'+type(exc).__name__
    finally:
        try:h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
