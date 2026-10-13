"""Explicitly configured readonly HTTPS transport. Construction never connects."""
import json
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit


class ObserverTransportError(RuntimeError):
    """Fixed public error only; never include endpoint, calldata or provider error."""


METHODS = frozenset(('eth_chainId', 'eth_getCode', 'eth_getTransactionByHash',
                     'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_call'))
FACTORY_SELECTORS = frozenset(('0x38d52e0f', '0x753c6ae8', '0x770e710b', '0xe83e6ec8', '0x012f52ee',
                               '0xcbdb6f6a', '0x7bbecc95', '0x7a092896', '0x2b20e397', '0x2198cf14', '0x05faf32e'))
ESCROW_SELECTORS = frozenset(('0x38d52e0f', '0x753c6ae8', '0x80acfcb9', '0x3b426d3f', '0x84b0196e',
                              '0xded2363a', '0xcbdb6f6a', '0xbf7e3b60', '0x7bbecc95', '0x8da5cb5b',
                              '0x7a092896', '0x9741462a', '0xf7260d3e', '0x4e427852'))


def _pairs(items):
    value = {}
    for key, item in items:
        if key in value: raise ObserverTransportError('OBSERVER_JSON_REJECTED')
        value[key] = item
    return value


def strict_json(raw):
    try:
        return json.loads(raw, object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError):
        raise ObserverTransportError('OBSERVER_JSON_REJECTED') from None


def json_bytes(value):
    try:
        return json.dumps(value, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()
    except (ValueError, TypeError):
        raise ObserverTransportError('OBSERVER_JSON_REJECTED') from None


def endpoint_config(endpoint, allowed_endpoints, allowed_hosts):
    if (type(endpoint) is not str or type(allowed_endpoints) not in (tuple, list)
            or type(allowed_hosts) not in (tuple, list) or not allowed_hosts
            or endpoint not in allowed_endpoints or len(endpoint) > 4096):
        raise ObserverTransportError('RPC_ENDPOINT_REJECTED')
    try:
        parsed = urlsplit(endpoint)
        host = parsed.hostname
        if (parsed.scheme != 'https' or not host or parsed.username or parsed.password
                or parsed.fragment or parsed.port not in (None, 443)
                or host not in allowed_hosts or host != host.lower()
                or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host)
                or any(ord(ch) < 33 or ord(ch) > 126 for ch in endpoint)):
            raise ValueError()
        return host, parsed.path or '/', parsed.query
    except ValueError:
        raise ObserverTransportError('RPC_ENDPOINT_REJECTED') from None


def validate_budget(budget, *, registration_receipt=False):
    if type(registration_receipt) is not bool:
        raise ObserverTransportError('OBSERVER_BUDGET_REJECTED')
    ranges = {'maxCalls': 48, 'maxTotalMs': 40000 if registration_receipt else 20000, 'maxCallMs': 3000,
              'maxResponseBytes': 1048576, 'maxTotalBytes': 1048576, 'maxCatalogEntries': 3}
    if type(budget) is not dict or set(budget) != set(ranges):
        raise ObserverTransportError('OBSERVER_BUDGET_REJECTED')
    if any(type(budget[k]) is not int or not 1 <= budget[k] <= cap for k, cap in ranges.items()):
        raise ObserverTransportError('OBSERVER_BUDGET_REJECTED')
    if budget['maxCallMs'] > budget['maxTotalMs']:
        raise ObserverTransportError('OBSERVER_BUDGET_REJECTED')
    return dict(budget)


def validate_readonly_request(method, params, factory):
    word = lambda value: type(value) is str and re.fullmatch(r'0x[0-9a-fA-F]{64}', value)
    address = lambda value: type(value) is str and re.fullmatch(r'0x[0-9a-fA-F]{40}', value) and int(value[2:], 16) != 0
    block = lambda value: type(value) is dict and set(value) == {'blockHash', 'requireCanonical'} and word(value['blockHash']) and value['requireCanonical'] is True
    ok = False
    if type(params) is list and method in METHODS:
        if method == 'eth_chainId': ok = params == []
        elif method in ('eth_getTransactionByHash', 'eth_getTransactionReceipt'): ok = len(params) == 1 and word(params[0])
        elif method == 'eth_getBlockByNumber':
            ok = len(params) == 2 and params[1] is False and type(params[0]) is str and (params[0] == 'finalized' or re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)', params[0]))
        elif method == 'eth_getCode': ok = len(params) == 2 and address(params[0]) and block(params[1])
        elif method == 'eth_call' and len(params) == 2 and type(params[0]) is dict and set(params[0]) == {'to', 'data'}:
            call = params[0]
            selectors = FACTORY_SELECTORS if str(call['to']).lower() == factory.lower() else ESCROW_SELECTORS
            ok = (address(call['to']) and block(params[1]) and type(call['data']) is str
                  and 10 <= len(call['data']) <= 4096 and re.fullmatch(r'0x(?:[0-9a-fA-F]{2})+', call['data'])
                  and call['data'][:10].lower() in selectors)
    if not ok: raise ObserverTransportError('RPC_REQUEST_REJECTED')


class ReadOnlyJsonRpcTransport:
    """One reconciliation session, own counter/deadline; no retries or redirects.

    Requests use an owned short-lived empty-environment worker, so DNS/TLS cannot
    escape the per-call deadline. Endpoint and executables are trusted composition.
    """
    def __init__(self, *, endpoint, allowed_endpoints, allowed_hosts, python_executable, profile, registration_receipt=False):
        endpoint_config(endpoint, allowed_endpoints, allowed_hosts)
        self.endpoint = endpoint
        self.allowed_endpoints = tuple(allowed_endpoints)
        self.allowed_hosts = tuple(allowed_hosts)
        self.python = str(Path(python_executable))
        if not Path(self.python).is_absolute(): raise ObserverTransportError('ABSOLUTE_PYTHON_REQUIRED')
        self.profile = dict(profile)
        self.budget = validate_budget(profile.get('budget'),registration_receipt=registration_receipt)
        self.started, self.calls, self.bytes = time.monotonic(), 0, 0
        self.worker = Path(__file__).with_name('rpc_worker.py')

    def request(self, method, params, *, deadline):
        validate_readonly_request(method, params, self.profile['factory'])
        self.calls += 1
        if self.calls > self.budget['maxCalls']: raise ObserverTransportError('RPC_CALL_LIMIT')
        end = min(deadline, self.started + self.budget['maxTotalMs'] / 1000,
                  time.monotonic() + self.budget['maxCallMs'] / 1000)
        if end <= time.monotonic(): raise ObserverTransportError('RPC_TIME_LIMIT')
        packet = {'endpoint': self.endpoint, 'allowedEndpoints': self.allowed_endpoints,
                  'allowedHosts': self.allowed_hosts, 'method': method, 'params': params,
                  'factory': self.profile['factory'], 'id': self.calls,
                  'maxBytes': min(self.budget['maxResponseBytes'], self.budget['maxTotalBytes'] - self.bytes),
                  'timeout': end - time.monotonic()}
        raw = json_bytes(packet)
        if len(raw) > 16384 or packet['maxBytes'] <= 0: raise ObserverTransportError('RPC_RESPONSE_LIMIT')
        proc = None
        try:
            proc = subprocess.Popen([self.python, '-I', str(self.worker)], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, cwd=str(self.worker.parent))
            output, _ = proc.communicate(raw, timeout=max(0.001, end-time.monotonic()-0.05))
            if proc.returncode or time.monotonic() > end or len(output) > packet['maxBytes']:
                raise ObserverTransportError('RPC_UNAVAILABLE')
            self.bytes += len(output)
            response = strict_json(output)
            if (type(response) is not dict or response.get('jsonrpc') != '2.0'
                    or type(response.get('id')) is not int or response['id'] != self.calls
                    or 'result' not in response or 'error' in response):
                raise ObserverTransportError('RPC_RESPONSE_REJECTED')
            return response['result']
        except (OSError, subprocess.TimeoutExpired):
            raise ObserverTransportError('RPC_UNAVAILABLE') from None
        finally:
            if proc is not None:
                if proc.poll() is None: proc.kill()
                try: proc.wait(timeout=0.05)
                except subprocess.TimeoutExpired: proc.kill()
                for pipe in (proc.stdin, proc.stdout):
                    if pipe: pipe.close()
