"""Fresh PG17.11 regression: actual wallet auth + rate-limit functions, synthetic rows."""
import os,re,json,tempfile,subprocess
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[1]
def run():
    assert '17.11' in subprocess.check_output(['/opt/homebrew/bin/pg_ctl','--version'],env={'LC_ALL':'C'}).decode()
    with tempfile.TemporaryDirectory(prefix='mf-rate-pg-') as directory:
        base=Path(directory).resolve();os.chmod(base,0o700);pg=base/'pg';sock=base/'socket';sock.mkdir(mode=0o700)
        def command(*args):subprocess.run(args,env={'LC_ALL':'C'},check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        command('/opt/homebrew/bin/initdb','-D',str(pg),'-A','trust','--encoding=UTF8','--no-locale','-U','rate_check')
        started=False
        try:
            command('/opt/homebrew/bin/pg_ctl','-D',str(pg),'-l',str(base/'pg.log'),'-o',f"-k {sock} -h '' -p 5432 -c max_connections=12 -c shared_buffers=16MB",'-w','start');started=True
            with psycopg.connect(host=str(sock),user='rate_check',dbname='postgres',autocommit=True) as c:
                assert Path(c.execute('SHOW data_directory').fetchone()[0]).resolve()==pg
                c.execute('''
CREATE SCHEMA c1_private;CREATE SCHEMA c1_api;
CREATE ROLE c1_api_code_owner;CREATE ROLE c1_app_api;
GRANT USAGE ON SCHEMA c1_private,c1_api TO c1_api_code_owner,c1_app_api;
CREATE TABLE c1_private.deployment(ns text,manifest jsonb,now bigint,credential_epoch bigint);
CREATE TABLE c1_private.sessions(ns text,hash bytea,subject text,csrf bytea,revoked boolean,epoch bigint,identity_revision bigint,created bigint,activity bigint);
CREATE TABLE c1_private.identities(ns text,subject text,auth_kind text,revision bigint,recipient_key text);
CREATE TABLE c1_private.wallet_principals(ns text,subject text,identity_revision bigint,recipient_key text,expires_at bigint);
CREATE TABLE c1_private.external_session_expiry(ns text,hash bytea,expires_at bigint);
CREATE TABLE c1_private.verified_owner_bindings(ns text,subject text,owner text,enabled boolean,identity_revision bigint,credential_epoch bigint,verified_until bigint);
CREATE TABLE c1_private.payer_bindings(ns text,subject text,address text);
CREATE TABLE c1_private.rate_buckets(ns text,key text,period bigint,bucket bigint,count int,PRIMARY KEY(ns,key,period,bucket));
GRANT SELECT ON ALL TABLES IN SCHEMA c1_private TO c1_api_code_owner;
GRANT INSERT,UPDATE ON c1_private.rate_buckets TO c1_api_code_owner;
CREATE FUNCTION c1_private.h(text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode($1,'hex') $$;
CREATE FUNCTION c1_private.fail(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%',$1;END $$;
CREATE FUNCTION c1_private.auth_dynamic_email(text,jsonb,boolean) RETURNS c1_private.sessions LANGUAGE plpgsql AS $$ BEGIN PERFORM c1_private.fail('UNAUTHENTICATED');END $$;
INSERT INTO c1_private.deployment VALUES('inert','{"mode":"CP30_TESTNET_CONNECTION"}',100,1);
INSERT INTO c1_private.sessions VALUES('inert',decode('aa','hex'),'B',decode('cc','hex'),false,1,1,100,100);
INSERT INTO c1_private.identities VALUES('inert','B','wallet',1,'recipient');
INSERT INTO c1_private.wallet_principals VALUES('inert','B',1,'recipient',9999);
INSERT INTO c1_private.external_session_expiry VALUES('inert',decode('aa','hex'),9999);
INSERT INTO c1_private.verified_owner_bindings VALUES('inert','B','payer-B',true,1,1,9999);
''')
                def extract(path,pattern):return re.search(pattern, (ROOT/path).read_text(),re.S).group()
                c.execute(extract('connection-migrations/026-wallet-principal.sql',r'CREATE FUNCTION c1_private\.auth\(.*?\$\$;'))
                old=extract('migrations/010-read-models.sql',r'CREATE FUNCTION c1_api\.rate_limit\(.*?\$\$;');c.execute(old)
                c.execute('ALTER FUNCTION c1_api.rate_limit(text,jsonb) OWNER TO c1_api_code_owner; REVOKE ALL ON FUNCTION c1_api.rate_limit(text,jsonb) FROM PUBLIC; GRANT EXECUTE ON FUNCTION c1_api.rate_limit(text,jsonb) TO c1_app_api')
                def call(**extra):
                    q={'session_hash':'aa','csrf_hash':'cc','support':True,'buckets':[],**extra}
                    with c.transaction():
                        c.execute('SET LOCAL ROLE c1_app_api')
                        return c.execute('SELECT c1_api.rate_limit(%s,%s)',('inert',Jsonb(q))).fetchone()[0]
                def reject(code,**q):
                    try:call(**q)
                    except psycopg.Error as e:assert e.diag.message_primary==code
                    else:raise AssertionError(code)
                reject('PAYER_REQUIRED')
                metadata="SELECT proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='c1_api.rate_limit(text,jsonb)'::regprocedure"
                before=c.execute(metadata).fetchone()
                c.execute((ROOT/'connection-migrations/033-live-support-rate-binding.sql').read_text())
                assert c.execute(metadata).fetchone()==before
                reject('CSRF',csrf_hash='dd')
                for assignment in ('enabled=false','identity_revision=2','credential_epoch=2','verified_until=100'):
                    with c.transaction():
                        c.execute('UPDATE c1_private.verified_owner_bindings SET '+assignment)
                        reject('PAYER_BINDING_CHANGED')
                        raise psycopg.Rollback()
                for _ in range(3):assert call(payer='spoofed-browser-payer')['allowed']
                assert call()['error']=='RATE_LIMIT'
                buckets=dict(c.execute('SELECT key,count FROM c1_private.rate_buckets WHERE period=60').fetchall())
                assert buckets['support-payer:payer-B']==3 and buckets['support-subject:B']==4
                assert not any('spoofed' in key for key in buckets)
                # Another authenticated subject with the same verified payer
                # cannot evade the shared payer bucket by rotating sessions.
                c.execute("UPDATE c1_private.sessions SET subject='C'; UPDATE c1_private.identities SET subject='C'; UPDATE c1_private.wallet_principals SET subject='C'; UPDATE c1_private.verified_owner_bindings SET subject='C'")
                assert call()['error']=='RATE_LIMIT'
                assert c.execute("SELECT count FROM c1_private.rate_buckets WHERE key='support-payer:payer-B' AND period=60").fetchone()[0]==4
                assert call(support=False,buckets=[{'key':'public','period':60,'limit':120}])['allowed']
                # Non-live mode retains the old payer binding contract.
                c.execute("UPDATE c1_private.deployment SET manifest='{}'")
                reject('PAYER_REQUIRED')
                c.execute("INSERT INTO c1_private.payer_bindings VALUES('inert','C','legacy-payer')")
                assert call()['allowed']
                c.execute("UPDATE c1_private.deployment SET manifest='{\"mode\":\"CP30_TESTNET_CONNECTION\"}'; DELETE FROM c1_private.rate_buckets")
                for index in range(10):
                    c.execute('UPDATE c1_private.deployment SET now=%s',(100+60*index,))
                    assert call()['allowed']
                c.execute('UPDATE c1_private.deployment SET now=700')
                assert call()['error']=='RATE_LIMIT'
                print(json.dumps({'status':'PASS','realWalletAuthFunction':True,'subjectAndPayerLimitsRetained':True,'ownerAclSearchPathPreserved':True,'realRunTouched':False}))
        finally:
            if started:command('/opt/homebrew/bin/pg_ctl','-D',str(pg),'-m','fast','-w','stop')
if __name__=='__main__':run()
