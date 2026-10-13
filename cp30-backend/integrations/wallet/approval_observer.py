"""Observe only the original ERC20 approve and current finalized allowance.

No database or authority mutation. Main must recheck original session, quote,
deadline, payer and attempt in its final transaction before enabling original fund.
"""
import re
import subprocess
import time
from pathlib import Path

from approval_rpc import (ApprovalError, address, word, quantity, profile_config,
    json_bytes, strict_json, scope_config, validate_request)


class ApprovalObserver:
    def __init__(self, *, node_executable, profile, transport_factory):
        self.node = Path(node_executable)
        if not self.node.is_absolute() or not self.node.is_file():
            raise ApprovalError('ABSOLUTE_NODE_REQUIRED')
        if not callable(transport_factory): raise ApprovalError('APPROVAL_TRANSPORT_REQUIRED')
        self.profile = profile_config(strict_json(json_bytes(profile)))
        self.transport_factory = transport_factory
        self.helper = Path(__file__).with_name('approval-codec.mjs')

    def _codec(self, method, parameters, deadline):
        packet = json_bytes({'method': method, 'parameters': parameters})
        if len(packet) > 524288: raise ApprovalError('APPROVAL_CODEC_REJECTED')
        timeout = min(3, deadline - time.monotonic())
        if timeout <= 0: raise ApprovalError('APPROVAL_BUDGET_EXHAUSTED')
        try:
            result = subprocess.run([str(self.node), str(self.helper)], input=packet,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={},
                cwd=str(self.helper.parent), timeout=timeout, check=False)
            if result.returncode or len(result.stdout) > 4096 or time.monotonic() > deadline:
                raise ApprovalError('APPROVAL_CODEC_REJECTED')
            value = strict_json(result.stdout)
            if type(value) is not dict or 'error' in value: raise ApprovalError('APPROVAL_CODEC_REJECTED')
            return value
        except (OSError, subprocess.TimeoutExpired):
            raise ApprovalError('APPROVAL_CODEC_UNAVAILABLE') from None

    def _record(self, record, deadline):
        record = strict_json(json_bytes(record))
        if (type(record) is not dict or set(record) != {'attemptId', 'quoteId', 'payer',
            'amount', 'transactionHash', 'deployment'} or type(record['attemptId']) is not str
            or not re.fullmatch(r'(?:[A-Za-z0-9_-]{1,128}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:approve)', record['attemptId'])
            or type(record['amount']) is not str or not re.fullmatch(r'[1-9][0-9]{0,77}', record['amount'])
            or int(record['amount']) >= 1 << 256):
            raise ApprovalError('ORIGINAL_APPROVAL_REJECTED')
        for k in ('quoteId', 'transactionHash'): record[k] = word(record[k])
        record['payer'] = address(record['payer'])
        deployment = record['deployment']
        if type(deployment) is not dict or set(deployment) != {'chainId', 'from', 'to', 'value', 'data', 'callDataDigest'}:
            raise ApprovalError('ORIGINAL_APPROVAL_REJECTED')
        prepared = self._codec('prepare', {'payer': record['payer'], 'escrow': self.profile['escrow'],
            'amount': record['amount']}, deadline)
        expected = {'chainId': self.profile['chainId'], 'from': record['payer'],
            'to': self.profile['asset'], 'value': '0', 'data': prepared['data'],
            'callDataDigest': prepared['callDataDigest']}
        if type(deployment['chainId']) is not int: raise ApprovalError('ORIGINAL_APPROVAL_REJECTED')
        deployment = {**deployment, 'from': address(deployment['from']), 'to': address(deployment['to']),
            'callDataDigest': word(deployment['callDataDigest'])}
        if deployment != expected: raise ApprovalError('ORIGINAL_APPROVAL_REJECTED')
        record['deployment'] = expected
        return record, scope_config({'transactionHash': record['transactionHash'],
            'payer': record['payer'], 'allowanceData': prepared['allowanceData']}, self.profile)

    @staticmethod
    def _header(value, *, expected_number=None, expected_hash=None):
        if type(value) is not dict: raise ApprovalError('APPROVAL_BLOCK_MISSING')
        result = {'number': quantity(value['number']), 'hash': word(value['hash'])}
        if ((expected_number is not None and result['number'] != expected_number)
            or (expected_hash is not None and result['hash'] != expected_hash)):
            raise ApprovalError('APPROVAL_CANONICAL_CONFLICT')
        return result

    @staticmethod
    def _receipt(value, record):
        if (type(value) is not dict or word(value['transactionHash']) != record['transactionHash']
            or quantity(value['status']) != 1 or address(value['from']) != record['payer']
            or address(value['to']) != record['deployment']['to']):
            raise ApprovalError('APPROVAL_RECEIPT_REJECTED')
        return {'blockNumber': quantity(value['blockNumber']), 'blockHash': word(value['blockHash']),
            'transactionIndex': quantity(value['transactionIndex'])}

    def verify_original_approval(self, record):
        """Return a complete observation or None. No partial observation authorizes fund.

        The record must be loaded from the original persisted approve attempt,
        never constructed from a caller-supplied transaction hash. Constructor
        configuration errors raise fixed ApprovalError; reconciliation fails closed.
        """
        deadline = time.monotonic() + self.profile['budget']['maxTotalMs'] / 1000
        try:
            original, scope = self._record(record, deadline)
            transport = self.transport_factory(dict(scope))
            calls = total_bytes = 0
            finalized_hash = None
            def rpc(method, params):
                nonlocal calls, total_bytes, finalized_hash
                validate_request(method, params, self.profile, scope, finalized_hash)
                budget = self.profile['budget']
                if calls >= budget['maxCalls'] or time.monotonic() >= deadline:
                    raise ApprovalError('APPROVAL_BUDGET_EXHAUSTED')
                calls += 1
                result = transport.request(method, params, deadline=deadline)
                size = len(json_bytes(result))
                total_bytes += size
                if (time.monotonic() > deadline or size > budget['maxResponseBytes']
                    or total_bytes > budget['maxTotalBytes']): raise ApprovalError('APPROVAL_BUDGET_EXHAUSTED')
                if method == 'eth_getBlockByNumber' and params == ['finalized', False]:
                    finalized_hash = self._header(result)['hash']
                return result
            if quantity(rpc('eth_chainId', [])) != self.profile['chainId']:
                raise ApprovalError('APPROVAL_CHAIN_REJECTED')
            self._header(rpc('eth_getBlockByNumber', ['0x0', False]),
                expected_number=0, expected_hash=self.profile['genesisHash'])
            transaction = rpc('eth_getTransactionByHash', [original['transactionHash']])
            self._codec('verify', {'transaction': transaction, 'expected': {
                **original['deployment'], 'transactionHash': original['transactionHash']}}, deadline)
            receipt = self._receipt(rpc('eth_getTransactionReceipt', [original['transactionHash']]), original)
            if (quantity(transaction['blockNumber']) != receipt['blockNumber']
                or word(transaction['blockHash']) != receipt['blockHash']
                or quantity(transaction['transactionIndex']) != receipt['transactionIndex']):
                raise ApprovalError('APPROVAL_RECEIPT_REJECTED')
            finalized = self._header(rpc('eth_getBlockByNumber', ['finalized', False]))
            if receipt['blockNumber'] > finalized['number']:
                raise ApprovalError('APPROVAL_NOT_FINALIZED')
            self._header(rpc('eth_getBlockByNumber', [hex(receipt['blockNumber']), False]),
                expected_number=receipt['blockNumber'], expected_hash=receipt['blockHash'])
            ref = {'blockHash': finalized['hash'], 'requireCanonical': True}
            code = rpc('eth_getCode', [self.profile['asset'], ref])
            allowance = rpc('eth_call', [{'to': self.profile['asset'], 'data': scope['allowanceData'],
                'gas': '0x186a0'}, ref])
            state = self._codec('state', {'code': code, 'allowance': allowance}, deadline)
            if (state['assetCodeHash'] != self.profile['assetCodeHash']
                or not re.fullmatch(r'(?:0|[1-9][0-9]{0,77})', state['allowance'])
                or int(state['allowance']) < int(original['amount'])):
                raise ApprovalError('APPROVAL_ALLOWANCE_NOT_READY')
            # Both headers and the original receipt must remain canonical after
            # all same-block state reads; no partial result survives a conflict.
            self._header(rpc('eth_getBlockByNumber', [hex(finalized['number']), False]),
                expected_number=finalized['number'], expected_hash=finalized['hash'])
            self._header(rpc('eth_getBlockByNumber', [hex(receipt['blockNumber']), False]),
                expected_number=receipt['blockNumber'], expected_hash=receipt['blockHash'])
            if self._receipt(rpc('eth_getTransactionReceipt', [original['transactionHash']]), original) != receipt:
                raise ApprovalError('APPROVAL_CANONICAL_CONFLICT')
            return {'status': 'READY_FOR_ORIGINAL_FUND', 'verification': 'VERIFIED_ORIGINAL_APPROVAL',
                **{k: original[k] for k in ('attemptId', 'quoteId', 'transactionHash', 'payer', 'amount')},
                'asset': self.profile['asset'], 'escrow': self.profile['escrow'],
                'assetCodeHash': state['assetCodeHash'], 'allowance': state['allowance'],
                'receiptBlock': {'number': str(receipt['blockNumber']), 'hash': receipt['blockHash']},
                'finalizedBlock': {'number': str(finalized['number']), 'hash': finalized['hash']}}
        except Exception:
            # RPC/codec/provider errors are observations unavailable, never fund
            # authority and never raw-data/provider-context logs.
            return None
