"""Isolated actual crypto bridge check. No PrivateRuntime/old suite/PG/RPC is invoked."""
import json
from pathlib import Path
import subprocess
import unittest

from business.transaction_crypto import TransactionCrypto, TransactionCryptoError


class TransactionCryptoBridgeTest(unittest.TestCase):
    def test_actual_empty_environment_bridge_and_runtime_hash_facet(self):
        script = Path(__file__).with_name('transaction-crypto.test.mjs')
        generated = subprocess.run(['/opt/homebrew/bin/node', str(script), '--temporary-memory-fixture'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, timeout=5, check=False)
        self.assertEqual(generated.returncode, 0, 'Synthetic in-memory fixture unavailable')
        # Private fixture raw remains only in process memory; no raw/key/signature assertions or logs.
        fixture = json.loads(generated.stdout)
        crypto = TransactionCrypto('/opt/homebrew/bin/node')
        expected = crypto.prepare_original_envelope(fixture['descriptor'], fixture['approvedPlan'])
        observed = crypto.inspect_signed_transaction(fixture['raw'], expected)
        self.assertEqual(set(observed), {'hash', 'type', 'chainId', 'from', 'to', 'value', 'data',
                                       'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas'})
        self.assertEqual(observed['from'], expected['from'])
        self.assertEqual(observed['nonce'], '0')
        self.assertEqual(observed['type'], 'eip1559')
        record = {'deployment': fixture['descriptor'], 'transaction': {key: fixture['approvedPlan'][key]
                  for key in ('nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas')}}
        runtime_result = crypto.verify_signed_transaction(record, fixture['raw'], gas_budget_wei='100000')
        self.assertEqual(runtime_result['transactionHash'], observed['hash'])
        for change in ({'nonce': '1'}, {'maxFeePerGas': '3'}, {'to': '0x' + '2' * 40}, {'data': '0x1235'}):
            with self.subTest(fields=tuple(change)), self.assertRaises(TransactionCryptoError):
                crypto.inspect_signed_transaction(fixture['raw'], {**expected, **change})


if __name__ == '__main__':
    unittest.main()
