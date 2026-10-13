"""Owned HTTPS/PG stable keysets over 55 real original publications."""
import argparse,base64,json,sys,traceback
from urllib.parse import quote
from smoke import Harness,IntegrationFailure,Consumer

def publish(h,owner,index):
    path='/v1/stores/S1/drafts/page'+str(index).zfill(3)
    saved=owner.ok('PUT',path,{'name':'Page '+str(index),'description':'Original page terms','price':'3','windows':[[0,1440]],'expectedRevision':0})
    uploaded=owner.ok('PUT',path+'/image',base64.b64decode(h.fixture['terms'][0]['image']),mime='image/png',revision=saved['revision'])
    review=owner.ok('POST',path+'/review',{'expectedRevision':uploaded['revision']})
    intent=owner.ok('POST',path+'/publish',{'reviewId':review['reviewId']});h.terminal(owner,intent['id'])

def pages(client,path,size,key):
    cursor=None;found=[];lengths=[]
    for _ in range(60):
        page=client.ok('GET',path+'?limit='+str(size)+('&cursor='+quote(cursor) if cursor else ''))
        values=[row[key] for row in page['items']];assert len(values)<=size
        assert not set(values)&set(found);found+=values;lengths.append(len(values))
        cursor=page.get('cursor')
        if not cursor:return found,lengths
    raise AssertionError('UNBOUNDED_PAGINATION')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start();owner=h.login('owner1');other=h.login('owner1','b');now=h.fixture['now']
        for index in range(55):
            h.clock(now+61*index);publish(h,owner,index)
        h.restart_app('reconciler',crash=True)
        h.clock(now+61*55)
        for path,key,count,sizes in [('/v1/stores/S1/meals','meal',56,[1,2,20,50]),('/v1/ledger','id',55,[20,50]),('/v1/stores','id',3,[1,2])]:
            baseline=None
            for size in sizes:
                values,lengths=pages(owner,path,size,key);assert len(values)==count
                if baseline is None:baseline=values
                else:assert values==baseline
                h.records.append({'scenario':'C13-keyset','route':path,'limit':size,'count':count,'pageLengths':lengths,'keys':values,'status':'PASS'})
            assert owner.request('GET',path+'?limit=51')[0]==422
            default=owner.ok('GET',path);assert len(default['items'])==min(20,count)
        h.clock(now+61*56)
        route='/v1/stores/S1/meals';cursor=owner.ok('GET',route+'?limit=2')['cursor']
        payload=json.loads(base64.urlsafe_b64decode(cursor.split('.')[0]+'='*(-len(cursor.split('.')[0])%4)))
        assert payload['after'] is not None and set(payload['snapshot'])=={'height','catalogRevision'}
        assert payload['principal'] not in json.dumps(owner.cookie)
        statuses={}
        statuses['tamper']=owner.request('GET',route+'?cursor='+quote(cursor[:-1]+('0' if cursor[-1]!='0' else '1')))[0]
        statuses['scope']=owner.request('GET','/v1/stores/S2/meals?cursor='+quote(cursor))[0]
        statuses['principal']=other.request('GET',route+'?cursor='+quote(cursor))[0]
        assert all(value==422 for value in statuses.values())
        publish(h,owner,55)
        statuses['watermark']=owner.request('GET',route+'?cursor='+quote(cursor))[0];assert statuses['watermark']==409
        fresh=owner.ok('GET',route+'?limit=2')['cursor'];h.clock(now+61*56+900)
        statuses['expiry']=owner.request('GET',route+'?cursor='+quote(fresh))[0];assert statuses['expiry']==422
        h.records.append({'scenario':'C13-cursor-bindings','status':'PASS','responses':statuses,'snapshotFields':list(payload['snapshot'])})
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='PAGINATION_EXCEPTION:'+type(exc).__name__+':'+str(traceback.extract_tb(exc.__traceback__)[-1].lineno)
    finally:
        try:h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1
if __name__=='__main__':sys.exit(main())
