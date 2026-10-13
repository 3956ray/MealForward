"""Fresh owned PG multi-meal SQL: synthetic chain facts, actual auth/owner guards.
Never opens the real application database or signer. Catalog execution has its own tests.
"""
import importlib.util,json,re
from pathlib import Path
from psycopg.types.json import Jsonb
import psycopg
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('kitchen_check',ROOT/'tools/live-kitchen-pg-check.py')
kitchen=importlib.util.module_from_spec(spec);spec.loader.exec_module(kitchen)

def check(ctx):
    kitchen.kitchen(ctx)
    c,call,reject,store,meal,voucher,rows,snapshot=[ctx[k] for k in ('c','call','reject','store','meal','voucher','rows','snapshot')]
    c.execute('''CREATE ROLE c1_live_code_owner;CREATE ROLE c1_runtime_code_owner;CREATE ROLE c1_runtime_policy_owner;
CREATE ROLE c1_live_api;CREATE ROLE c1_live_observer;
ALTER TABLE c1_live_private.stores ADD PRIMARY KEY(ns,store);
CREATE FUNCTION c1_runtime_internal.live_material(n text,q jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('store',to_jsonb(t),'intent','{}'::jsonb) FROM c1_live_private.stores t WHERE ns=n AND store=q->>'store' $$;
''')
    # Exact new catalog table, excluding unrelated signer/runtime provisioning.
    schema=re.search(r'CREATE TABLE c1_live_private.catalog_versions\(.*?;',(ROOT/'connection-migrations/043-live-catalog-execution.sql').read_text(),re.S).group()
    c.execute(schema)
    c.execute('''GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private,c1_runtime_internal TO c1_live_code_owner,c1_runtime_code_owner,c1_runtime_policy_owner,c1_live_api,c1_live_observer;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA c1_private,c1_live_private TO c1_live_code_owner,c1_runtime_code_owner;
''')
    c.execute((ROOT/'connection-migrations/040-live-collection-timezone.sql').read_text())
    c.execute((ROOT/'connection-migrations/044-live-multi-meal.sql').read_text())
    c.execute('''ALTER FUNCTION c1_runtime_internal.live_api(text,jsonb) OWNER TO c1_live_code_owner;
REVOKE ALL ON FUNCTION c1_runtime_internal.live_api(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_runtime_internal.live_api(text,jsonb) TO c1_live_api;
''')
    new='c'*64;pending='d'*64
    def insert(m,version,state,name,price,ident):
        body={'name':name,'description':'New description','price':price,'windows':[[0,420]]}
        terms={'mealId':'0x'+m,'version':version,'unitPrice':price,'windowCount':'1','startMinute0':'0','endMinute0':'420','startMinute1':'0','endMinute1':'0'}
        c.execute('INSERT INTO c1_live_private.catalog_versions(ns,store,meal,version,draft_id,draft_revision,body,image,image_digest,terms,terms_hash,needs_listing,target_listed,publish_intent,state) VALUES(%s,%s,%s,%s,%s,1,%s,%s,%s,%s,%s,true,true,%s,%s)',('inert',store,m,version,'11111111-1111-4111-8111-111111111111',Jsonb(body),b'PNG',m,Jsonb(terms),'0x'+m,ident,state))
    insert(new,'1','LIVE','New half USDC','500000','00000000-0000-4000-8000-000000000020')
    insert(new,'2','LIVE','New version','900000','00000000-0000-4000-8000-000000000021')
    insert(pending,'1','PUBLISHED','Not listed yet','100000','00000000-0000-4000-8000-000000000022')
    snapshot['menu']['0x'+new]={'listed':True,'currentVersion':'2','terms':{'unitPrice':'900000','termsHash':'0x'+new},'candidate':{'available':True,'unitSeq':'1','nextGeneration':'1','termsHash':'0x'+new}}
    snapshot['menu']['0x'+pending]={'listed':True,'currentVersion':'1','terms':{'unitPrice':'100000'},'candidate':{'available':False}}
    rows['units'][0]['seq']='0'
    rows['units'].append({'seq':'1','meal_id':'0x'+new,'version':'1','terms_hash':'0x'+new,'bucket':'A','price':'500000','generation':'0','voucher_id':None})
    c.execute('UPDATE c1_live_private.stores SET snapshot=%s,rows=%s',(Jsonb(snapshot),Jsonb(rows)))
    old=c.execute('SELECT profile FROM c1_live_private.stores').fetchone()[0]
    c.execute('SET ROLE c1_live_api')
    menu=call('public_meals',store=store)['items'];assert len(menu)==2
    item=next(x for x in menu if x['id']==new)
    assert item['name']=='New version' and item['price']=='900000' and item['version']=='2' and item['eligible']=='1' and item['supported']=='1'
    assert item['financial']['counts']=={'F':'1','A':'1','R':'0','H':'0','S':'0','X':'0'} and item['financial']['liability']=='500000'
    assert item['collectionTimeZone']=='Asia/Shanghai' and item['windows']==[[0,420]]
    oldvoucher=call('voucher_get',id=voucher,session_hash='77',csrf_hash='88')
    assert oldvoucher['terms']['name']=='Original meal' and oldvoucher['price']=='7000000' and oldvoucher['version']=='1'
    reject('OWNER_BINDING_CHANGED','workbench',other=True,store=store)
    bench=call('workbench',store=store,session_hash='77',csrf_hash='88');assert len(bench['items'])==2 and bench['catalogIntents']==[]
    review=call('support_review',store=store,meal=new,quantity=1,session_hash='77',csrf_hash='88',review_id='00000000-0000-4000-8000-000000000030')['review']
    assert review['name']=='New version' and review['unitPrice']==review['amount']=='900000' and review['mealId']=='0x'+new
    reject('UNAVAILABLE','support_review',store=store,meal=pending,quantity=1,session_hash='77',csrf_hash='88',review_id='00000000-0000-4000-8000-000000000031')
    # Candidate points to an older funded unit, so the recipient sees its original 0.5 terms.
    review=call('claim_review',other=True,store=store,meal=new,review_id='00000000-0000-4000-8000-000000000032')['review']
    assert review['name']=='New half USDC' and review['price']=='500000' and review['version']=='1' and review['expectedUnitSeq']=='1'
    claimq={'client':{'reviewId':'00000000-0000-4000-8000-000000000032'},'new_id':'00000000-0000-4000-8000-000000000040','op_id':'0x'+'8'*64,'key':'new-meal-claim'}
    claimed=call('claim_confirm',other=True,**claimq)
    assert claimed==call('claim_confirm',other=True,**claimq) and claimed['action']=='issue'
    reject('CSRF','claim_review',other=True,csrf_hash='ee',store=store,meal=new,review_id='00000000-0000-4000-8000-000000000033')
    def image(m,v):return c.execute('SELECT c1_runtime_internal.live_catalog_image(%s,%s)',('inert',Jsonb({'store':store,'meal':m,'version':v}))).fetchone()[0]
    assert image(new,'1')['image']=='UE5H'
    try:image(pending,'1')
    except psycopg.Error as e:assert e.diag.message_primary=='NOT_FOUND'
    else:raise AssertionError('pending image leaked')
    c.execute('RESET ROLE')
    c.execute('SET ROLE c1_live_observer')
    material=c.execute('SELECT c1_runtime_internal.live_material(%s,%s)',('inert',Jsonb({'store':store}))).fetchone()[0]
    assert material['catalogMeals']==['0x'+meal,'0x'+new,'0x'+pending]
    c.execute('RESET ROLE')
    assert c.execute('SELECT profile FROM c1_live_private.stores').fetchone()[0]==old
    # Published content stays hidden until both transactions are finalized.
    c.execute("UPDATE c1_live_private.catalog_versions SET state='LIVE' WHERE meal=%s",(pending,))
    assert len(call('public_meals',store=store)['items'])==3
    # New voucher details remain version 1 even though the visible menu is version 2.
    newvoucher='0x'+'7'*64
    rows['units'][1].update(bucket='R',generation='1',voucher_id=newvoucher)
    rows['vouchers'].append({'id':newvoucher,'expires_at':'99999','lock_id':None,'marker_id':None,'expired':False})
    c.execute('UPDATE c1_live_private.stores SET rows=%s',(Jsonb(rows),))
    c.execute("INSERT INTO c1_live_private.claims(ns,store,recipient_key,id,intent,subject,seq,generation) VALUES('inert',%s,'other-recipient',%s,%s,'other','1','1')",(store,newvoucher,claimq['new_id']))
    dto=call('voucher_get',other=True,id=newvoucher)
    assert dto['price']=='500000' and dto['terms']['name']=='New half USDC' and dto['version']=='1' and dto['terms']['windows']==[[0,420]]
    # A newer on-chain version without matching confirmed content cannot borrow old text.
    snapshot['menu']['0x'+new]['currentVersion']='3'
    c.execute('UPDATE c1_live_private.stores SET snapshot=%s',(Jsonb(snapshot),))
    assert all(x['id']!=new for x in call('public_meals',store=store)['items'])
    # Restore fixture's outer session checks after this callback.
    print(json.dumps({'multiMeal':'PASS','historicalClaimTerms':True,'oldVoucherPreserved':True,'pendingHidden':True,'exactVersionImages':True,'ownerAndCsrfGuards':True,'actualApiAndObserverRoles':True,'realRunTouched':False}))

if __name__=='__main__':kitchen.fixture.run(after_display=check,api_migration='038-live-kitchen-recovery.sql')
