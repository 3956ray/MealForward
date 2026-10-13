"""Bounded offline recovery contract checks; no DB, network or wallet IO."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from .application import Application,COOKIE,digest
from .db import DatabaseRejected
from .onboarding_adapter import OnboardingGateway


class Checks(unittest.TestCase):
    def gateway(self,items=(),error=None):
        calls=[]
        def call(method,q):
            calls.append((method,q))
            if error:raise error
            return {'items':deepcopy(items),'hasMore':False}
        @contextmanager
        def transaction(namespace,*,read_only=False):
            self.assertEqual(namespace,'inert-namespace')
            self.assertTrue(read_only)
            yield SimpleNamespace(call=call)
        gateway=OnboardingGateway(SimpleNamespace(transaction=transaction),lambda:'inert-namespace',
            publication_adapter=SimpleNamespace(is_ready=lambda rid:rid=='confirmed'),
            business_datasource=SimpleNamespace(ready_for_store=lambda rid:rid=='confirmed'),
            operation_gate=SimpleNamespace(allowed=lambda *args:True))
        gateway.require_configured=lambda:None
        return gateway,calls

    def test_session_only_input_and_empty_result(self):
        gateway,calls=self.gateway()
        self.assertEqual(gateway.list_owned({'session_hash':'session-a','owner':'attacker',
            'subject':'attacker','readOnly':False}),{'items':[],'hasMore':False})
        self.assertEqual(calls,[('onboarding_list_owned',{'session_hash':'session-a','readOnly':True})])

    def test_auth_failure_propagates_without_empty_success(self):
        gateway,_=self.gateway(error=DatabaseRejected('UNAUTHENTICATED',401))
        with self.assertRaises(DatabaseRejected):gateway.list_owned({})

    def test_original_states_and_projection_readiness(self):
        items=[{'registrationId':state.lower(),'state':state,'ready':state=='CONFIRMED',
            'request':{'inert':'original'}} for state in ('DRAFT','PENDING','UNKNOWN','CONFIRMED')]
        original=deepcopy(items);gateway,calls=self.gateway(items)
        result=gateway.list_owned({'session_hash':'session-b'})
        self.assertEqual([row['state'] for row in result['items']],[row['state'] for row in items])
        self.assertEqual([row['businessReady'] for row in result['items']],[False,False,False,True])
        self.assertEqual(items,original)
        self.assertEqual(len(calls),1)

    def application(self):
        app=Application.__new__(Application)
        app.config={'mode':'CP30_TESTNET_CONNECTION','namespace':'inert-namespace'}
        app.cursor_key=b'inert-offline-cursor-key';app.origin='https://localhost:16443'
        app.controller=SimpleNamespace(call=lambda *args:{})
        app.real_business=None;app.call=lambda *args:{}
        app._rate=lambda *args:{'now':1}
        calls=[]
        app.onboarding=SimpleNamespace(list_owned=lambda q:calls.append(q) or {'items':[],'hasMore':False})
        return app,calls

    def test_http_route_uses_cookie_and_rejects_address_or_pagination(self):
        app,calls=self.application()
        result=app.handle('GET','/v1/store-registrations',{}, {COOKIE:'inert-cookie'},b'',None)
        self.assertEqual(result[0],200)
        self.assertEqual(calls[0]['session_hash'],digest('inert-cookie'))
        self.assertEqual(result[2]['Cache-Control'],'no-store')
        for query in ('owner=attacker','limit=1'):
            self.assertEqual(app.handle('GET','/v1/store-registrations?'+query,{}, {COOKIE:'inert-cookie'},b'',None)[0],422)
        self.assertEqual(len(calls),1)

    def test_anonymous_session_routes_return_401_without_db_validation(self):
        app,calls=self.application()
        app.call=lambda *args:self.fail('Anonymous request reached session DB validation')
        for path in ('/v1/me','/v1/store-registrations'):
            for cookies in ({},{COOKIE:''}):
                result=app.handle('GET',path,{},cookies,b'',None)
                self.assertEqual(result[:2],(401,{'error':'UNAUTHENTICATED'}))
        self.assertEqual(calls,[])

    def test_cookie_present_preserves_authoritative_failure(self):
        app,_=self.application()
        def reject(q):raise DatabaseRejected('INVALID_HASH',409)
        app.onboarding.list_owned=reject
        result=app.handle('GET','/v1/store-registrations',{}, {COOKIE:'inert-cookie'},b'',None)
        self.assertEqual(result[:2],(409,{'error':'INVALID_HASH','setup':None}))

    def test_sql_contract_is_bounded_and_uses_existing_owner_authority(self):
        source=(Path(__file__).resolve().parents[2]/'connection-migrations/030-onboarding-session-list.sql').read_text()
        for required in ('c1_api.onboarding_authorize','r.ns=n',"r.subject=v_auth->>'subject'",
            "r.record->>'owner'=v_auth->>'owner'","r.record->>'bindingRevision'=v_auth->>'bindingRevision'",
            'LIMIT 51','position<=50','FROM PUBLIC','TO c1_app_api,c1_api_a,c1_api_b'):
            self.assertIn(required,source)
        for forbidden in ('ownerSignature',"'deployment'",'UPDATE ','INSERT ','DELETE ','FOR UPDATE'):
            self.assertNotIn(forbidden,source)


if __name__=='__main__':unittest.main()
