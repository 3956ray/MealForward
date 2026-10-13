"""Fixed empty-environment Node bridge; run outside all database transactions."""
import json
from pathlib import Path
import subprocess


class TransactionCryptoError(ValueError):
    pass


class TransactionCrypto:
    transaction_codec_protocol = 'CP30_CANONICAL_SIGNED_TRANSACTION_V1'

    def __init__(self, node_executable):
        self.node = Path(node_executable)
        if not self.node.is_absolute():
            raise TransactionCryptoError('ABSOLUTE_NODE_REQUIRED')
        self.helper = Path(__file__).with_name('transaction-crypto.mjs')

    def _call(self, method, parameters):
        try:
            request = json.dumps({'method': method, 'parameters': parameters},
                                 separators=(',', ':'), allow_nan=False).encode()
            if len(request) > 131072:
                raise TransactionCryptoError('TRANSACTION_CRYPTO_INPUT_LIMIT')
            result = subprocess.run([str(self.node), str(self.helper)], input=request,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, timeout=3, check=False)
            if result.returncode or len(result.stdout) > 131072:
                raise TransactionCryptoError('SIGNED_TRANSACTION_REJECTED')
            value = json.loads(result.stdout)
            if type(value) is not dict or value.get('error'):
                raise TransactionCryptoError('SIGNED_TRANSACTION_REJECTED')
            return value
        except (OSError, subprocess.TimeoutExpired):
            raise TransactionCryptoError('TRANSACTION_CRYPTO_UNAVAILABLE') from None
        except (ValueError, TypeError):
            raise TransactionCryptoError('SIGNED_TRANSACTION_REJECTED') from None

    def prepare_original_envelope(self, descriptor, approved_plan):
        return self._call('prepare_original_envelope', {'descriptor': descriptor, 'approvedPlan': approved_plan})

    def inspect_signed_transaction(self, raw, expected):
        return self._call('inspect_signed_transaction', {'raw': raw, 'expected': expected})

    def verify_signed_transaction(self, record, raw, *, gas_budget_wei):
        """Runtime host convenience facet; Main supplies the approved budget outside a transaction.

        This class is not the full host codec: quote preparation/verification and operation encoding
        remain existing BusinessCodec/Main composition. No private_runtime or record schema is changed.
        """
        try:
            plan = {'type': 'eip1559', **record['transaction'], 'gasBudgetWei': gas_budget_wei}
            expected = self.prepare_original_envelope(record['deployment'], plan)
            result = self.inspect_signed_transaction(raw, expected)
            return {**result, 'transactionHash': result['hash']}
        except (KeyError, TypeError):
            raise TransactionCryptoError('SIGNED_TRANSACTION_REJECTED') from None
