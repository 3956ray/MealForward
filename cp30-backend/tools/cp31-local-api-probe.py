#!/usr/bin/env python3
"""Anonymous localhost CP30 HTTP/asset probe. No cookies, tokens or DB access.

GET requests may increment normal server access/rate-limit counters.
Only eight hardcoded local URLs are contacted. Response bodies are never printed.
"""
import hashlib
import http.client
import json
from pathlib import Path
import re
import ssl

HOST = 'localhost:16443'
ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / 'sites-frontend' / 'dist'
ENDPOINTS = ('/v1/connection', '/v1/identity/setup', '/v1/registered-stores',
             '/v1/stores', '/v1/ledger', '/v1/me', '/app.js', '/ledger-view.mjs')
MAX_BYTES = 512 * 1024
SAFE_ERROR = re.compile(r'[A-Z][A-Z0-9_]{0,63}\Z')


def inspect(endpoint):
    connection = http.client.HTTPSConnection(
        '127.0.0.1', 16443, context=ssl._create_unverified_context(), timeout=7)
    try:
        connection.request('GET', endpoint, headers={'Host': HOST, 'Accept': 'application/json'})
        response = connection.getresponse()
        kind = (response.getheader('Content-Type') or '').split(';', 1)[0]
        body = response.read(MAX_BYTES + 1)
        result = {'endpoint': endpoint, 'http': response.status, 'type': kind}
        if len(body) > MAX_BYTES:
            result['diagnostic'] = 'RESPONSE_TOO_LARGE'
        elif response.status != 200 and kind == 'application/json':
            try:
                error = json.loads(body).get('error')
                result['error'] = error if isinstance(error, str) and SAFE_ERROR.fullmatch(error) else 'NONSTANDARD_ERROR'
            except (ValueError, AttributeError):
                result['diagnostic'] = 'INVALID_ERROR_JSON'
        elif response.status == 200 and endpoint in ('/app.js', '/ledger-view.mjs'):
            expected = SITE / endpoint.removeprefix('/')
            result['matches_checked_out_cp31'] = (expected.is_file() and
                hashlib.sha256(body).digest() == hashlib.sha256(expected.read_bytes()).digest())
        elif response.status == 200 and endpoint in ('/v1/registered-stores', '/v1/stores', '/v1/ledger'):
            try:
                payload = json.loads(body)
                result['public_item_count'] = len(payload['items']) if isinstance(payload.get('items'), list) else 'INVALID_ITEMS'
            except (ValueError, AttributeError, TypeError, KeyError):
                result['diagnostic'] = 'INVALID_PUBLIC_JSON'
        return result
    finally:
        connection.close()


def main():
    for endpoint in ENDPOINTS:
        try:
            result = inspect(endpoint)
        except (OSError, TimeoutError, ssl.SSLError) as exc:
            result = {'endpoint': endpoint, 'diagnostic': type(exc).__name__}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
