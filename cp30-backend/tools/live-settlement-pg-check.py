"""Fresh PG settlement delay boundaries; synthetic original finalized receipt.

Reuses actual auth, owner, recovery and API SQL. No live configuration or chain.
"""
import importlib.util,json
from pathlib import Path
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('kitchen_check',ROOT/'tools/live-kitchen-pg-check.py')
kitchen=importlib.util.module_from_spec(spec);spec.loader.exec_module(kitchen)

def settlement(ctx):
    kitchen.kitchen(ctx)
    c,call,reject,store,voucher,rows=[ctx[k] for k in ('c','call','reject','store','voucher','rows')]
    c.execute('''CREATE ROLE c1_live_code_owner NOLOGIN;
ALTER TABLE c1_live_private.intents ADD COLUMN observer_record jsonb, ADD COLUMN revision bigint DEFAULT 1;
CREATE TABLE c1_live_private.receipts(ns text,intent uuid,hash text,block_number numeric,block_hash text,log_index numeric,proof jsonb,revision bigint);
CREATE TABLE c1_live_private.wallet_attempts(ns text,intent uuid,kind text,deployment jsonb,hash text,confirmed boolean DEFAULT false,proof jsonb,revision bigint DEFAULT 1,PRIMARY KEY(ns,intent,kind));
''')
    c.execute("""GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private,c1_runtime_internal TO c1_live_code_owner;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA c1_live_private,c1_private TO c1_live_code_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA c1_live_private TO c1_live_code_owner;
ALTER FUNCTION c1_runtime_internal.live_api(text,jsonb) OWNER TO c1_live_code_owner;
CREATE ROLE settlement_api_test NOLOGIN;
GRANT USAGE ON SCHEMA c1_runtime_internal TO settlement_api_test;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_api(text,jsonb) TO settlement_api_test;
""")
    attrs="SELECT proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='c1_runtime_internal.live_api(text,jsonb)'::regprocedure"
    before=c.execute(attrs).fetchone()
    c.execute((ROOT/'connection-migrations/039-live-settlement-delay.sql').read_text())
    assert c.execute(attrs).fetchone()==before
    ownerq={'store':store,'session_hash':'77','csrf_hash':'88'}
    assert c.execute("SELECT has_function_privilege('c1_live_code_owner','c1_live_private.settlement_info(text,c1_live_private.stores,text,text,bigint)','EXECUTE'),has_function_privilege('settlement_api_test','c1_live_private.settlement_info(text,c1_live_private.stores,text,text,bigint)','EXECUTE')").fetchone()==(True,False)
    def own(op,**q):
        c.execute('SET ROLE settlement_api_test')
        try:return call(op,**{**ownerq,**q})
        finally:c.execute('RESET ROLE')
    def denied(code,op,**q):
        c.execute('SET ROLE settlement_api_test')
        try:reject(code,op,**{**ownerq,**q})
        finally:c.execute('RESET ROLE')
    def now(t):c.execute('UPDATE c1_private.deployment SET now=%s',(t,))
    report='00000000-0000-4000-8000-000000000005';report_id='0x'+'5'*64
    tx='0x'+'a'*64;block='0x'+'b'*64
    original={'operation':'report','parameters':{'opId':report_id,'voucherId':voucher,'generation':'1'}}
    proof={'authority':'VERIFIED_ORIGINAL_CHAIN_OPERATION','transactionHash':tx,'blockHash':block,'blockNumber':'42','original':original,'operation':{'kind':'8','result':report_id,'executedAt':'54000'},'snapshot':{'timestamp':'54000'}}
    rows['units'][0]['report_id']=report_id
    # Marker time is deliberately earlier: it must not control the delay.
    rows['units'][0]['marker_at']='53000'
    c.execute('UPDATE c1_live_private.stores SET rows=%s,profile=profile||%s',(Jsonb(rows),Jsonb({'binding':{'owner':'0x'+'c'*40,'receiver':'0x'+'c'*40,'asset':'0x'+'d'*40,'escrow':'0x'+'e'*40,'chainId':10143},'assetMetadata':{'decimals':6,'symbol':'USDC'}})))
    c.execute('UPDATE c1_live_private.intents SET parameters=parameters||%s,observer_record=%s,transaction_hash=%s WHERE id=%s',(Jsonb({'generation':'1'}),Jsonb(original),tx,report))
    review='00000000-0000-4000-8000-000000000010';intent='00000000-0000-4000-8000-000000000011'
    now(54180)
    denied('SETTLEMENT_REPORT_REQUIRED','settle_review',voucher=voucher,review_id=review)
    assert own('payouts')['items'][0]['settleEligibleAt'] is None
    c.execute('INSERT INTO c1_live_private.receipts VALUES(%s,%s,%s,42,%s,0,%s,1)',('inert',report,tx,block,Jsonb(proof)))
    now(54179)
    payout=own('payouts');p=payout['items'][0]
    assert payout['serverTime']==54179 and p['reportConfirmedAt']==54000 and p['settleEligibleAt']==54180
    assert p['receiver']=='0x'+'c'*40 and p['asset']=='0x'+'d'*40 and p['assetSymbol']=='USDC' and p['assetDecimals']==6 and p['amount']=='7000000'
    assert p['settlementIntents']==[]
    denied('SETTLEMENT_DELAY','settle_review',voucher=voucher,review_id=review)
    now(54180)
    reviewed=own('settle_review',voucher=voucher,review_id=review)
    assert reviewed['review']['settleEligibleAt']==54180 and reviewed['review']['amount']=='7000000'
    assert 'settleEligibleAt' not in c.execute('SELECT payload FROM c1_live_private.reviews WHERE id=%s',(review,)).fetchone()[0]
    review2='00000000-0000-4000-8000-000000000012'
    own('settle_review',voucher=voucher,review_id=review2)
    q={'client':{'reviewId':review},'new_id':intent,'op_id':'0x'+'6'*64,'key':'original-settlement'}
    now(54179);denied('SETTLEMENT_DELAY','settle_confirm',**q)
    now(54180);accepted=own('settle_confirm',**q)
    assert own('settle_confirm',**q)==accepted
    denied('ORIGINAL_SETTLEMENT_PENDING','settle_confirm',client={'reviewId':review2},new_id='00000000-0000-4000-8000-000000000013',op_id='0x'+'9'*64,key='replacement-settlement')
    assert accepted['voucherId']==voucher and accepted['amount']=='7000000' and accepted['generation']=='1'
    assert own('payouts')['items'][0]['settlementIntents']==[accepted]
    denied('ORIGINAL_SETTLEMENT_PENDING','settle_review',voucher=voucher,review_id='00000000-0000-4000-8000-000000000012')
    now(54179)
    denied('SETTLEMENT_DELAY','wallet_material',id=intent)
    denied('SETTLEMENT_DELAY','wallet_attempt',id=intent,kind='settle')
    now(54180)
    assert own('wallet_material',id=intent)['intent']['id']==intent
    deployment={'from':'0x'+'c'*40,'chainId':10143,'to':'0x'+'e'*40,'value':'0'}
    own('wallet_attempt',id=intent,kind='settle',deployment=deployment,observerRecord={'original':'synthetic'})
    denied('ORIGINAL_WALLET_ATTEMPT_UNKNOWN','wallet_attempt',id=intent,kind='settle',deployment=deployment)
    # Original lookup/hash recording remains recoverable, even if clock is earlier.
    now(54179)
    assert 'settle' in own('wallet_material',id=intent)['attempts']
    own('wallet_hash',id=intent,kind='settle',hash='0x'+'7'*64)
    own('wallet_hash',id=intent,kind='settle',hash='0x'+'7'*64)
    denied('ORIGINAL_WALLET_LOCATOR_CONFLICT','wallet_hash',id=intent,kind='settle',hash='0x'+'8'*64)
    assert own('payouts')['items'][0]['settlementIntents'][0]['transactionHash']=='0x'+'7'*64
    reject('OWNER_BINDING_CHANGED','payouts',other=True,store=store)
    reject('NOT_FOUND','wallet_material',other=True,id=intent)
    # Invalid time proof fails closed; no current/marker/local-time fallback.
    c.execute("UPDATE c1_live_private.receipts SET proof=jsonb_set(proof,'{snapshot,timestamp}','\"54001\"')")
    assert own('payouts')['items'][0]['settleEligibleAt'] is None
    denied('SETTLEMENT_REPORT_REQUIRED','wallet_attempt',id=intent,kind='settle')
    for key,bad in [('authority','UNVERIFIED'),('transactionHash','0x'+'0'*64),('blockHash','0x'+'0'*64)]:
        c.execute('UPDATE c1_live_private.receipts SET proof=%s',(Jsonb({**proof,key:bad}),))
        assert own('payouts')['items'][0]['settleEligibleAt'] is None
        denied('SETTLEMENT_REPORT_REQUIRED','wallet_attempt',id=intent,kind='settle')
    c.execute("UPDATE c1_live_private.intents SET stage='FINAL_SUCCEEDED' WHERE id=%s",(intent,))
    assert own('wallet_material',id=intent)['intent']['stage']=='FINAL_SUCCEEDED'
    assert c.execute("SELECT count(*) FROM c1_live_private.intents WHERE action='settle'").fetchone()[0]==1
    print(json.dumps({'settlementDelay':'PASS','boundary179Denied180Allowed':True,'reportReceiptTimeOnly':True,'originalRecovery':True,'realRunTouched':False}))

if __name__=='__main__':kitchen.fixture.run(after_display=settlement,api_migration='038-live-kitchen-recovery.sql')
