"""Targeted receipt budget checks; synthetic memory/Node only, no live resource."""
from copy import deepcopy
import hashlib
import subprocess
import time
import unittest
from unittest.mock import patch
from .connection_composition import wallet_modules
from .encoding import NODE
from .onboarding_adapter import ROOT


class Checks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.observer,cls.transport=wallet_modules()
        result=subprocess.run([NODE,str(ROOT/'integrations/wallet/python-bridge-fixture.mjs')],
            env={},stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=3,check=True)
        cls.fixture=cls.transport.strict_json(result.stdout)

    def budget(self):return {**self.fixture['profile']['budget'],'maxTotalMs':40000}

    def test_forty_seconds_requires_explicit_receipt_scope(self):
        budget=self.budget()
        with self.assertRaises(self.transport.ObserverTransportError):self.transport.validate_budget(budget)
        self.assertEqual(self.transport.validate_budget(budget,registration_receipt=True),budget)
        self.assertEqual(self.transport.validate_budget(self.fixture['profile']['budget']),self.fixture['profile']['budget'])
        for key,value in [('maxTotalMs',40001),('maxCallMs',3001),('maxCalls',49),
            ('maxResponseBytes',1048577),('maxTotalBytes',1048577)]:
            with self.subTest(key=key),self.assertRaises(self.transport.ObserverTransportError):
                self.transport.validate_budget({**budget,key:value},registration_receipt=True)

    def test_transport_default_scope_stays_twenty_seconds_and_does_not_connect(self):
        profile={**self.fixture['profile'],'budget':self.budget()}
        values={'endpoint':'https://synthetic.invalid/','allowed_endpoints':['https://synthetic.invalid/'],
            'allowed_hosts':['synthetic.invalid'],'python_executable':'/synthetic/python','profile':profile}
        with patch.object(self.transport.subprocess,'Popen') as child:
            with self.assertRaises(self.transport.ObserverTransportError):self.transport.ReadOnlyJsonRpcTransport(**values)
            scoped=self.transport.ReadOnlyJsonRpcTransport(**values,registration_receipt=True)
            self.assertEqual(scoped.budget['maxTotalMs'],40000)
            self.assertEqual(scoped.budget['maxCallMs'],3000)
            child.assert_not_called()

    def test_actual_pinned_python_node_bridge_keeps_all_thirty_seven_checks(self):
        fixture=deepcopy(self.fixture);fixture['profile']['budget']=self.budget();calls=[]
        outer=self
        class Transcript:
            def request(self,method,params,*,deadline):
                outer.assertGreater(deadline,time.monotonic())
                entry=fixture['entries'][len(calls)]
                outer.assertEqual((method,params),(entry['method'],entry['params']))
                outer.transport.validate_readonly_request(method,params,fixture['profile']['factory'])
                calls.append(method);return deepcopy(entry['result'])
        verifier=self.observer.NodeReceiptVerifier(node_executable=NODE,profile=fixture['profile'],
            transport_factory=Transcript,compiler_pins=self.observer.EXPECTED_COMPILER_PINS)
        evidence=verifier.verify_original(fixture['original'],fixture['transactionHash'],fixture['deployment'])
        self.assertEqual(evidence,fixture['evidence']);self.assertEqual(len(calls),37)

    def test_updated_runner_pins_match_files_and_existing_abi_pins_remain(self):
        for name in ('registration-observer.mjs','registration-observer-runner.mjs'):
            self.assertEqual(hashlib.sha256((ROOT/'integrations/wallet'/name).read_bytes()).hexdigest(),
                self.observer.EXPECTED_COMPILER_PINS[name])
        self.assertEqual(self.observer.EXPECTED_COMPILER_PINS['index.mjs'],'5a5c2c1961e55519829e78824b306308c09657f32712dccbc0dda13ccf44eca0')
        self.assertEqual(self.observer.EXPECTED_COMPILER_PINS['factory-abi.mjs'],'e32e4605f0333b04464e3cdf55155016c512cb44ed05fdaceeb9af15c9aed838')
        self.assertEqual(self.observer.EXPECTED_COMPILER_PINS['escrow-abi.mjs'],'1f8c6f4e1d1657042ed89f0f76a16dac8ff7d608099d2edfa58dee6be0e69af7')


if __name__=='__main__':unittest.main()
