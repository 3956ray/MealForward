import contextlib
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import requests
from urllib3.exceptions import ReadTimeoutError
from server.alchemy_readonly import Checker, CheckError, create_app, load_endpoint, ORIGIN, MAX_RESPONSE

SECRET = 'SYNTHETIC_SECRET_CP18_DO_NOT_EXPOSE'
URL = 'https://monad-testnet.g.alchemy.com/v2/' + SECRET


class Response:
    def __init__(self, result='0x279f', *, identifier=1, status=200, body=None, chunks=None):
        self.status_code = status
        self.body = body if body is not None else json.dumps({'jsonrpc': '2.0', 'id': identifier, 'result': result}).encode()
        self.chunks = chunks
        self.closed = False

    def __enter__(self): return self
    def __exit__(self, *args): self.closed = True
    def iter_content(self, chunk_size):
        return self.chunks() if self.chunks else iter([self.body])


class Session:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []
        self.trust_env = True
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        response = next(self.responses)
        if isinstance(response, Exception): raise response
        if callable(response): return response()
        return response


class AlchemyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = Path(self.temp.name) / 'config.json'
        self.config.write_text(json.dumps({'testnet_rpc_url': URL, 'mainnet_rpc_url': 'DO_NOT_CALL',
                                          'active_network': 'mainnet', 'transactions_enabled': True}))
        self.config.chmod(0o600)

    def checker(self, responses, **kwargs):
        self.session = Session(responses)
        return Checker(self.config, session_factory=lambda: self.session, **kwargs)

    def post(self, checker, **kwargs):
        options = {'base_url': ORIGIN, 'headers': {'Origin': ORIGIN}, 'json': {}}
        options.update(kwargs)
        return create_app(checker).test_client().post('/api/v1/testnet/status', **options)

    def test_success_whitelist_zero_large_integer_and_fixed_rpc(self):
        for block in (0, 2**100):
            checker = self.checker([Response(), Response(hex(block), identifier=2)])
            response = self.post(checker)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(set(response.json), {'chainId', 'network', 'latestBlock', 'checkedAt', 'contractConnected'})
            self.assertEqual(response.json['chainId'], 10143)
            self.assertEqual(response.json['latestBlock'], str(block))
            self.assertFalse(response.json['contractConnected'])
            self.assertTrue(response.json['checkedAt'].endswith('Z'))
            self.assertNotIn('Set-Cookie', response.headers)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertFalse(self.session.trust_env)
            self.assertEqual([c[1]['json']['method'] for c in self.session.calls], ['eth_chainId', 'eth_blockNumber'])
            for url, args in self.session.calls:
                self.assertEqual(url, URL)
                self.assertEqual(args['json']['params'], [])
                self.assertFalse(args['allow_redirects'])
                self.assertLessEqual(args['timeout'][0], 2)
                self.assertLessEqual(args['timeout'][1], 3)

    def test_wrong_chain_stops_after_one_call(self):
        for chain in ('0x8f', '0x7a69'):
            checker = self.checker([Response(chain)])
            response = self.post(checker)
            self.assertEqual((response.status_code, response.json['error']['code']), (502, 'NETWORK_MISMATCH'))
            self.assertEqual(len(self.session.calls), 1)

    def test_protocol_variants_and_redaction(self):
        failures = [Response(status=302), Response(status=500), Response(status=429),
                    Response(body=(SECRET * 3000).encode()), Response(body=b'not json ' + SECRET.encode()),
                    Response(body=json.dumps({'jsonrpc':'2.0','id':1,'error':{'message':URL}}).encode()),
                    Response(identifier=True), Response(identifier=2), Response(result=None), Response(result=True),
                    Response(result='0x00'), Response(result='123'), Response(result='0x'),
                    Response(body=json.dumps({'id':1,'result':'0x279f'}).encode()),
                    requests.exceptions.SSLError(URL), requests.ConnectionError(URL), requests.Timeout(URL),
                    requests.ConnectionError(ReadTimeoutError(None, URL, SECRET))]
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            for failure in failures:
                checker = self.checker([failure])
                with self.subTest(failure=type(failure).__name__):
                    response = self.post(checker)
                    self.assertIn(response.status_code, (502, 503, 504))
                    self.assertNotIn(SECRET, response.get_data(as_text=True))
                    self.assertNotIn(URL, str(response.headers))
                    self.assertEqual(len(self.session.calls), 1)
                    if isinstance(failure, Response) and failure.status_code == 429:
                        self.assertEqual(response.json['error']['code'], 'UPSTREAM_RATE_LIMITED')
                        self.assertEqual(response.headers['Retry-After'], '60')
                    if isinstance(failure, requests.Timeout) or isinstance(failure, requests.ConnectionError) and isinstance(failure.args[0], ReadTimeoutError):
                        self.assertEqual(response.status_code, 504)
        self.assertNotIn(SECRET, stdout.getvalue() + stderr.getvalue())

    def test_invalid_config_never_calls_upstream(self):
        for url in ('http://monad-testnet.g.alchemy.com/v2/x', URL + '?q=x', URL + '#x',
                    'https://evil.test/v2/x', 'https://user@monad-testnet.g.alchemy.com/v2/x',
                    'https://monad-testnet.g.alchemy.com/v2/x/extra', 'https://monad-testnet.g.alchemy.com/v2/%2f'):
            self.config.write_text(json.dumps({'testnet_rpc_url': url}))
            checker = self.checker([])
            self.assertEqual(self.post(checker).status_code, 503)
            self.assertEqual(self.session.calls, [])
        self.config.unlink()
        self.assertEqual(self.post(self.checker([])).json['error']['code'], 'CONFIG_UNAVAILABLE')

    def test_private_config_permissions(self):
        self.config.chmod(0o644)
        with self.assertRaises(CheckError): load_endpoint(self.config)

    def test_guard_body_and_methods_before_upstream(self):
        cases = [({'headers': {'Origin': 'http://evil.test'}}, 403),
                 ({'base_url': 'http://localhost:15217'}, 403),
                 ({'headers': {}}, 403), ({'json': {'method':'eth_sendRawTransaction'}}, 400),
                 ({'json': []}, 400), ({'json': None, 'data': '{', 'content_type':'application/json'}, 400),
                 ({'json': None, 'data': '{}', 'content_type':'text/plain'}, 415),
                 ({'json': {'padding':'x'*2000}}, 413)]
        for options, expected in cases:
            checker = self.checker([])
            self.assertEqual(self.post(checker, **options).status_code, expected)
            self.assertEqual(self.session.calls, [])
        client = create_app(self.checker([])).test_client()
        self.assertEqual(client.get('/api/v1/testnet/status', base_url=ORIGIN, headers={'Origin':ORIGIN}).status_code,405)

    def test_global_rate_window_failures_count_xff_no_bypass(self):
        now = [100.0]
        checker = self.checker([Response('0x8f') for _ in range(6)], clock=lambda: now[0])
        for i in range(5):
            self.assertEqual(self.post(checker, headers={'Origin':ORIGIN,'X-Forwarded-For':str(i)}).status_code,502)
        limited = self.post(checker)
        self.assertEqual(limited.json['error']['code'], 'LOCAL_RATE_LIMITED')
        self.assertEqual(limited.headers['Retry-After'], '60')
        self.assertEqual(len(self.session.calls), 5)
        now[0] += 60
        self.assertEqual(self.post(checker).status_code,502)

    def test_deadline_http_returns_but_unwinding_keeps_singleflight(self):
        entered, release = threading.Event(), threading.Event()
        def delayed():
            entered.set()
            release.wait(2)
            return Response()
        checker = self.checker([delayed], budget=0.06)
        started = time.monotonic()
        response = self.post(checker)
        self.assertTrue(entered.is_set())
        self.assertEqual(response.status_code,504)
        self.assertLess(time.monotonic()-started, 0.3)
        self.assertTrue(checker.inflight)
        busy = self.post(checker)
        self.assertEqual(busy.json['error']['code'], 'CHECK_IN_PROGRESS')
        self.assertEqual(busy.headers['Retry-After'], '1')
        self.assertEqual(len(checker.attempts), 1)
        release.set()
        for _ in range(100):
            if not checker.inflight: break
            time.sleep(.005)
        self.assertFalse(checker.inflight)
        self.assertEqual(len(self.session.calls), 1)

    def test_slow_stream_total_deadline_and_response_closed(self):
        def chunks():
            for _ in range(100):
                time.sleep(.015)
                yield b' '
        upstream = Response(chunks=chunks)
        checker = self.checker([upstream], budget=.06)
        started = time.monotonic()
        self.assertEqual(self.post(checker).status_code,504)
        self.assertLess(time.monotonic()-started,.3)
        for _ in range(100):
            if not checker.inflight: break
            time.sleep(.005)
        self.assertTrue(upstream.closed)
        self.assertEqual(len(self.session.calls),1)

    def test_second_rpc_uses_same_total_budget(self):
        now = [0.0]
        def first():
            now[0] = 7
            return Response()
        checker = self.checker([first, Response('0x2', identifier=2)], clock=lambda: now[0])
        self.assertEqual(self.post(checker).status_code,200)
        self.assertEqual(self.session.calls[1][1]['timeout'], (1,1))

    def test_oversize_decompressed_stream_stops(self):
        response = Response(body=b' ' * (MAX_RESPONSE+1))
        checker = self.checker([response])
        self.assertEqual(self.post(checker).status_code,502)
        self.assertTrue(response.closed)


if __name__ == '__main__': unittest.main()
