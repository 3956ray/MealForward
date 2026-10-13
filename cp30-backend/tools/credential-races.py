"""C09 actual concurrent HTTPS credential races; secrets remain in memory only."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import threading
import sys
import time
import uuid
from smoke import Harness, IntegrationFailure


def accepted(client, path, body, before_send=None, timings=None):
    key=uuid.uuid4().hex
    for attempt in range(5):
        status,result=client.request('POST',path,body,key=key,before_send=before_send if attempt==0 else None)
        if attempt==0 and timings is not None:timings['end']=time.monotonic_ns()
        if status!=503:
            return status,result
        time.sleep(.025*(attempt+1))
    return status,result


def one(h, kind, number):
    h.new_case('c09-'+kind)
    side='a' if number%2 else 'b'
    other='b' if side=='a' else 'a'
    alice=h.login('alice',side)
    owner=h.login('owner1',other)
    same=h.login('same',other) if kind=='two-recover' else None
    review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
    fund=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']})
    h.actor(fund['id'],'0x'+format(0x71,'040x'));h.terminal(alice,fund['id'])
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'})
    issue=alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']})
    final=h.terminal(alice,issue['id']);voucher=final['result']['result']
    access=alice.ok('POST','/v1/vouchers/'+voucher+'/recover',{})
    display=alice.ok('POST','/v1/vouchers/'+voucher+'/display',{'access':access['access']})
    before=h.b.call('fixture_snapshot',h.namespace,{})
    gate=threading.Barrier(2,timeout=3)

    timings=[{},{}]
    def ready(index):
        gate.wait()
        if index==(0 if number<=10 else 1):time.sleep(.0015)
        timings[index]['start']=time.monotonic_ns()
    def first():
        if kind in {'recover','two-recover'}:
            return accepted(alice,'/v1/vouchers/'+voucher+'/recover',{},lambda:ready(0),timings[0])
        if kind=='refresh':
            return accepted(alice,'/v1/vouchers/'+voucher+'/display',{'access':access['access']},lambda:ready(0),timings[0])
        return accepted(alice,'/v1/auth/logout',{},lambda:ready(0),timings[0])

    def second():
        if kind=='two-recover':
            return accepted(same,'/v1/vouchers/'+voucher+'/recover',{},lambda:ready(1),timings[1])
        return accepted(owner,'/v1/stores/S1/locks',{'display':display['display']},lambda:ready(1),timings[1])

    with ThreadPoolExecutor(max_workers=2) as pool:
        a,b=pool.submit(first),pool.submit(second)
        left,right=a.result(timeout=10),b.result(timeout=10)
    if not (timings[0]['start']<timings[1]['end'] and timings[1]['start']<timings[0]['end']):raise IntegrationFailure('C09:REQUESTS_DID_NOT_OVERLAP')
    if kind=='two-recover':
        if left[0]!=200 or right[0]!=200:raise IntegrationFailure('C09:TWO_RECOVER_NOT_COMPLETED')
        credentials=[left[1]['access'],right[1]['access']]
        results=[client.request('POST','/v1/vouchers/'+voucher+'/display',{'access':secret})
                 for client,secret in zip([alice,same],credentials)]
        if sorted(status for status,_ in results)!=[200,409]:raise IntegrationFailure('C09:MULTIPLE_ACCESS_EPOCHS')
        order='first-then-second' if left[1]['accessEpoch']<right[1]['accessEpoch'] else 'second-then-first'
    else:
        if right[0]==200:
            order='lock-first'
            h.terminal(owner,right[1]['id'])
            if kind=='recover' and (left[0]!=200 or left[1].get('redeemable') is not False):raise IntegrationFailure('C09:LOCK_REPLACED')
            if kind=='refresh' and left[0]!=409:raise IntegrationFailure('C09:LOCK_REFRESHED')
            if kind=='logout' and left[0]!=200:raise IntegrationFailure('C09:LOGOUT_FAILED')
        else:
            order='credential-first'
            if left[0]!=200 or right[0]!=409:raise IntegrationFailure('C09:INVALID_RACE_OUTCOME')
        # The old display never becomes usable again, including when the other
        # request initially encountered the journal's short pending fence.
        old=owner.request('POST','/v1/stores/S1/checks',{'display':display['display']})
        if old[0]!=409:raise IntegrationFailure('C09:OLD_DISPLAY_REVIVED')
    after=h.b.call('fixture_snapshot',h.namespace,{})
    old,new=before['credentialState'][0],after['credentialState'][0]
    assert (old['issuedAt'],old['expiresAt'])==(new['issuedAt'],new['expiresAt'])
    assert new['activeAccess']<=1 and new['activeDisplay']<=1
    assert before['rollups']==after['rollups']
    h.records.append({'scenario':'C09','kind':kind,'round':number,'status':'PASS','order':order,
                      'ports':[alice.port,owner.port],'initialRequestIntervalsNs':timings,'responses':[{'status':status,'error':value.get('error'),'stage':value.get('stage')}
                                                               for status,value in [left,right]],
                      'before':before,'after':after})
    return order


def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
    h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        for kind in ['recover','refresh','logout','two-recover']:
            counts={}
            for number in range(1,21):
                order=one(h,kind,number);counts[order]=counts.get(order,0)+1
            h.records.append({'scenario':'C09-order-counts','kind':kind,'counts':counts})
            if len(counts)!=2 or min(counts.values())<5:raise IntegrationFailure('C09:ORDER_COVERAGE:'+kind)
            print(kind+':20/20',flush=True)
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='CREDENTIAL_RACE_EXCEPTION:'+type(exc).__name__
    finally:
        try:h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1


if __name__=='__main__':sys.exit(main())
