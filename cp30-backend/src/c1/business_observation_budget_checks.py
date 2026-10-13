"""Read-budget override and failure diagnostics; no network, DB or signing."""
from copy import deepcopy
from contextlib import redirect_stderr
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch
import unittest
from .live_gateway import LiveGateway,business_modules,module
from .live_checks import BINDING
from .onboarding_adapter import IntegrationRejected,NODE

class Checks(unittest.TestCase):
    def setUp(self):
        self.obs=business_modules()['observer'];self.rpc=module('rpc_transport')
        budget={'maxCalls':96,'maxTotalMs':20000,'maxCallMs':3000,'maxResponseBytes':1048576,'maxTotalBytes':1048576,'maxMealIds':3}
        evidence={**BINDING,'chainId':str(BINDING['chainId']),**{k:'0x'+'a'*64 for k in ('configHash','parametersDigest','transactionHash','blockHash','registrationId')},'deployment':{},'catalog':[{'terms':{'mealId':'0x'+'b'*64}}]}
        self.profile={'binding':deepcopy(BINDING),'registrationState':'CONFIRMED','registrationEvidence':evidence,'genesisHash':'0x'+'c'*64,'finality':'rpc-finalized','eip1898':True,'runtimeTemplatePin':self.obs.RUNTIME_PIN,'compilerPins':self.obs.PINS.copy(),'budget':budget}
        self.gateway=LiveGateway.__new__(LiveGateway)
        self.gateway.config={'rpc':{},'observer':{'budget':{**budget,'maxTotalMs':45000,'maxCallMs':5000}}}
        self.gateway.codec=SimpleNamespace(node=NODE,call=lambda *args:None)

    def test_both_validators_accept_45_seconds_and_reject_over_cap(self):
        profile={**self.profile,'budget':{**self.profile['budget'],'maxTotalMs':45000,'maxCallMs':5000}}
        self.obs.StoreEscrowObserver(codec=self.gateway.codec,transport_factory=lambda:None,profile=profile)
        self.rpc.validate_profile(profile)
        for key,value in [('maxTotalMs',45001),('maxCallMs',5001),('maxCalls',97),('maxMealIds',4),('maxTotalBytes',1048577),('maxResponseBytes',1048577)]:
            invalid=deepcopy(profile);invalid['budget'][key]=value
            with self.subTest(key=key):
                with self.assertRaises(ValueError):self.obs.StoreEscrowObserver(codec=self.gateway.codec,transport_factory=lambda:None,profile=invalid)
                with self.assertRaises(self.rpc.BusinessTransportError):self.rpc.validate_profile(invalid)

    def test_only_read_copy_changes_and_original_profile_is_preserved(self):
        original=deepcopy(self.profile);observer=self.gateway._observer(self.profile)
        self.assertEqual(observer.profile['budget']['maxTotalMs'],45000)
        self.assertEqual(observer.profile['budget']['maxCallMs'],5000)
        self.assertEqual(self.profile['budget']['maxCallMs'],3000)
        self.assertEqual(self.profile,original)
        observer.profile['binding']['owner']='changed-in-copy'
        self.assertEqual(self.profile,original)

    def test_other_budget_overrides_are_rejected(self):
        for key,value in [('maxCalls',95),('maxCallMs',2999),('maxCallMs',5001),('maxCallMs',True),('maxTotalMs',45001),('maxTotalMs',True)]:
            saved=deepcopy(self.gateway.config)
            self.gateway.config['observer']['budget'][key]=value
            with self.assertRaises(IntegrationRejected):self.gateway._observer(self.profile)
            self.gateway.config=saved

    def test_projection_still_receives_original_profile(self):
        seen=[];g=self.gateway;g.worker_ledger=object()
        g.observer_factory=lambda p:g._observer(p)
        g.projection=SimpleNamespace(finalized_snapshot_rows=lambda *args:{})
        g._fixed=lambda ledger,method,q:seen.append(q) or {'saved':True}
        original=deepcopy(self.profile)
        with patch.object(self.obs.StoreEscrowObserver,'read_finalized',return_value={'inert':True}):
            g._seed_or_refresh({'registration':{'id':'inert','record':{}},'store':{'profile':self.profile,'revision':2}})
        self.assertEqual(seen[0]['profile'],original)
        self.assertEqual(seen[0]['profile']['budget']['maxTotalMs'],20000)

    def test_diagnostics_redact_and_rate_limit(self):
        output=StringIO()
        with patch.object(self.obs,'_last_diagnostic',None),patch.object(self.obs.time,'monotonic',side_effect=[100,101,161]),redirect_stderr(output):
            self.obs.observation_diagnostic(ValueError('inert-secret-detail'),'snapshot',99)
            self.obs.observation_diagnostic(ValueError('TOTAL_TIME_LIMIT'),'snapshot',100)
            self.obs.observation_diagnostic(ValueError('TOTAL_TIME_LIMIT'),'snapshot',160)
        self.assertEqual(len(output.getvalue().splitlines()),2)
        self.assertNotIn('inert-secret-detail',output.getvalue())
        self.assertIn('OBSERVATION_FAILED',output.getvalue());self.assertIn('TOTAL_TIME_LIMIT',output.getvalue())

    def test_finish_failure_never_returns_partial_snapshot(self):
        observer=self.gateway._observer(self.profile)
        session=SimpleNamespace(start=lambda:None,finish=lambda:(_ for _ in ()).throw(ValueError('inert-finality-failure')))
        with patch.object(observer,'_pins'),patch.object(observer,'_snapshot',return_value={'partial':True}),patch.object(self.obs,'_Session',return_value=session),patch.object(self.obs,'observation_diagnostic') as report:
            self.assertIsNone(observer.read_finalized())
            self.assertEqual(report.call_args.args[1],'finish')

if __name__=='__main__':unittest.main()
