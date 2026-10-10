"""R2/R3 regressions adapted from the independent 185493b review probes.
Only synthetic public-chain evidence, temporary files and constructor sentinels.
Never reads a real keystore or contacts RPC, and never starts a signer.
"""
import copy
import tempfile
import time
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.fernet import Fernet
from eth_utils import keccak
from server.backend import canonical, digest
from server.contracts import ApiError
from server.manual_business import cp29_composition as c, cp29_readonly as ro
from server.manual_business.composition import load_backend
from server.manual_business.identity import GENESIS, deployment_plan, verify_deployment, expected_runtime
from server.manual_business.store import ManualStore
from tests.test_cp29_single_operator import config


def readonly_output():
    plan=deployment_plan('cp29-first-meal-20261009',ro.OWNER,ro.OWNER,ro.DEPLOY_NONCE)
    block_hash='0x'+'12'*32
    tx=dict(hash=ro.DEPLOY_TX,blockHash=block_hash,blockNumber=100,transactionIndex=0,
        **{'from':ro.OWNER,'to':None},nonce=ro.DEPLOY_NONCE,chainId=10143,value=0,input=plan['creationInput'])
    receipt=dict(transactionHash=ro.DEPLOY_TX,blockHash=block_hash,blockNumber=100,
                 transactionIndex=0,status=1,contractAddress=ro.CONTRACT.lower())
    block=dict(hash=block_hash,number=100,transactions=[ro.DEPLOY_TX])
    deployed=verify_deployment(plan,tx,receipt,block,expected_runtime(ro.OWNER),101)
    class FakeRpc:
        def __init__(self,*args):pass
        def observation(self):return nullcontext()
        def guard(self):return {'number':101}
        def nonce(self,address):return 0
        def read(self,method,args,height):
            if method in ('paused','totalFunded'):return 0
            role,address=args
            return address==ro.OWNER or role in (keccak(text='ISSUER_ROLE'),keccak(text='OPERATOR_ROLE'))
    with patch.object(ro,'register_deployment',return_value=deployed),patch.object(ro,'TestnetRpc',FakeRpc):
        return ro.observe(plan['runId'],transport=object())


class SignerPreflightTests(unittest.TestCase):
    def capability_case(self,kind):
        backend=SimpleNamespace(runtime=SimpleNamespace(config=config(single=False)))
        with tempfile.TemporaryDirectory(prefix='cp29-cap-test-') as tmp:
            cap=Path(tmp)/'cap'
            if kind!='missing':
                cap.write_text('short' if kind=='short' else 'c'*43)
                cap.chmod(0o644 if kind=='permission' else 0o600)
            error={'missing':FileNotFoundError,'short':ValueError,'permission':PermissionError}[kind]
            with patch.object(c,'load_backend',return_value=backend), \
                 patch('server.manual_business.cp29_keystore.signer_from_encrypted_keystore') as unlock, \
                 patch.object(c,'operator_signer') as start:
                with self.assertRaises(error):
                    c.business_signer(config_file='synthetic',plan_file='synthetic',encryption_key_file='synthetic',
                                      keystore_file='NEVER_OPEN',capability_file=cap)
                unlock.assert_not_called();start.assert_not_called()

    def test_missing_capability_never_reaches_keystore(self):self.capability_case('missing')
    def test_short_capability_never_reaches_keystore(self):self.capability_case('short')
    def test_permission_invalid_capability_never_reaches_keystore(self):self.capability_case('permission')

    def test_valid_preflight_reaches_only_explicit_constructor_sentinels(self):
        backend=SimpleNamespace(runtime=SimpleNamespace(config=config(single=False)))
        with tempfile.TemporaryDirectory() as tmp:
            cap=Path(tmp)/'cap';cap.write_text('c'*43);cap.chmod(0o600)
            with patch.object(c,'load_backend',return_value=backend), \
                 patch('server.manual_business.cp29_keystore.signer_from_encrypted_keystore',return_value='fake-callback') as unlock, \
                 patch.object(c,'operator_signer',return_value='fake-signer') as start:
                self.assertEqual(c.business_signer(config_file='synthetic',plan_file='synthetic',
                    encryption_key_file='synthetic',keystore_file='NEVER_OPEN',capability_file=cap),'fake-signer')
                unlock.assert_called_once();start.assert_called_once_with(backend,'fake-callback','c'*43)

    def test_real_runtime_denial_still_precedes_capability_secret_and_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);cfg=config(single=False)
            d=dict(runId=cfg['runId'],contractAddress=cfg['contractAddress'],
                   merchant=cfg['participants']['merchant'],admin=cfg['participants']['admin'])
            d['deploymentId']=digest(canonical(d))
            cfg.update(deployment=d,deploymentId=d['deploymentId'],genesisHash=GENESIS,databasePath=str(root/'db'/'business.db'))
            ManualStore(cfg['databasePath'],cfg,create=True)
            cf=root/'config';pf=root/'plan'
            cf.write_text(canonical(cfg));pf.write_text('null');cf.chmod(0o600);pf.chmod(0o600)
            with patch('server.manual_business.composition.HttpsTransport') as transport, \
                 patch('server.manual_business.cp29_keystore.signer_from_encrypted_keystore') as unlock:
                with self.assertRaises(ApiError) as exc:
                    c.business_signer(config_file=cf,plan_file=pf,encryption_key_file=root/'ABSENT_SECRET',
                                      keystore_file='NEVER_OPEN',capability_file=root/'ABSENT_CAP')
                self.assertEqual(exc.exception.code,'RUNTIME_NOT_AUTHORIZED')
                transport.assert_not_called();unlock.assert_not_called()


class ReadonlyCompositionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='cp29-composition-offline-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.observed=readonly_output()
        self.cfg=config(single=False)
        self.cfg.update(deployment=self.observed['deployment'],deploymentId=self.observed['deploymentId'],
            contractAddress=self.observed['deployment']['contractAddress'],participants=self.observed['participants'],
            genesisHash=GENESIS,databasePath=str(self.root/'db'/'business.db'),rpcUrl='https://example.invalid')
        self.cf=self.root/'config';self.pf=self.root/'plan';self.secret=self.root/'app-key'
        self.secret.write_bytes(Fernet.generate_key());self.secret.chmod(0o600)
        self.write_config()

    def write_config(self):
        self.cf.write_text(canonical(self.cfg));self.cf.chmod(0o600)
        p={k:self.cfg[k] for k in ('runId','chainId','genesisHash','deploymentId','participants')}
        p.update(version=1,configDigest=digest(canonical(self.cfg)),expiresAt=int(time.time())+300,
                 actions={'proof':dict(count=1,gas=0,maxFeePerGas=0,maxPriorityFeePerGas=0,value=0)},
                 totalValueWei=0,totalFeeWei=0)
        self.pf.write_text(canonical(p));self.pf.chmod(0o600)

    def test_full_readonly_output_composes_without_rewriting_deployment_or_digest(self):
        original=copy.deepcopy(self.observed)
        self.assertNotEqual(self.cfg['deployment']['merchant'],self.cfg['participants']['merchant'])
        self.assertEqual(self.cfg['deployment']['merchant'].lower(),self.cfg['participants']['merchant'])
        ManualStore(self.cfg['databasePath'],self.cfg,create=True)
        # Production RuntimeGate, TestnetRpc and ManualBackend constructors run;
        # transport must never be called and there is no signer construction.
        with patch('server.manual_business.composition.HttpsTransport') as factory:
            factory.return_value.side_effect=AssertionError('No network allowed')
            backend=load_backend(self.cf,self.pf,self.secret)
            factory.return_value.assert_not_called()
        self.assertEqual(backend.deployment,original['deployment'])
        self.assertEqual(self.observed,original)
        self.assertEqual(backend.deployment['deploymentId'],original['deploymentId'])
        identity={k:v for k,v in backend.deployment.items() if k!='deploymentId'}
        self.assertEqual(digest(canonical(identity)),original['deploymentId'])

    def test_changed_or_invalid_participant_address_still_rejected_before_db_and_network(self):
        for value in ('0x'+'d'*40,'not-an-address',None):
            for role in ('admin','merchant'):
                with self.subTest(value=value,role=role):
                    self.cfg['participants']=copy.deepcopy(self.observed['participants'])
                    self.cfg['participants'][role]=value;self.write_config()
                    with patch('server.manual_business.composition.ManualStore') as store, \
                         patch('server.manual_business.composition.HttpsTransport') as network:
                        with self.assertRaisesRegex(ValueError,'participant configuration differ'):
                            load_backend(self.cf,self.pf,self.secret)
                        store.assert_not_called();network.assert_not_called()

    def test_case_only_mutation_of_original_deployment_still_breaks_its_digest(self):
        self.cfg['deployment']=copy.deepcopy(self.cfg['deployment'])
        self.cfg['deployment']['merchant']=self.cfg['deployment']['merchant'].lower()
        self.write_config()
        with patch('server.manual_business.composition.ManualStore') as store:
            with self.assertRaisesRegex(ValueError,'deployment identity required'):
                load_backend(self.cf,self.pf,self.secret)
            store.assert_not_called()

if __name__=='__main__':unittest.main()
