"""Fresh PG finalized-lock failure + UTC+8 window regressions; no real chain.

Auth/owner/API/projection SQL are actual. RPC proofs, store freshness and runtime
fencing are synthetic fixtures; observer canonicality is tested independently.
"""
import importlib.util,json
from pathlib import Path
from psycopg.types.json import Jsonb
import psycopg

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('kitchen_check',ROOT/'tools/live-kitchen-pg-check.py')
kitchen=importlib.util.module_from_spec(spec);spec.loader.exec_module(kitchen)

def check(ctx):
    kitchen.kitchen(ctx)
    c,call,store,voucher,rows,snapshot=[ctx[k] for k in ('c','call','store','voucher','rows','snapshot')]
    c.execute('''CREATE ROLE c1_runtime_code_owner NOLOGIN;
CREATE ROLE lock_observer_test NOLOGIN;
ALTER TABLE c1_live_private.intents ADD COLUMN observer_record jsonb, ADD COLUMN revision bigint DEFAULT 1;
ALTER TABLE c1_live_private.intents ADD CONSTRAINT intents_stage_check CHECK(stage IN('ACCEPTED','UNKNOWN','WAIT_ACTOR','FINAL_SUCCEEDED'));
CREATE TABLE c1_live_private.receipts(ns text,intent uuid,hash text,block_number numeric,block_hash text,log_index numeric,proof jsonb,revision bigint,PRIMARY KEY(ns,intent));
GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private,c1_runtime_internal TO c1_runtime_code_owner;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA c1_live_private,c1_private TO c1_runtime_code_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c1_live_private TO c1_runtime_code_owner;
''')
    c.execute((ROOT/'connection-migrations/040-live-collection-timezone.sql').read_text())
    c.execute((ROOT/'connection-migrations/041-live-lock-final-revert.sql').read_text())
    c.execute('''ALTER FUNCTION c1_runtime_internal.live_projection(text,jsonb) OWNER TO c1_runtime_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.live_projection(text,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_runtime_internal TO lock_observer_test;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_projection(text,jsonb) TO lock_observer_test;
CREATE OR REPLACE FUNCTION c1_live_private.store(n text,k text,risk boolean DEFAULT false) RETURNS c1_live_private.stores LANGUAGE plpgsql AS $$
DECLARE t c1_live_private.stores;now bigint;BEGIN SELECT * INTO t FROM c1_live_private.stores WHERE ns=n AND store=k;SELECT d.now INTO now FROM c1_private.deployment d WHERE ns=n;
IF risk AND now-(t.snapshot->>'timestamp')::bigint>120 THEN PERFORM c1_private.fail('FINALIZED_FACTS_STALE');END IF;RETURN t;END $$;
''')
    lock='00000000-0000-4000-8000-000000000003';op='0x'+'1'*64;tx='0x'+'a'*64;block='0x'+'b'*64
    original={'functionName':'lock','parameters':{'opId':op,'voucherId':voucher,'generation':'1'}}
    zero='0x'+'0'*64
    proof={'authority':'VERIFIED_ORIGINAL_LOCK_REVERT','original':original,'transactionHash':tx,'blockNumber':'42','blockHash':block,'timestamp':'53980','receiptStatus':'0','voucher':{'generation':'1','lockId':zero,'markerId':zero,'reportId':zero,'settleId':zero},'operation':{'kind':'0'}}
    rows['units'][0]['bucket']='R';rows['vouchers'][0].update(lock_id=None,marker_id=None,report_id=None,settle_id=None)
    snapshot.update(blockNumber='43',blockHash='0x'+'c'*64,timestamp='53990')
    c.execute('UPDATE c1_live_private.stores SET rows=%s,snapshot=%s',(Jsonb(rows),Jsonb(snapshot)))
    c.execute("UPDATE c1_live_private.intents SET stage='FINAL_SUCCEEDED' WHERE action IN('lock','markHandover','report')")
    c.execute("UPDATE c1_live_private.intents SET stage='UNKNOWN',result=NULL,observer_record=%s,transaction_hash=%s WHERE id=%s",(Jsonb(original),tx,lock))
    c.execute("INSERT INTO c1_live_private.leases VALUES('inert',%s,'9','1','lock','00000000-0000-4000-8000-000000000099')",(store,))
    q={'store':store,'expectedRevision':1,'intentRevision':1,'id':lock,'lockRevert':proof}
    def project(value):
        c.execute('SET ROLE lock_observer_test')
        try:return c.execute('SELECT c1_runtime_internal.live_projection(%s,%s)',('inert',Jsonb(value))).fetchone()[0]
        finally:c.execute('RESET ROLE')
    def denied(code,value):
        try:project(value)
        except psycopg.Error as e:assert e.diag.message_primary==code,e.diag.message_primary
        else:raise AssertionError(code)
        assert c.execute('SELECT stage FROM c1_live_private.intents WHERE id=%s',(lock,)).fetchone()[0]=='UNKNOWN'
        assert c.execute('SELECT count(*) FROM c1_live_private.leases WHERE intent=%s',(lock,)).fetchone()[0]==1
    for field,value in [('authority','UNVERIFIED'),('receiptStatus','1'),('transactionHash','0x'+'d'*64),('original',{}),('blockNumber','44')]:
        denied('VERIFIED_LOCK_REVERT_REQUIRED',{**q,'lockRevert':{**proof,field:value}})
    denied('VERIFIED_LOCK_REVERT_REQUIRED',{**q,'intentRevision':2})
    denied('VERIFIED_LOCK_REVERT_REQUIRED',{**q,'lockRevert':{**proof,'voucher':{**proof['voucher'],'generation':'2'}}})
    rows['vouchers'][0]['lock_id']=op
    c.execute('UPDATE c1_live_private.stores SET rows=%s',(Jsonb(rows),))
    denied('VERIFIED_LOCK_REVERT_REQUIRED',q)
    rows['vouchers'][0]['lock_id']=None
    c.execute('UPDATE c1_live_private.stores SET rows=%s,snapshot=jsonb_set(snapshot,\'{timestamp}\',\'"53000"\')',(Jsonb(rows),))
    denied('FINALIZED_FACTS_STALE',q)
    c.execute('UPDATE c1_live_private.stores SET snapshot=%s',(Jsonb(snapshot),))
    assert project(q)['state']=='FINAL_REVERT' and project(q)['replay'] is True
    assert c.execute('SELECT count(*) FROM c1_live_private.leases WHERE intent=%s',(lock,)).fetchone()[0]==0
    assert c.execute("SELECT count(*) FROM c1_live_private.leases WHERE seq='9'").fetchone()[0]==1
    assert c.execute('SELECT log_index FROM c1_live_private.receipts WHERE intent=%s',(lock,)).fetchone()[0] is None
    dto=call('intent_get',id=lock,session_hash='77',csrf_hash='88')
    assert dto['stage']=='FINAL_REVERT' and dto['result']=={'outcome':'FINAL_REVERT','reason':'TRANSACTION_REVERTED','transactionHash':tx,'blockHash':block}
    assert not call('voucher_get',id=voucher,session_hash='77',csrf_hash='88')['pending']
    assert c.execute('SELECT count(*) FROM c1_live_private.credentials WHERE active').fetchone()[0]==0
    # Outside UTC+8 window: no new usable code, even after safely released failure.
    out=call('recover',voucher=voucher,session_hash='77',csrf_hash='88',key='outside-recover',new_access_hash='90',new_session_hash='91',new_csrf_hash='92')
    assert not out['redeemable'] and out['collectionTimeZone']=='Asia/Shanghai'
    # Pure exact boundary checks: UTC06:30 corresponds to local14:30, UTC11 to19.
    for at,expected,end in [(23399,False,23399),(23400,True,39600),(39599,True,39600),(39600,False,39600),(54000,False,54000)]:
        value=c.execute('SELECT c1_live_private.redeemable(%s,c,t,%s),c1_live_private.utc_window_end(t,c.id,%s) FROM c1_live_private.claims c JOIN c1_live_private.stores t ON t.ns=c.ns AND t.store=c.store WHERE c.id=%s',('inert',at,at,voucher)).fetchone()
        assert value==(expected,end),(at,value)
    c.execute('UPDATE c1_private.deployment SET now=28800')
    c.execute("UPDATE c1_live_private.stores SET snapshot=jsonb_set(snapshot,'{timestamp}','\"28800\"')")
    recovered=call('recover',voucher=voucher,session_hash='91',csrf_hash='92',key='inside-recover',new_access_hash='95',new_session_hash='93',new_csrf_hash='94')
    assert recovered['redeemable']
    displayed=call('display',voucher=voucher,session_hash='93',csrf_hash='94',key='inside-display',access_hash='95',new_display_hash='96')
    assert displayed['validUntil']==28920
    review=call('support_review',store=store,meal=ctx['meal'],quantity=1,session_hash='93',csrf_hash='94',review_id='00000000-0000-4000-8000-000000000050')
    assert review['review']['collectionTimeZone']=='Asia/Shanghai'
    # Existing outer fixture advances its clock to 68400 and checks old access.
    c.execute("UPDATE c1_live_private.stores SET snapshot=jsonb_set(snapshot,'{timestamp}','\"68400\"')")
    print(json.dumps({'lockFinalRevert':'PASS','actualWorkerRole':True,'failureReplayAndLeaseIsolation':True,'oldCodeRemainsInvalid':True,'utcPlus8Boundaries':'PASS','realRunTouched':False}))

if __name__=='__main__':kitchen.fixture.run(after_display=check,api_migration='038-live-kitchen-recovery.sql')
