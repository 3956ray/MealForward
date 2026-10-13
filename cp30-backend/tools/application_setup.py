"""Fresh full-app config generation, called only by the explicit new initializer."""
import json,os,secrets
from pathlib import Path
from c1.journal import Journal
from c1.first_binding_journal import FirstBindingJournal
from c1.registrar_signer_journal import word_hash

def configuration_files(run,marker,plan,db,ledger_config):
    import psycopg
    from c1.private_connection_config import read_private
    app=plan['application'];ns=plan['namespace'];template=app['businessTemplate'];run_id=marker['id'];cluster_id=run_id+'-fresh'
    # Only fresh empty identity/security resources are initialized here; no
    # fixture/economic snapshot or existing journal is imported/adopted.
    journal=Journal(run/'security/security.journal',run_id,cluster_id,initialize=True,empty_cluster=True)
    try:
        journal.checkpoint(ns,{'credential':{'global':1},'restore':{'global':1}});anchor=journal.snapshot(ns)
        password=(run/'bootstrap-password').read_text().strip()
        with psycopg.connect(host=str(run/'socket'),port=5432,dbname='c1_connection',user='c1_connection_bootstrap',password=password,connect_timeout=2) as conn:
            if conn.execute('SELECT count(*) FROM c1_private.identities').fetchone()[0]!=0 or conn.execute('SELECT count(*) FROM c1_private.store_registrations').fetchone()[0]!=0:raise ValueError('FRESH_IDENTITY_RESOURCES_REQUIRED')
            conn.execute('INSERT INTO c1_private.journal_anchors VALUES(%s,%s,%s)',(ns,anchor['sequence'],anchor['digest']))
    finally:journal.close()
    binding=FirstBindingJournal(run/'binding',word_hash(template),initialize=True);binding.close()
    api_cap,identity_cap=secrets.token_hex(32),secrets.token_hex(32);login_cap=secrets.token_hex(32)
    runtime_controller={'path':ledger_config['socket_path'],'cap':ledger_config['executor_cap']}
    security={'mode':'CP30_IDENTITY_SECURITY_CONTROLLER','namespace':ns,'run_id':run_id,'cluster_id':cluster_id,'journal_path':str(run/'security/security.journal'),'socket_path':str(run/'socket/security.sock'),'db':{'security':db['c1_identity_security_login']},'securityRole':'security','api_cap':api_cap,'identity_cap':identity_cap}
    identity={'mode':'CP30_REAL_IDENTITY_AUTHORITY','namespace':ns,'origin':app['origin'],'allowedOrigin':app['allowedOrigin'],'activation':app['activation'],'identity':{**app['identity'],'emailHmacKey':secrets.token_hex(32),'subjectHmacKey':secrets.token_hex(32)},'walletProof':app['walletProof'],'walletKindRpc':app['walletKindRpc'],'db':{'identity':db['c1_identity_authority_login']},'identityDatabaseRole':'identity','controller':{'path':security['socket_path'],'cap':identity_cap},'socket_path':str(run/'socket/identity.sock'),'api_cap':login_cap}
    services={};authorities={};logins={'quoteAuthority':'c1_business_quote_login','issuerAuthority':'c1_business_issuer_login','operatorAuthority':'c1_business_operator_login'}
    for role,value in template['roles'].items():
        cap=secrets.token_hex(32);custody=app['custody'][role]
        services[role]={'mode':'CP30_BUSINESS_RUNTIME','enabled':True,'role':role,'grantId':value['grant']['id'],'runtimeDirectory':custody['directory'],'keyHandle':custody['keyHandle'],'genesisHash':app['business']['observer']['genesisHash'],'rpc':app['broadcastRpc'],'db':{'runtime':db[logins[role]]},'runtimeRole':'runtime','runtimeController':runtime_controller,'client_cap':cap}
        authorities[role]={'path':str(run/'socket/automatic-business.sock'),'cap':cap}
    automatic={'mode':'CP30_AUTOMATIC_BUSINESS','enabled':True,'namespace':ns,'template':template,'bindingDirectory':str(run/'binding'),'bindingRole':'binding','db':{'binding':db['c1_auto_binding_login']},'runtimeController':runtime_controller,'business':app['business'],'services':services,'socket_path':str(run/'socket/automatic-business.sock')}
    registrar=read_private(run/'registrar-client.json')[0]
    business={**app['business'],'enabled':True,'apiRole':'liveApi','observerRole':'liveObserver','controller':runtime_controller,'authorities':authorities}
    api={'mode':'CP30_TESTNET_CONNECTION','namespace':ns,'run':str(run/'content'),'origin':app['origin'],'httpPort':app['httpPort'],'allowedOrigin':app['allowedOrigin'],'backendOriginHash':app['walletProof']['backendOriginHash'],'certfile':app['tls']['certfile'],'keyfile':app['tls']['keyfile'],'bound_file':str(run/'bound.json'),'cursor_key':secrets.token_hex(32),'controller_path':security['socket_path'],'controller_cap':api_cap,'db':{'api':db['c1_app_api_login'],'registration':db['c1_registration_worker_login'],'liveApi':db['c1_live_gateway_login'],'liveObserver':db['c1_live_observer_login']},'connection':{'profile':{**plan['profile'],'mode':'TESTNET'},'activation':app['activation'],'identityService':{'path':identity['socket_path'],'cap':login_cap},'registrar':{'path':registrar['path'],'cap':registrar['cap']},'registrationDatabaseRole':'registration','observer':app['registrationObserver'],'business':business}}
    return {'security.json':security,'identity.json':identity,'automatic-business.json':automatic,'application.json':api}
