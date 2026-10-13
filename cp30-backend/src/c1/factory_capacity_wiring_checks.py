"""Normal in-memory capacity wiring/transport checks. No PG/HTTP/RPC/key IO."""
from copy import deepcopy
import importlib
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from .connection_composition import RegistrationWorker,compose_services
from .factory_capacity_transport import FactoryCapacityTransport
from .onboarding_adapter import domain_modules,IntegrationRejected,NODE

PROFILE={'chainId':'10143','factory':'0x'+'1'*40,'registrar':'0x'+'2'*40,
    'asset':'0x'+'3'*40,'quoteAuthority':'0x'+'4'*40,'catalogAuthority':'0x'+'5'*40,
    'issuerAuthority':'0x'+'6'*40,'operatorAuthority':'0x'+'7'*40,'escrowCreationCodeHash':'0x'+'8'*64}
EVIDENCE={'profile':PROFILE,'count':0,'observedAt':100,'blockHash':'0x'+'9'*64}
BUDGET={'maxCalls':14,'maxTotalMs':20000,'maxCallMs':3000,'maxResponseBytes':262144,
    'maxTotalBytes':1048576,'maxCatalogEntries':3}


class Checks(unittest.TestCase):
    def worker(self):
        events=[];clock=[0];failure=[None];db_response=[{'retained':True}]
        def observe():
            events.append('observe')
            if failure[0]:raise failure[0]
            return deepcopy(EVIDENCE)
        def retain(method,namespace,evidence):
            self.assertEqual((method,namespace),('factory_capacity','synthetic_namespace'))
            self.assertEqual(evidence,{**EVIDENCE,'blockHash':EVIDENCE['blockHash'][2:]});events.append('retain')
            return db_response[0]
        dispatcher=SimpleNamespace(step=lambda:events.append('dispatch') or None,
            tasks=SimpleNamespace(next_task=lambda:None))
        worker=RegistrationWorker(dispatcher,capacity_observer=SimpleNamespace(observe=observe),
            database=SimpleNamespace(call=retain),namespace=lambda:'synthetic_namespace',
            expected_profile=deepcopy(PROFILE),monotonic=lambda:clock[0])
        return worker,events,clock,failure,db_response

    def test_first_empty_queue_refreshes_before_dispatch_and_ten_second_throttle(self):
        worker,events,clock,_,_=self.worker()
        worker.step();self.assertEqual(events,['observe','retain','dispatch'])
        clock[0]=9;worker.step();self.assertEqual(events.count('observe'),1)
        clock[0]=10;worker.step();self.assertEqual(events.count('observe'),2)

    def test_failed_observation_never_writes_and_preserves_dispatcher_with_backoff(self):
        worker,events,clock,failure,_=self.worker();failure[0]=RuntimeError('inert private detail')
        self.assertIsNone(worker.step());self.assertEqual(worker.last_error,'FACTORY_CAPACITY_UNAVAILABLE')
        clock[0]=9;worker.step();self.assertEqual(events,['observe','dispatch','dispatch'])
        failure[0]=None;clock[0]=10;worker.step()
        self.assertEqual(events,['observe','dispatch','dispatch','observe','retain','dispatch'])
        self.assertIsNone(worker.last_error)

    def test_rejected_retention_or_profile_conflict_preserves_original_dispatcher(self):
        worker,events,_,_,response=self.worker();response[0]={'error':'UNAVAILABLE'}
        self.assertIsNone(worker.step());self.assertEqual(worker.last_error,'FACTORY_CAPACITY_UNAVAILABLE')
        self.assertEqual(events,['observe','retain','dispatch'])
        worker,events,_,_,_=self.worker();worker.expected_profile={**PROFILE,'extra':'unapproved'}
        self.assertIsNone(worker.step());self.assertEqual(events,['observe','dispatch'])

    def test_db_hash_boundary_removes_prefix_without_mutating_observer_evidence(self):
        worker,events,_,_,_=self.worker();evidence=deepcopy(EVIDENCE);original=deepcopy(evidence)
        worker.capacity_observer=SimpleNamespace(observe=lambda:evidence)
        captured=[];worker.database=SimpleNamespace(call=lambda method,namespace,q:captured.append(q) or {'retained':True})
        worker.step()
        self.assertEqual(captured,[{**original,'blockHash':'9'*64}])
        self.assertEqual(evidence,original);self.assertIsNot(captured[0],evidence)

    def test_malformed_public_block_hash_never_reaches_database(self):
        for block_hash in ['9'*64,'0x'+'A'*64,'0x'+'9'*63,'0x'+'g'*64,None,123]:
            with self.subTest(block_hash=block_hash):
                worker,events,_,_,_=self.worker()
                worker.capacity_observer=SimpleNamespace(observe=lambda:{**EVIDENCE,'blockHash':block_hash})
                worker.step()
                self.assertEqual(events,['dispatch'])
                self.assertEqual(worker.last_error,'FACTORY_CAPACITY_UNAVAILABLE')

    def test_capacity_failure_preserves_original_unknown_lookup_without_new_send(self):
        worker,events,_,failure,_=self.worker();failure[0]=RuntimeError('inert failure')
        domain_modules();leaf=importlib.import_module('c1_onboarding_integration.dispatcher')
        task={'namespace':'synthetic_namespace','registrationId':'0x'+'a'*64}
        domain=SimpleNamespace(original_attempt=lambda *args:{'registrationId':task['registrationId'],'state':'UNKNOWN'},
            reconcile=lambda *args:{'state':'UNKNOWN','ready':False})
        registrar=SimpleNamespace(original_lookup_protocol=leaf.ORIGINAL_LOOKUP_V1,
            send_original=lambda *args:self.fail('must not send'),
            lookup_original=lambda *args:events.append('lookup') or None)
        reads=[]
        tasks=SimpleNamespace(next_task=lambda:reads.append('read') or deepcopy(task))
        worker.dispatcher=leaf.OnboardingDispatcher(domain,registrar,tasks)
        self.assertEqual(worker.step()['state'],'UNKNOWN')
        self.assertEqual(events,['observe','lookup']);self.assertEqual(reads,['read'])

    def test_capacity_failure_keeps_previously_authorized_pending_queue_then_only_lookup(self):
        worker,events,_,failure,_=self.worker();failure[0]=RuntimeError('inert failure')
        domain_modules();leaf=importlib.import_module('c1_onboarding_integration.dispatcher')
        records={'pending':{'registrationId':'0x'+'a'*64,'state':'PENDING'},
            'unknown':{'registrationId':'0x'+'b'*64,'state':'UNKNOWN'}}
        original_unknown=deepcopy(records['unknown']);attempts=[]
        def record(namespace,rid):return next(deepcopy(r) for r in records.values() if r['registrationId']==rid)
        def begin(namespace,rid):
            records['pending']['state']='UNKNOWN';return record(namespace,rid)
        def task():
            selected=records['pending'] if records['pending']['state']=='PENDING' else records['unknown']
            return {'namespace':'synthetic_namespace','registrationId':selected['registrationId']}
        domain=SimpleNamespace(original_attempt=record,begin_attempt=begin,reconcile=lambda *args:{'state':'UNKNOWN','ready':False})
        registrar=SimpleNamespace(original_lookup_protocol=leaf.ORIGINAL_LOOKUP_V1,
            send_original=lambda r:attempts.append(('send',r['registrationId'])) or None,
            lookup_original=lambda r:attempts.append(('lookup',r['registrationId'])) or None)
        worker.dispatcher=leaf.OnboardingDispatcher(domain,registrar,SimpleNamespace(next_task=task))
        worker.step();worker.step()
        self.assertEqual(attempts,[('send',records['pending']['registrationId']),('lookup',records['unknown']['registrationId'])])
        self.assertEqual(records['unknown'],original_unknown)
        self.assertEqual(events,['observe']);self.assertEqual(worker.last_error,'FACTORY_CAPACITY_UNAVAILABLE')

    def test_composition_uses_full_observer_profile_and_exact_factory_parameters(self):
        domain_modules();real_import=importlib.import_module;captured={}
        def factory(**kwargs):captured.update(kwargs);return SimpleNamespace(observe=lambda:deepcopy(EVIDENCE))
        def load(name):
            return SimpleNamespace(FactoryCapacityObserver=factory) if name=='c1_onboarding_integration.factory_capacity' else real_import(name)
        observer_profile={**PROFILE,'chainId':10143,'genesisHash':'0x'+'b'*64,
            'runtimeTemplatePins':{'factory':'0x'+'c'*64},'budget':{**BUDGET,'maxTotalMs':40000}}
        registrar=SimpleNamespace(original_lookup_protocol='CP30_ORIGINAL_REGISTRATION_V1',
            send_original=lambda *args:None,lookup_original=lambda *args:None)
        config={'connection':{'profile':{**PROFILE,'mode':'TESTNET','assetDecimals':6,'assetSymbol':'USDC'},
            'observer':{'profile':observer_profile}}}
        with patch('c1.connection_composition.importlib.import_module',side_effect=load):
            services=compose_services(config,SimpleNamespace(),lambda:'synthetic_namespace',services={
                'registration_database':SimpleNamespace(database='onboarding_internal'),'registrar':registrar,
                'receipt_verifier':SimpleNamespace(),'identity_client':SimpleNamespace()})
        self.assertIsNot(captured['profile'],observer_profile)
        self.assertEqual(captured['profile'],{**observer_profile,'budget':BUDGET})
        self.assertEqual(observer_profile['budget']['maxTotalMs'],40000)
        self.assertEqual(services['dispatcher'].expected_profile,PROFILE)

    def transport(self):
        settings={'endpoint':'https://synthetic.invalid/','allowedEndpoints':['https://synthetic.invalid/'],
            'allowedHosts':['synthetic.invalid'],'pythonExecutable':'/synthetic/python','profile':{'budget':BUDGET}}
        return FactoryCapacityTransport(settings,PROFILE)

    def test_all_eight_selectors_match_actual_abi_codec_and_are_accepted(self):
        codec=Path(__file__).with_name('registrar_profile_codec.mjs')
        result=subprocess.run([NODE,str(codec)],input=b'{"op":"calls"}',env={},
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=3,check=True)
        calls=json.loads(result.stdout)['calls']
        self.assertEqual(set(calls),{'asset','registrar','quoteAuthority','catalogAuthority',
            'issuerAuthority','operatorAuthority','escrowCreationCodeHash','storeCount'})
        self.assertEqual(set(calls.values()),set(FactoryCapacityTransport.SELECTORS))
        self.assertEqual(len(FactoryCapacityTransport.SELECTORS),8)
        from .registrar_rpc import validate
        transport=self.transport();block={'blockHash':EVIDENCE['blockHash'],'requireCanonical':True}
        for selector in calls.values():validate('eth_call',[{'to':PROFILE['factory'],'data':selector},block],transport.settings)

    def test_transport_never_starts_worker_for_broadcast_other_target_or_unlisted_getter(self):
        transport=self.transport();block={'blockHash':EVIDENCE['blockHash'],'requireCanonical':True}
        with patch('c1.factory_capacity_transport.subprocess.Popen') as worker:
            for method,params in [('eth_sendRawTransaction',['0x00']),('eth_getTransactionCount',[PROFILE['registrar'],'pending']),
                ('eth_call',[{'to':PROFILE['asset'],'data':'0xa1b141d4'},block]),
                ('eth_call',[{'to':PROFILE['factory'],'data':'0x00000000'},block])]:
                with self.assertRaises(ValueError):transport.request(method,params,deadline=100)
            worker.assert_not_called()

    def test_store_count_worker_is_empty_environment_and_hard_deadline_bounded(self):
        transport=self.transport();block={'blockHash':EVIDENCE['blockHash'],'requireCanonical':True}
        child=SimpleNamespace(returncode=0,stdin=None,stdout=None,poll=lambda:0,wait=lambda **kw:0)
        def communicate(raw,*,timeout):
            packet=json.loads(raw);self.assertEqual(packet['method'],'eth_call')
            self.assertEqual(packet['params'][0],{'to':PROFILE['factory'],'data':'0xa1b141d4'})
            self.assertFalse(packet['settings']['broadcastEnabled'])
            self.assertGreater(timeout,0);self.assertLessEqual(timeout,1)
            return b'{"result":"0x00"}',None
        child.communicate=communicate
        with patch('c1.factory_capacity_transport.time.monotonic',return_value=transport.started),patch('c1.factory_capacity_transport.subprocess.Popen',return_value=child) as start:
            self.assertEqual(transport.request('eth_call',[{'to':PROFILE['factory'],'data':'0xa1b141d4'},block],deadline=transport.started+1),'0x00')
            self.assertEqual(start.call_args.kwargs['env'],{})
            self.assertEqual(start.call_args.args[0][:3],['/synthetic/python','-I','-B'])


if __name__=='__main__':unittest.main()
