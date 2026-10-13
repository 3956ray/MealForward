"""Attach the existing dedicated catalog account to one reviewed owned runtime.

No key generation, signing, broadcasting, old grant edits, or binding replacement.
Run only after reviewed forward migrations and with the existing controller up.
The permanent preparation file retains the one original grant and login secret.
"""
import argparse,copy,hashlib,importlib.util,json,os,secrets,stat,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
spec=importlib.util.spec_from_file_location('catalog_setup',ROOT/'tools/connection-bootstrap.py')
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
from c1.db import Database
from c1.ipc import Client
from c1.runtime_ledger_controller import RuntimeLedgerControllerClient
from c1.registration_runtime_host import persistence_module
from c1.live_gateway import module

def replace_private(path,value):
    temp=path.with_name(path.name+'.catalog-tmp')
    if temp.exists():
        if setup.private_json(temp)!=value:raise ValueError('ORIGINAL_CONFIG_TEMP_CONFLICT')
    else:setup.write(temp,value)
    os.replace(temp,path)
    fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)

def value_digest(value):return hashlib.sha256(setup.canonical(value)+b'\n').hexdigest()

def finish_configs(run,state,statepath):
    plan=state['files']
    for name,item in plan.items():
        if setup.digest(run/name) not in (item['before'],value_digest(item['after'])):raise ValueError('ORIGINAL_CONFIG_INSTALL_CONFLICT')
    for name,item in plan.items():
        replace_private(run/name,item['after'])
    state['committed']=True;replace_private(statepath,state)

def provision(run):
    import psycopg
    from psycopg import sql
    run,marker=setup.marker(run);installed=setup.private_json(run/'INSTALLED.json')
    if Path(sys.executable).resolve()!=Path(installed['pythonExecutable']).resolve():raise ValueError('PINNED_RUNNER_REQUIRED')
    statepath=run/'CATALOG-PREPARING.json'
    if statepath.exists():
        prior=setup.private_json(statepath)
        if prior['runId']!=marker['id']:raise ValueError('ORIGINAL_CATALOG_PREPARATION_CHANGED')
        if prior.get('files'):
            finish_configs(run,prior,statepath)
            return {'status':'CATALOG_CONFIGURED_RESTART_REQUIRED','account':prior['profile']['binding']['catalogAuthority'],'transactionsSent':0}
    if any(installed['sqlPins'].get('connection-migrations/'+name)!=setup.digest(ROOT/'connection-migrations'/name) for name in ('042-live-catalog-reviews.sql','043-live-catalog-execution.sql','044-live-multi-meal.sql')):raise ValueError('REVIEWED_CATALOG_MIGRATIONS_REQUIRED')
    app=setup.private_json(run/'application.json');automatic=setup.private_json(run/'automatic-business.json');controller=setup.private_json(run/'controller.json')
    for name in ('application.json','automatic-business.json','controller.json'):
        if installed['configs'][name]!=setup.digest(run/name):raise ValueError('REVIEWED_CONFIG_REQUIRED')
    ns=app['namespace'];metadata=setup.private_json(run/'custody-metadata.json')['catalogAuthority']
    if metadata['directory']!=str(run/'catalogAuthority'):raise ValueError('DEDICATED_CATALOG_HANDLE_REQUIRED')
    handle=metadata['keyHandle'];key=run/'catalogAuthority'/handle['name'];info=key.lstat()
    if handle['name']!='authority.key' or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode)!=0o600 or info.st_uid!=os.getuid() or info.st_nlink!=1 or info.st_dev!=handle['device'] or info.st_ino!=handle['inode'] or not 66<=info.st_size<=67:raise ValueError('DEDICATED_CATALOG_HANDLE_REQUIRED')
    base=app['db']['api'];common={k:base[k] for k in ('host','port','dbname')}
    common.update(user='c1_connection_bootstrap',password=(run/'bootstrap-password').read_text().strip(),application_name='c1-catalog-provision',connect_timeout=2)
    fresh=not statepath.exists()
    with psycopg.connect(**common) as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        if Path(conn.execute('SHOW data_directory').fetchone()[0]).resolve()!=run/'pg':raise ValueError('OWNED_DATABASE_REQUIRED')
        row=conn.execute("SELECT profile FROM c1_live_private.authority_profiles WHERE ns=%s AND role='issuerAuthority'",(ns,)).fetchone()
        if not row:raise ValueError('ORIGINAL_PROFILE_REQUIRED')
        profile=row[0];account=profile['binding']['catalogAuthority'];store=profile['binding']['storeId'][2:]
        if account!=metadata['account']:raise ValueError('CATALOG_ACCOUNT_MISMATCH')
        expiry=conn.execute("SELECT min(expires_at) FROM c1_runtime_private.grants WHERE ns=%s AND role IN ('issuerAuthority','operatorAuthority','quoteAuthority') AND enabled",(ns,)).fetchone()[0]
        if not expiry or not int(time.time())<expiry<=int(time.time())+86400:raise ValueError('BOUNDED_GRANT_REQUIRED')
        if fresh:
            if conn.execute("SELECT 1 FROM pg_roles WHERE rolname='c1_business_catalog_login'").fetchone() or (run/'catalogAuthority/business-authority-originals.jsonl').exists() or 'catalogAuthority' in automatic['services']:raise ValueError('FRESH_CATALOG_ONLY')
            state={'runId':marker['id'],'namespace':ns,'profile':profile,'store':store,'grant':{'id':'catalog-'+secrets.token_hex(12),'enabled':True,'expiresAt':expiry,'signatureUnits':'6','gasUnits':'720000000000000000'},'password':secrets.token_hex(32),'cap':secrets.token_hex(32),'journalIntent':False,'journalCreated':False}
            setup.write(statepath,state)
        else:state=setup.private_json(statepath)
        if state['runId']!=marker['id'] or state['namespace']!=ns or state['profile']!=profile or state['store']!=store or state['grant']['expiresAt']>expiry:raise ValueError('ORIGINAL_CATALOG_PREPARATION_CHANGED')
    journalpath=run/'catalogAuthority/business-authority-originals.jsonl';leaf=module('original_signer')
    if state['journalIntent'] and not journalpath.exists():raise ValueError('ORIGINAL_JOURNAL_MISSING')
    if not state['journalIntent']:
        state['journalIntent']=True;replace_private(statepath,state)
        journal=leaf.AuthorityOriginalJournal(run/'catalogAuthority',role='catalogAuthority',profile=profile,initialize=True);journal.close()
    else:
        journal=leaf.AuthorityOriginalJournal(run/'catalogAuthority',role='catalogAuthority',profile=profile);journal.close()
    state['journalCreated']=True;replace_private(statepath,state)
    with psycopg.connect(**common) as conn:
        role=conn.execute("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='c1_business_catalog_login'").fetchone()
        if role is None:
            conn.execute(sql.SQL('CREATE ROLE c1_business_catalog_login LOGIN INHERIT PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS').format(sql.Literal(state['password'])))
            conn.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO c1_business_catalog_login').format(sql.Identifier(base['dbname'])))
            conn.execute('GRANT c1_runtime_executor,c1_business_private TO c1_business_catalog_login WITH INHERIT TRUE')
        elif any(role):raise ValueError('CATALOG_LOGIN_PRIVILEGES_CHANGED')
        members={row[0] for row in conn.execute("SELECT g.rolname FROM pg_auth_members m JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.roleid WHERE u.rolname='c1_business_catalog_login'")}
        if members!={'c1_runtime_executor','c1_business_private'}:raise ValueError('CATALOG_LOGIN_MEMBERSHIP_CHANGED')
        existing=conn.execute("SELECT profile FROM c1_live_private.authority_profiles WHERE ns=%s AND role='catalogAuthority'",(ns,)).fetchone()
        if existing:
            grant=conn.execute("SELECT id,expires_at,signature_cap,gas_cap,enabled FROM c1_runtime_private.grants WHERE ns=%s AND role='catalogAuthority'",(ns,)).fetchall()
            wanted=state['grant']
            if existing[0]!=profile or len(grant)!=1 or tuple(str(x) for x in grant[0])!=(wanted['id'],str(wanted['expiresAt']),wanted['signatureUnits'],wanted['gasUnits'],'True'):raise ValueError('ORIGINAL_CATALOG_GRANT_CHANGED')
    with psycopg.connect(**{**common,'user':'c1_business_catalog_login','password':state['password']}) as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        if conn.execute('SELECT current_user').fetchone()[0]!='c1_business_catalog_login':raise ValueError('CATALOG_LOGIN_IDENTITY_CHANGED')
    if not existing:
        database=Database({'db':{'bootstrap':common}},'bootstrap','runtime_internal',max_size=1)
        client=RuntimeLedgerControllerClient(Client(controller['socket_path'],controller['executor_cap'],timeout=5))
        ledger=persistence_module().PgRuntimeLedger(database,ns,client)
        try:
            with ledger.transaction() as tx:
                tx.fixed.call('business_provision',{'ticket':tx.ticket,'store':store,'catalogProfile':profile,'grant':state['grant']});tx.dirty=True
        finally:database.close()
    # Only append the catalog service; all original template and services remain.
    service=copy.deepcopy(automatic['services']['issuerAuthority'])
    service.update(role='catalogAuthority',grantId=state['grant']['id'],runtimeDirectory=str(run/'catalogAuthority'),keyHandle=handle,client_cap=state['cap'])
    service['db']={service['runtimeRole']:{**next(iter(service['db'].values())),'user':'c1_business_catalog_login','password':state['password'],'application_name':'c1-business-catalog-'+marker['id']}}
    source={'path':automatic['socket_path'],'cap':state['cap']}
    if automatic['services'].get('catalogAuthority') not in (None,service) or app['connection']['business']['authorities'].get('catalogAuthority') not in (None,source):raise ValueError('CATALOG_CONFIGURATION_CONFLICT')
    automatic['services']['catalogAuthority']=service;app['connection']['business']['authorities']['catalogAuthority']=source
    wallet=setup.private_json(run/'WALLET-LOGIN-INSTALLED.json')
    if wallet['originalConfigs']!=installed['configs']:raise ValueError('WALLET_PIN_BASE_CHANGED')
    files={}
    for name,value in [('application.json',app),('automatic-business.json',automatic)]:
        backup=run/(name+'.before-catalog')
        if not backup.exists():setup.write(backup,setup.private_json(run/name))
        files[name]={'before':setup.digest(run/name),'after':value};installed['configs'][name]=value_digest(value)
    wallet['originalConfigs']=copy.deepcopy(installed['configs'])
    for name,value in [('INSTALLED.json',installed),('WALLET-LOGIN-INSTALLED.json',wallet)]:files[name]={'before':setup.digest(run/name),'after':value}
    state['files']=files;replace_private(statepath,state)
    finish_configs(run,state,statepath)
    return {'status':'CATALOG_CONFIGURED_RESTART_REQUIRED','account':account,'grantExpiry':state['grant']['expiresAt'],'signatureCap':6,'gasCapWei':state['grant']['gasUnits'],'transactionsSent':0}

if __name__=='__main__':
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
    try:result=provision(args.run)
    except Exception as exc:
        code=str(exc)
        print(json.dumps({'status':'CATALOG_PROVISION_CLOSED','reason':code if code.isupper() and len(code)<100 else 'PRIVATE_STAGE_FAILED'}));raise SystemExit(1) from None
    print(json.dumps(result))
