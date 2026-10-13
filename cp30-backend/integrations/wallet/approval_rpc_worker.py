"""Owned one-request worker. This source is not exercised against real HTTP here."""
import http.client
import math
import ssl
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from approval_rpc import (endpoint_config, json_bytes, strict_json, profile_config,
    scope_config, validate_request, word)


def perform(packet):
    if type(packet) is not dict or set(packet) != {'endpoint', 'allowedEndpoints', 'allowedHosts',
        'profile', 'scope', 'finalizedHash', 'method', 'params', 'id', 'deadline', 'maxBytes'}:
        raise ValueError()
    profile = profile_config(packet['profile'])
    scope = scope_config(packet['scope'], profile)
    pinned = None if packet['finalizedHash'] is None else word(packet['finalizedHash'])
    validate_request(packet['method'], packet['params'], profile, scope, pinned)
    host, path = endpoint_config(packet['endpoint'], packet['allowedEndpoints'], packet['allowedHosts'])
    cap, end = packet['maxBytes'], packet['deadline']
    if (type(packet['id']) is not int or not 1 <= packet['id'] <= profile['budget']['maxCalls']
        or type(cap) is not int or not 1 <= cap <= profile['budget']['maxResponseBytes']
        or type(end) not in (int, float) or not math.isfinite(end)
        or not 0 < end - time.monotonic() <= profile['budget']['maxCallMs'] / 1000):
        raise ValueError()
    def remaining():
        value = end - time.monotonic()
        if value <= 0: raise TimeoutError()
        return value
    # Direct http.client connection has no proxy/environment lookup or redirects.
    connection = http.client.HTTPSConnection(host, port=443, timeout=remaining(), context=ssl.create_default_context())
    try:
        connection.connect()
        connection.sock.settimeout(remaining())
        body = json_bytes({'jsonrpc': '2.0', 'id': packet['id'], 'method': packet['method'], 'params': packet['params']})
        connection.request('POST', path, body=body, headers={'Content-Type': 'application/json',
            'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Connection': 'close'})
        connection.sock.settimeout(remaining())
        response = connection.getresponse()
        if response.status != 200: raise ValueError()
        if sum(len(k) + len(v) + 4 for k, v in response.getheaders()) > 16384: raise ValueError()
        if response.getheader('Content-Encoding', 'identity').lower() != 'identity': raise ValueError()
        if response.getheader('Content-Type', '').split(';')[0].strip().lower() != 'application/json': raise ValueError()
        length = response.getheader('Content-Length')
        if length is not None and (not length.isdecimal() or int(length) > cap): raise ValueError()
        output = bytearray()
        while True:
            if connection.sock is not None: connection.sock.settimeout(remaining())
            else: remaining()
            chunk = response.read(min(65536, cap + 1 - len(output)))
            if not chunk: break
            output.extend(chunk)
            if len(output) > cap: raise ValueError()
        remaining()
        result = strict_json(output)
        if (type(result) is not dict or result.get('jsonrpc') != '2.0'
            or type(result.get('id')) is not int or result['id'] != packet['id']
            or 'result' not in result or 'error' in result): raise ValueError()
        return bytes(output)
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384: raise ValueError()
        sys.stdout.buffer.write(perform(strict_json(raw)))
    except Exception:
        sys.stdout.write('{"error":"APPROVAL_RPC_UNAVAILABLE"}')
        sys.exit(1)
