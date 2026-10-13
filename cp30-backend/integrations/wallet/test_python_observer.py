"""Pure-memory RPC transcript + real owned Node bridge; never contact any endpoint."""
from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from registration_observer import NodeReceiptVerifier, ObserverBridgeError, EXPECTED_COMPILER_PINS
from rpc_transport import ObserverTransportError, ReadOnlyJsonRpcTransport, endpoint_config, strict_json, validate_readonly_request

NODE = '/opt/homebrew/bin/node'
ROOT = Path(__file__).resolve().parent


class SyntheticTransport:
    def __init__(self, entries, missing_receipt=False, wrong_original=False):
        self.entries = deepcopy(entries)
        self.calls = 0
        self.missing_receipt, self.wrong_original = missing_receipt, wrong_original

    def request(self, method, params, *, deadline):
        if time.monotonic() >= deadline: raise AssertionError('expired synthetic deadline')
        entry = self.entries[self.calls]
        if (method, params) != (entry['method'], entry['params']): raise AssertionError('transcript mismatch')
        self.calls += 1
        result = deepcopy(entry['result'])
        if self.missing_receipt and method == 'eth_getTransactionReceipt': return None
        if self.wrong_original and method == 'eth_getTransactionByHash': result['from'] = '0x'+'f'*40
        return result


class PythonObserverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        completed = subprocess.run([NODE, str(ROOT / 'python-bridge-fixture.mjs')], env={},
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2, check=True)
        cls.fixture = strict_json(completed.stdout)

    def verifier(self, transport, profile=None, pins=None):
        return NodeReceiptVerifier(node_executable=NODE, profile=profile or self.fixture['profile'],
                                   transport_factory=lambda: transport,
                                   compiler_pins=EXPECTED_COMPILER_PINS if pins is None else pins)

    def test_real_node_protocol_complete_evidence_and_pending_wrong_original(self):
        for mode in ('complete', 'pending', 'wrong'):
            transport = SyntheticTransport(self.fixture['entries'], missing_receipt=mode == 'pending', wrong_original=mode == 'wrong')
            result = self.verifier(transport).verify_original(self.fixture['original'], self.fixture['transactionHash'], self.fixture['deployment'])
            if mode == 'complete':
                self.assertEqual(result, self.fixture['evidence'])
                self.assertEqual(transport.calls, 37)
            else: self.assertIsNone(result)

    def test_missing_configuration_or_changed_pins_close_before_transport(self):
        transport = SyntheticTransport(self.fixture['entries'])
        profile = deepcopy(self.fixture['profile']); profile.pop('genesisHash')
        with self.assertRaisesRegex(ObserverBridgeError, '^OBSERVER_CONFIGURATION_REQUIRED$'): self.verifier(transport, profile=profile)
        with self.assertRaisesRegex(ObserverBridgeError, '^OBSERVER_COMPILER_PINS_REQUIRED$'): self.verifier(transport, pins={})
        self.assertEqual(transport.calls, 0)

    def test_transport_exception_has_fixed_error_without_input(self):
        class Broken:
            def request(self, *args, **kwargs): raise RuntimeError('private endpoint and calldata must not escape')
        with self.assertRaisesRegex(ObserverBridgeError, '^OBSERVER_TRANSPORT_REJECTED$'):
            self.verifier(Broken()).verify_original(self.fixture['original'], self.fixture['transactionHash'], self.fixture['deployment'])

    def test_https_configuration_and_only_snapshot_readonly_request_shapes(self):
        endpoint = 'https://rpc.synthetic.invalid/readonly'
        self.assertEqual(endpoint_config(endpoint, [endpoint], ['rpc.synthetic.invalid'])[0], 'rpc.synthetic.invalid')
        for bad in ('http://rpc.synthetic.invalid/readonly', 'https://other.synthetic.invalid/', 'https://user:pass@rpc.synthetic.invalid/', 'https://rpc.synthetic.invalid:444/'):
            with self.assertRaises(ObserverTransportError): endpoint_config(bad, [bad], ['rpc.synthetic.invalid'])
        profile = self.fixture['profile']
        ReadOnlyJsonRpcTransport(endpoint=endpoint, allowed_endpoints=[endpoint], allowed_hosts=['rpc.synthetic.invalid'],
                                 python_executable=sys.executable, profile=profile)  # Constructor makes zero IO.
        for method, params in [('eth_sendRawTransaction', ['0x1234']), ('eth_call', [{'to': profile['factory'], 'data': '0x12345678'}, 'latest']),
                               ('eth_getCode', [profile['factory'], 'latest']), ('eth_getBlockByNumber', ['pending', False])]:
            with self.assertRaises(ObserverTransportError): validate_readonly_request(method, params, profile['factory'])
        for entry in self.fixture['entries']:
            validate_readonly_request(entry['method'], entry['params'], profile['factory'])


if __name__ == '__main__': unittest.main()
