"""Targeted fresh PG17.11 SQL checks, never opens the application run/database.

Uses synthetic context guards and the real live owner function. Does not claim
end-to-end runtime journal/controller or real wallet validation.
"""
import json,os,subprocess,tempfile
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[1]
BIN=Path('/opt/homebrew/bin')
STORE='a'*64;MEAL='b'*64;NEW='11111111-1111-4111-8111-111111111111'

def run(*, after_drafts=None):
    assert '17.11' in subprocess.check_output([str(BIN/'pg_ctl'),'--version'],env={}).decode()
    with tempfile.TemporaryDirectory(prefix='mf-draft-pg-') as directory:
        base=Path(directory).resolve();os.chmod(base,0o700)
        pg=base/'pg';sock=base/'socket';sock.mkdir(mode=0o700)
        def command(*args):
            subprocess.run(args,env={'LC_ALL':'C'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
        command(str(BIN/'initdb'),'-D',str(pg),'-A','trust','--no-locale','--encoding=UTF8','-U','draft_check')
        started=False
        try:
            try:
                command(str(BIN/'pg_ctl'),'-D',str(pg),'-l',str(base/'pg.log'),'-o',f"-k {sock} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB",'-w','start');started=True
            except subprocess.CalledProcessError:
                print((base/'pg.log').read_text()[-2000:]);raise
            with psycopg.connect(host=str(sock),user='draft_check',dbname='postgres',autocommit=True) as conn:
                assert Path(conn.execute('SHOW data_directory').fetchone()[0]).resolve()==pg
                conn.execute('''
CREATE ROLE c1_runtime_table_owner; CREATE ROLE c1_runtime_code_owner;
CREATE ROLE c1_runtime_controller_code_owner; CREATE ROLE c1_live_code_owner; CREATE ROLE c1_live_api;
CREATE SCHEMA c1_private;CREATE SCHEMA c1_live_private AUTHORIZATION c1_runtime_table_owner;
CREATE SCHEMA c1_runtime_private;CREATE SCHEMA c1_runtime_internal;
GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private,c1_runtime_internal TO c1_live_code_owner,c1_live_api,c1_runtime_code_owner,c1_runtime_controller_code_owner;
CREATE TABLE c1_private.sessions(subject text,identity_revision bigint,epoch bigint);
CREATE TABLE c1_private.store_registrations(ns text,id text,subject text,record jsonb);
CREATE TABLE c1_private.verified_owner_bindings(ns text,subject text,enabled boolean,owner text,revision bigint,identity_revision bigint,credential_epoch bigint,verified_until bigint);
CREATE TABLE c1_private.deployment(ns text,now bigint);
CREATE TABLE c1_live_private.stores(ns text,store text,registration_id text,meal text,profile jsonb,PRIMARY KEY(ns,store));
ALTER TABLE c1_live_private.stores OWNER TO c1_runtime_table_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA c1_private TO c1_live_code_owner;
GRANT SELECT ON c1_live_private.stores TO c1_live_code_owner;
CREATE FUNCTION c1_private.fail(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%',$1;END $$;
CREATE FUNCTION c1_live_private.context(n text,q jsonb,mutation boolean) RETURNS c1_private.sessions LANGUAGE plpgsql AS $$
DECLARE s c1_private.sessions;BEGIN
 IF q->>'ticket' IS DISTINCT FROM 'inert-ticket' THEN PERFORM c1_private.fail('CLOSED');END IF;
 SELECT * INTO s FROM c1_private.sessions WHERE subject=q->>'session_hash';
 IF NOT FOUND THEN PERFORM c1_private.fail('UNAUTHENTICATED');END IF;
 IF mutation AND q->>'csrf_hash' IS DISTINCT FROM 'inert-csrf' THEN PERFORM c1_private.fail('CSRF');END IF;
 RETURN s;END $$;
CREATE FUNCTION c1_live_private.store(n text,k text,risk boolean) RETURNS c1_live_private.stores LANGUAGE plpgsql AS $$
DECLARE t c1_live_private.stores;BEGIN SELECT * INTO t FROM c1_live_private.stores WHERE ns=n AND store=k;
 IF NOT FOUND THEN PERFORM c1_private.fail('NOT_FOUND');END IF;RETURN t;END $$;
CREATE FUNCTION c1_runtime_private.material(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"original":true}'::jsonb $$;
CREATE FUNCTION c1_runtime_private.floors(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"runtime_attempt":{"original":1}}'::jsonb $$;
''')
                source=(ROOT/'connection-migrations/023-live-business.sql').read_text()
                owner=source.split('CREATE FUNCTION c1_live_private.owner(',1)[1].split('END $$;',1)[0]
                conn.execute('CREATE FUNCTION c1_live_private.owner('+owner+'END $$;')
                before=conn.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()
                migration=(ROOT/'connection-migrations/031-live-drafts.sql').read_text()
                conn.execute('BEGIN');conn.execute(migration);conn.execute('ROLLBACK')
                assert conn.execute("SELECT to_regclass('c1_live_private.drafts')").fetchone()[0] is None
                assert before==conn.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()
                conn.execute(migration)
                assert before==conn.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()
                profile={'binding':{'owner':'0x'+'c'*40},'firstMeal':{'name':'Published','description':'Original','price':'7000000','windows':[[0,1440]]}}
                conn.execute('INSERT INTO c1_live_private.stores VALUES(%s,%s,%s,%s,%s)',('inert',STORE,'registration',MEAL,Jsonb(profile)))
                conn.execute("INSERT INTO c1_private.sessions VALUES('owner',1,1),('other',1,1)")
                conn.execute("INSERT INTO c1_private.deployment VALUES('inert',1)")
                conn.execute("INSERT INTO c1_private.store_registrations VALUES('inert','registration','owner','{\"bindingRevision\":1}')")
                conn.execute('INSERT INTO c1_private.verified_owner_bindings VALUES(%s,%s,true,%s,1,1,1,100)',('inert','owner','0x'+'c'*40))
                conn.execute('SET ROLE c1_live_api')
                def call(op,meal=NEW,payload=None,key='inert-key-0000001',**extra):
                    q={'op':op,'store':STORE,'meal':meal,'ticket':'inert-ticket','session_hash':'owner','csrf_hash':'inert-csrf','key':key,**extra}
                    if payload is not None:q['payload']=payload
                    with conn.transaction():
                        conn.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'+(' READ ONLY' if op in ('get','list','image_get') else ''))
                        return conn.execute('SELECT c1_runtime_internal.live_draft(%s,%s)',('inert',Jsonb(q))).fetchone()[0]
                def reject(code,*args,**kwargs):
                    try:call(*args,**kwargs)
                    except psycopg.Error as exc:assert exc.diag.message_primary==code,(code,exc.diag.message_primary)
                    else:raise AssertionError('Expected '+code)
                assert call('get',MEAL)['draft']['name']=='Published'
                assert call('get')['revision']==0
                reject('OWNER_BINDING_CHANGED','list',session_hash='other')
                reject('UNAUTHENTICATED','get',session_hash='absent')
                reject('CLOSED','get',ticket='closed')
                payload={'name':'Private','description':'Draft','price':'8000000','windows':[[0,1440]],'expectedRevision':0}
                reject('CSRF','save',payload=payload,csrf_hash='wrong')
                saved=call('save',payload=payload);assert saved['revision']==1 and saved['saved']
                assert call('save',payload=payload)==saved
                reject('IDEMPOTENCY_CONFLICT','save',payload={**payload,'price':'9'})
                reject('STALE_REVISION','save',payload=payload,key='inert-key-0000002')
                assert call('save',payload={**payload,'expectedRevision':1},key='inert-key-0000002')['revision']==2
                image={'image':'iVBORw0KGgo=','imageDigest':'d'*64,'expectedRevision':2}
                assert call('image_save',payload=image,key='inert-image-00001')['revision']==3
                assert call('image_save',payload=image,key='inert-image-00001')['revision']==3
                assert call('image_get')['image'].strip()==image['image']
                reject('OWNER_BINDING_CHANGED','image_get',session_hash='other')
                reject('INVALID_MEAL','get',meal='f'*64)
                assert len(call('list')['items'])==1
                conn.execute('RESET ROLE')
                assert conn.execute('SELECT profile FROM c1_live_private.stores').fetchone()[0]==profile
                material=conn.execute("SELECT c1_runtime_private.material('inert')").fetchone()[0]
                assert 'privateDrafts' in material and 'image' not in material['privateDrafts']['drafts'][0]
                assert material['privateDrafts']['drafts'][0]['imageSha256']
                assert conn.execute("SELECT c1_runtime_private.floors('inert')->'runtime_attempt'->>%s",('private-draft:'+STORE+':'+NEW,)).fetchone()[0]=='3'
                if after_drafts is not None:after_drafts(locals())
                conn.execute("UPDATE c1_private.verified_owner_bindings SET verified_until=0")
                conn.execute('SET ROLE c1_live_api')
                reject('OWNER_BINDING_CHANGED','get')
                print(json.dumps({'status':'PASS','scope':'fresh PG17.11 SQL; synthetic context, real owner checks','liveRunTouched':False}))
        finally:
            if started:command(str(BIN/'pg_ctl'),'-D',str(pg),'-m','fast','-w','stop')

if __name__=='__main__':run()
