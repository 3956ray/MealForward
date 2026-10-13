"""C11 real process/transaction fault cases, retained UNKNOWN and same-key recovery."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import signal,sys,time,uuid
from smoke import Harness,IntegrationFailure

PAYER='0x'+format(0x71,'040x')

def snapshot(h):return h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'SNAPSHOT')

def prepare_fund(h):
    alice=h.login('alice')
    review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
    return alice,review

def worker_name(h,pid):return next(name for name,process in h.processes if process.pid==pid)

def await_ack(h,command):
    h.wait(lambda:h.fault_ack(command) is not None,'FAULT_ACK',timeout=4)
    return h.fault_ack(command)

def signal_app(h,name,value):
    # The same verified ownership operation used for worker race barriers.
    from owned import app_identity,private_file
    import json
    process=next(process for candidate,process in reversed(h.processes) if candidate==name and process.poll() is None)
    registry=json.loads(private_file(h.run/'owned-pids.json').read_text())
    entry=next(row for row in registry['apps'] if row['pid']==process.pid)
    app_identity(h.run,process.pid,config=h.configs[name],python=h.run/'venv/bin/python',registry=entry)
    process.send_signal(value)

def sql_rollback(h,point,number):
    h.new_case('sql-'+point);alice,review=prepare_fund(h)
    before=snapshot(h)
    h.expect(h.b.call('fixture_fault',h.namespace,{'kind':'sql_fail','point':point,'enabled':True}),'ARM_SQL')
    key=uuid.uuid4().hex
    status,result=alice.request('POST','/v1/support/intents',{'reviewId':review['reviewId']},key=key)
    assert status==409 and result['error']=='INJECTED_FAILURE'
    after=snapshot(h)
    for field in ['intents','outbox','orders','units','reservations','pendingEmails','pendingSubjects','entries']:
        assert before[field]==after[field]
    h.expect(h.b.call('fixture_fault',h.namespace,{'kind':'sql_fail','point':point,'enabled':False}),'DISARM_SQL')
    status,intent=alice.request('POST','/v1/support/intents',{'reviewId':review['reviewId']},key=key);assert status==200
    h.actor(intent['id'],PAYER);h.terminal(alice,intent['id'])
    h.records.append({'scenario':'C11-transaction-rollback','point':point,'round':number,'status':'PASS','before':before,'afterFailure':after,'afterRecovery':snapshot(h)})

def domain_response(h,number):
    h.new_case('domain-response');alice,review=prepare_fund(h);key=uuid.uuid4().hex
    command=h.fault('domain_committed')
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(alice.request,'POST','/v1/support/intents',{'reviewId':review['reviewId']},key)
        ack=await_ack(h,command);committed=snapshot(h)
        assert committed['intents']==committed['outbox']==1
        h.restart_app('api_a',crash=True,disarm_fault=True)
        try:pending.result(timeout=3)
        except Exception:pass
    h.rebind(alice,'a')
    status,intent=alice.request('POST','/v1/support/intents',{'reviewId':review['reviewId']},key=key)
    assert status==200 and intent['id']==ack['object'] and intent['replay'] is True
    h.actor(intent['id'],PAYER);h.terminal(alice,intent['id'])
    h.records.append({'scenario':'C11-domain-commit-response-loss','round':number,'status':'PASS','committed':committed,'after':snapshot(h)})

def claim_fault(h,point,number):
    h.new_case(point);alice,review=prepare_fund(h)
    fund=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(fund['id'],PAYER);h.terminal(alice,fund['id'])
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'})
    command=h.fault(point);intent=alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']})
    ack=await_ack(h,command);before=snapshot(h)
    h.restart_app(worker_name(h,ack['pid']),crash=True,disarm_fault=True);h.clock(h.fixture['now']+11)
    if point=='lease_claimed':h.terminal(alice,intent['id'])
    else:
        h.wait(lambda:snapshot(h)['intentStates'][intent['id']]=='UNKNOWN','UNKNOWN')
        h.clock(h.fixture['now']+259201)
        h.wait(lambda:snapshot(h)['intentStates'][intent['id']]=='UNKNOWN','OLD_UNKNOWN')
        after=snapshot(h)
        assert after['reservations']==after['pendingEmails']==after['pendingSubjects']==1 and after['vouchers']==0
    h.records.append({'scenario':'C11-'+point,'round':number,'status':'PASS','genuineUnknown':point=='ticket_staged','before':before,'after':snapshot(h)})

def source_fault(h,point,number):
    h.new_case(point);alice,review=prepare_fund(h)
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']})
    if point=='receipt_ingested':signal_app(h,'reconciler',signal.SIGSTOP)
    command=h.fault(point)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(h.actor,intent['id'],PAYER)
        ack=await_ack(h,command);before=snapshot(h)
        h.restart_app('source',crash=True,disarm_fault=True)
        if point=='authority_committed':h.restart_app('controller',crash=True)
        if point=='receipt_ingested':signal_app(h,'reconciler',signal.SIGCONT)
        try:pending.result(timeout=3)
        except Exception:pass
    # Synthetic time must keep advancing across startup and retry leases.
    # Querying the original ticket never redispatches its authority transition.
    for tick in range(1,7):
        h.clock(h.fixture['now']+tick*11)
        time.sleep(.25)
        if snapshot(h)['intentStates'][intent['id']]=='FINAL_SUCCEEDED':break
    h.terminal(alice,intent['id'])
    after=snapshot(h);assert after['orders']==after['units']==after['entries']==after['appliedReceipts']==1
    h.records.append({'scenario':'C11-'+point,'round':number,'status':'PASS','before':before,'after':after})

def apply_fault(h,point,number):
    h.new_case(point);alice,review=prepare_fund(h)
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']})
    if point=='apply_after_ledger':
        h.expect(h.b.call('fixture_fault',h.namespace,{'kind':'sql_fail','point':point,'enabled':True}),'ARM_APPLY')
        h.actor(intent['id'],PAYER)
        h.wait(lambda:snapshot(h)['receipts']==1,'INGESTED')
        time.sleep(.15);before=snapshot(h)
        assert before['orders']==before['units']==before['entries']==before['appliedReceipts']==0
        h.expect(h.b.call('fixture_fault',h.namespace,{'kind':'sql_fail','point':point,'enabled':False}),'DISARM_APPLY')
    else:
        command=h.fault(point);h.actor(intent['id'],PAYER);await_ack(h,command);before=snapshot(h)
        assert before['entries']==before['appliedReceipts']==1
        h.restart_app('reconciler',crash=True,disarm_fault=True)
    h.terminal(alice,intent['id']);after=snapshot(h)
    assert after['orders']==after['units']==after['entries']==after['appliedReceipts']==1
    h.records.append({'scenario':'C11-'+point,'round':number,'status':'PASS','before':before,'after':after})

def source_unavailable(h,number):
    h.new_case('source-unavailable');alice,review=prepare_fund(h)
    fund=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(fund['id'],PAYER);h.terminal(alice,fund['id'])
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'})
    signal_app(h,'source',signal.SIGSTOP)
    try:
        intent=alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']})
        h.wait(lambda:snapshot(h)['intentStates'][intent['id']]=='UNKNOWN','SOURCE_UNKNOWN',timeout=6)
        # Kill the stopped process before it can consume its queued dispatch.
        h.restart_app('source',crash=True)
    finally:
        signal_app(h,'source',signal.SIGCONT)
    h.clock(h.fixture['now']+259201)
    after=snapshot(h);assert after['vouchers']==0 and after['reservations']==after['pendingEmails']==after['pendingSubjects']==1
    h.records.append({'scenario':'C11-source-unavailable','round':number,'status':'PASS','genuineUnknown':True,'after':after})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');parser.add_argument('--start-at',choices=['source']);args=parser.parse_args()
    h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        h.records.append({'scenario':'C11-matrix-scope','startAt':args.start_at or 'all'})
        if not args.start_at:
            for point in ['domain_before_outbox','domain_after_outbox']:
                for number in range(1,4):sql_rollback(h,point,number)
            for number in range(1,4):domain_response(h,number)
            for point in ['lease_claimed','ticket_staged']:
                for number in range(1,4):claim_fault(h,point,number)
        for point in ['authority_committed','receipt_ingested']:
            for number in range(1,4):source_fault(h,point,number)
        for point in ['apply_after_ledger','apply_committed']:
            for number in range(1,4):apply_fault(h,point,number)
        for number in range(1,4):source_unavailable(h,number)
        h.new_case('pg-crash');alice,review=prepare_fund(h)
        intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(intent['id'],PAYER);original=h.terminal(alice,intent['id'])
        h.crash_pg_and_restart();h.rebind(alice,'a');recovered=h.terminal(alice,intent['id']);assert recovered['result']==original['result']
        status='PASS'
    except IntegrationFailure as exc:
        reason=str(exc)
        h.records.append({'scenario':'failure-state','snapshot':snapshot(h)})
    except Exception as exc:reason='CRASH_MATRIX_EXCEPTION:'+type(exc).__name__
    finally:
        try:
            h.fault()
            for name,process in list(dict(h.processes).items()):
                if process.poll() is None:signal_app(h,name,signal.SIGCONT)
            h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
