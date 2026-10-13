"""C04 exact 20 Save and 20 Publish CAS barriers on two actual HTTPS APIs."""
import argparse,base64,signal,sys,threading,time
from concurrent.futures import ThreadPoolExecutor
from smoke import Harness,IntegrationFailure

def case(h,kind,number):
    h.new_case('catalog-'+kind);clients=[h.login('owner1','a'),h.login('owner1','b')]
    payload={'name':'Race meal','description':'Exact original\nContent','price':'3','windows':[[0,1440]],'expectedRevision':0}
    path='/v1/stores/S1/drafts/race';requests=[payload,{**payload,'name':'Other winner'}];method='PUT'
    if kind=='publish':
        saved=clients[0].ok('PUT',path,payload)
        uploaded=clients[0].ok('PUT',path+'/image',base64.b64decode(h.fixture['terms'][0]['image']),mime='image/png',revision=saved['revision'])
        reviews=[client.ok('POST',path+'/review',{'expectedRevision':uploaded['revision']}) for client in clients]
        requests=[{'reviewId':review['reviewId']} for review in reviews];path+='/publish';method='POST'
    barrier=threading.Barrier(2,timeout=3);intervals=[None,None]
    def send(index):
        def ready():barrier.wait();intervals[index]=[time.monotonic_ns(),None]
        result=clients[index].request(method,path,requests[index],before_send=ready)
        intervals[index][1]=time.monotonic_ns();return result
    before=h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'BEFORE')
    reserved=None;public_before=None
    h.workers_signal(signal.SIGSTOP)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(send,index) for index in range(2)]
            responses=[future.result(timeout=10) for future in futures]
        assert max(value[0] for value in intervals)<min(value[1] for value in intervals)
        assert sorted(status for status,_ in responses)==[200,409]
        winner=next(index for index,(status,_) in enumerate(responses) if status==200)
        assert responses[1-winner][1]['error']=='CONFLICT'
        reserved=h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'RESERVED')
        if kind=='publish':
            public_before=clients[0].request('GET','/v1/stores/S1/meals/race')[0]
            assert public_before==404
    finally:h.workers_signal(signal.SIGCONT)
    if kind=='save':
        saved=clients[0].ok('GET','/v1/stores/S1/drafts/race')
        assert saved['revision']==1 and saved['name']==requests[winner]['name']
        assert h.b.call('fixture_snapshot',h.namespace,{})['outbox']==0
    else:
        h.terminal(clients[winner],responses[winner][1]['id'])
        current=clients[0].ok('GET','/v1/stores/S1/meals/race')
        assert current['version']==1 and current['available'] and current['listed'] is False
        state=h.b.call('fixture_snapshot',h.namespace,{})
        assert state['intents']==state['outbox']==state['appliedReceipts']==1
    h.records.append({'scenario':'C04-'+kind+'-CAS','round':number,'status':'PASS','winner':winner,
                      'before':before,'reserved':reserved,'after':h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'AFTER'),
                      'draftRevision':saved['revision'] if kind=='save' else uploaded['revision'],
                      'preFinalPublicStatus':public_before,'finalVersion':None if kind=='save' else current['version'],
                      'apiPids':[dict(h.processes)['api_a'].pid,dict(h.processes)['api_b'].pid],
                      'apiPorts':[client.port for client in clients],'overlapNs':min(v[1] for v in intervals)-max(v[0] for v in intervals),
                      'responses':[{'status':status,'error':body.get('error')} for status,body in responses]})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        for kind in ['save','publish']:
            for number in range(1,21):case(h,kind,number)
            print('C04-'+kind+':20/20',flush=True)
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='CATALOG_RACE_EXCEPTION:'+type(exc).__name__
    finally:
        try:h.workers_signal(signal.SIGCONT);h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
