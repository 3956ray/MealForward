"""Independent connection setup. Source-only in this delivery; no implicit activation.

prepare: fresh owned directory, disabled plan; initialize: fresh PG + source schema,
external HEADER and reviewed registrar profile/grant; start/stop: own private hosts.
There is no restore, reset, grant-refill, journal-recreation or key-generation action.
"""
import argparse,fcntl,hashlib,json,os,re,secrets,signal,stat,subprocess,sys,time
from contextlib import contextmanager
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from c1.registrar_signer_journal import canonical,owned_directory,word_hash,OriginalSignerJournal
from c1.runtime_ledger_controller import RuntimeLedgerJournal
BASE_OWNERS=('c1_table_owner','c1_api_code_owner','c1_auth_code_owner','c1_projection_code_owner')
RUNTIME_GROUPS=('c1_runtime_table_owner','c1_runtime_code_owner','c1_runtime_policy_owner','c1_runtime_controller_code_owner','c1_runtime_executor','c1_runtime_controller','c1_runtime_registrar_admission','c1_live_code_owner','c1_live_api','c1_live_observer','c1_business_private','c1_app_api','c1_identity_security','c1_identity_authority','c1_registration_worker','c1_auto_binding')
COMPAT_GROUPS=('c1_api_a','c1_api_b','c1_worker_a','c1_worker_b','c1_controller','c1_reconciler')
LOGINS=('c1_registrar_login','c1_ledger_controller_login')
SQL_PIN='63d49ac17054446e51c7474db2c45f54bd20a7fe4d4adcc4658b92554cd3331c'
ADAPTER_PIN='e96804a599fb815eaebcc37e52e7aa2777134aee2f20a7fef4bc6a94c6c4bf12'
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(canonical(value)+b'\n');f.flush();os.fsync(f.fileno())
    fd=os.open(Path(path).parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def private_json(path):
    path=Path(path);info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size>262144:raise ValueError('PRIVATE_CONFIGURATION_REQUIRED')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:return json.load(f)
def marker(run):
    run=owned_directory(run);m=private_json(run/'CONNECTION-OWNED.json')
    if m.get('owner')!=os.getuid() or m.get('run')!=str(run) or m.get('protocol')!='CP30_CONNECTION_BOOTSTRAP_V1':raise ValueError('FRESH_CONNECTION_RUN_REQUIRED')
    return run,m
def prepare(run):
    run=Path(run)
    if not run.is_absolute() or run.resolve()!=run or run.exists() or len(str(run/'socket/registrar.sock').encode())>103 or any(c in str(run) for c in '\n\r\t') or ROOT.parent==run or ROOT in run.parents:raise ValueError('NEW_EXTERNAL_DIRECTORY_REQUIRED')
    os.umask(0o077);run.mkdir(mode=0o700)
    for name in ('socket','registrar','ledger','logs'): (run/name).mkdir(mode=0o700)
    write(run/'CONNECTION-OWNED.json',{'protocol':'CP30_CONNECTION_BOOTSTRAP_V1','owner':os.getuid(),'run':str(run),'id':secrets.token_hex(16),'created':int(time.time())})
    # The key handle is a fresh, empty SLOT. Setup never reads or generates a key.
    fd=os.open(run/'registrar/registrar.key',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd)
    write(run/'plan.disabled.json',{'mode':'CP30_REGISTRAR_RUNTIME','enabled':False,'namespace':None,'profile':None,'grant':None,'transactionLimits':None,'rpc':None,
        'postgresBin':None,'pythonExecutable':None,'keyHandle':str(run/'registrar/registrar.key'),
        'required':'Explicit reviewed non-secret profile, expiry and signature/gas caps; installed pinned Python runtime; fresh dedicated key provisioned internally before activation.'})
    return {'status':'NOT_CONFIGURED','run':str(run)}
def validate_plan(plan,run):
    if plan.get('mode')!='CP30_REGISTRAR_RUNTIME' or plan.get('enabled') is not True:raise ValueError('EXPLICIT_REVIEWED_ACTIVATION_REQUIRED')
    if not re.fullmatch('[a-z][a-z0-9_-]{0,63}',str(plan.get('namespace'))):raise ValueError('EXPLICIT_NAMESPACE_REQUIRED')
    profile=plan['profile']
    if plan.get('application'):
        from c1.full_configuration import validate_application
        validate_application(plan['application'],profile)
    for field in ('factory','registrar','asset','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority'):
        if not re.fullmatch('0x[0-9a-f]{40}',str(profile.get(field))) or int(profile[field],16)==0:raise ValueError('FIXED_PROFILE_REQUIRED')
    for field in ('genesisHash','factoryCodeHash','chainProfileDigest','escrowCreationCodeHash'):
        if not re.fullmatch('0x[0-9a-f]{64}',str(profile.get(field))) or int(profile[field],16)==0:raise ValueError('FIXED_PROFILE_REQUIRED')
    if type(profile.get('chainId')) is not str or not re.fullmatch('[1-9][0-9]{0,15}',profile.get('chainId')) or int(profile['chainId'])>2**53-1:raise ValueError('FIXED_CHAIN_REQUIRED')
    if not isinstance(profile.get('runtimeTemplatePins'),dict) or not re.fullmatch('0x[0-9a-f]{64}',str(profile['runtimeTemplatePins'].get('factory'))):raise ValueError('FIXED_FACTORY_TEMPLATE_REQUIRED')
    grant=plan['grant'];limits=plan['transactionLimits']
    if set(limits)!={'gas','maxFeePerGas','maxPriorityFeePerGas'} or any(type(v) is not str or not re.fullmatch('[1-9][0-9]{0,77}',v) for v in limits.values()):raise ValueError('CANONICAL_TRANSACTION_LIMITS_REQUIRED')
    for field in ('signatureUnits','gasUnits'):
        if type(grant.get(field)) is not str or not re.fullmatch('[1-9][0-9]{0,77}',grant[field]) or int(grant[field])>=2**256:raise ValueError('EXPLICIT_BUDGET_REQUIRED')
    if type(grant.get('expiresAt')) is not int or not int(time.time())<grant['expiresAt']<=int(time.time())+86400 or not re.fullmatch('[a-zA-Z0-9_-]{1,64}',str(grant.get('id'))):raise ValueError('BOUNDED_GRANT_REQUIRED')
    if int(limits['maxPriorityFeePerGas'])>int(limits['maxFeePerGas']) or int(limits['gas'])*int(limits['maxFeePerGas'])>int(grant['gasUnits']):raise ValueError('GAS_CAP_REQUIRED')
    if Path(plan['keyHandle'])!=run/'registrar/registrar.key':raise ValueError('NEW_DEDICATED_KEY_HANDLE_REQUIRED')
    info=Path(plan['keyHandle']).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or not 64<=info.st_size<=67:raise ValueError('NEW_DEDICATED_KEY_HANDLE_REQUIRED')
    if not Path(plan['postgresBin']).is_absolute() or not Path(plan['pythonExecutable']).is_absolute():raise ValueError('EXPLICIT_EXECUTABLES_REQUIRED')
    from c1.registrar_rpc import RegistrarRpc
    RegistrarRpc({**plan['rpc'],'factory':profile['factory'],'registrar':profile['registrar'],'factorySelectors':[],'broadcastEnabled':False})
    if digest(ROOT/'migrations/019-private-original-ledger.sql')!=SQL_PIN or digest(ROOT/'integrations/persistence/pg_runtime_ledger.py')!=ADAPTER_PIN:raise ValueError('FINAL_LEDGER_PIN_REQUIRED')
    return plan

def initialize(run,plan_path):
    run,m=marker(run);plan=validate_plan(private_json(plan_path),run)
    if Path(sys.executable).resolve()!=Path(plan['pythonExecutable']).resolve():raise ValueError('PINNED_PYTHON_RUNNER_REQUIRED')
    import importlib.metadata
    expected=dict(re.findall(r'^([A-Za-z0-9_-]+)==([0-9.]+)',(ROOT/'requirements-connection.lock').read_text(),re.MULTILINE))
    if any(importlib.metadata.version(name)!=version for name,version in expected.items()):raise ValueError('PINNED_CONNECTION_DEPENDENCIES_REQUIRED')
    if any((run/name).exists() for name in ('INITIALIZING.json','INSTALLED.json','pg','registrar/registrar-originals.jsonl','ledger/runtime-ledger.jsonl')):raise ValueError('FRESH_ONLY_NO_RETRY_OR_RESTORE')
    # A permanent attempt marker forbids replay even after a partial initializer.
    write(run/'INITIALIZING.json',{'planDigest':word_hash(plan),'id':m['id']})
    # Fixed public locale prevents macOS PG startup locale initialization issues;
    # PG children receive this one value, never inherited application configuration.
    pg=Path(plan['postgresBin']);version=subprocess.run([str(pg/'postgres'),'--version'],env={'LC_ALL':'C'},capture_output=True,check=True).stdout.decode()
    if not re.search(r'\b17\.11\b',version):raise ValueError('PG_17_11_REQUIRED')
    import psycopg
    from psycopg import sql
    from psycopg.types.json import Jsonb
    bootstrap_pw=secrets.token_hex(32)
    fd=os.open(run/'bootstrap-password',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:f.write(bootstrap_pw+'\n');f.flush();os.fsync(f.fileno())
    subprocess.run([str(pg/'initdb'),'-D',str(run/'pg'),'-U','c1_connection_bootstrap','--pwfile',str(run/'bootstrap-password'),'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--locale=C'],env={'LC_ALL':'C'},capture_output=True,check=True)
    with (run/'pg/postgresql.conf').open('a') as f:
        f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(run/'socket').replace("'","''")+"'\nmax_connections=24\nshared_buffers=64MB\nfsync=on\nfull_page_writes=on\nsynchronous_commit=on\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length=0\nlog_parameter_max_length_on_error=0\n")
    subprocess.run([str(pg/'pg_ctl'),'-D',str(run/'pg'),'-l',str(run/'logs/pg.log'),'start','-w','-t','10'],env={'LC_ALL':'C'},capture_output=True,check=True)
    pg_pid=int((run/'pg/postmaster.pid').read_text().splitlines()[0])
    write(run/'PG-OWNED.json',{'id':m['id'],'pid':pg_pid})
    try:
        common={'host':str(run/'socket'),'port':5432,'user':'c1_connection_bootstrap','password':bootstrap_pw,'connect_timeout':2}
        credentials={name:secrets.token_hex(32) for name in (*LOGINS,*(("c1_app_api_login","c1_identity_security_login","c1_identity_authority_login","c1_registration_worker_login","c1_auto_binding_login","c1_business_quote_login","c1_business_issuer_login","c1_business_operator_login","c1_live_gateway_login","c1_live_observer_login") if plan.get('application') else ()))}
        with psycopg.connect(**common,dbname='postgres',autocommit=True) as conn:
            for name in (*BASE_OWNERS,*RUNTIME_GROUPS,*COMPAT_GROUPS):conn.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name)))
            for name,pw in credentials.items():conn.execute(sql.SQL('CREATE ROLE {} LOGIN INHERIT PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name),sql.Literal(pw)))
            conn.execute('CREATE DATABASE c1_connection OWNER c1_table_owner');conn.execute('REVOKE ALL ON DATABASE c1_connection FROM PUBLIC')
        namespace=plan['namespace'];profile=plan['profile'];grant=plan['grant'];now=int(time.time());journal=None
        try:
            with psycopg.connect(**common,dbname='c1_connection') as conn:
                conn.execute('GRANT CREATE ON DATABASE c1_connection TO c1_runtime_table_owner')
                for path in [*sorted((ROOT/'migrations').glob('[0-9]*.sql')),*sorted((ROOT/'connection-migrations').glob('[0-9]*.sql'))]:conn.execute(path.read_text())
                conn.execute('REVOKE CREATE ON DATABASE c1_connection FROM c1_runtime_table_owner')
                # Remove bootstrap-superuser ownership from all callable C1 API functions.
                for fn, in conn.execute("SELECT proname FROM pg_proc WHERE pronargs=2 AND proargtypes='25 3802'::oidvector AND pronamespace='c1_api'::regnamespace").fetchall():
                    owner='c1_auth_code_owner' if fn.startswith(('auth_','security_','fixture_','execution_','restore_')) or fn in {'journal_anchor','identity_security_checkpoint'} else 'c1_api_code_owner'
                    conn.execute(sql.SQL('ALTER FUNCTION c1_api.{}(text,jsonb) OWNER TO {}').format(sql.Identifier(fn),sql.Identifier(owner)))
                # No fixture initialization, synthetic identity/store/balance or old dispatch grant.
                for owner in BASE_OWNERS[1:]:
                    conn.execute(sql.SQL('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c1_private TO {}').format(sql.Identifier(owner)))
                conn.execute('GRANT c1_runtime_executor,c1_runtime_registrar_admission TO c1_registrar_login WITH INHERIT TRUE')
                conn.execute('GRANT c1_runtime_controller TO c1_ledger_controller_login WITH INHERIT TRUE')
                conn.execute('GRANT CONNECT ON DATABASE c1_connection TO c1_registrar_login,c1_ledger_controller_login')
                conn.execute('INSERT INTO c1_private.deployment(ns,manifest,now,clock_floor,heartbeat,halt,reason) VALUES(%s,%s,%s,%s,%s,false,\'FRESH_CONNECTION\')',(namespace,Jsonb({'mode':'CP30_TESTNET_CONNECTION','profile':profile}),now,now,now))
                conn.execute('INSERT INTO c1_private.transaction_guard(ns) VALUES(%s)',(namespace,))
                conn.execute("INSERT INTO c1_runtime_private.principals VALUES(%s,'c1_registrar_login','registrar',%s,%s)",(namespace,profile['chainId'],profile['registrar']))
                conn.execute("INSERT INTO c1_runtime_private.principals VALUES(%s,'c1_connection_bootstrap','registrar',%s,%s)",(namespace,profile['chainId'],profile['registrar']))
                conn.execute("INSERT INTO c1_runtime_private.grants(id,ns,revision,chain_id,system_account,role,enabled,expires_at,signature_cap,gas_cap) VALUES(%s,%s,1,%s,%s,'registrar',true,%s,%s,%s)",(grant['id'],namespace,profile['chainId'],profile['registrar'],grant['expiresAt'],grant['signatureUnits'],grant['gasUnits']))
                if plan.get('application'):
                    app=plan['application'];template=app['businessTemplate']
                    memberships={'c1_app_api_login':'c1_app_api','c1_identity_security_login':'c1_identity_security','c1_identity_authority_login':'c1_identity_authority','c1_registration_worker_login':'c1_registration_worker','c1_auto_binding_login':'c1_auto_binding','c1_live_gateway_login':'c1_live_api','c1_live_observer_login':'c1_live_observer','c1_business_quote_login':'c1_runtime_executor,c1_business_private','c1_business_issuer_login':'c1_runtime_executor,c1_business_private','c1_business_operator_login':'c1_runtime_executor,c1_business_private'}
                    for login,groups in memberships.items():
                        for group in groups.split(','):conn.execute(sql.SQL('GRANT {} TO {} WITH INHERIT TRUE').format(sql.Identifier(group),sql.Identifier(login)))
                        conn.execute(sql.SQL('GRANT CONNECT ON DATABASE c1_connection TO {}').format(sql.Identifier(login)))
                    role_logins={'quoteAuthority':'c1_business_quote_login','issuerAuthority':'c1_business_issuer_login','operatorAuthority':'c1_business_operator_login'}
                    for role,value in template['roles'].items():
                        grant_=value['grant']
                        conn.execute('INSERT INTO c1_runtime_private.principals VALUES(%s,%s,%s,%s,%s)',(namespace,role_logins[role],role,profile['chainId'],value['account']))
                        conn.execute('INSERT INTO c1_runtime_private.grants(id,ns,revision,chain_id,system_account,role,enabled,expires_at,signature_cap,gas_cap) VALUES(%s,%s,1,%s,%s,%s,true,%s,%s,%s)',(grant_['id'],namespace,profile['chainId'],value['account'],role,grant_['expiresAt'],grant_['signatureUnits'],grant_['gasUnits']))
                    for login in ('c1_auto_binding_login','c1_live_gateway_login','c1_live_observer_login'):
                        conn.execute("INSERT INTO c1_runtime_private.principals VALUES(%s,%s,'quoteAuthority',%s,%s)",(namespace,login,profile['chainId'],profile['quoteAuthority']))
                    conn.execute('INSERT INTO c1_live_private.binding_templates VALUES(%s,%s,%s)',(namespace,word_hash(template),Jsonb(template)))
                # Fresh entire database only: cross-namespace floors begin empty;
                # there is no adoption of restored DB global values.
                if conn.execute('SELECT count(*) FROM c1_runtime_private.nonces').fetchone()[0]!=0:raise ValueError('FRESH_GLOBAL_NONCE_REQUIRED')
                mh=conn.execute("SELECT encode(sha256(convert_to(c1_runtime_private.material(%s)::text,'UTF8')),'hex')",(namespace,)).fetchone()[0]
                floors=conn.execute('SELECT c1_runtime_private.floors(%s)',(namespace,)).fetchone()[0]
                checkpoint={'ledgerRevision':0,'ledgerHead':word_hash({'freshRun':m['id'],'profile':profile,'limits':plan['transactionLimits'],'grant':grant,'materialHash':mh}),'materialHash':mh,'epochs':{'source_epoch':1,'credential_epoch':1,'restore_generation':1},'floors':floors,'globalFloors':{'runtime_nonce':{}}}
                journal=RuntimeLedgerJournal(run/'ledger',namespace,initialize=checkpoint);cp=journal.checkpoint
                conn.execute('INSERT INTO c1_runtime_private.state(ns,revision,head,material_hash,source_epoch,credential_epoch,restore_generation,journal_sequence,journal_digest) VALUES(%s,0,%s,%s,1,1,1,%s,%s)',(namespace,cp['ledgerHead'],mh,cp['journalSequence'],cp['journalDigest']))
            signer=OriginalSignerJournal(run/'registrar',initialize=True);signer.close()
        finally:
            if journal:journal.close()
        db={name:{**common,'dbname':'c1_connection','user':name,'password':pw,'application_name':name+'-'+m['id']} for name,pw in credentials.items()}
        controller_cap=secrets.token_hex(32);client_cap=secrets.token_hex(32)
        controller={'mode':'CP30_RUNTIME_LEDGER_CONTROLLER','db':db,'runtimeControllerRole':'c1_ledger_controller_login','journals':{namespace:str(run/'ledger')},'clockEnabled':True,'socket_path':str(run/'socket/ledger.sock'),'executor_cap':controller_cap}
        registrar={**{k:plan[k] for k in ('mode','enabled','namespace','profile','transactionLimits','rpc','keyHandle')},'db':db,'grantId':grant['id'],'runtimeExecutorRole':'c1_registrar_login','runtimeDirectory':str(run/'registrar'),'runtimeController':{'path':controller['socket_path'],'cap':controller_cap},'socket_path':str(run/'socket/registrar.sock'),'client_cap':client_cap}
        # Separate configs do not expose controller DB credentials to registrar.
        controller['db']={'c1_ledger_controller_login':db['c1_ledger_controller_login']};registrar['db']={'c1_registrar_login':db['c1_registrar_login']}
        write(run/'controller.json',controller);write(run/'registrar.json',registrar)
        write(run/'registrar-client.json',{'path':registrar['socket_path'],'cap':client_cap,'namespace':namespace})
        if plan.get('application'):
            from application_setup import configuration_files
            extra=configuration_files(run,m,plan,db,controller)
            for name,value in extra.items():write(run/name,value)
        else:extra={}
        write(run/'INSTALLED.json',{'id':m['id'],'planDigest':word_hash(plan),'pythonExecutable':plan['pythonExecutable'],'postgresBin':plan['postgresBin'],'configs':{name:digest(run/name) for name in (*('controller.json','registrar.json','registrar-client.json'),*extra)},'pgPid':int((run/'pg/postmaster.pid').read_text().splitlines()[0]),'sqlPins':{str(path.relative_to(ROOT)):digest(path) for path in [*sorted((ROOT/'migrations').glob('[0-9]*.sql')),*sorted((ROOT/'connection-migrations').glob('[0-9]*.sql'))]}})
        return {'status':'SOURCE_INSTALLED_PRIVATE_HOSTS_NOT_STARTED','run':str(run)}
    except BaseException:
        if (run/'pg/postmaster.pid').exists() and int((run/'pg/postmaster.pid').read_text().splitlines()[0])==pg_pid:
            subprocess.run([str(pg/'pg_ctl'),'-D',str(run/'pg'),'stop','-m','fast','-w','-t','10'],env={'LC_ALL':'C'},capture_output=True,timeout=15)
        raise

@contextmanager
def forward_lock(run):
    fd=os.open(Path(run)/'WALLET-FORWARD.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:raise ValueError('OWNED_FORWARD_LOCK_REQUIRED')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally:os.close(fd)
def start(run):
    run,_=marker(run)
    with forward_lock(run):return _start_locked(run)
def _start_locked(run):
    run,m=marker(run);installed=private_json(run/'INSTALLED.json')
    if installed['id']!=m['id']:raise ValueError('OWNED_START_REQUIRED')
    for manifest in run.glob('HOSTS-*.json'):
        for entry in private_json(manifest)['processes']:
            if subprocess.run(['/bin/ps','-p',str(entry['pid']),'-o','lstart='],env={},capture_output=True).stdout.strip():raise ValueError('PREVIOUS_HOST_PID_MUST_BE_STOPPED')
    launch=secrets.token_hex(8)
    for name,pin in installed['configs'].items():
        private_json(run/name)
        if digest(run/name)!=pin:raise ValueError('REVIEWED_CONFIGURATION_CHANGED')
    if int((run/'pg/postmaster.pid').read_text().splitlines()[0])!=installed['pgPid']:raise ValueError('OWNED_PG_IDENTITY_REQUIRED')
    processes=[]
    try:
        launches=[('c1.runtime_ledger_controller','controller')]
        full_application='application.json' in installed['configs']
        if full_application:launches.extend([('c1.identity_security_controller','security'),('c1.identity_runtime','identity')])
        launches.append(('c1.registration_runtime_host','registrar'))
        if full_application:launches.extend([('c1.automatic_business','automatic-business'),('c1.application','application')])
        if not full_application and (run/'BUSINESS-INSTALLED.json').exists():
            business=private_json(run/'BUSINESS-INSTALLED.json')
            if business['id']!=m['id'] or any(digest(run/name)!=pin for name,pin in business['configs'].items()):raise ValueError('REVIEWED_BUSINESS_PIN_REQUIRED')
            launches.append(('c1.business_runtime_host','business-suite'))
        for module,name in launches:
            code="import os;os.environ.clear();import sys;sys.path.insert(0,"+repr(str(ROOT/'src'))+");from "+module+" import main;main()"
            command=[installed['pythonExecutable'],'-I','-B','-c',code,'--config',str(run/(name+'.json'))]
            fd=os.open(run/('logs/'+name+'-'+launch+'.log'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as output:process=subprocess.Popen(command,env={},stdin=subprocess.DEVNULL,stdout=output,stderr=output,start_new_session=True)
            processes.append(process)
            from c1.ipc import Client
            end=time.monotonic()+5;config=private_json(run/(name+'.json'))
            while time.monotonic()<end:
                if name=='application' and (run/'bound.json').exists():
                    bound=private_json(run/'bound.json')
                    if bound.get('pid')==process.pid and bound.get('port')==config['httpPort'] and bound.get('origin')==config['origin']:break
                if process.poll() is not None:raise ValueError('PRIVATE_HOST_START_FAILED')
                if name!='application' and Path(config['socket_path']).exists():break
                time.sleep(.05)
            else:raise ValueError('PRIVATE_HOST_START_TIMEOUT')
            if name=='application':
                if config['backendOriginHash']!='0x'+hashlib.sha256(config['origin'].encode()).hexdigest():raise ValueError('APPLICATION_ORIGIN_HASH_MISMATCH')
            elif name=='security':
                result=Client(config['socket_path'],config['api_cap'],timeout=5).call(config['namespace'],'query',{})
                if result.get('error') or result.get('riskBlocked'):raise ValueError('SECURITY_STARTUP_MATCH_REQUIRED')
            elif name=='identity':
                result=Client(config['socket_path'],config['api_cap'],timeout=5).call(config['namespace'],'setup',{})
                if result.get('sdkLoginEnabled') is not True:raise ValueError('IDENTITY_NOT_CONFIGURED')
            elif name=='automatic-business':
                for role,entry in config['services'].items():
                    result=Client(config['socket_path'],entry['client_cap'],timeout=5).call(config['namespace'],'setup',{})
                    if result.get('role')!=role or result.get('state') not in {'WAIT_VERIFIED_REGISTRATION',None}:raise ValueError('AUTOMATIC_BINDING_STARTUP_CONFLICT')
            elif name=='controller':
                result=Client(config['socket_path'],config['executor_cap'],timeout=5).call(next(iter(config['journals'])),'runtime_ledger_begin',{'readOnly':True})
                if result.get('error') or result.get('readOnly') is not True:raise ValueError('EXTERNAL_STARTUP_MATCH_REQUIRED')
            elif name=='business-suite':
                for entry in config['services'].values():
                    result=Client(config['socket_path'],entry['client_cap'],timeout=5).call(entry['profile']['namespace'],'setup',{})
                    if result.get('status')!='CONFIGURED':raise ValueError('AUTHORITY_NOT_CONFIGURED')
            else:
                result=Client(config['socket_path'],config['client_cap'],timeout=5).call(config['namespace'],'setup',{})
                if result.get('status')!='CONFIGURED':raise ValueError('REGISTRAR_NOT_CONFIGURED')
        write(run/('HOSTS-'+launch+'.json'),{'id':m['id'],'processes':[{'pid':p.pid,'command':p.args,'identity':subprocess.run(['/bin/ps','-p',str(p.pid),'-o','lstart='],env={},capture_output=True,check=True).stdout.decode().strip()} for p in processes]})
    except BaseException:
        for p in reversed(processes):
            if p.poll() is None:p.terminate();p.wait(timeout=5)
        raise
    return {'status':'PRIVATE_HOSTS_STARTED_NO_DEPLOYMENT_REQUESTED','run':str(run)}
def stop(run):
    run,_=marker(run)
    with forward_lock(run):return _stop_locked(run)
def _stop_locked(run):
    run,m=marker(run)
    for manifest in sorted(run.glob('HOSTS-*.json'),reverse=True):
        hosts=private_json(manifest)
        if hosts['id']!=m['id']:raise ValueError('OWNED_HOSTS_REQUIRED')
        for entry in reversed(hosts['processes']):
            probe=subprocess.run(['/bin/ps','-p',str(entry['pid']),'-o','lstart='],env={},capture_output=True)
            if not probe.stdout.strip():continue
            command=subprocess.run(['/bin/ps','-ww','-p',str(entry['pid']),'-o','command='],env={},capture_output=True).stdout.decode().strip()
            if probe.stdout.decode().strip()!=entry['identity'] or command!=' '.join(entry['command']):raise ValueError('OWNED_PID_IDENTITY_REQUIRED')
            os.kill(entry['pid'],signal.SIGTERM)
    # Journals, keys, configs and the PG cluster are retained for normal restart.
    return {'status':'OWNED_PRIVATE_HOST_STOP_REQUESTED'}
def main():
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','initialize','start','stop']);parser.add_argument('run');parser.add_argument('--plan');args=parser.parse_args()
    try:result=initialize(args.run,args.plan) if args.action=='initialize' and args.plan else globals()[args.action](args.run)
    except Exception:raise SystemExit('CONNECTION_SETUP_CLOSED') from None
    print(json.dumps(result))
if __name__=='__main__':main()
