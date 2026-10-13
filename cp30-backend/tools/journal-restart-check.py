"""One terminal journal fault per fresh owned run; never repairs damaged journal."""
import argparse,hashlib,os,sys,traceback
from smoke import Harness,IntegrationFailure
from owned import private_file

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');parser.add_argument('damage',choices=['missing','torn','older']);args=parser.parse_args()
    h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start();journal=private_file(h.run/'security.journal');prefix=journal.read_bytes()
        alice=h.login('alice');alice.ok('POST','/v1/auth/logout',{})
        before=h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'BEFORE')
        anchor=h.expect(h.b.call('journal_anchor',h.namespace,{}),'DB_ANCHOR')
        assert anchor['sequence']>1
        h.stop_app('controller');original=journal.read_bytes()
        preserved=h.run/'journal-fault-original.bin';preserved.write_bytes(original);preserved.chmod(0o600)
        if args.damage=='missing':journal.rename(h.run/'missing-journal-evidence.bin')
        else:
            with journal.open('wb' if args.damage=='older' else 'ab') as stream:
                stream.write(prefix if args.damage=='older' else b'\x00\x00');stream.flush();os.fsync(stream.fileno())
        h.launch('controller','controller');process=h.processes[-1][1];process.wait(timeout=5)
        assert process.returncode!=0 and not (h.run/'controller.sock').exists()
        response=alice.request('POST','/v1/support/reviews',{'store':'S1','meal':'meal','quantity':1})
        assert response[0]==503
        after=h.expect(h.b.call('fixture_snapshot',h.namespace,{}),'AFTER');assert after==before
        expected={'missing':'MISSING_OR_UNAVAILABLE_JOURNAL','torn':'TORN_LENGTH','older':'OLDER_JOURNAL'}[args.damage]
        assert expected in private_file(h.run/'controller-diagnostic.log').read_text()
        h.records.append({'scenario':'R2-journal-'+args.damage,'status':'PASS','startupRejected':True,'reason':expected,
            'retainedSequence':anchor['sequence'],'originalDigest':hashlib.sha256(original).hexdigest(),
            'riskStatus':response[0],'before':before,'after':after,'journalNotReinitialized':True})
        status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='JOURNAL_RESTART_EXCEPTION:'+type(exc).__name__+':'+str(traceback.extract_tb(exc.__traceback__)[-1].lineno)
    finally:
        try:h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1
if __name__=='__main__':sys.exit(main())
