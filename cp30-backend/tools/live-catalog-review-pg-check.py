"""Fresh owned PG catalog previews. No signer, RPC, publication or live DB."""
import importlib.util,json,sys
from pathlib import Path
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('draft_check',ROOT/'tools/live-drafts-pg-check.py')
draft=importlib.util.module_from_spec(spec);spec.loader.exec_module(draft)
sys.path.insert(0,str(ROOT/'integrations'))
from business.catalog_codec import CatalogCodec
NODE='/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'

def check(ctx):
    c,call,reject=ctx['conn'],ctx['call'],ctx['reject']
    c.execute('ALTER TABLE c1_live_private.stores ADD COLUMN snapshot jsonb, ADD COLUMN rows jsonb, ADD COLUMN revision bigint DEFAULT 1')
    c.execute("UPDATE c1_live_private.stores SET snapshot='{}',rows='{\"controls\":{\"control_revision\":\"0\"}}'")
    before=c.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()
    c.execute((ROOT/'connection-migrations/042-live-catalog-reviews.sql').read_text())
    assert c.execute("SELECT c1_runtime_private.material('inert'),c1_runtime_private.floors('inert')").fetchone()==before
    binding={'chainId':10143,'escrow':'0x'+'1'*40,'asset':'0x'+'2'*40,'storeId':'0x'+draft.STORE,'owner':'0x'+'c'*40,'receiver':'0x'+'c'*40,'catalogAuthority':'0x'+'3'*40,'issuerAuthority':'0x'+'4'*40,'operatorAuthority':'0x'+'5'*40,'quoteAuthority':'0x'+'6'*40}
    c.execute("UPDATE c1_live_private.stores SET profile=jsonb_set(profile,'{binding}',%s)",(Jsonb(binding),))
    c.execute('SET ROLE c1_live_api')
    item=call('get');assert item['id']==item['draftId']==draft.NEW and item['mealId'].startswith('0x')
    assert call('list')['items'][0]['mealId']==item['mealId']
    assert call('get',draft.MEAL)['mealId']=='0x'+draft.MEAL
    reject('OWNER_BINDING_CHANGED','catalog_material',expectedRevision=3,session_hash='other')
    reject('STALE_REVISION','catalog_material',expectedRevision=2)
    m=call('catalog_material',expectedRevision=3);assert m['mealId']==item['mealId'] and m['version']=='1'
    terms={'mealId':m['mealId'],'version':m['version'],'unitPrice':'8000000','bodyDigest':'0x'+'7'*64,'imageDigest':'0x'+'d'*64,'windowCount':'1','startMinute0':'0','endMinute0':'1440','startMinute1':'0','endMinute1':'0'}
    codec=CatalogCodec(NODE);hash_=codec.call('catalogTermsHash',{'binding':binding,'input':terms})['termsHash']
    q={'expectedRevision':3,'storeRevision':1,'input':terms,'termsHash':hash_,'expectedControlRevision':'0','reviewId':'00000000-0000-4000-8000-000000000001','key':'catalog-review-key-1'}
    reject('CSRF','catalog_review',**{**q,'csrf_hash':'wrong'})
    reject('DRAFT_CATALOG_MISMATCH','catalog_review',**{**q,'input':{**terms,'unitPrice':'1'}})
    reject('STALE_REVIEW','catalog_review',**{**q,'storeRevision':2})
    reviewed=call('catalog_review',**q)
    assert call('catalog_review',**q)==reviewed
    r=reviewed['review'];assert r['price']==r['unitPrice']=='8000000' and r['needsListing'] and r['targetListed']
    assert r['collectionTimeZone']=='Asia/Shanghai' and r['draftId']==draft.NEW and r['imageDigest']=='0x'+'d'*64
    assert r['expiresAt']==301 and r['termsHash']==hash_ and 'input' not in r
    c.execute('RESET ROLE')
    assert c.execute('SELECT count(*) FROM c1_live_private.catalog_reviews').fetchone()[0]==1
    assert c.execute("SELECT c1_runtime_private.floors('inert')->'runtime_attempt'->>'catalog-review:00000000-0000-4000-8000-000000000001'").fetchone()[0]=='1'
    # Existing unlisted meal updates never silently relist it.
    c.execute('UPDATE c1_live_private.stores SET snapshot=%s',(Jsonb({'menu':{m['mealId']:{'currentVersion':'1','listed':False}}}),))
    c.execute('SET ROLE c1_live_api')
    m2=call('catalog_material',expectedRevision=3);assert m2['version']=='2'
    terms2={**terms,'version':'2'}
    reviewed2=call('catalog_review',**{**q,'input':terms2,'termsHash':codec.call('catalogTermsHash',{'binding':binding,'input':terms2})['termsHash'],'reviewId':'00000000-0000-4000-8000-000000000002','key':'catalog-review-key-2'})
    assert not reviewed2['review']['needsListing'] and not reviewed2['review']['targetListed']
    c.execute('RESET ROLE')
    print(json.dumps({'catalogReview':'PASS','canonicalDraftMapping':True,'immutablePreviewAndReplay':True,'existingListingPreserved':True,'realRunTouched':False}))

if __name__=='__main__':draft.run(after_drafts=check)
