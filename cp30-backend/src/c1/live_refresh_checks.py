"""Offline scheduling and bounded RPC error diagnostics. No network or signer."""
from contextlib import redirect_stderr
from io import StringIO
from unittest.mock import Mock,patch
import unittest
from . import live_checks
from .live_gateway import module

class Checks(unittest.TestCase):
    def setUp(self):
        live_checks.LiveChecks.setUp(self)
        self.store={'snapshot':{'timestamp':'100'},'profile':{},'meal':'c'*64}
        self.tasks=[]
        self.gateway._seed_or_refresh=Mock(return_value={'state':'REFRESHED'})
        self.gateway._check_approval=lambda material:None
        def material(q):
            if q.get('op')=='registration':return {'registration':{'id':'inert'},'store':self.store}
            if q.get('op')=='tasks':return {'items':self.tasks}
            return {'intent':next(i for i in self.tasks if i['id']==q['id']),'store':self.store,'attempts':{}}
        self.worker.responses['live_material']=material

    def task(self,id_):
        return {'id':id_,'action':'fund','signed_quote':{'inert':True},'transaction_hash':None,'observer_record':None}

    def test_fresh_idle_and_wait_actor_never_refresh(self):
        self.assertEqual(self.gateway.step()['state'],'IDLE')
        self.tasks=[self.task('one')]
        self.assertEqual(self.gateway.step()['state'],'WAIT_ACTOR')
        self.gateway._seed_or_refresh.assert_not_called()

    def test_stale_refresh_cooldown_and_fair_rotation(self):
        self.store['snapshot']['timestamp']='40'
        self.tasks=[self.task('one'),self.task('two')]
        with patch('c1.live_gateway.time.monotonic',return_value=100):
            self.assertEqual(self.gateway.step()['state'],'REFRESHED')
        # Even after cooldown, one task is allowed before the next refresh.
        with patch('c1.live_gateway.time.monotonic',return_value=111):
            self.assertEqual(self.gateway.step()['state'],'WAIT_ACTOR')
            self.assertEqual(self.gateway._task_cursor,1)
            self.assertEqual(self.gateway.step()['state'],'REFRESHED')
            self.assertEqual(self.gateway.step()['state'],'WAIT_ACTOR')
            self.assertEqual(self.gateway._task_cursor,2)
            self.assertEqual(self.gateway.step()['state'],'WAIT_ACTOR')
        self.assertEqual(self.gateway._seed_or_refresh.call_count,2)

    def test_failed_refresh_still_yields_and_does_not_retry_each_tick(self):
        self.store['snapshot']['timestamp']='0'
        self.tasks=[self.task('one')]
        self.gateway._seed_or_refresh.side_effect=ValueError('inert')
        with patch('c1.live_gateway.time.monotonic',return_value=100),redirect_stderr(StringIO()):
            self.assertEqual(self.gateway.step()['state'],'UNKNOWN')
            self.assertEqual(self.gateway.step()['state'],'WAIT_ACTOR')
            self.assertEqual(self.gateway.step()['state'],'WAIT_ACTOR')
        self.assertEqual(self.gateway._seed_or_refresh.call_count,1)

    def test_verified_lock_revert_uses_worker_projection_without_authority_execution(self):
        self.store['revision']=3
        record={'original':'synthetic'};hash_='0x'+'a'*64
        self.tasks=[{'id':'original-lock','store':'inert','action':'lock','stage':'UNKNOWN','revision':2,
                     'signed_quote':None,'transaction_hash':hash_,'observer_record':record,'private_record':{}}]
        proof={'authority':'VERIFIED_ORIGINAL_LOCK_REVERT','original':record,'transactionHash':hash_}
        self.gateway.observer_factory=lambda *_:Mock(verify_original_operation=Mock(return_value=proof))
        for client in self.clients.values():client.execute=Mock(side_effect=AssertionError('No signing or rebroadcast'))
        self.worker.responses['live_projection']={'state':'FINAL_REVERT'}
        self.assertEqual(self.gateway.step()['state'],'FINAL_REVERT')
        _,q,readonly=self.worker.calls[-1]
        self.assertEqual(q['lockRevert'],proof);self.assertEqual(q['intentRevision'],2)
        self.assertEqual(q['expectedRevision'],3);self.assertFalse(readonly)
        for client in self.clients.values():client.execute.assert_not_called()

    def test_diagnostics_classification_redaction_and_rate_limit(self):
        rpc=module('rpc_transport');worker=module('rpc_worker')
        self.assertEqual(worker.failure_code(TimeoutError('secret')),'BUSINESS_RPC_TIMEOUT')
        self.assertEqual(worker.failure_code(worker.BusinessTransportError('BUSINESS_RPC_HTTP_REJECTED')),'BUSINESS_RPC_HTTP_REJECTED')
        self.assertEqual(worker.failure_code(ValueError('secret')),'BUSINESS_RPC_WORKER_EXIT')
        self.assertEqual(rpc.worker_failure(b'{"error":"BUSINESS_RPC_TIMEOUT"}'),'BUSINESS_RPC_TIMEOUT')
        self.assertEqual(rpc.worker_failure(b'{"error":"secret"}'),'BUSINESS_RPC_WORKER_EXIT')
        self.assertEqual(rpc.worker_failure(b'invalid secret'),'BUSINESS_RPC_WORKER_EXIT')
        out=StringIO()
        with patch.object(rpc,'_last_rpc_diagnostic',None),patch.object(rpc.time,'monotonic',return_value=100),redirect_stderr(out):
            rpc.rpc_diagnostic(ValueError('secret'),'secret-url',99)
            rpc.rpc_diagnostic(ValueError('secret'),'eth_call',99)
        self.assertEqual(len(out.getvalue().splitlines()),1)
        self.assertNotIn('secret',out.getvalue())
        self.assertIn('BUSINESS_RPC_UNAVAILABLE',out.getvalue())

if __name__=='__main__':unittest.main()
