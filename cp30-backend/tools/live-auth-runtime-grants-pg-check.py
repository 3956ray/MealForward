"""Fresh PG17.11 regression: actual wallet auth runtime ACL, synthetic rows."""
import os,re,json,tempfile,subprocess
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[1]
def run():
    assert '17.11' in subprocess.check_output(['/opt/homebrew/bin/pg_ctl','--version'],env={'LC_ALL':'C'}).decode()
    with tempfile.TemporaryDirectory(prefix='mf-auth-acl-pg-') as directory:
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
CREATE ROLE c1_auth_code_owner;CREATE ROLE c1_live_code_owner;
CREATE ROLE c1_runtime_policy_owner;CREATE ROLE c1_runtime_code_owner;
GRANT USAGE ON SCHEMA c1_private TO c1_auth_code_owner,c1_live_code_owner,c1_runtime_policy_owner,c1_runtime_code_owner;
GRANT USAGE ON SCHEMA c1_private,c1_api TO c1_api_code_owner,c1_app_api;
CREATE TABLE c1_private.deployment(ns text,manifest jsonb,now bigint,credential_epoch bigint);
CREATE TABLE c1_private.sessions(ns text,hash bytea,subject text,csrf bytea,revoked boolean,epoch bigint,identity_revision bigint,created bigint,activity bigint);
CREATE TABLE c1_private.identities(ns text,subject text,auth_kind text,revision bigint,recipient_key text);
CREATE TABLE c1_private.wallet_principals(ns text,subject text,identity_revision bigint,recipient_key text,expires_at bigint);
CREATE TABLE c1_private.external_session_expiry(ns text,hash bytea,expires_at bigint);
CREATE TABLE c1_private.verified_owner_bindings(ns text,subject text,owner text,enabled boolean,identity_revision bigint,credential_epoch bigint,verified_until bigint);
CREATE TABLE c1_private.payer_bindings(ns text,subject text,address text);
CREATE TABLE c1_private.rate_buckets(ns text,key text,period bigint,bucket bigint,count int,PRIMARY KEY(ns,key,period,bucket));
GRANT SELECT ON ALL TABLES IN SCHEMA c1_private TO c1_api_code_owner,c1_auth_code_owner;
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
                c.execute(extract('connection-migrations/026-wallet-principal.sql',r'CREATE FUNCTION c1_private\.auth\(.*?GRANT EXECUTE ON FUNCTION c1_private\.auth.*?;'))
                roles=('c1_runtime_policy_owner','c1_runtime_code_owner')
                def call(role,csrf='cc'):
                    with c.transaction():
                        c.execute('SET LOCAL ROLE '+role)
                        return c.execute("SELECT (c1_private.auth(%s,%s,true)).subject",('inert',Jsonb({'session_hash':'aa','csrf_hash':csrf}))).fetchone()[0]
                def reject(role,code,csrf='cc'):
                    try:call(role,csrf)
                    except psycopg.Error as e:assert e.sqlstate==code,(e.sqlstate,code)
                    else:raise AssertionError('expected rejection')
                for role in roles:reject(role,'42501')
                metadata="SELECT proowner,prosrc,prosecdef,proconfig FROM pg_proc WHERE oid='c1_private.auth(text,jsonb,boolean)'::regprocedure"
                before=c.execute(metadata).fetchone()
                rows=c.execute('SELECT to_jsonb(s) FROM c1_private.sessions s').fetchall()
                c.execute((ROOT/'connection-migrations/034-wallet-auth-runtime-grants.sql').read_text())
                assert c.execute(metadata).fetchone()==before
                assert c.execute('SELECT to_jsonb(s) FROM c1_private.sessions s').fetchall()==rows
                for role in roles:
                    assert call(role)=='B'
                    reject(role,'P0001','dd')
                    assert not c.execute('SELECT rolcanlogin FROM pg_roles WHERE rolname=%s',(role,)).fetchone()[0]
                    for assignment in ('revoked=true','epoch=2','identity_revision=2'):
                        with c.transaction():
                            c.execute('UPDATE c1_private.sessions SET '+assignment)
                            reject(role,'P0001')
                            raise psycopg.Rollback()
                    with c.transaction():
                        c.execute('UPDATE c1_private.wallet_principals SET expires_at=100')
                        reject(role,'P0001')
                        raise psycopg.Rollback()
                reject('c1_app_api','42501')
                grants=c.execute("SELECT grantee::regrole::text FROM pg_proc,aclexplode(proacl) WHERE oid='c1_private.auth(text,jsonb,boolean)'::regprocedure AND privilege_type='EXECUTE'").fetchall()
                assert {x[0] for x in grants}=={'c1_auth_code_owner','c1_live_code_owner','c1_api_code_owner',*roles}
                print(json.dumps({'status':'PASS','realWalletAuth':True,'runtimeRolesNoLogin':True,'csrfAndSessionChecksRetained':True,'exactAcl':True,'functionAndRowsUnchanged':True,'realRunTouched':False}))
        finally:
            if started:command('/opt/homebrew/bin/pg_ctl','-D',str(pg),'-m','fast','-w','stop')
if __name__=='__main__':run()
