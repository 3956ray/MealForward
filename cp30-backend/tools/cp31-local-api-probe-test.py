"""Offline tests for the anonymous localhost probe; no real CP30 request occurs."""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('cp31-local-api-probe.py')
spec = importlib.util.spec_from_file_location('cp31_probe', FILE)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class FakeResponse:
    def __init__(self, status, content_type, body):
        self.status, self.content_type, self.body = status, content_type, body

    def getheader(self, name):
        return self.content_type if name == 'Content-Type' else None

    def read(self, limit):
        return self.body[:limit]


class FakeConnection:
    def __init__(self, response):
        self.response, self.requests, self.closed = response, [], False

    def request(self, method, path, headers):
        self.requests.append((method, path, headers))

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


class ProbeTests(unittest.TestCase):
    def run_case(self, endpoint, status, content, mime='application/json'):
        connection = FakeConnection(FakeResponse(status, mime, content))
        with patch.object(probe.http.client, 'HTTPSConnection', return_value=connection):
            result = probe.inspect(endpoint)
        self.assertTrue(connection.closed)
        self.assertEqual(connection.requests, [
            ('GET', endpoint, {'Host': 'localhost:16443', 'Accept': 'application/json'})
        ])
        return result

    def test_422_reports_error_code_only(self):
        result = self.run_case('/v1/stores', 422, b'{"error":"INVALID_REQUEST","secret":"do_not_show"}')
        self.assertEqual(result['error'], 'INVALID_REQUEST')
        self.assertNotIn('secret', json.dumps(result))

    def test_public_data_never_prints_original_contents(self):
        result = self.run_case('/v1/ledger', 200, b'{"items":[{"store":"hidden1"},{"store":"hidden2"}]}')
        self.assertEqual(result['public_item_count'], 2)
        self.assertNotIn('hidden', json.dumps(result))

    def test_registered_catalog_is_a_nonledger_public_control(self):
        result = self.run_case('/v1/registered-stores', 200,
                               b'{"items":[{"registrationId":"privateid"}]}')
        self.assertEqual(result['public_item_count'], 1)
        self.assertNotIn('privateid', json.dumps(result))

    def test_asset_fingerprint_matches_checked_out_version(self):
        with TemporaryDirectory() as tmp:
            previous = probe.SITE
            try:
                probe.SITE = Path(tmp)
                (probe.SITE / 'app.js').write_bytes(b'expected content')
                self.assertTrue(self.run_case('/app.js', 200, b'expected content',
                    'text/javascript; charset=utf-8')['matches_checked_out_cp31'])
                self.assertFalse(self.run_case('/app.js', 200, b'older content',
                    'text/javascript')['matches_checked_out_cp31'])
            finally:
                probe.SITE = previous

    def test_anon_401_and_missing_asset(self):
        self.assertEqual(self.run_case('/v1/me', 401, b'{"error":"UNAUTHENTICATED"}')['error'],
                         'UNAUTHENTICATED')
        self.assertEqual(self.run_case('/ledger-view.mjs', 404, b'{"error":"NOT_FOUND"}')['http'], 404)


if __name__ == '__main__':
    unittest.main()
