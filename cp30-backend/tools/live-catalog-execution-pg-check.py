"""Fresh owned PG catalog execution checks; no real runtime or chain access."""
import importlib.util,json,re
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('catalog_review_check',ROOT/'tools/live-catalog-review-pg-check.py')
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)

def check(ctx):
    review.check(ctx)
    c,call,reject=ctx['conn'],ctx['call'],ctx['reject'];store=review.draft.STORE
    c.execute('''CREATE ROLE c1_runtime_policy_owner;CREATE ROLE c1_connection_bootstrap LOGIN SUPERUSER;CREATE ROLE catalog_observer;
CREATE DOMAIN c1_private.uint256 AS numeric CHECK(VALUE>=0);
ALTER TABLE c1_private.deployment ADD PRIMARY KEY(ns);
CREATE TABLE c1_private.identities(ns text,subject text,recipient_key text);
INSERT INTO c1_private.identities VALUES('inert','owner','owner-key');
CREATE FUNCTION c1_runtime_private.check_open(text,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION c1_runtime_private.base_guard(text,boolean,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION c1_runtime_internal.business_provision(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION c1_runtime_internal.first_binding_material(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"binding":"retained"}'::jsonb $$;
CREATE TABLE c1_live_private.authority_profiles(ns text,role text CHECK(role IN('quoteAuthority','issuerAuthority','operatorAuthority')),profile jsonb,revision bigint,PRIMARY KEY(ns,role));
''')
    for path,names,schema in [('integrations/persistence/runtime-ledger.sql',['principals','grants','authorizations'],'c1_runtime_private'),('connection-migrations/023-live-business.sql',['intents','leases','wallet_attempts','claims','credentials','receipts'],'c1_live_private')]:
        src=(ROOT/path).read_text()
        for name in names:
            ddl=re.search(r'CREATE TABLE '+schema+r'\.'+name+r'\(.*?;',src,re.S).group()
            c.execute(ddl.replace('email_key bytea','recipient_key text'))
    c.execute('''GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private,c1_runtime_internal TO c1_runtime_policy_owner,catalog_observer;
GRANT SELECT ON ALL TABLES IN SCHEMA c1_private TO c1_runtime_code_owner,c1_runtime_policy_owner,c1_live_code_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA c1_runtime_private TO c1_runtime_code_owner;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA c1_runtime_private TO c1_runtime_policy_owner;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA c1_live_private TO c1_live_code_owner,c1_runtime_code_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA c1_live_private TO c1_runtime_policy_owner;
GRANT INSERT ON c1_live_private.authority_profiles TO c1_runtime_policy_owner;
''')
    binding=c.execute('SELECT profile->\'binding\' FROM c1_live_private.stores').fetchone()[0]
    profile={'namespace':'inert','binding':binding,'escrowCodeHash':'0x'+'9'*64,'chainProfileDigest':'0x'+'8'*64}
    for role in ['issuerAuthority','operatorAuthority','quoteAuthority']:
        c.execute('INSERT INTO c1_live_private.authority_profiles VALUES(%s,%s,%s,1)',('inert',role,Jsonb(profile)))
        c.execute('INSERT INTO c1_runtime_private.grants(id,ns,revision,chain_id,system_account,role,enabled,expires_at,signature_cap,gas_cap) VALUES(%s,%s,1,%s,%s,%s,true,100,6,720000000000000000)',(role,'inert','10143',binding[role],role))
    c.execute("UPDATE c1_live_private.stores SET snapshot=NULL")
    before=c.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()
    c.execute((ROOT/'connection-migrations/043-live-catalog-execution.sql').read_text())
    assert before==c.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()
    c.execute('''ALTER FUNCTION c1_runtime_internal.live_projection(text,jsonb) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.live_projection(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_projection(text,jsonb) TO catalog_observer;''')
    c.execute('SET ROLE c1_live_api');assert call('catalog_capabilities')=={'publish':False};c.execute('RESET ROLE')
    grant={'id':'catalog-grant','enabled':True,'expiresAt':100,'signatureUnits':'6','gasUnits':'720000000000000000'}
    def provision(p=profile,g=grant):return c.execute('SELECT c1_runtime_internal.business_provision(%s,%s)',('inert',Jsonb({'store':store,'catalogProfile':p,'grant':g}))).fetchone()[0]
    def denied(code,fn):
        try:fn()
        except psycopg.Error as e:assert e.diag.message_primary==code,e.diag.message_primary
        else:raise AssertionError(code)
    denied('permission denied for function business_provision',lambda:(c.execute('SET ROLE c1_live_api'),provision()))
    c.execute('RESET ROLE');c.execute('SET SESSION AUTHORIZATION c1_connection_bootstrap')
    denied('BOUNDED_CATALOG_PROFILE_REQUIRED',lambda:provision(g={**grant,'signatureUnits':'7'}))
    denied('BOUNDED_CATALOG_PROFILE_REQUIRED',lambda:provision(p={**profile,'namespace':'wrong'}))
    assert provision()['provisioned'];denied('FRESH_CATALOG_PROVISION_REQUIRED',provision)
    assert c.execute("SELECT c1_runtime_internal.first_binding_material('inert','{}')->'catalogActivation'->>'grantId'").fetchone()[0]=='catalog-grant'
    c.execute('RESET SESSION AUTHORIZATION');c.execute('SET ROLE c1_live_api');assert call('catalog_capabilities')=={'publish':True}
    q={'reviewId':'00000000-0000-4000-8000-000000000001','new_id':'00000000-0000-4000-8000-000000000010','op_id':'0x'+'1'*64,'key':'catalog-publish-key-1'}
    reject('CSRF','catalog_publish',**{**q,'csrf_hash':'wrong'})
    out=call('catalog_publish',**q);assert out['stage']=='ACCEPTED' and out['needsListing'] and out['targetListed']
    assert call('catalog_publish',**q)==out
    reject('IDEMPOTENCY_CONFLICT','catalog_publish',**{**q,'reviewId':'00000000-0000-4000-8000-000000000002'})
    reject('ORIGINAL_CATALOG_PENDING','catalog_publish',**{**q,'key':'catalog-publish-key-2','reviewId':'00000000-0000-4000-8000-000000000002'})
    c.execute('RESET ROLE')
    assert c.execute('SELECT state FROM c1_live_private.catalog_versions').fetchone()[0]=='PENDING'
    frozen=c.execute('SELECT body,image,terms FROM c1_live_private.catalog_versions').fetchone()
    child='00000000-0000-4000-8000-000000000011'
    def project(ident,action,block,event):
        params=c.execute('SELECT parameters FROM c1_live_private.intents WHERE id=%s',(ident,)).fetchone()[0]
        original={'functionName':action,'parameters':params};tx='0x'+str(block)*64
        c.execute("UPDATE c1_live_private.intents SET stage='UNKNOWN',observer_record=%s,transaction_hash=%s WHERE id=%s",(Jsonb(original),tx,ident))
        p,revision=c.execute('SELECT profile,revision FROM c1_live_private.stores').fetchone()
        snap={'authority':'CANONICAL_FINALIZED_CHAIN_FACTS','chainId':10143,'escrow':binding['escrow'],'blockNumber':str(block),'blockHash':'0x'+str(block+2)*64,'timestamp':'1','operations':{},'vouchers':{}}
        proof={'authority':'VERIFIED_ORIGINAL_CHAIN_OPERATION','original':original}
        receipt={'intentId':ident,'original':original,'transactionHash':tx,'functionName':action,'store':store,'proof':proof,'blockNumber':str(block),'blockHash':snap['blockHash'],'logIndex':'0','event':{'args':event},'operation':{'result':'0x'+'7'*64}}
        rows={'schema':'CP30_CHAIN_PROJECTION_V1','snapshot':snap,'receipt':receipt,'vouchers':[]}
        query={'store':store,'profile':p,'expectedRevision':revision,'intentRevision':1,'snapshot':snap,'rows':rows,'listingIntentId':child,'listingOpId':'0x'+'2'*64}
        def send():
            c.execute('SET ROLE catalog_observer')
            try:return c.execute('SELECT c1_runtime_internal.live_projection(%s,%s)',('inert',Jsonb(query))).fetchone()[0]
            finally:c.execute('RESET ROLE')
        assert send()['originalConfirmed'];query['expectedRevision']=revision+1;assert send()['replay']
    meal,version,hash_=c.execute('SELECT meal,version,terms_hash FROM c1_live_private.catalog_versions').fetchone()
    project(q['new_id'],'publish',1,{'mealId':'0x'+meal,'version':version,'termsHash':hash_,'revision':'1'})
    assert c.execute('SELECT state,listing_intent::text FROM c1_live_private.catalog_versions').fetchone()==('PUBLISHED',child)
    assert c.execute("SELECT count(*) FROM c1_live_private.intents WHERE action='setListed'").fetchone()[0]==1
    dto=c.execute('SELECT c1_live_private.intent_dto(i) FROM c1_live_private.intents i WHERE id=%s',(child,)).fetchone()[0]
    assert dto['parentIntentId']==q['new_id'] and dto['needsListing'] and dto['targetListed']
    project(child,'setListed',2,{'mealId':'0x'+meal,'kind':'2','value':True,'revision':'2'})
    assert c.execute('SELECT state FROM c1_live_private.catalog_versions').fetchone()[0]=='LIVE'
    assert c.execute('SELECT body,image,terms FROM c1_live_private.catalog_versions').fetchone()==frozen
    assert c.execute("SELECT count(*) FROM c1_live_private.authority_profiles WHERE role<>'catalogAuthority' AND profile=%s",(Jsonb(profile),)).fetchone()[0]==3
    print(json.dumps({'catalogExecution':'PASS','freshOwnedPg':True,'boundedDedicatedProvision':True,'publishThenListingRequired':True,'originalReplaySingleChild':True,'immutableHistory':True,'realRunTouched':False}))

if __name__=='__main__':review.draft.run(after_drafts=check)
