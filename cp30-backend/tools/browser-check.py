"""Bounded fresh-browser TLS/Cookie evidence; no screenshots, traces or raw logs."""
import argparse,base64,hashlib,json,os,secrets,subprocess,sys
from smoke import Harness,ROOT,IntegrationFailure

def main():
    parser=argparse.ArgumentParser();parser.add_argument('run');args=parser.parse_args()
    h=Harness(args.run);status,reason='FAIL',None
    try:
        h.start()
        assertions=[]
        for _ in range(2):
            value=secrets.token_urlsafe(32);assertions.append(value)
            h.expect(h.b.call('fixture_assertion',h.namespace,{'subject':'alice','assertion_hash':hashlib.sha256(value.encode()).hexdigest()}),'BROWSER_ASSERTION_ISSUE')
        public=subprocess.run(['/usr/bin/openssl','x509','-in',str(h.run/'tls-cert.pem'),'-pubkey','-noout'],env={},capture_output=True,check=True).stdout
        der=subprocess.run(['/usr/bin/openssl','pkey','-pubin','-outform','DER'],input=public,env={},capture_output=True,check=True).stdout
        temp=h.run/'browser-temp';temp.mkdir(mode=0o700)
        payload={'origin':h.origins['a'],'assertions':assertions,'temp':str(temp),'spki':base64.b64encode(hashlib.sha256(der).digest()).decode()}
        result=subprocess.run(['/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node',str(ROOT/'tools/browser-check.cjs')],input=json.dumps(payload).encode(),env={'TMPDIR':str(temp)},capture_output=True,timeout=45)
        value=json.loads(result.stdout)
        if result.returncode or value.get('status')!='PASS':raise IntegrationFailure('BROWSER_CHECK_FAILED:'+value.get('phase','UNKNOWN'))
        registry=json.loads((temp/'browser-pid.json').read_text())
        if registry.get('stopped') is not True:raise IntegrationFailure('BROWSER_NOT_STOPPED')
        h.records.append({'scenario':'C03-browser-secure-cookie',**value,'browserPid':registry['pid'],'browserStopped':True});status='PASS'
    except IntegrationFailure as exc:reason=str(exc)
    except Exception as exc:reason='BROWSER_EXCEPTION:'+type(exc).__name__
    finally:
        try:h.close()
        except Exception as exc:status,reason='FAIL','TEARDOWN:'+type(exc).__name__
        h.evidence(status,reason)
    return 0 if status=='PASS' else 1

if __name__=='__main__':sys.exit(main())
