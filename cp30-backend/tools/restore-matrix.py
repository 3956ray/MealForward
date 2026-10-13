"""R2 actual owned restores and retained fences; no fixture reinitialization."""
import argparse,copy,hashlib,json,signal,sys,threading,time,traceback,uuid
from concurrent.futures import ThreadPoolExecutor
from smoke import Harness,IntegrationFailure
from restore_owned import OwnedRestore
from c1.db import Database
from c1.ipc import Client
from c1.application import COOKIE

PAYER='0x'+format(0x71,'040x')
def snapshot(h):return h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'SNAPSHOT')
def journal(h):return h.expect(h.private.call(h.namespace,'query',{}),'JOURNAL_QUERY')
def ack(h,command):
    h.wait(lambda:h.fault_ack(command) is not None,'FAULT_ACK',timeout=4)
    return h.fault_ack(command)
def fund_review(h,alice):return alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
def fund(h,alice):
    review=fund_review(h,alice);intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(intent['id'],PAYER);h.terminal(alice,intent['id']);return intent
def old_session_denied(h,client):
    # Replace one driver connection, never exceeding its two-connection budget.
    h.a.close();api=Database({'db':{'api':h.settings['roles']['c1_api_a']}},'api','business',max_size=1)
    try:
        result=api.call('auth_me',h.namespace,{'session_hash':hashlib.sha256(client.cookie[COOKIE].encode()).hexdigest()})
        assert result['status']==401
    finally:
        api.close();h.a=Database({'db':{'authority':h.settings['roles']['c1_controller_authority']}},'authority','authority',max_size=1)

def successful_rebuild(h,number):
    h.new_case('restore-rebuild');alice=h.login('alice');fund(h,alice);restore=OwnedRestore(h)
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'});key=uuid.uuid4().hex;command=h.fault('ticket_staged')
    intent=alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']},key=key);ack(h,command)
    backup=restore.backup();h.fault();original=h.terminal(alice,intent['id']);before=snapshot(h)
    reference=restore.restore(backup);h.rebind(alice,'a');old_session_denied(h,alice)
    assert alice.request('GET','/v1/me')[0]==503
    h.clock(h.fixture['now']+11)
    h.wait(lambda:snapshot(h)['appliedReceipts']==before['appliedReceipts'],'RESTORE_ORIGINAL_REBUILD')
    finished=h.expect(restore.finish(reference),'RESTORE_FINISH');assert finished['credential_epoch']>1
    assert alice.request('GET','/v1/me')[0]==401
    current=h.login('alice');result=current.ok('GET','/v1/intents/'+intent['id']);assert result['result']==original['result']
    replay=current.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']},key=key)
    assert replay['id']==intent['id'] and replay['replay'] and snapshot(h)['vouchers']==1
    assert snapshot(h)['rollups']==before['rollups']
    h.records.append({'scenario':'R2-successful-original-rebuild','round':number,'status':'PASS','before':before,'after':snapshot(h),'credentialEpoch':finished['credential_epoch'],'originalResult':original['result']})

def pending_restore(h,kind,number):
    h.new_case('pending-'+kind);alice=h.login('alice');restore=OwnedRestore(h);backup=restore.backup(authority=kind=='execution')
    command=h.fault('security_applied' if kind=='security' else 'authority_committed')
    with ThreadPoolExecutor(max_workers=1) as pool:
        if kind=='security':pending=pool.submit(alice.request,'POST','/v1/auth/logout',{})
        else:
            review=fund_review(h,alice);intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']})
            pending=pool.submit(h.actor,intent['id'],PAYER)
        ack(h,command)
        h.stop_app('api_a' if kind=='security' else 'source',crash=True);h.fault()
        try:pending.result(timeout=3)
        except Exception:pass
    retained=journal(h);assert retained['pending'] is not None
    before=snapshot(h);reference=restore.restore(backup);h.rebind(alice,'a');old_session_denied(h,alice)
    after=journal(h)
    assert after['pending']['digest']==retained['pending']['digest'] and after['restore_pending'] is not None
    assert after['epochs']['credential_epoch']>retained['epochs']['credential_epoch']
    assert restore.finish(reference).get('error')=='QUARANTINED'
    assert alice.request('GET','/v1/me')[0]==503
    assert snapshot(h)['provenance']['halted']
    h.records.append({'scenario':'R2-pending-'+kind+'-old-restore','round':number,'status':'PASS',
        'originalPendingPreserved':True,'newCredentialEpoch':after['epochs']['credential_epoch'],'quarantined':True,
        'before':before,'after':snapshot(h)})

def cancellation(h,number):
    h.new_case('terminal-close');alice=h.login('alice');review=fund_review(h,alice)
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});command=h.fault('authority_closed')
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(alice.request,'POST','/v1/support/intents/'+intent['id']+'/cancel',{})
        ack(h,command);before=snapshot(h)
        assert before['intentStates'][intent['id']]=='CANCELLATION_PENDING' and before['pendingSupport']==2
        h.restart_app('controller',crash=True,disarm_fault=True)
        try:pending.result(timeout=3)
        except Exception:pass
    h.wait(lambda:(h.run/'controller.sock').exists(),'CONTROLLER_RESTART')
    result=alice.ok('POST','/v1/support/intents/'+intent['id']+'/cancel',{});after=snapshot(h)
    assert result['status']=='DEFINITELY_UNEXECUTED' and after['pendingSupport']==0 and after['orders']==0
    h.records.append({'scenario':'R2-authority-close-before-release','round':number,'status':'PASS','before':before,'after':after})

def lower_floors(h,number):
    h.new_case('lower-floors');clients=[h.login('alice','a'),h.login('alice','b')]
    commands=[{'kind':'logout','mutation_id':str(uuid.uuid4()),'command':{
        'session_hash':hashlib.sha256(client.cookie[COOKIE].encode()).hexdigest(),
        'csrf_hash':hashlib.sha256(client.csrf.encode()).hexdigest()}} for client in clients]
    before=journal(h);barrier=threading.Barrier(2,timeout=2)
    def producer(index):
        client=Client(h.run/'controller.sock',h.caps['api']);barrier.wait()
        return client.call(h.namespace,'security',commands[index])
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(producer,[0,1]))
    winners=[i for i,result in enumerate(results) if 'error' not in result]
    assert len(winners)==1 and results[1-winners[0]].get('status')==503
    winner=winners[0]
    def reference(result):return {key:result[key] for key in ('mutation_id','sequence','digest')}
    def apply(ref):
        h.a.close();api=Database({'db':{'api':h.settings['roles']['c1_api_a']}},'api','business',max_size=1)
        try:h.expect(api.call('security_apply',h.namespace,ref),'ORIGINAL_SECURITY_APPLY')
        finally:
            api.close();h.a=Database({'db':{'authority':h.settings['roles']['c1_controller_authority']}},'authority','authority',max_size=1)
    original=reference(results[winner]);apply(original)
    ipc=Client(h.run/'controller.sock',h.caps['api'])
    h.expect(ipc.call(h.namespace,'security',{'phase':'finish',**original}),'ORIGINAL_FINISH')
    retained=journal(h)
    current=reference(h.expect(ipc.call(h.namespace,'security',commands[1-winner]),'SECOND_VALID_PREPARE'))
    pending=journal(h);barrier=threading.Barrier(2,timeout=2)
    def stale(phase):
        client=Client(h.run/'controller.sock',h.caps['api']);barrier.wait()
        return client.call(h.namespace,'security',{'phase':phase,**original})
    with ThreadPoolExecutor(max_workers=2) as pool:rejected=list(pool.map(stale,['finish','abort']))
    assert all(result.get('status')==503 for result in rejected)
    unchanged=journal(h)
    assert unchanged['pending']['digest']==pending['pending']['digest']
    assert unchanged['sequence']==pending['sequence'] and unchanged['floors']==retained['floors'] and unchanged['epochs']==retained['epochs']
    apply(current);h.expect(ipc.call(h.namespace,'security',{'phase':'finish',**current}),'CURRENT_FINISH')
    final=journal(h)
    for domain,objects in retained['floors'].items():
        for key,value in objects.items():assert final['floors'][domain][key]>=value
    assert all(client.request('GET','/v1/me')[0]==401 for client in clients)
    def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
    h.records.append({'scenario':'R2-two-producer-lower-floor','round':number,'status':'PASS',
        'validPrepareResults':[result.get('status',200) for result in results],
        'staleOriginalResults':[result['status'] for result in rejected],
        'originalSequence':original['sequence'],'currentSequence':current['sequence'],
        'retainedFloorDigest':digest(retained['floors']),'duringStaleFloorDigest':digest(unchanged['floors']),
        'originalPendingPreserved':True,'floorMonotonic':True,'finalSequence':final['sequence'],
        'bothOriginalSessionsRevoked':True,'apiPids':[dict(h.processes)['api_a'].pid,dict(h.processes)['api_b'].pid]})

def old_epoch(h,number):
    h.new_case('old-epoch');alice=h.login('alice');intent=fund(h,alice);before=snapshot(h)
    original=h.expect(h.a.call('ticket_query',h.namespace,{'ticket_id':intent['id']}),'ORIGINAL')
    epoch=journal(h)['epochs']['source_epoch'];h.restart_app('source');h.restart_app('reconciler');h.restart_app('controller')
    h.wait(lambda:(h.run/'controller.sock').exists(),'ORDINARY_RESTART')
    assert journal(h)['epochs']['source_epoch']==epoch
    assert alice.ok('GET','/v1/intents/'+intent['id'])['result']['t0']==h.fixture['now']
    poison=copy.deepcopy(original['receipt']);poison['source_epoch']=epoch-1
    h.a.close();ingest=Database({'db':{'ingest':h.settings['roles']['c1_source_ingest']}},'ingest','business',max_size=1)
    try:result=ingest.call('receipt_ingest',h.namespace,{'receipt':poison})
    finally:ingest.close();h.a=Database({'db':{'authority':h.settings['roles']['c1_controller_authority']}},'authority','authority',max_size=1)
    assert result.get('error')=='FINAL_CONFLICT'
    after=snapshot(h);assert after['appliedReceipts']==before['appliedReceipts'] and after['rollups']==before['rollups'] and after['provenance']['halted']
    h.records.append({'scenario':'R2-old-epoch-and-normal-restart','round':number,'status':'PASS','sourceEpochPreserved':True,'before':before,'after':after})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');parser.add_argument('--only-rebuild',action='store_true');args=parser.parse_args()
    h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start();h.records.append({'scenario':'R2-matrix-scope','onlyRebuild':args.only_rebuild})
        for number in range(1,4):successful_rebuild(h,number)
        if not args.only_rebuild:
            for kind in ['security','execution']:
                for number in range(1,4):pending_restore(h,kind,number)
            for function in [cancellation,lower_floors,old_epoch]:
                for number in range(1,4):function(h,number)
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='RESTORE_MATRIX_EXCEPTION:'+type(exc).__name__+':'+str(traceback.extract_tb(exc.__traceback__)[-1].lineno)
    finally:
        try:
            h.fault()
            for name,process in dict(h.processes).items():
                if process.poll() is None:h.signal_app(name,signal.SIGCONT)
            h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
