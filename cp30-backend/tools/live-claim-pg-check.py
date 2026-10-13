"""Fresh PG claim/recover/display regression using actual auth and live SQL.

Runtime fencing/store guards and finalized data are synthetic. No real database,
network, signer or chain execution; authority execution is verified separately.
"""
import json,os,re,subprocess,tempfile
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[1]
def function(source):return re.search(r'CREATE OR REPLACE FUNCTION c1_runtime_internal\.live_api\(n text,q jsonb\).*?\$\$;',source,re.S).group()
def run(*, after_display=None, api_migration="037-live-claim-recovery-list.sql"):
    old=function((ROOT/'connection-migrations/026-wallet-principal.sql').read_text())
    new=function((ROOT/'connection-migrations/032-live-review-payload.sql').read_text())
    assert new.replace("(t.profile->'firstMeal')||p||jsonb_build_object","p||t.profile->'firstMeal'||jsonb_build_object")==old
    assert '17.11' in subprocess.check_output(['/opt/homebrew/bin/pg_ctl','--version'],env={'LC_ALL':'C'}).decode()
    with tempfile.TemporaryDirectory(prefix='mf-claim-pg-') as directory:
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
CREATE FUNCTION c1_live_private.store(text,text,boolean DEFAULT false) RETURNS c1_live_private.stores LANGUAGE sql AS $$ SELECT * FROM c1_live_private.stores WHERE ns=$1 AND store=$2 $$;
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
                c.execute('''
ALTER TABLE c1_private.sessions ADD COLUMN ns text DEFAULT 'inert', ADD COLUMN hash bytea, ADD COLUMN csrf bytea, ADD COLUMN revoked boolean DEFAULT false, ADD COLUMN created bigint DEFAULT 54000, ADD COLUMN activity bigint DEFAULT 54000, ADD COLUMN authenticated bigint DEFAULT 54000, ADD COLUMN revision bigint DEFAULT 1;
ALTER TABLE c1_private.deployment ADD COLUMN credential_epoch bigint DEFAULT 1;
ALTER TABLE c1_private.identities ADD COLUMN auth_kind text DEFAULT 'wallet', ADD COLUMN revision bigint DEFAULT 1;
CREATE TABLE c1_private.wallet_principals(ns text,subject text,recipient_key text,identity_revision bigint,expires_at bigint);
CREATE TABLE c1_private.external_session_expiry(ns text,hash bytea,expires_at bigint);
CREATE FUNCTION c1_private.h(text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode($1,'hex') $$;
CREATE FUNCTION c1_private.auth_dynamic_email(text,jsonb,boolean) RETURNS c1_private.sessions LANGUAGE plpgsql AS $$ BEGIN PERFORM c1_private.fail('UNAUTHENTICATED');END $$;
UPDATE c1_private.sessions SET hash=decode('aa','hex'),csrf=decode('cc','hex');
INSERT INTO c1_private.sessions(subject,identity_revision,epoch,hash,csrf) VALUES('other',1,1,decode('bb','hex'),decode('dd','hex'));
INSERT INTO c1_private.identities(ns,subject,recipient_key) VALUES('inert','other','other-recipient');
INSERT INTO c1_private.wallet_principals VALUES('inert','payer','recipient',1,99999),('inert','other','other-recipient',1,99999);
INSERT INTO c1_private.external_session_expiry VALUES('inert',decode('aa','hex'),99999),('inert',decode('bb','hex'),99999);
UPDATE c1_private.deployment SET now=54000;
ALTER TABLE c1_live_private.intents ADD COLUMN id uuid, ADD COLUMN idem text, ADD COLUMN client jsonb, ADD COLUMN session_hash text, ADD COLUMN csrf_hash text, ADD COLUMN identity_revision bigint, ADD COLUMN credential_epoch bigint, ADD COLUMN op_id text, ADD COLUMN result jsonb, ADD COLUMN transaction_hash text;
ALTER TABLE c1_live_private.claims ADD COLUMN id text, ADD COLUMN intent uuid, ADD COLUMN subject text, ADD COLUMN seq text, ADD COLUMN generation text, ADD COLUMN access_epoch bigint DEFAULT 0, ADD COLUMN display_epoch bigint DEFAULT 0, ADD COLUMN revision bigint DEFAULT 1;
DROP TABLE c1_live_private.credentials;
CREATE TABLE c1_live_private.credentials(ns text,hash text,kind text,voucher text,session_hash text,identity_revision bigint,credential_epoch bigint,access_epoch bigint,display_epoch bigint,valid_until bigint,active boolean,revision bigint);
CREATE TABLE c1_live_private.token_ops(ns text,subject text,kind text,idem text,voucher text,result jsonb);
CREATE TABLE c1_live_private.leases(ns text,store text,seq text,generation text,kind text,intent uuid,PRIMARY KEY(ns,store,seq,generation,kind));
''')
                source=(ROOT/'connection-migrations/023-live-business.sql').read_text()
                auth=(ROOT/'connection-migrations/026-wallet-principal.sql').read_text()
                c.execute(re.search(r'CREATE FUNCTION c1_private\.auth\(.*?\$\$;',auth,re.S).group())
                c.execute('CREATE OR REPLACE FUNCTION c1_live_private.context(text,jsonb,boolean) RETURNS c1_private.sessions LANGUAGE sql AS $$ SELECT c1_private.auth($1,$2,$3) $$')
                for name in ('unit','voucher_dto','redeemable','utc_window_end'):
                    body=re.search(r'CREATE FUNCTION c1_live_private\.'+name+r'\(.*?\$\$;',source,re.S).group()
                    c.execute(body.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1))
                c.execute((ROOT/'connection-migrations/035-live-intent-quote-display.sql').read_text())
                c.execute((ROOT/'connection-migrations/036-live-support-quote-window.sql').read_text())
                attrs="SELECT proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='c1_runtime_internal.live_api(text,jsonb)'::regprocedure"
                before=c.execute(attrs).fetchone()
                c.execute((ROOT/'connection-migrations'/api_migration).read_text())
                assert c.execute(attrs).fetchone()==before
                def call(op,other=False,**extra):
                    q={'op':op,'session_hash':'bb' if other else 'aa','csrf_hash':'dd' if other else 'cc','key':'inert-idempotency-key',**extra}
                    return c.execute('SELECT c1_runtime_internal.live_api(%s,%s)',('inert',Jsonb(q))).fetchone()[0]
                def reject(code,op,**q):
                    try:call(op,**q)
                    except psycopg.Error as e:assert e.diag.message_primary==code,e.diag.message_primary
                    else:raise AssertionError(code)
                review='00000000-0000-4000-8000-000000000001';intent='00000000-0000-4000-8000-000000000002'
                dto=call('claim_review',store=store,meal=meal,review_id=review)
                assert dto['review']['expectedUnitSeq']=='0' and dto['review']['deadline']=='54600'
                reject('STALE_REVIEW','claim_confirm',other=True,client={'reviewId':review},new_id=intent,op_id='0x'+'e'*64)
                q={'client':{'reviewId':review},'new_id':intent,'op_id':'0x'+'e'*64}
                issued=call('claim_confirm',**q);assert issued['action']=='issue' and issued['stage']=='ACCEPTED'
                assert call('claim_confirm',**q)==issued
                assert call('my_claims')['items']==[issued] and call('my_claims',other=True)['items']==[]
                reject('NOT_FOUND','intent_get',other=True,id=intent)
                reject('CSRF','claim_review',csrf_hash='ee',store=store,meal=meal,review_id=review)
                # Synthetic finalized fixture only; never claim this is an on-chain execution.
                voucher='0x'+'f'*64
                snapshot['terms']=[{'mealId':'0x'+meal,'version':'1','windowCount':'1','startMinute0':'870','endMinute0':'1140'}]
                snapshot['vouchers']={voucher:{'expired':False,'lockId':'0x'+'0'*64,'expiresAt':'99999'}}
                rows['units']=[{'voucher_id':voucher,'bucket':'R','generation':'1','price':'7000000','meal_id':'0x'+meal,'version':'1'}]
                rows['vouchers']=[{'id':voucher,'expires_at':'99999','lock_id':None,'marker_id':None,'expired':False}]
                c.execute('UPDATE c1_live_private.stores SET snapshot=%s,rows=%s',(Jsonb(snapshot),Jsonb(rows)))
                c.execute("UPDATE c1_live_private.intents SET stage='FINAL_SUCCEEDED'")
                c.execute('INSERT INTO c1_live_private.claims(ns,store,recipient_key,id,intent,subject,seq,generation) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',('inert',store,'recipient',voucher,intent,'payer','0','1'))
                assert call('my_vouchers')['items'][0]['id']==voucher and call('my_vouchers',other=True)['items']==[]
                reject('NOT_FOUND','voucher_get',other=True,id=voucher)
                recovered=call('recover',voucher=voucher,new_access_hash='11',new_session_hash='22',new_csrf_hash='33')
                assert recovered['redeemable'] is True
                reject('UNAUTHENTICATED','my_vouchers')
                display=call('display',session_hash='22',csrf_hash='33',voucher=voucher,access_hash='11',new_display_hash='44',key='display-key-one')
                assert display['validUntil']==54120
                replay=call('display',session_hash='22',csrf_hash='33',voucher=voucher,access_hash='11',new_display_hash='55',key='display-key-one')
                assert replay['replay'] is True
                assert c.execute("SELECT count(*) FROM c1_live_private.credentials WHERE kind='display'").fetchone()[0]==1
                reject('INVALID_CODE','display',session_hash='22',csrf_hash='33',voucher=voucher,access_hash='99',new_display_hash='66',key='display-key-two')
                if after_display is not None:after_display(locals())
                # Access expires at the UTC window boundary, regardless of voucher lifetime.
                c.execute('UPDATE c1_private.deployment SET now=68400; UPDATE c1_private.sessions SET activity=68400')
                reject('INVALID_CODE','display',session_hash='22',csrf_hash='33',voucher=voucher,access_hash='11',new_display_hash='66',key='display-key-two')
                print(json.dumps({'status':'PASS','realAuthAndLiveApi':True,'claimReplayAndRecipientIsolation':True,'recoverRotatesSession':True,'displayExpiryReplayAndWindow':True,'realRunTouched':False}))
        finally:
            if started:command('/opt/homebrew/bin/pg_ctl','-D',str(pg),'-m','fast','-w','stop')

if __name__=='__main__':run()
