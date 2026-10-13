"""Future internal owned provisioning after verified registration; source only.

Never reads key bytes, starts a service, calls RPC or signs. The new dedicated
key handles must be provisioned internally before this reviewed configuration
step. Existing ledger heads/budgets are advanced by a sealed fixed mutation.
"""
import argparse,importlib.util,json,os,secrets,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
spec=importlib.util.spec_from_file_location('connection_setup_source',ROOT/'tools/connection-bootstrap.py');setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
from c1.db import Database
from c1.ipc import Client
from c1.runtime_ledger_controller import RuntimeLedgerControllerClient
from c1.registration_runtime_host import persistence_module
from c1.live_gateway import module
ROLES={'quoteAuthority':'c1_business_quote_login','issuerAuthority':'c1_business_issuer_login','operatorAuthority':'c1_business_operator_login'}
def provision(run,plan_path):
    run,marker=setup.marker(run);installed=setup.private_json(run/'INSTALLED.json');plan=setup.private_json(plan_path)
    if plan.get('mode')!='CP30_BUSINESS_SUITE' or plan.get('enabled') is not True or set(plan['roles'])!=set(ROLES) or (run/'BUSINESS-PREPARING.json').exists():raise ValueError('EXPLICIT_FRESH_BUSINESS_PROVISION_REQUIRED')
    if Path(sys.executable).resolve()!=Path(installed['pythonExecutable']).resolve():raise ValueError('PINNED_RUNNER_REQUIRED')
    controller=setup.private_json(run/'controller.json');namespace=next(iter(controller['journals']))
    if setup.digest(run/'controller.json')!=installed['configs']['controller.json']:raise ValueError('REVIEWED_CONTROLLER_REQUIRED')
    # All slots are new, outside registrar custody, and checked only as metadata.
    profiles=[]
    for role,value in plan['roles'].items():
        profile=value['profile'];module('original_signer').approved_profile(profile,role)
        if profile['namespace']!=namespace:raise ValueError('FIXED_NAMESPACE_REQUIRED')
        directory=setup.owned_directory(value['runtimeDirectory'])
        if directory==run/'registrar' or directory.parent!=run or (directory/'business-authority-originals.jsonl').exists():raise ValueError('NEW_AUTHORITY_DIRECTORY_REQUIRED')
        handle=value['keyHandle'];info=(directory/handle['name']).lstat()
        if info.st_dev!=handle['device'] or info.st_ino!=handle['inode'] or not 66<=info.st_size<=67:raise ValueError('APPROVED_NEW_HANDLE_METADATA_REQUIRED')
        grant=value['grant']
        if grant.get('enabled') is not True:raise ValueError('EXPLICIT_AUTHORITY_GRANT_REQUIRED')
        if type(grant['expiresAt']) is not int or not int(time.time())<grant['expiresAt']<=int(time.time())+86400:raise ValueError('BOUNDED_GRANT_REQUIRED')
        profiles.append({'role':role,'profile':profile,'grant':grant})
    setup.write(run/'BUSINESS-PREPARING.json',{'id':marker['id'],'planDigest':setup.word_hash(plan)})
    import psycopg
    from psycopg import sql
    # Only this new owned PG's bootstrap credential; not any old runtime/config.
    pw=(run/'bootstrap-password').read_text().strip()
    common={'host':str(run/'socket'),'port':5432,'dbname':'c1_connection','user':'c1_connection_bootstrap','password':pw,'application_name':'c1-business-provision','connect_timeout':2}
    credentials={name:secrets.token_hex(32) for name in (*ROLES.values(),'c1_live_gateway_login','c1_live_observer_login')}
    with psycopg.connect(**common) as conn:
        for name,password in credentials.items():
            conn.execute(sql.SQL('CREATE ROLE {} LOGIN INHERIT PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS').format(sql.Identifier(name),sql.Literal(password)))
            conn.execute(sql.SQL('GRANT CONNECT ON DATABASE c1_connection TO {}').format(sql.Identifier(name)))
        conn.execute('GRANT c1_runtime_executor,c1_business_private TO c1_business_quote_login,c1_business_issuer_login,c1_business_operator_login WITH INHERIT TRUE')
        conn.execute('GRANT c1_live_api TO c1_live_gateway_login WITH INHERIT TRUE');conn.execute('GRANT c1_live_observer TO c1_live_observer_login WITH INHERIT TRUE')
    dbconfig={'db':{'bootstrap':common}};database=Database(dbconfig,'bootstrap','runtime_internal',max_size=1)
    runtime=RuntimeLedgerControllerClient(Client(controller['socket_path'],controller['executor_cap'],timeout=5));ledger=persistence_module().PgRuntimeLedger(database,namespace,runtime)
    try:
        with ledger.transaction() as tx:
            tx.fixed.call('business_provision',{'ticket':tx.ticket,'registrationId':plan['registrationId'],'profiles':profiles});tx.dirty=True
    finally:database.close()
    services={};caps={};db={name:{**common,'user':name,'password':password,'application_name':name+'-'+marker['id']} for name,password in credentials.items()}
    for role,value in plan['roles'].items():
        leaf=module('original_signer');journal=leaf.AuthorityOriginalJournal(value['runtimeDirectory'],role=role,profile=value['profile'],initialize=True);journal.close()
        cap=secrets.token_hex(32);caps[role]={'path':str(run/'socket/business.sock'),'cap':cap}
        services[role]={'mode':'CP30_BUSINESS_RUNTIME','enabled':True,'role':role,'profile':value['profile'],'grantId':value['grant']['id'],'runtimeDirectory':value['runtimeDirectory'],'keyHandle':value['keyHandle'],'genesisHash':plan['genesisHash'],'rpc':plan['broadcastRpc'],'db':{ROLES[role]:db[ROLES[role]]},'runtimeRole':ROLES[role],'runtimeController':{'path':controller['socket_path'],'cap':controller['executor_cap']},'client_cap':cap}
    suite={'mode':'CP30_BUSINESS_SUITE','enabled':True,'services':services,'socket_path':str(run/'socket/business.sock')}
    client={'mode':'CP30_TESTNET_CONNECTION','db':{name:db[name] for name in ('c1_live_gateway_login','c1_live_observer_login')},'business':{**plan['gateway'],'enabled':True,'apiRole':'c1_live_gateway_login','observerRole':'c1_live_observer_login','controller':{'path':controller['socket_path'],'cap':controller['executor_cap']},'authorities':caps}}
    setup.write(run/'business-suite.json',suite);setup.write(run/'business-client.json',client)
    setup.write(run/'BUSINESS-INSTALLED.json',{'id':marker['id'],'configs':{name:setup.digest(run/name) for name in ('business-suite.json','business-client.json')},'planDigest':setup.word_hash(plan)})
    return {'status':'BUSINESS_PRIVATE_SOURCE_PROVISIONED_NOT_STARTED'}
def main():
    if os.environ:raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    parser=argparse.ArgumentParser();parser.add_argument('run');parser.add_argument('--plan',required=True);args=parser.parse_args()
    try:result=provision(args.run,args.plan)
    except Exception:raise SystemExit('BUSINESS_PROVISION_CLOSED') from None
    print(json.dumps(result))
if __name__=='__main__':main()
