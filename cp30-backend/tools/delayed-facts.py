"""R1/C08 actual un-applied originals, revocation, >72h delay and observer restart."""
import argparse,base64,hashlib,signal,sys,time,traceback,uuid
from smoke import Harness,IntegrationFailure
from owned import private_file
from c1.fixtures import canonical_email,email_key

PAYER='0x'+format(0x71,'040x')
def snapshot(h):return h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'SNAPSHOT')
def fund(h,alice):
    review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(intent['id'],PAYER);h.terminal(alice,intent['id'])
def issue(h,alice):
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'})
    return alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']})
def locked(h,alice,owner):
    intent=issue(h,alice);vid=h.terminal(alice,intent['id'])['result']['result']
    access=alice.ok('POST','/v1/vouchers/'+vid+'/recover',{})
    code=alice.ok('POST','/v1/vouchers/'+vid+'/display',{'access':access['access']})
    intent=owner.ok('POST','/v1/stores/S1/locks',{'display':code['display']})
    return vid,h.terminal(owner,intent['id'])['result']['result']
def publish_review(h,owner):
    saved=owner.ok('PUT','/v1/stores/S1/drafts/delayed',{'name':'Delayed original','description':'Original UTF-8\nUnchanged','price':'7','windows':[[0,1440]],'expectedRevision':0})
    uploaded=owner.ok('PUT','/v1/stores/S1/drafts/delayed/image',base64.b64decode(h.fixture['terms'][0]['image']),mime='image/png',revision=saved['revision'])
    return owner.ok('POST','/v1/stores/S1/drafts/delayed/review',{'expectedRevision':uploaded['revision']})
def revoke(h,client,subject,kind):
    if kind=='logout':client.ok('POST','/v1/auth/logout',{})
    else:
        command={'subject':subject,'store':'S1','enabled':False}
        if kind=='identity':
            email=canonical_email(subject+'-changed@example.test')
            command={'subject':subject,'canonical_email':email,'email_key':email_key(h.namespace,email,private_file(h.run/'email-key').read_bytes())}
        h.expect(h.private.call(h.namespace,'fixture',{'operation':kind,'mutation_id':str(uuid.uuid4()),'command':command}),'REVOCATION')
    if kind!='grant':assert client.request('GET','/v1/me')[0]==401
    else:
        status,_=client.request('PUT','/v1/stores/S1/drafts/denied',{'name':'Denied','description':'Denied','price':'1','windows':[[0,1440]],'expectedRevision':0})
        assert status in {403,404}

def delayed(h,kind,mutation):
    h.new_case(kind+'-'+mutation);alice=h.login('alice');owner=h.login('owner1','b');vid=lockid=None
    if kind!='publish':fund(h,alice)
    if kind in {'handover','settle'}:vid,lockid=locked(h,alice,owner)
    if kind=='settle':
        marker=owner.ok('POST','/v1/stores/S1/cases/'+lockid+'/handover-intents',{});h.terminal(owner,marker['id'])
        h.wait(lambda:snapshot(h)['rollups']['S1']['H']=='3','ORIGINAL_REPORT')
        review=owner.ok('POST','/v1/stores/S1/payouts/'+vid+'/settle-reviews',{})
    elif kind=='publish':review=publish_review(h,owner)
    before=snapshot(h);h.signal_app('reconciler',signal.SIGSTOP)
    try:
        if kind=='issue':intent=issue(h,alice)
        elif kind=='publish':intent=owner.ok('POST','/v1/stores/S1/drafts/delayed/publish',{'reviewId':review['reviewId']})
        elif kind=='handover':intent=owner.ok('POST','/v1/stores/S1/cases/'+lockid+'/handover-intents',{})
        else:
            intent=owner.ok('POST','/v1/stores/S1/settle-intents',{'reviewId':review['reviewId']});h.actor(intent['id'],h.fixture['manifest']['stores']['S1']['owner'])
        h.wait(lambda:snapshot(h)['receipts']==before['receipts']+1,'UNAPPLIED_ORIGINAL')
        original=h.expect(h.a.call('ticket_query',h.namespace,{'ticket_id':intent['id']}),'ORIGINAL_RESULT')
        assert original['status']=='FINAL_SUCCEEDED'
        unapplied=snapshot(h);assert unapplied['appliedReceipts']==before['appliedReceipts']
        time.sleep(.12);h.workers_signal(signal.SIGSTOP)
        revoke(h,alice if kind=='issue' else owner,'alice' if kind=='issue' else 'owner1',mutation)
        h.clock(h.fixture['now']+259201)
        h.restart_app('reconciler',crash=True)
        h.wait(lambda:snapshot(h)['intentStates'][intent['id']]=='FINAL_SUCCEEDED','DELAYED_ORIGINAL_APPLY')
        after=snapshot(h);assert after['appliedReceipts']==before['appliedReceipts']+1
        refreshed=h.login('same' if kind=='issue' and mutation=='identity' else 'alice' if kind=='issue' else 'owner1')
        if kind=='issue':
            voucher=refreshed.ok('GET','/v1/my/vouchers')['items'][0]
            assert voucher['issuedAt']==h.fixture['now'] and voucher['expiresAt']==h.fixture['now']+259200
            recovered=refreshed.ok('POST','/v1/vouchers/'+voucher['id']+'/recover',{})
            assert recovered['redeemable'] is False and 'access' not in recovered
        elif kind=='publish':
            current=refreshed.ok('GET','/v1/stores/S1/meals/delayed');assert current['version']==1 and current['available']
        elif kind=='settle':assert after['rollups']['S1']['S']=='3' and after['rollups']['S1']['H']=='0'
        # A second observer restart reconstructs the original accepted history.
        h.restart_app('reconciler',crash=True);time.sleep(.15)
        assert snapshot(h)['appliedReceipts']==after['appliedReceipts']
    finally:
        h.signal_app('reconciler',signal.SIGCONT);h.workers_signal(signal.SIGCONT)
    if kind=='handover':
        h.wait(lambda:snapshot(h)['rollups']['S1']['H']=='3','REVOKED_LATE_REPORT_CONTINUATION')
        assert snapshot(h)['rollups']['S1']['R']=='0'
    h.records.append({'scenario':'R1-delayed-unapplied-original','action':kind,'revocation':mutation,'status':'PASS',
        'delaySeconds':259201,'originalT0':original['receipt']['now'],'sourceFinalBeforeRevocation':True,
        'before':before,'unapplied':unapplied,'afterOriginalApply':after,'afterContinuation':snapshot(h)})

def clock_case(h,kind):
    h.new_case(kind);alice=h.login('alice');before=snapshot(h)
    if kind=='service-rollback':
        h.clock(h.fixture['now']+10)
        result=h.b.call('fixture_clock',h.namespace,{'now':h.fixture['now']+9});assert result.get('halted')
        assert snapshot(h)['provenance']['halted']
        assert alice.request('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})[0]==503
    elif kind=='source-rollback':
        h.expect(h.a.call('fixture_clock',h.namespace,{'now':h.fixture['now']+10}),'SOURCE_FORWARD')
        assert h.a.call('fixture_clock',h.namespace,{'now':h.fixture['now']+9})['error']=='CLOCK_ROLLBACK'
    else:
        skew=2 if kind=='skew-two' else 3
        h.expect(h.a.call('fixture_clock',h.namespace,{'now':h.fixture['now']+skew}),'SOURCE_SKEW')
        review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
        intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(intent['id'],PAYER)
        if skew==2:
            final=h.terminal(alice,intent['id']);assert final['result']['t0']==h.fixture['now']+2
        else:
            h.wait(lambda:snapshot(h)['provenance']['halted'],'SKEW_QUARANTINE')
            after=snapshot(h);assert after['appliedReceipts']==0 and after['receipts']==1 and after['orders']==0
    h.records.append({'scenario':'C08-clock-boundary','kind':kind,'status':'PASS','before':before,'after':snapshot(h)})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        for kind in ['issue','publish','handover','settle']:
            for mutation in (['logout','identity'] if kind=='issue' else ['logout','identity','grant']):delayed(h,kind,mutation)
        for kind in ['service-rollback','source-rollback','skew-two','skew-three']:clock_case(h,kind)
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='DELAYED_FACT_EXCEPTION:'+type(exc).__name__+':'+str(traceback.extract_tb(exc.__traceback__)[-1].lineno)
    finally:
        try:
            if h.processes:h.signal_app('reconciler',signal.SIGCONT);h.workers_signal(signal.SIGCONT)
            h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
