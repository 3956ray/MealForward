"""Owned PG bootstrap, strict function privileges, fixed isolated runtimes."""
import argparse,json,os,secrets,subprocess,sys,time,hashlib
from pathlib import Path
from owned import scope,write_marker,pg_identity,private_file
ROOT=Path(__file__).resolve().parents[1]
PG='/opt/homebrew/bin/'
RUNTIME_ROLES=['c1_api_a','c1_api_b','c1_worker_a','c1_worker_b','c1_reconciler','c1_source_ingest','c1_fixture_identity','c1_controller','c1_source_service','c1_actor_payer','c1_actor_owner','c1_controller_authority','c1_reconciler_authority']
OWNERS=['c1_table_owner','c1_api_code_owner','c1_auth_code_owner','c1_projection_code_owner']
API_METHODS='content_material content_verify review_material intent_retry auth_pre_session auth_me auth_touch security_apply public_stores public_meals public_meal public_ledger public_image my_orders order_get intent_get support_review support_confirm refund_review refund_confirm claim_review claim_confirm my_vouchers voucher_get draft_get draft_save draft_image draft_review draft_publish control_confirm workbench code_check handover_confirm case_get payouts settle_review settle_confirm rate_limit'.split()
WORKER_METHODS='content_material content_verify claim_job stage_job job_query continuation'.split()
CONTROLLER_METHODS='journal_anchor restore_material_list restore_status restore_install restore_proof restore_finish content_material content_verify fixture_init fixture_assertion fixture_clock fixture_fault fixture_snapshot security_reserve security_prepare security_apply security_proof security_finish security_abort security_abort_finish security_startup stage_actor cancel_begin cancel_finish execution_fence execution_clear'.split()
SOURCE_METHODS='source_ticket receipt_ingest'.split()
RECONCILER_METHODS='content_material content_verify receipt_list apply_receipt observer_status'.split()
AUTH_SOURCE='ticket_register execution_view execution_commit execution_proof ticket_query ticket_close'.split()
AUTH_CONTROL='journal_anchor restore_status restore_install restore_proof restore_finish fixture_init fixture_clock fixture_actor ticket_register execution_reserve execution_prepare execution_proof execution_finish execution_abort ticket_query ticket_close startup_check'.split()
AUTH_RECONCILER=['receipt_get','startup_check']
def start(run):
    import psycopg
    from psycopg import sql
    os.umask(0o077);run,marker=scope(run,phases=('RUNTIME_READY','INITIALIZING'));marker['phase']='INITIALIZING';marker['cluster_id']=marker.get('cluster_id',secrets.token_hex(16));write_marker(run,marker)
    env={'PATH':'/usr/bin:/bin:/opt/homebrew/bin','HOME':str(run/'home'),'LC_ALL':'C'}
    if not (run/'pg').exists():
        pw=secrets.token_hex(32);(run/'bootstrap-password').write_text(pw+'\n');(run/'s').mkdir(mode=0o700)
        subprocess.run([PG+'initdb','-D',str(run/'pg'),'-U','c1_bootstrap','--pwfile',str(run/'bootstrap-password'),'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--locale=C'],env=env,check=True,capture_output=True)
        with (run/'pg/postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(run/'s')+"'\nmax_connections=24\nshared_buffers=64MB\nwork_mem=4MB\nfsync=on\nfull_page_writes=on\nsynchronous_commit=on\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length=0\nlog_parameter_max_length_on_error=0\nlog_connections=off\nlog_disconnections=off\n")
    else:
        # Resume only a failed initializer, never a running/tested database.
        assert not (run/'runtime-private.json').exists() and not (run/'pg/postmaster.pid').exists()
        pw=(run/'bootstrap-password').read_text().strip()
    subprocess.run([PG+'pg_ctl','-D',str(run/'pg'),'-l',str(run/'pg.log'),'start','-w','-t','10'],env=env,check=True,capture_output=True)
    pgpid=int((run/'pg/postmaster.pid').read_text().splitlines()[0]);(run/'owned-pids.json').write_text(json.dumps({'pg':pg_identity(run),'apps':[]}))
    connkw=dict(host=str(run/'s'),port=5432,user='c1_bootstrap',password=pw,connect_timeout=2)
    credentials={}
    with psycopg.connect(**connkw,dbname='postgres',autocommit=True) as conn:
        for name in OWNERS:conn.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name)))
        for name in RUNTIME_ROLES:
            password=secrets.token_hex(32);credentials[name]=password
            conn.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name),sql.Literal(password)))
        for database in ['c1_business','c1_authority']:
            conn.execute(sql.SQL('CREATE DATABASE {} OWNER c1_table_owner').format(sql.Identifier(database)))
            conn.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(sql.Identifier(database)))
    for database in ['c1_business','c1_authority']:
        with psycopg.connect(**connkw,dbname=database,autocommit=True) as conn:
            paths=sorted((ROOT/'migrations').glob('[0-9]*.sql')) if database=='c1_business' else [ROOT/'migrations/authority.sql']
            for path in paths:
                try:conn.execute(path.read_text())
                except Exception as exc:raise RuntimeError('MIGRATION_FAILED:'+path.name+':'+getattr(exc,'sqlstate','UNKNOWN')+':'+str(exc).splitlines()[0]) from None
            schema='c1_api' if database=='c1_business' else 'c1_authority'
            conn.execute(sql.SQL('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA {} FROM PUBLIC').format(sql.Identifier(schema)))
            # All function owners NOLOGIN; runtime cannot SET ROLE to them.
            for oid,fn in conn.execute('SELECT oid,proname FROM pg_proc WHERE pronargs=2 AND proargtypes=\'25 3802\'::oidvector AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname=%s)',(schema,)).fetchall():
                owner='c1_auth_code_owner' if database=='c1_authority' else 'c1_projection_code_owner' if fn in RECONCILER_METHODS+SOURCE_METHODS+['execution_commit'] else 'c1_auth_code_owner' if fn=='journal_anchor' or fn.startswith(('security_','auth_','fixture_','execution_','restore_')) else 'c1_api_code_owner'
                conn.execute(sql.SQL('ALTER FUNCTION {}.{}(text,jsonb) OWNER TO {}').format(sql.Identifier(schema),sql.Identifier(fn),sql.Identifier(owner)))
            if database=='c1_business':
                groups={'c1_api_a':API_METHODS,'c1_api_b':API_METHODS,'c1_worker_a':WORKER_METHODS,'c1_worker_b':WORKER_METHODS,'c1_controller':CONTROLLER_METHODS,'c1_fixture_identity':['fixture_assertion'],'c1_source_ingest':SOURCE_METHODS,'c1_reconciler':RECONCILER_METHODS}
                for owner in OWNERS[1:]:conn.execute(sql.SQL('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c1_private TO {}').format(sql.Identifier(owner)))
            else:groups={'c1_source_service':AUTH_SOURCE,'c1_controller_authority':AUTH_CONTROL,'c1_reconciler_authority':AUTH_RECONCILER,'c1_actor_payer':['fixture_actor'],'c1_actor_owner':['fixture_actor']}
            existing={row[0] for row in conn.execute('SELECT proname FROM pg_proc WHERE pronargs=2 AND proargtypes=\'25 3802\'::oidvector AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname=%s)',(schema,)).fetchall()}
            for role,methods in groups.items():
                conn.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(database),sql.Identifier(role)))
                conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(role)))
                for method in methods:
                    if method not in existing:continue
                    conn.execute(sql.SQL('GRANT EXECUTE ON FUNCTION {}.{}(text,jsonb) TO {}').format(sql.Identifier(schema),sql.Identifier(method),sql.Identifier(role)))
            # Code owners may call each other only through fixed internal helpers;
            # broad runtime function grants are never used.
            for owner in OWNERS[1:]:conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(owner)))
            for owner in OWNERS[1:]:conn.execute(sql.SQL('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(owner)))
    settings={'run':str(run),'run_id':run.name,'cluster_id':marker['cluster_id'],'mode':'C1_SYNTHETIC_LOOPBACK','created':time.time(),'roles':{role:{'host':str(run/'s'),'port':5432,'dbname':'c1_authority' if role in {'c1_source_service','c1_controller_authority','c1_reconciler_authority','c1_actor_payer','c1_actor_owner'} else 'c1_business','user':role,'password':password,'application_name':role+'-'+run.name} for role,password in credentials.items()},'bootstrap':connkw}
    (run/'runtime-private.json').write_text(json.dumps(settings));marker['phase']='INITIALIZED';write_marker(run,marker);print(json.dumps({'status':'PG_INITIALIZED','run':str(run),'pid':pgpid,'databases':2,'tcpListeners':0}))
def stop(run):
    run,marker=scope(run,phases=('INITIALIZING','INITIALIZED','SEALED','STOPPED'),legacy_stop=True)
    pidfile=run/'pg/postmaster.pid'
    if pidfile.exists():
        owner=json.loads(private_file(run/'owned-pids.json').read_text());pg_identity(run,owner['pg']);assert not owner.get('apps')
        subprocess.run([PG+'pg_ctl','-D',str(run/'pg'),'stop','-m','fast','-w','-t','10'],env={},check=True,capture_output=True)
    marker['phase']='STOPPED';write_marker(run,marker);print(json.dumps({'status':'OWNED_PG_STOPPED'}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop']);p.add_argument('run');a=p.parse_args();globals()[a.action](a.run)
