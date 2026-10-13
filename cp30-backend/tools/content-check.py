"""Actual persisted original-content negatives over owned PG and HTTPS."""
import argparse,base64,signal,sys,time
from smoke import Harness,IntegrationFailure

PAYER='0x'+format(0x71,'040x')
FAULTS=['missing_body','missing_image','corrupt_body','corrupt_image']

def snapshot(h):return h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'SNAPSHOT')

def corrupt(h,kind,meal='meal'):
    h.expect(h.b.call('fixture_fault',h.namespace,{'kind':kind,'store':'S1','meal':meal,'version':1}),'CONTENT_FAULT')

def issued_negative(h,kind):
    h.new_case(kind);alice=h.login('alice');owner=h.login('owner1','b')
    review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':2})
    fund=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(fund['id'],PAYER);h.terminal(alice,fund['id'])
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'})
    issue=alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']});final=h.terminal(alice,issue['id']);vid=final['result']['result']
    access=alice.ok('POST','/v1/vouchers/'+vid+'/recover',{})
    display=alice.ok('POST','/v1/vouchers/'+vid+'/display',{'access':access['access']})
    assert owner.ok('POST','/v1/stores/S1/checks',{'display':display['display']})['valid']
    before=snapshot(h);corrupt(h,kind)
    requests=[(alice,'/v1/vouchers/'+vid+'/display',{'access':access['access']}),
              (owner,'/v1/stores/S1/checks',{'display':display['display']}),
              (owner,'/v1/stores/S1/locks',{'display':display['display']}),
              (alice,'/v1/claims/reviews',{'store':'S1','meal':'meal'})]
    outcomes=[]
    for client,path,payload in requests:
        status,result=client.request('POST',path,payload)
        assert status==503 and result['error']=='CONTENT_UNAVAILABLE'
        outcomes.append({'operation':path.rsplit('/',1)[-1],'status':status,'error':result['error']})
    after=snapshot(h)
    for key in ['rollups','units','orders','entries','vouchers','reservations','pendingEmails','pendingSubjects','credentialState','intentStates']:
        assert after[key]==before[key],key
    private=alice.ok('GET','/v1/vouchers/'+vid);public=alice.ok('GET','/v1/stores/S1/meals/meal')
    assert private['terms']['available'] is False and public['available'] is False
    h.records.append({'scenario':'original-content-issued-negative','fault':kind,'status':'PASS','requests':outcomes,'before':before,'after':after})

def publish_negative(h,kind):
    h.new_case('publish-'+kind);owner=h.login('owner1')
    saved=owner.ok('PUT','/v1/stores/S1/drafts/newmeal',{'name':'New meal','description':'Exact original\nUTF-8','price':'7','windows':[[0,1440]],'expectedRevision':0})
    image=base64.b64decode(h.fixture['terms'][0]['image'])
    uploaded=owner.ok('PUT','/v1/stores/S1/drafts/newmeal/image',image,mime='image/png',revision=saved['revision'])
    review=owner.ok('POST','/v1/stores/S1/drafts/newmeal/review',{'expectedRevision':uploaded['revision']})
    h.signal_app('reconciler',signal.SIGSTOP)
    try:
        intent=owner.ok('POST','/v1/stores/S1/drafts/newmeal/publish',{'reviewId':review['reviewId']})
        h.wait(lambda:snapshot(h)['receipts']==1,'ORIGINAL_PUBLISH_RECEIPT')
        original=h.expect(h.a.call('ticket_query',h.namespace,{'ticket_id':intent['id']}),'AUTHORITY_ORIGINAL')
        assert original['status']=='FINAL_SUCCEEDED'
        before=snapshot(h);corrupt(h,kind,'newmeal')
    finally:h.signal_app('reconciler',signal.SIGCONT)
    time.sleep(.4);after=snapshot(h)
    assert owner.request('GET','/v1/stores/S1/meals/newmeal')[0]==404
    assert after['appliedReceipts']==0 and after['receipts']==1 and after['provenance']['height']==0
    assert after['rollups']==before['rollups'] and after['intents']==before['intents']==1
    h.records.append({'scenario':'original-content-final-publish-negative','fault':kind,'status':'PASS','sourceFinal':True,'publicHeadAbsent':True,'before':before,'after':after})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start();h.flow()
        for kind in FAULTS:issued_negative(h,kind)
        for kind in FAULTS:publish_negative(h,kind)
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='CONTENT_CHECK_EXCEPTION:'+type(exc).__name__
    finally:
        try:
            if h.processes:h.signal_app('reconciler',signal.SIGCONT)
            h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
