"""Offline live-draft routing and input checks; no real image or runtime IO."""
from types import SimpleNamespace
from unittest.mock import patch
import unittest
from .live_drafts import handle,CAPABILITIES
from .onboarding_adapter import IntegrationRejected
from . import onboarding_recovery_checks as recovery_checks

STORE='a'*64;MEAL='11111111-1111-4111-8111-111111111111'
PATH='/v1/stores/'+STORE+'/drafts/'+MEAL

class Checks(unittest.TestCase):
    def gateway(self):
        calls=[]
        def fixed(ledger,method,q,*,read_only=False):
            calls.append((method,q,read_only))
            return {'items':[]} if q['op']=='list' else {'saved':True,'revision':3}
        return SimpleNamespace(_fixed=fixed,api_ledger=object(),draft_run='inert-unused'),calls

    def test_list_capabilities_and_stable_client_identifier(self):
        g,calls=self.gateway()
        self.assertEqual(handle(g,'GET','/v1/stores/'+STORE+'/drafts',{'session_hash':'owner'},None,{}),{'items':[],'capabilities':CAPABILITIES})
        handle(g,'GET',PATH,{'session_hash':'owner'},None,{})
        self.assertTrue(all(c[2] for c in calls))
        self.assertEqual(calls[-1][1]['meal'],MEAL)

    def test_private_write_cas_and_no_publish(self):
        g,calls=self.gateway()
        body={'name':'Meal','description':'Private','price':'7000000','windows':[[0,1440]],'expectedRevision':0}
        handle(g,'PUT',PATH,{'session_hash':'owner','key':'inert-idempotency-key'},body,{})
        self.assertEqual(calls[0][1]['payload'],body);self.assertFalse(calls[0][2])
        for invalid in ({**body,'price':7},{**body,'expectedRevision':True},{**body,'windows':[[0,90],[80,100]]}):
            with self.assertRaises(IntegrationRejected):handle(g,'PUT',PATH,{'session_hash':'owner'},invalid,{})
        with self.assertRaises(IntegrationRejected) as caught:handle(g,'POST',PATH+'/publish',{'session_hash':'owner'}, {'reviewId':'00000000-0000-4000-8000-000000000001'},{})
        self.assertEqual(caught.exception.code,'LIVE_CATALOG_EXECUTION_UNAVAILABLE')
        self.assertEqual(len(calls),1)

    def test_image_authorizes_before_normalization_and_preserves_replay_revision(self):
        g,calls=self.gateway()
        def normalize(raw,mime):
            self.assertEqual(len(calls),1);self.assertTrue(calls[0][2])
            self.assertEqual(raw,b'raw');return b'normalized'
        with patch('c1.live_drafts.normalize_image',side_effect=normalize),patch('c1.live_drafts.image_hash',return_value='0x'+'d'*64):
            handle(g,'PUT',PATH+'/image',{'session_hash':'owner'},b'raw',{'content-type':'image/png','x-c1-draft-revision':'1'})
        # Current revision=3 does not reject an original retry at revision=1;
        # authoritative SQL resolves idempotency before testing the CAS.
        self.assertEqual(calls[-1][1]['payload']['expectedRevision'],1)
        self.assertEqual(calls[-1][1]['payload']['imageDigest'],'d'*64)

    def test_image_owner_failure_never_decodes(self):
        g,_=self.gateway()
        def denied(*args,**kwargs):raise IntegrationRejected('OWNER_BINDING_CHANGED',409)
        g._fixed=denied
        with patch('c1.live_drafts.normalize_image') as normalize:
            with self.assertRaises(IntegrationRejected):handle(g,'PUT',PATH+'/image',{'session_hash':'owner'},b'raw',{'x-c1-draft-revision':'1'})
            normalize.assert_not_called()

    def test_anonymous_private_drafts_are_401(self):
        g,calls=self.gateway()
        with self.assertRaises(IntegrationRejected) as caught:handle(g,'GET',PATH,{},None,{})
        self.assertEqual(caught.exception.status,401);self.assertEqual(calls,[])

    def test_application_passes_binary_image_and_serves_private_png(self):
        app,_=recovery_checks.Checks().application()
        received=[]
        app.real_business=SimpleNamespace(handle=lambda method,path,q,body,headers:received.append(body) or {'saved':True})
        headers={'host':'localhost:16443','idempotency-key':'inert-key-0000001','content-type':'image/png'}
        self.assertEqual(app.handle('PUT',PATH+'/image',headers,{},b'raw','https://localhost:16443')[0],200)
        self.assertEqual(received,[b'raw'])
        app.real_business=SimpleNamespace(handle=lambda *args:{'image':'aW5lcnQ='})
        status,body,headers=app.handle('GET',PATH+'/image',{}, {},b'',None)
        self.assertEqual((status,body,headers['Content-Type']),(200,b'inert','image/png'))
        self.assertEqual(headers['Cache-Control'],'no-store')

if __name__=='__main__':unittest.main()
