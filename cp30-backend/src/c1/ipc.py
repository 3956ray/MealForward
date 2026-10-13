"""Bounded private Unix JSON transport with explicit, disjoint capabilities."""
from __future__ import annotations
import hmac
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import threading

MAX_MESSAGE = 65536

def _encode(value):
    data = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8') + b'\n'
    if len(data) > MAX_MESSAGE:
        raise ValueError('IPC_MESSAGE_TOO_LARGE')
    return data

def _read(stream):
    data = stream.readline(MAX_MESSAGE + 1)
    if not data.endswith(b'\n') or len(data) > MAX_MESSAGE:
        raise ValueError('IPC_INVALID_FRAME')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('IPC_DUPLICATE_FIELD')
            result[key] = value
        return result
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('IPC_INVALID_NUMBER')))
    if not isinstance(value, dict):
        raise ValueError('IPC_INVALID_OBJECT')
    return value

def _directory(path):
    info = Path(path).parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('IPC_UNSAFE_DIRECTORY')

class Client:
    def __init__(self, path, cap, *, timeout=2):
        self.path, self.cap, self.timeout = str(path), cap, timeout

    def call(self, namespace, method, request=None):
        _directory(self.path)
        info = os.lstat(self.path)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('IPC_UNSAFE_SOCKET')
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(self.timeout)
            connection.connect(self.path)
            connection.sendall(_encode({'cap': self.cap, 'namespace': namespace, 'method': method, 'request': request or {}}))
            with connection.makefile('rb') as stream:
                return _read(stream)

ControllerClient = Client

class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = True
    request_queue_size = 8

    def __init__(self, path, capabilities, handler, *, max_handlers=8):
        # capabilities = {role: {cap: new random opaque value, methods: [...]}}.
        _directory(path)
        self.path = str(path)
        self.capabilities = capabilities
        self.handler = handler
        self.slots = threading.BoundedSemaphore(max_handlers)
        values = [entry['cap'] for entry in capabilities.values()]
        if any(not isinstance(value, str) or len(value) < 32 for value in values) or len(values) != len(set(values)):
            raise ValueError('IPC_INVALID_CAPABILITIES')
        outer = self
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                self.request.settimeout(2)
                try:
                    envelope = _read(self.rfile)
                    if set(envelope) != {'cap', 'namespace', 'method', 'request'}:
                        raise ValueError('IPC_INVALID_SCHEMA')
                    cap, method, namespace, request = (envelope[key] for key in ('cap', 'method', 'namespace', 'request'))
                    if not isinstance(cap, str) or not isinstance(method, str) or not isinstance(namespace, str) or not namespace or len(namespace) > 128 or not isinstance(request, dict):
                        raise ValueError('IPC_INVALID_SCHEMA')
                    role = next((role for role, entry in outer.capabilities.items() if hmac.compare_digest(entry['cap'], cap)), None)
                    if role is None or method not in outer.capabilities[role]['methods']:
                        response = {'error': 'IPC_FORBIDDEN', 'status': 403}
                    else:
                        response = outer.handler(namespace, method, request, role=role)
                except (ValueError, UnicodeError, json.JSONDecodeError):
                    response = {'error': 'IPC_BAD_REQUEST', 'status': 400}
                except Exception:
                    response = {'error': 'IPC_UNAVAILABLE', 'status': 503}
                try:
                    self.wfile.write(_encode(response))
                except (OSError, ValueError):
                    pass
        super().__init__(self.path, Handler)
        os.chmod(self.path, 0o600)
        self.socket_identity = os.lstat(self.path).st_ino

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(_encode({'error': 'IPC_BUSY', 'status': 503}))
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def server_close(self):
        super().server_close()
        try:
            info = os.lstat(self.path)
            if stat.S_ISSOCK(info.st_mode) and info.st_ino == self.socket_identity:
                os.unlink(self.path)
        except FileNotFoundError:
            pass
