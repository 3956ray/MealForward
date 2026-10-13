"""Owned one-request HTTPS worker. Never run during offline checks."""
import http.client
import json
import ssl
import sys
import time
from pathlib import Path

# -I excludes script directory from sys.path. Add only this known source directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rpc_transport import endpoint_config, json_bytes, strict_json, validate_readonly_request


def perform(packet):
    host, path, query = endpoint_config(packet['endpoint'], packet['allowedEndpoints'], packet['allowedHosts'])
    validate_readonly_request(packet['method'], packet['params'], packet['factory'])
    cap, timeout = packet['maxBytes'], packet['timeout']
    if type(cap) is not int or not 1 <= cap <= 1048576 or type(timeout) not in (int, float) or not 0 < timeout <= 3:
        raise ValueError()
    end = time.monotonic() + timeout
    def remaining():
        value = end - time.monotonic()
        if value <= 0: raise TimeoutError()
        return value
    connection = http.client.HTTPSConnection(host, port=443, timeout=remaining(), context=ssl.create_default_context())
    try:
        connection.connect()
        connection.sock.settimeout(remaining())
        body = json_bytes({'jsonrpc': '2.0', 'id': packet['id'], 'method': packet['method'], 'params': packet['params']})
        connection.request('POST', path + ('?' + query if query else ''), body=body,
                           headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Connection': 'close'})
        connection.sock.settimeout(remaining())
        response = connection.getresponse()
        # http.client never follows redirects. Reject every non-200 response.
        if response.status != 200: raise ValueError()
        if sum(len(k)+len(v)+4 for k,v in response.getheaders()) > 16384: raise ValueError()
        if response.getheader('Content-Encoding', 'identity').lower() != 'identity': raise ValueError()
        if response.getheader('Content-Type', '').split(';')[0].strip().lower() != 'application/json': raise ValueError()
        length = response.getheader('Content-Length')
        if length is not None and (not length.isdecimal() or int(length) > cap): raise ValueError()
        output = bytearray()
        while True:
            if connection.sock is not None: connection.sock.settimeout(remaining())
            else: remaining()
            chunk = response.read(min(65536, cap+1-len(output)))
            if not chunk: break
            output.extend(chunk)
            if len(output) > cap: raise ValueError()
        remaining()
        value = strict_json(output)
        if type(value) is not dict or value.get('jsonrpc') != '2.0' or type(value.get('id')) is not int or value['id'] != packet['id'] or 'result' not in value or 'error' in value:
            raise ValueError()
        return bytes(output)
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384: raise ValueError()
        packet = strict_json(raw)
        result = perform(packet)
        sys.stdout.buffer.write(result)
    except Exception:
        sys.stdout.write('{"error":"RPC_UNAVAILABLE"}')
        sys.exit(1)
