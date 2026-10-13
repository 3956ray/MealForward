"""Actual first-candidate poison, original replay and observer reconstruction."""
import argparse,copy,signal,sys,time,traceback
from concurrent.futures import ThreadPoolExecutor
from smoke import Harness,IntegrationFailure
from c1.db import Database
from c1.ipc import Client

PAYER='0x'+format(0x71,'040x')
def snapshot(h):return h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'SNAPSHOT')
def ingest(h,receipt):
    h.a.close();database=Database({'db':{'ingest':h.settings['roles']['c1_source_ingest']}},'ingest','business',max_size=1)
    try:return database.call('receipt_ingest',h.namespace,{'receipt':receipt})
    finally:
        database.close();h.a=Database({'db':{'authority':h.settings['roles']['c1_controller_authority']}},'authority','authority',max_size=1)
def mutate(r,kind):
    if kind.startswith('scope-'):
        field=kind[6:];r['scope'][field]='wrong'
    elif kind=='epoch':r['source_epoch']-=1
    elif kind=='height':r['height']+=1
    elif kind=='parent':r['parent']='f'*64
    elif kind=='block':r['block_hash']='f'*64
    elif kind=='future':r['now']+=3
    elif kind=='past':r['now']-=1
    elif kind=='incomplete':r['complete_to']=0
    elif kind=='transaction':r['tx_index']=1
    elif kind=='nonfinal':r['final']=False
    elif kind=='log-order':r['logs'][0]['log_index']=1
    elif kind=='missing-log':r['logs']=[]
    elif kind=='extra-log':r['logs'].append(copy.deepcopy(r['logs'][0]))
    elif kind=='t0':r['transition']['t0']+=1
    elif kind=='result':r['transition']['result']='0x'+'f'*64
    elif kind=='after':r['transition']['after']['height']+=1
    elif kind=='before':r['transition']['before']['height']+=1
    elif kind=='payload-hash':r['transition']['payload_hash']='0x'+'f'*64
    elif kind=='caller':r['operation']['caller']='0x'+'f'*40
    elif kind=='operation':r['operation']['kind']='refund'
    else:raise AssertionError(kind)
    return r

KINDS=['scope-namespace','scope-store_id','scope-escrow','scope-asset','scope-receiver','epoch','height','parent','block','future','past','incomplete','transaction','nonfinal','log-order','missing-log','extra-log','t0','result','after','before','payload-hash','caller','operation']
def poison(h,kind):
    h.new_case('poison-'+kind);alice=h.login('alice');review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});fault=h.fault('authority_committed')
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(h.actor,intent['id'],PAYER)
        h.wait(lambda:h.fault_ack(fault) is not None,'AUTHORITY_COMMITTED')
        h.stop_app('source',crash=True);h.fault()
        try:pending.result(timeout=3)
        except Exception:pass
    proof=h.expect(h.a.call('execution_proof',h.namespace,{'ticket_id':intent['id']}),'ORIGINAL_PROOF')
    source=Client(h.run/'controller.sock',h.caps['source'])
    h.expect(source.call(h.namespace,'execution_finish',{'ticket_id':intent['id'],'sequence':proof['sequence'],'digest':proof['digest']}),'ORIGINAL_FINISH')
    original=h.expect(h.a.call('ticket_query',h.namespace,{'ticket_id':intent['id']}),'ORIGINAL')
    assert original['status']=='FINAL_SUCCEEDED'
    before=snapshot(h);assert before['receipts']==before['appliedReceipts']==0
    result=ingest(h,mutate(copy.deepcopy(original['receipt']),kind))
    if result.get('error'):assert result['error'] in {'RECEIPT_MISMATCH','FINAL_CONFLICT'}
    else:
        deadline=time.monotonic()+3
        while not snapshot(h)['provenance']['halted'] and time.monotonic()<deadline:time.sleep(.05)
        assert snapshot(h)['provenance']['halted']
    after=snapshot(h);assert after['appliedReceipts']==after['entries']==after['orders']==0 and after['rollups']==before['rollups']
    h.records.append({'scenario':'C12-first-candidate-poison','kind':kind,'status':'PASS','ingestError':result.get('error'),'quarantined':after['provenance']['halted'],'before':before,'after':after})
    h.launch('source','source');h.wait(lambda:(h.run/'source.sock').exists(),'SOURCE_READY')

def replay(h):
    h.new_case('original-replay');alice=h.login('alice');review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(intent['id'],PAYER);h.terminal(alice,intent['id'])
    original=h.expect(h.a.call('ticket_query',h.namespace,{'ticket_id':intent['id']}),'ORIGINAL')['receipt'];before=snapshot(h)
    for number in range(1,101):
        result=h.expect(ingest(h,original),'REPLAY');assert result['noop']
        h.restart_app('reconciler',crash=True)
        # A subsequent step and retained projection must remain an exact no-op.
        time.sleep(.12);assert dict(h.processes)['reconciler'].poll() is None
        assert snapshot(h)==before
        h.records.append({'scenario':'C12-original-replay-rebuild','round':number,'status':'PASS','observerPid':dict(h.processes)['reconciler'].pid,'appliedReceipts':before['appliedReceipts'],'height':before['provenance']['height']})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        for kind in KINDS:poison(h,kind)
        replay(h);status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='RECEIPT_CHECK_EXCEPTION:'+type(exc).__name__+':'+str(traceback.extract_tb(exc.__traceback__)[-1].lineno)
    finally:
        try:h.fault();h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1
if __name__=='__main__':sys.exit(main())
