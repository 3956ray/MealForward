"""Fresh synthetic PG: original kitchen recovery, actual auth/owner/API guards.

Chain states below are explicit fixtures, not a signer or projection execution.
"""
import importlib.util,json,re
from pathlib import Path
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('claim_check',ROOT/'tools/live-claim-pg-check.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

def kitchen(ctx):
    c,call,reject,store,voucher,rows,snapshot=[ctx[k] for k in ('c','call','reject','store','voucher','rows','snapshot')]
    c.execute('''ALTER TABLE c1_live_private.intents ADD COLUMN parent uuid;
ALTER TABLE c1_live_private.stores ADD COLUMN registration_id text;
CREATE TABLE c1_private.store_registrations(ns text,id text,subject text,record jsonb);
UPDATE c1_live_private.stores SET registration_id='registration';
UPDATE c1_private.verified_owner_bindings SET verified_until=99999;
INSERT INTO c1_private.store_registrations VALUES('inert','registration','payer','{"bindingRevision":"1"}');
''')
    source=(ROOT/'connection-migrations/023-live-business.sql').read_text()
    owner=re.search(r'CREATE FUNCTION c1_live_private\.owner\(.*?\$\$;',source,re.S).group()
    c.execute(owner.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1))
    c.execute("UPDATE c1_live_private.stores SET profile=profile||%s",(Jsonb({'binding':{'owner':'0x'+'c'*40}}),))
    rows['units'][0]['seq']='0';snapshot['timestamp']='53990'
    c.execute('UPDATE c1_live_private.stores SET rows=%s,snapshot=%s',(Jsonb(rows),Jsonb(snapshot)))
    ownerq={'store':store,'session_hash':'22','csrf_hash':'33'}
    def own(op,**q):return call(op,**{**ownerq,**q})
    def state():return c.execute('SELECT (SELECT count(*) FROM c1_live_private.intents),(SELECT count(*) FROM c1_live_private.credentials WHERE active),(SELECT sum(access_epoch+display_epoch) FROM c1_live_private.claims)').fetchone()
    before=state()
    assert own('code_check',display_hash='44')['valid'] is True
    assert own('code_check',display_hash='44')['valid'] is True and state()==before
    reject('OWNER_BINDING_CHANGED','code_check',other=True,store=store,display_hash='44')
    reject('OWNER_BINDING_CHANGED','workbench',other=True,store=store)
    lock='00000000-0000-4000-8000-000000000003';lock_id='0x'+'1'*64
    q={'display_hash':'44','new_id':lock,'op_id':lock_id,'key':'original-lock-key'}
    locked=own('lock_confirm',**q)
    assert own('lock_confirm',**q)==locked
    assert c.execute("SELECT count(*) FROM c1_live_private.intents WHERE action='lock'").fetchone()[0]==1
    reject('INVALID_CODE','lock_confirm',**ownerq,display_hash='44',new_id=lock,op_id=lock_id,key='replacement-lock-key')
    bench=own('workbench');item=bench['redemptionIntents'][0]
    assert bench['serverTime']==54000 and bench['snapshotTime']=='53990'
    assert item['id']==lock and item['lockId']==lock_id and item['voucherId']==voucher
    assert item['result'] is None and item['transactionHash'] is None
    assert set(item)=={'id','intentId','store','action','stage','result','transactionHash','voucherId','lockId','parentIntentId'}
    # Finalized lock fixture, then real handover admission with original replay.
    rows['vouchers'][0]['lock_id']=lock_id;rows['vouchers'][0]['seq']='0';rows['vouchers'][0]['generation']='1'
    c.execute('UPDATE c1_live_private.stores SET rows=%s',(Jsonb(rows),))
    c.execute("UPDATE c1_live_private.intents SET stage='FINAL_SUCCEEDED',result=%s WHERE id=%s",(Jsonb({'result':lock_id,'transactionHash':'0x'+'2'*64,'blockHash':'0x'+'3'*64}),lock))
    handover='00000000-0000-4000-8000-000000000004';marker='0x'+'4'*64
    q={'case_id':lock_id,'new_id':handover,'op_id':marker,'key':'original-handover-key'}
    handed=own('handover_confirm',**q)
    assert handed['action']=='handover' and own('handover_confirm',**q)==handed
    case=own('case_get',id=lock_id)
    assert case['locked'] and not case['marked'] and case['state']=='R' and case['pending']
    assert case['price']=='7000000' and case['terms']['name']=='Original meal'
    assert case['id']==lock_id and case['voucher']==voucher and len(case['redemptionIntents'])==2
    reject('OWNER_BINDING_CHANGED','case_get',other=True,store=store,id=lock_id)
    # Report link and finalized R -> H fixtures preserve original results verbatim.
    report='00000000-0000-4000-8000-000000000005'
    c.execute("INSERT INTO c1_live_private.intents(ns,store,subject,action,stage,parameters,id,parent,op_id) VALUES('inert',%s,'payer','report','ACCEPTED',%s,%s,%s,%s)",(store,Jsonb({'voucherId':voucher,'lockId':lock_id}),report,handover,'0x'+'5'*64))
    c.execute("UPDATE c1_live_private.intents SET stage='FINAL_SUCCEEDED' WHERE id=%s",(handover,))
    rows['vouchers'][0]['marker_id']=marker
    c.execute('UPDATE c1_live_private.stores SET rows=%s',(Jsonb(rows),))
    case=own('case_get',id=lock_id)
    assert case['marked'] and case['state']=='R' and case['pending']
    child=next(x for x in case['redemptionIntents'] if x['action']=='report')
    assert child['parentIntentId']==handover and child['result'] is None
    rows['units'][0]['bucket']='H'
    c.execute('UPDATE c1_live_private.stores SET rows=%s',(Jsonb(rows),))
    c.execute("UPDATE c1_live_private.intents SET stage='FINAL_SUCCEEDED' WHERE id=%s",(report,))
    assert own('case_get',id=lock_id)['state']=='H' and not own('case_get',id=lock_id)['pending']
    # Scope filtering and fresh-session recovery, without copying private fields.
    c.execute("INSERT INTO c1_live_private.intents(ns,store,subject,action,stage,parameters,id) VALUES('foreign',%s,'payer','lock','ACCEPTED','{}','00000000-0000-4000-8000-000000000006'),('inert',%s,'other','lock','ACCEPTED','{}','00000000-0000-4000-8000-000000000007'),('inert','another-store','payer','lock','ACCEPTED','{}','00000000-0000-4000-8000-000000000008')",(store,store))
    assert len(own('workbench')['redemptionIntents'])==3
    c.execute("INSERT INTO c1_live_private.intents(ns,store,subject,action,stage,parameters,id) VALUES('inert',%s,'payer','lock','ACCEPTED',%s,'00000000-0000-4000-8000-000000000009')",(store,Jsonb({'voucherId':'0x'+'9'*64})))
    assert len(own('workbench')['redemptionIntents'])==4
    assert len(own('case_get',id=lock_id)['redemptionIntents'])==3
    c.execute("INSERT INTO c1_private.sessions SELECT subject,identity_revision,epoch,ns,decode('77','hex'),decode('88','hex'),false,created,activity,authenticated,revision FROM c1_private.sessions WHERE hash=decode('22','hex')")
    c.execute("INSERT INTO c1_private.external_session_expiry VALUES('inert',decode('77','hex'),99999)")
    assert own('workbench',session_hash='77',csrf_hash='88')['redemptionIntents']==own('workbench')['redemptionIntents']
    print(json.dumps({'kitchenRecovery':'PASS','checksDoNotConsume':True,'originalReplay':True,'ownerIsolation':True,'chainStates':'synthetic fixtures only'}))

if __name__=='__main__':fixture.run(after_display=kitchen,api_migration='038-live-kitchen-recovery.sql')
