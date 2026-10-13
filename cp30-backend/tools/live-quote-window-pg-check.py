"""Execute old/new live_api review branches in a fresh PG17.11 synthetic schema.

Guards are synthetic; the live_api function and review INSERT/DTO expression are
the actual migration source. Never connects to the real application database.
"""
import json,os,re,subprocess,tempfile
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[1]
def function(source):return re.search(r'CREATE OR REPLACE FUNCTION c1_runtime_internal\.live_api\(n text,q jsonb\).*?\$\$;',source,re.S).group()
def run():
    old=function((ROOT/'connection-migrations/026-wallet-principal.sql').read_text())
    new=function((ROOT/'connection-migrations/032-live-review-payload.sql').read_text())
    assert new.replace("(t.profile->'firstMeal')||p||jsonb_build_object","p||t.profile->'firstMeal'||jsonb_build_object")==old
    assert '17.11' in subprocess.check_output(['/opt/homebrew/bin/pg_ctl','--version'],env={'LC_ALL':'C'}).decode()
    with tempfile.TemporaryDirectory(prefix='mf-review-pg-') as directory:
        base=Path(directory).resolve();os.chmod(base,0o700);pg=base/'pg';sock=base/'socket';sock.mkdir(mode=0o700)
        def command(*args):subprocess.run(args,env={'LC_ALL':'C'},check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        command('/opt/homebrew/bin/initdb','-D',str(pg),'-A','trust','--encoding=UTF8','--no-locale','-U','review_check')
        started=False
        try:
            command('/opt/homebrew/bin/pg_ctl','-D',str(pg),'-l',str(base/'pg.log'),'-o',f"-k {sock} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB",'-w','start');started=True
            with psycopg.connect(host=str(sock),user='review_check',dbname='postgres',autocommit=True) as c:
                assert Path(c.execute('SHOW data_directory').fetchone()[0]).resolve()==pg
                c.execute('''
CREATE SCHEMA c1_private;CREATE SCHEMA c1_live_private;CREATE SCHEMA c1_runtime_private;CREATE SCHEMA c1_runtime_internal;
CREATE TABLE c1_private.sessions(subject text,identity_revision bigint,epoch bigint);
CREATE TABLE c1_private.deployment(ns text,now bigint);
CREATE TABLE c1_private.identities(ns text,subject text,recipient_key text);
CREATE TABLE c1_private.verified_owner_bindings(ns text,subject text,enabled boolean,owner text,identity_revision bigint,credential_epoch bigint,verified_until bigint,revision bigint);
CREATE TABLE c1_live_private.stores(ns text,store text,meal text,profile jsonb,snapshot jsonb,rows jsonb,revision bigint);
CREATE TABLE c1_live_private.first_binding(ns text,state text);
CREATE TABLE c1_live_private.intents(ns text,store text,subject text,recipient_key text,action text,stage text,parameters jsonb);
CREATE TABLE c1_live_private.reviews(ns text,id uuid,subject text,store text,kind text,payload jsonb,store_revision bigint,identity_revision bigint,wallet_revision bigint,expires bigint,used boolean,revision bigint);
CREATE TABLE c1_live_private.claims(ns text,store text,recipient_key text);
CREATE TABLE c1_live_private.credentials(dummy text);
CREATE FUNCTION c1_private.fail(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%',$1;END $$;
CREATE FUNCTION c1_runtime_private.check_open(text,jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION c1_runtime_private.base_guard(text,boolean,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION c1_live_private.context(text,jsonb,boolean) RETURNS c1_private.sessions LANGUAGE sql AS $$ SELECT * FROM c1_private.sessions LIMIT 1 $$;
CREATE FUNCTION c1_live_private.store(text,text,boolean) RETURNS c1_live_private.stores LANGUAGE sql AS $$ SELECT * FROM c1_live_private.stores WHERE ns=$1 AND store=$2 $$;
CREATE FUNCTION c1_live_private.owner(text,c1_live_private.stores,c1_private.sessions) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION c1_live_private.voucher_dto(text,c1_live_private.claims,c1_live_private.stores) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
INSERT INTO c1_private.sessions VALUES('payer',1,1);
INSERT INTO c1_private.deployment VALUES('inert',100);
INSERT INTO c1_private.identities VALUES('inert','payer','recipient');
INSERT INTO c1_private.verified_owner_bindings VALUES('inert','payer',true,'0xcccccccccccccccccccccccccccccccccccccccc',1,1,999,1);
INSERT INTO c1_live_private.first_binding VALUES('inert','BOUND');
''')
                meal='b'*64;store='a'*64
                profile={'firstMeal':{'name':'Original meal','unitPrice':'999','mealId':'wrong-display-id','payer':'wrong-display-owner','quantity':'9','amount':'9'}}
                snapshot={'menu':{'0x'+meal:{'listed':True,'currentVersion':'1','terms':{'unitPrice':'7000000','termsHash':'0x'+'d'*64},'candidate':{'available':True,'unitSeq':'0','nextGeneration':'1','termsHash':'0x'+'d'*64}}}}
                rows={'controls':{'paused':False,'closed':False,'lifetime':'0'},'units':[{'voucher_id':'voucher','bucket':'H','generation':'1','price':'7000000'}]}
                c.execute('INSERT INTO c1_live_private.stores VALUES(%s,%s,%s,%s,%s,%s,1)',('inert',store,meal,Jsonb(profile),Jsonb(snapshot),Jsonb(rows)))
                c.execute(old)
                request={'op':'support_review','store':store,'meal':meal,'quantity':1,'review_id':'00000000-0000-4000-8000-000000000001'}
                broken=c.execute('SELECT c1_runtime_internal.live_api(%s,%s)',('inert',Jsonb(request))).fetchone()[0]
                assert broken['review']['payer']=='wrong-display-owner'
                before=c.execute('SELECT to_jsonb(r) FROM c1_live_private.reviews r ORDER BY id').fetchall()
                attrs="SELECT proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='c1_runtime_internal.live_api(text,jsonb)'::regprocedure"
                metadata=c.execute(attrs).fetchone()
                c.execute((ROOT/'connection-migrations/032-live-review-payload.sql').read_text())
                assert c.execute(attrs).fetchone()==metadata
                assert c.execute('SELECT to_jsonb(r) FROM c1_live_private.reviews r ORDER BY id').fetchall()==before
                for index,op in enumerate(('support_review','claim_review','settle_review'),2):
                    q={**request,'op':op,'review_id':f'00000000-0000-4000-8000-{index:012d}','voucher':'voucher'}
                    dto=c.execute('SELECT c1_runtime_internal.live_api(%s,%s)',('inert',Jsonb(q))).fetchone()[0]
                    payload=c.execute('SELECT payload FROM c1_live_private.reviews WHERE id=%s',(q['review_id'],)).fetchone()[0]
                    assert all(dto['review'][k]==v for k,v in payload.items())
                    assert dto['review']['name']=='Original meal'
                    assert dto['reviewId']==q['review_id'] and dto['store']==store
                    assert dto['review']['expiresAt']==400
                    if op=='support_review':assert dto['review']['amount']=='7000000' and dto['review']['quantity']=='1' and dto['review']['mealId']=='0x'+meal
                # Only future support deadlines change; existing payloads stay exact.
                before=c.execute('SELECT to_jsonb(r) FROM c1_live_private.reviews r ORDER BY id').fetchall()
                old_source=(ROOT/'connection-migrations/032-live-review-payload.sql').read_text()
                new_source=(ROOT/'connection-migrations/036-live-support-quote-window.sql').read_text()
                assert function(new_source).replace("    p=p||jsonb_build_object('deadline',(now+1800)::text);\n",'')==function(old_source)
                c.execute(new_source)
                assert c.execute(attrs).fetchone()==metadata
                assert c.execute('SELECT to_jsonb(r) FROM c1_live_private.reviews r ORDER BY id').fetchall()==before
                for index,op in enumerate(('support_review','claim_review','settle_review'),5):
                    q={**request,'op':op,'review_id':f'00000000-0000-4000-8000-{index:012d}','voucher':'voucher'}
                    dto=c.execute('SELECT c1_runtime_internal.live_api(%s,%s)',('inert',Jsonb(q))).fetchone()[0]
                    assert dto['review']['deadline']==('1900' if op=='support_review' else '700')
                    assert dto['review']['expiresAt']==400
                c.execute('ALTER TABLE c1_live_private.intents ADD COLUMN id uuid, ADD COLUMN result jsonb, ADD COLUMN transaction_hash text')
                original=(ROOT/'connection-migrations/023-live-business.sql').read_text()
                old_dto=re.search(r'CREATE FUNCTION c1_live_private\.intent_dto\(.*?\$\$;',original,re.S).group()
                c.execute(old_dto)
                c.execute("INSERT INTO c1_live_private.intents(ns,store,action,stage,parameters,id) VALUES('inert','original-store','fund','WAIT_ACTOR',%s,'00000000-0000-4000-8000-000000000099')",(Jsonb({'mealId':'0x'+'e'*64,'quantity':'1','amount':'7000000','deadline':'700'}),))
                old_rows=c.execute('SELECT to_jsonb(i) FROM c1_live_private.intents i').fetchall()
                old_value=c.execute('SELECT c1_live_private.intent_dto(i) FROM c1_live_private.intents i').fetchone()[0]
                dto_attrs="SELECT proowner,proacl,prosecdef,proconfig,provolatile FROM pg_proc WHERE oid='c1_live_private.intent_dto(c1_live_private.intents)'::regprocedure"
                dto_meta=c.execute(dto_attrs).fetchone()
                c.execute((ROOT/'connection-migrations/035-live-intent-quote-display.sql').read_text())
                assert c.execute(dto_attrs).fetchone()==dto_meta
                assert c.execute('SELECT to_jsonb(i) FROM c1_live_private.intents i').fetchall()==old_rows
                new_value=c.execute('SELECT c1_live_private.intent_dto(i) FROM c1_live_private.intents i').fetchone()[0]
                expected={'mealId':'0x'+'e'*64,'quantity':'1','amount':'7000000','quoteExpiresAt':'700'}
                assert new_value=={**old_value,**expected}
                c.execute("UPDATE c1_live_private.intents SET action='markHandover'")
                other=c.execute('SELECT c1_live_private.intent_dto(i) FROM c1_live_private.intents i').fetchone()[0]
                assert not set(expected)&set(other) and other['action']=='handover'
                print(json.dumps({'status':'PASS','dtoAndFutureSupportWindow':True,'branches':['support','claim','settle'],'ownerAclSearchPathPreserved':True,'existingReviewUnchanged':True,'realRunTouched':False}))
        finally:
            if started:command('/opt/homebrew/bin/pg_ctl','-D',str(pg),'-m','fast','-w','stop')

if __name__=='__main__':run()
