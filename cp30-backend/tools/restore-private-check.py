"""Retained grant and credential floors across owned old backups, three each."""
import argparse,sys,traceback,uuid
from smoke import Harness,IntegrationFailure
from restore_owned import OwnedRestore

def snapshot(h):return h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'SNAPSHOT')
def state(h):return h.expect(h.private.call(h.namespace,'query',{}),'JOURNAL')
def old_grant(h,number):
    h.new_case('old-grant');owner=h.login('owner1');restore=OwnedRestore(h);backup=restore.backup()
    h.expect(h.private.call(h.namespace,'fixture',{'operation':'grant','mutation_id':str(uuid.uuid4()),'command':{'subject':'owner1','store':'S1','enabled':False}}),'REVOKE')
    retained=state(h);reference=restore.restore(backup);h.rebind(owner,'a')
    assert restore.finish(reference).get('error')=='QUARANTINED'
    assert owner.request('GET','/v1/stores/S1/workbench')[0]==503
    current=state(h);assert current['restore_pending'] and current['floors']==retained['floors']
    h.records.append({'scenario':'R2-old-grant-private-anchor','round':number,'status':'PASS','quarantined':True,'retainedFloorsPreserved':True,'snapshot':snapshot(h)})

def old_credentials(h,number):
    h.new_case('old-credentials');alice=h.login('alice');restore=OwnedRestore(h)
    review=alice.ok('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
    intent=alice.ok('POST','/v1/support/intents',{'reviewId':review['reviewId']});h.actor(intent['id'],'0x'+format(0x71,'040x'));h.terminal(alice,intent['id'])
    review=alice.ok('POST','/v1/claims/reviews',{'store':'S1','meal':'meal'})
    intent=alice.ok('POST','/v1/claims/intents',{'reviewId':review['reviewId']});vid=h.terminal(alice,intent['id'])['result']['result']
    access=alice.ok('POST','/v1/vouchers/'+vid+'/recover',{})
    alice.ok('POST','/v1/vouchers/'+vid+'/display',{'access':access['access']})
    before=snapshot(h);assert before['credentialState'][0]['activeAccess']==before['credentialState'][0]['activeDisplay']==1
    first,second=restore.backup(),restore.backup()
    reference=restore.restore(first);finished=h.expect(restore.finish(reference),'FIRST_RESTORE_FINISH')
    epoch=finished['credential_epoch'];assert epoch>1
    reference=restore.restore(second);h.rebind(alice,'a')
    assert restore.finish(reference).get('error')=='QUARANTINED'
    after=snapshot(h);current=state(h)
    assert current['epochs']['credential_epoch']>epoch and current['restore_pending']
    assert all(row['activeAccess']==row['activeDisplay']==0 for row in after['credentialState'])
    assert alice.request('GET','/v1/me')[0]==503
    assert after['rollups']==before['rollups']
    h.records.append({'scenario':'R2-old-credential-and-prior-restore-anchor','round':number,'status':'PASS','firstCredentialEpoch':epoch,'secondCredentialEpoch':current['epochs']['credential_epoch'],'quarantined':True,'before':before,'after':after})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args();h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        for function in [old_grant,old_credentials]:
            for number in range(1,4):function(h,number)
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='RESTORE_PRIVATE_EXCEPTION:'+type(exc).__name__+':'+str(traceback.extract_tb(exc.__traceback__)[-1].lineno)
    finally:
        try:h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1
if __name__=='__main__':sys.exit(main())
