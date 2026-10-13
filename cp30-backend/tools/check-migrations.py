"""Validate migrations only in a registered, never-fixtured owned initializer."""
import importlib.util,json,os,secrets,sys,time
from pathlib import Path
from owned import initialization_connections,write_marker
import psycopg
from psycopg import sql
spec=importlib.util.spec_from_file_location('localrun',Path(__file__).with_name('local-run.py'));local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
run=Path(sys.argv[1]);connections,connkw,marker,identity=initialization_connections(run,psycopg)
for connection in connections:connection.close()
credentials={}
with psycopg.connect(**connkw,dbname='postgres',autocommit=True) as conn:
 for role in local.RUNTIME_ROLES:
  password=secrets.token_hex(32);credentials[role]=password
  conn.execute(sql.SQL('ALTER ROLE {} PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
for database in ['c1_business','c1_authority']:
 with psycopg.connect(**connkw,dbname=database,autocommit=True) as conn:
  # This tool is initialization-only, never allowed once any fixture or case exists.
  for schema in ['c1_api','c1_private','c1_authority']:conn.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(schema)))
  paths=sorted((local.ROOT/'migrations').glob('[0-9]*.sql')) if database=='c1_business' else [local.ROOT/'migrations/authority.sql']
  for path in paths:
   try:conn.execute(path.read_text())
   except Exception as exc:print(json.dumps({'status':'MIGRATION_FAILED','file':path.name,'sqlstate':exc.sqlstate,'diagnostic':str(exc).splitlines()[0]}));sys.exit(1)
  schema='c1_api' if database=='c1_business' else 'c1_authority'
  conn.execute(sql.SQL('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA {} FROM PUBLIC').format(sql.Identifier(schema)))
  for oid,fn in conn.execute('SELECT oid,proname FROM pg_proc WHERE pronargs=2 AND proargtypes=\'25 3802\'::oidvector AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname=%s)',(schema,)).fetchall():
   owner='c1_auth_code_owner' if database=='c1_authority' else 'c1_projection_code_owner' if fn in local.RECONCILER_METHODS+local.SOURCE_METHODS+['execution_commit'] else 'c1_auth_code_owner' if fn=='journal_anchor' or fn.startswith(('security_','auth_','fixture_','execution_','restore_')) else 'c1_api_code_owner'
   conn.execute(sql.SQL('ALTER FUNCTION {}.{}(text,jsonb) OWNER TO {}').format(sql.Identifier(schema),sql.Identifier(fn),sql.Identifier(owner)))
  if database=='c1_business':
   groups={'c1_api_a':local.API_METHODS,'c1_api_b':local.API_METHODS,'c1_worker_a':local.WORKER_METHODS,'c1_worker_b':local.WORKER_METHODS,'c1_controller':local.CONTROLLER_METHODS,'c1_fixture_identity':['fixture_assertion'],'c1_source_ingest':local.SOURCE_METHODS,'c1_reconciler':local.RECONCILER_METHODS}
   for owner in local.OWNERS[1:]:conn.execute(sql.SQL('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c1_private TO {}').format(sql.Identifier(owner)))
  else:groups={'c1_source_service':local.AUTH_SOURCE,'c1_controller_authority':local.AUTH_CONTROL,'c1_reconciler_authority':local.AUTH_RECONCILER,'c1_actor_payer':['fixture_actor'],'c1_actor_owner':['fixture_actor']}
  existing={r[0] for r in conn.execute('SELECT proname FROM pg_proc WHERE pronargs=2 AND proargtypes=\'25 3802\'::oidvector AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname=%s)',(schema,)).fetchall()}
  for role,methods in groups.items():
   conn.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(database),sql.Identifier(role)));conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(role)))
   for method in methods:
    if method in existing:conn.execute(sql.SQL('GRANT EXECUTE ON FUNCTION {}.{}(text,jsonb) TO {}').format(sql.Identifier(schema),sql.Identifier(method),sql.Identifier(role)))
  for owner in local.OWNERS[1:]:conn.execute(sql.SQL('GRANT USAGE ON SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(owner)))
  for owner in local.OWNERS[1:]:conn.execute(sql.SQL('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA {} TO {}').format(sql.Identifier(schema),sql.Identifier(owner)))
settings={'run':str(run),'run_id':run.name,'cluster_id':marker['cluster_id'],'mode':'C1_SYNTHETIC_LOOPBACK','created':time.time(),'roles':{role:{'host':str(run/'s'),'port':5432,'dbname':'c1_authority' if role in {'c1_source_service','c1_controller_authority','c1_reconciler_authority','c1_actor_payer','c1_actor_owner'} else 'c1_business','user':role,'password':password,'application_name':role+'-'+run.name} for role,password in credentials.items()},'bootstrap':connkw}
(run/'runtime-private.json').write_text(json.dumps(settings));os.chmod(run/'runtime-private.json',0o600);marker['phase']='INITIALIZED';write_marker(run,marker);print(json.dumps({'status':'MIGRATIONS_LOADED','files':len(paths)}))
