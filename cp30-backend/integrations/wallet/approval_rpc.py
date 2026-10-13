"""Approval-only HTTPS transport. Construction never connects; no retries."""
import json
import math
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit


class ApprovalError(ValueError):
    """Only fixed errors; do not include provider, endpoint or transaction details."""


METHODS = frozenset(('eth_chainId', 'eth_getTransactionByHash',
    'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'))


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result: raise ApprovalError('APPROVAL_JSON_REJECTED')
        result[key] = value
    return result


def strict_json(raw):
    try:
        return json.loads(raw, object_pairs_hook=_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError):
        raise ApprovalError('APPROVAL_JSON_REJECTED') from None


def json_bytes(value):
    try:
        return json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
    except (ValueError, TypeError):
        raise ApprovalError('APPROVAL_JSON_REJECTED') from None


def address(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-fA-F]{40}', value) or int(value[2:], 16) == 0:
        raise ApprovalError('APPROVAL_ADDRESS_REJECTED')
    return value.lower()


def word(value):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-fA-F]{64}', value):
        raise ApprovalError('APPROVAL_HASH_REJECTED')
    return value.lower()


def quantity(value):
    if type(value) is not str or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)', value) or len(value) > 66:
        raise ApprovalError('APPROVAL_QUANTITY_REJECTED')
    return int(value, 16)


def budget_config(budget):
    caps = {'maxCalls': 12, 'maxTotalMs': 20000, 'maxCallMs': 3000,
        'maxResponseBytes': 1048576, 'maxTotalBytes': 1048576}
    if (type(budget) is not dict or set(budget) != set(caps)
        or any(type(budget[k]) is not int or not 1 <= budget[k] <= cap for k, cap in caps.items())
        or budget['maxCallMs'] > budget['maxTotalMs']):
        raise ApprovalError('APPROVAL_BUDGET_REJECTED')
    return dict(budget)


def profile_config(profile):
    keys = {'chainId', 'genesisHash', 'asset', 'escrow', 'assetCodeHash', 'finality', 'eip1898', 'budget'}
    if (type(profile) is not dict or set(profile) != keys or type(profile['chainId']) is not int
        or not 0 < profile['chainId'] <= 9007199254740991
        or profile['finality'] != 'rpc-finalized' or profile['eip1898'] is not True):
        raise ApprovalError('APPROVAL_PROFILE_REJECTED')
    return {**profile, 'genesisHash': word(profile['genesisHash']),
        'asset': address(profile['asset']), 'escrow': address(profile['escrow']),
        'assetCodeHash': word(profile['assetCodeHash']), 'budget': budget_config(profile['budget'])}


def endpoint_config(endpoint, allowed_endpoints, allowed_hosts):
    if (type(endpoint) is not str or type(allowed_endpoints) not in (tuple, list)
        or type(allowed_hosts) not in (tuple, list) or not allowed_hosts
        or endpoint not in allowed_endpoints or len(endpoint) > 4096):
        raise ApprovalError('APPROVAL_ENDPOINT_REJECTED')
    try:
        u = urlsplit(endpoint)
        if (u.scheme != 'https' or not u.hostname or u.hostname not in allowed_hosts
            or u.hostname != u.hostname.lower() or u.username or u.password or u.fragment
            or u.port not in (None, 443) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', u.hostname)
            or any(ord(c) < 33 or ord(c) > 126 for c in endpoint)):
            raise ValueError()
        return u.hostname, (u.path or '/') + ('?' + u.query if u.query else '')
    except ValueError:
        raise ApprovalError('APPROVAL_ENDPOINT_REJECTED') from None


def scope_config(scope, profile):
    if type(scope) is not dict or set(scope) != {'transactionHash', 'payer', 'allowanceData'}:
        raise ApprovalError('APPROVAL_SCOPE_REJECTED')
    payer = address(scope['payer'])
    # Fixed selector + exactly two ABI address words. The codec supplies this data;
    # this guard independently binds it to the only approved owner/spender pair.
    expected = '0xdd62ed3e' + '0' * 24 + payer[2:] + '0' * 24 + profile['escrow'][2:]
    if scope['allowanceData'] != expected:
        raise ApprovalError('APPROVAL_SCOPE_REJECTED')
    return {**scope, 'payer': payer, 'transactionHash': word(scope['transactionHash'])}


def validate_request(method, params, profile, scope, finalized_hash):
    ok = False
    if type(params) is list and method in METHODS:
        if method == 'eth_chainId': ok = params == []
        elif method in ('eth_getTransactionByHash', 'eth_getTransactionReceipt'):
            ok = params == [scope['transactionHash']]
        elif method == 'eth_getBlockByNumber':
            if len(params) == 2 and params[1] is False:
                ok = params[0] == 'finalized'
                if not ok:
                    try: quantity(params[0]); ok = True
                    except ApprovalError: pass
        elif method in ('eth_getCode', 'eth_call') and len(params) == 2:
            ref = {'blockHash': finalized_hash, 'requireCanonical': True}
            if (finalized_hash is not None and type(params[1]) is dict and params[1] == ref
                and params[1].get('requireCanonical') is True):
                ok = (params[0] == profile['asset'] if method == 'eth_getCode' else
                    params[0] == {'to': profile['asset'], 'data': scope['allowanceData'], 'gas': '0x186a0'})
    if not ok: raise ApprovalError('APPROVAL_REQUEST_REJECTED')


class ApprovalRpcTransport:
    """One original attempt per instance. Empty-env worker bounds DNS/TLS time.

    Use a fresh instance for each observer invocation. No endpoint is taken from
    browser input. Only the observed finalized hash permits code/allowance reads.
    """
    def __init__(self, *, endpoint, allowed_endpoints, allowed_hosts, python_executable, profile, scope):
        endpoint_config(endpoint, allowed_endpoints, allowed_hosts)
        self.profile = profile_config(profile)
        self.scope = scope_config(scope, self.profile)
        self.python = Path(python_executable)
        if not self.python.is_absolute() or not self.python.is_file():
            raise ApprovalError('ABSOLUTE_PYTHON_REQUIRED')
        self.endpoint, self.endpoints, self.hosts = endpoint, tuple(allowed_endpoints), tuple(allowed_hosts)
        self.worker = Path(__file__).with_name('approval_rpc_worker.py')
        self.started = time.monotonic()
        self.calls = self.total_bytes = 0
        self.finalized_hash = None

    def request(self, method, params, *, deadline):
        validate_request(method, params, self.profile, self.scope, self.finalized_hash)
        budget = self.profile['budget']
        if type(deadline) not in (int, float) or not math.isfinite(deadline):
            raise ApprovalError('APPROVAL_DEADLINE_REJECTED')
        now = time.monotonic()
        end = min(deadline, self.started + budget['maxTotalMs'] / 1000, now + budget['maxCallMs'] / 1000)
        cap = min(budget['maxResponseBytes'], budget['maxTotalBytes'] - self.total_bytes)
        if self.calls >= budget['maxCalls'] or end - now < .05 or cap < 1:
            raise ApprovalError('APPROVAL_BUDGET_EXHAUSTED')
        self.calls += 1
        packet = {'endpoint': self.endpoint, 'allowedEndpoints': self.endpoints, 'allowedHosts': self.hosts,
            'profile': self.profile, 'scope': self.scope, 'finalizedHash': self.finalized_hash,
            'method': method, 'params': params, 'id': self.calls, 'deadline': end, 'maxBytes': cap}
        process = None
        try:
            process = subprocess.Popen([str(self.python), '-I', '-B', str(self.worker)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env={}, cwd=str(self.worker.parent))
            output, _ = process.communicate(json_bytes(packet), timeout=max(.001, end - time.monotonic()))
            if process.returncode or len(output) > cap or time.monotonic() > end:
                raise ApprovalError('APPROVAL_RPC_UNAVAILABLE')
            self.total_bytes += len(output)
            response = strict_json(output)
            if (type(response) is not dict or response.get('jsonrpc') != '2.0'
                or type(response.get('id')) is not int or response['id'] != self.calls
                or 'result' not in response or 'error' in response):
                raise ApprovalError('APPROVAL_RPC_UNAVAILABLE')
            result = response['result']
            if method == 'eth_getBlockByNumber' and params == ['finalized', False]:
                self.finalized_hash = word(result['hash'])
            return result
        except (OSError, subprocess.TimeoutExpired, KeyError, TypeError):
            raise ApprovalError('APPROVAL_RPC_UNAVAILABLE') from None
        finally:
            if process is not None:
                if process.poll() is None: process.kill()
                process.wait()
                for stream in (process.stdin, process.stdout):
                    if stream is not None: stream.close()
