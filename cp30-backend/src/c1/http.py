"""Strict, single-request loopback HTTPS transport for the bounded local pilot."""
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

JSON_LIMIT = 64 * 1024
IMAGE_LIMIT = 5 * 1024 * 1024
_TOKEN = re.compile(rb"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
_IMAGE_ROUTE = re.compile(r"(?:/v1/stores/[A-Za-z0-9_-]+/drafts/[A-Za-z0-9_-]+/image|/v1/store-registration-images)")


class InputRejected(ValueError):
    pass


def decode_json(body):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise InputRejected("INVALID_JSON")
            value[key] = item
        return value
    def invalid(value):
        raise InputRejected("INVALID_JSON")
    if not isinstance(body, bytes) or len(body) > JSON_LIMIT:
        raise InputRejected("INVALID_JSON")
    try:
        value = json.loads(body.decode("utf-8", "strict"), object_pairs_hook=pairs, parse_constant=invalid)
    except (UnicodeError, ValueError, RecursionError):
        raise InputRejected("INVALID_JSON") from None
    if not isinstance(value, dict):
        raise InputRejected("INVALID_JSON")
    def bounded(item, depth=0):
        if depth > 32 or isinstance(item, float) and not math.isfinite(item):
            raise InputRejected("INVALID_JSON")
        if isinstance(item, str):
            try:
                item.encode("utf-8", "strict")
            except UnicodeError:
                raise InputRejected("INVALID_JSON") from None
        elif isinstance(item, dict):
            for key, child in item.items():
                bounded(key, depth + 1)
                bounded(child, depth + 1)
        elif isinstance(item, list):
            for child in item:
                bounded(child, depth + 1)
    bounded(value)
    return value


class _Server(HTTPServer):
    allow_reuse_address = False
    def __init__(self, application, tls_context, *, port=0, origin=None):
        self.application = application
        if getattr(application,'config',{}).get('mode')=='CP30_TESTNET_CONNECTION':
            from .full_configuration import validate_origin
            validate_origin(origin,port)
            if origin!=application.config.get('origin') or port!=application.config.get('httpPort'):raise InputRejected('FIXED_ORIGIN_CONFIGURATION_MISMATCH')
        self.tls_context = tls_context
        self.slots = threading.BoundedSemaphore(8)
        self.threads = set()
        self.thread_lock = threading.Lock()
        super().__init__(("127.0.0.1", port), _Handler)
        self.host = "127.0.0.1:" + str(self.server_port)
        self.origin = origin or "https://" + self.host
        self.host = urlsplit(self.origin).netloc

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        try:
            return self.tls_context.wrap_socket(connection, server_side=True), address
        except (OSError, ssl.SSLError):
            connection.close()
            raise OSError("TLS_REJECTED") from None

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(.1)
                payload = b'{"error":"UNAVAILABLE"}'
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: " + str(len(payload)).encode("ascii") + b"\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" + payload)
            except OSError:
                pass
            self.shutdown_request(request)
            return
        def run():
            try:
                self.finish_request(request, address)
            except Exception:
                pass
            finally:
                self.shutdown_request(request)
                with self.thread_lock:
                    self.threads.discard(threading.current_thread())
                self.slots.release()
        thread = threading.Thread(target=run, daemon=True)
        with self.thread_lock:
            self.threads.add(thread)
        thread.start()

    def handle_error(self, request, client_address):
        pass


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = ""
    sys_version = ""

    def log_message(self, format, *args):
        pass

    def _line(self, limit):
        line = bytearray()
        while len(line) <= limit:
            remaining = self.read_deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            self.connection.settimeout(remaining)
            byte = self.rfile.read1(1)
            if not byte:
                raise InputRejected("INCOMPLETE_REQUEST")
            line.extend(byte)
            if byte == b"\n":
                if len(line) > limit or not line.endswith(b"\r\n"):
                    raise InputRejected("INVALID_REQUEST")
                return bytes(line)
        raise InputRejected("INVALID_REQUEST")

    def _response(self, status, value, headers=None):
        payload = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.connection.settimeout(10)
        self.send_response_only(status)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        if not any(key.lower() == "content-type" for key in (headers or {})):
            self.send_header("Content-Type", "application/octet-stream" if isinstance(value, bytes) else "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (headers or {}).items():
            # Only application-generated headers cross this boundary.
            values = value if isinstance(value, (list, tuple)) else [value]
            if not _TOKEN.fullmatch(key.encode("ascii")) or key.lower() in {"connection", "content-length"}:
                raise InputRejected("INVALID_RESPONSE")
            for item in values:
                if not isinstance(item, str) or "\r" in item or "\n" in item:
                    raise InputRejected("INVALID_RESPONSE")
                self.send_header(key, item)
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def handle(self):
        self.close_connection = True
        self.request_version = "HTTP/1.1"
        self.read_deadline = time.monotonic() + 5
        try:
            request = self._line(4096)[:-2].split(b" ")
            if len(request) != 3 or request[2] != b"HTTP/1.1":
                raise InputRejected("INVALID_REQUEST")
            method, target = (item.decode("ascii", "strict") for item in request[:2])
            if len(request[1]) > 2048:
                self._response(414, {"error": "URL_LIMIT"})
                return
            parsed = urlsplit(target)
            if not target.startswith("/") or target.startswith("//") or parsed.scheme or parsed.netloc or parsed.fragment or any(ord(c) < 33 or ord(c) == 127 for c in target) or "\\" in target:
                raise InputRejected("INVALID_URL")
            headers, total, count = {}, 0, 0
            while True:
                line = self._line(16 * 1024)
                total += len(line)
                if total > 16 * 1024:
                    self._response(431, {"error": "HEADER_LIMIT"})
                    return
                if line == b"\r\n":
                    break
                count += 1
                if count > 64 or line[:1] in {b" ", b"\t"} or b":" not in line:
                    raise InputRejected("INVALID_HEADERS")
                key, value = line[:-2].split(b":", 1)
                if not _TOKEN.fullmatch(key) or any(byte < 32 and byte != 9 or byte == 127 for byte in value):
                    raise InputRejected("INVALID_HEADERS")
                name = key.decode("ascii").lower()
                if name in headers:
                    raise InputRejected("DUPLICATE_HEADER")
                headers[name] = value.decode("latin-1").strip(" \t")
            if any(name.startswith("x-forwarded-") or name == "forwarded" for name in headers):
                raise InputRejected("PROXY_HEADER_DENIED")
            if headers.get("host") != self.server.host:
                self._response(403, {"error": "ORIGIN_DENIED"})
                return
            origin = headers.get("origin")
            fetch_site = headers.get("sec-fetch-site")
            navigation = method == "GET" and parsed.path in {"/", "/consumer.js", "/consumer.css"}
            if origin is not None and origin != self.server.origin or fetch_site is not None and fetch_site != "same-origin" and not (navigation and fetch_site == "none"):
                self._response(403, {"error": "ORIGIN_DENIED"})
                return
            if method not in {"GET", "POST", "PUT"}:
                self._response(405, {"error": "METHOD_DENIED"}, {"Allow": "GET, POST, PUT"})
                return
            if "transfer-encoding" in headers or "expect" in headers:
                raise InputRejected("INVALID_FRAMING")
            length_text = headers.get("content-length")
            if length_text is not None and not re.fullmatch(r"0|[1-9][0-9]{0,8}", length_text):
                raise InputRejected("INVALID_FRAMING")
            length = int(length_text or "0")
            raw_image = method == "PUT" and _IMAGE_ROUTE.fullmatch(parsed.path)
            if length > (IMAGE_LIMIT if raw_image else JSON_LIMIT):
                self._response(413, {"error": "BODY_LIMIT"})
                return
            if method == "GET" and length != 0:
                raise InputRejected("INVALID_FRAMING")
            if method != "GET":
                if origin != self.server.origin:
                    self._response(403, {"error": "ORIGIN_DENIED"})
                    return
                if length_text is None:
                    raise InputRejected("INVALID_FRAMING")
                content_type = headers.get("content-type")
                if content_type not in ({"image/png", "image/jpeg", "image/webp"} if raw_image else {"application/json"}):
                    self._response(415, {"error": "CONTENT_TYPE_DENIED"})
                    return
            pieces, received = [], 0
            while received < length:
                remaining = self.read_deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                self.connection.settimeout(remaining)
                piece = self.rfile.read1(min(65536, length - received))
                if not piece:
                    raise InputRejected("INCOMPLETE_BODY")
                pieces.append(piece)
                received += len(piece)
            body = b"".join(pieces)
            # This transport accepts only one request per connection. Reject bytes
            # already available beyond the declared body (including pipelining).
            self.connection.settimeout(.01)
            try:
                if self.rfile.peek(1):
                    raise InputRejected("OVERLONG_BODY")
            except (TimeoutError, socket.timeout):
                pass
            if method != "GET" and not raw_image:
                decode_json(body)
            cookies = {}
            raw_cookies = headers.get("cookie", "")
            if raw_cookies:
                for pair in raw_cookies.split(";"):
                    if "=" not in pair:
                        raise InputRejected("INVALID_COOKIE")
                    name = pair.split("=", 1)[0].strip()
                    if name in cookies:
                        raise InputRejected("INVALID_COOKIE")
                    cookie = SimpleCookie()
                    cookie.load(pair.strip())
                    if len(cookie) != 1 or name not in cookie:
                        raise InputRejected("INVALID_COOKIE")
                    cookies[name] = cookie[name].value
            status, value, response_headers = self.server.application.handle(method, target, headers, cookies, body, origin)
            self._response(status, value, response_headers)
        except (InputRejected, UnicodeError, ValueError, RecursionError):
            try:
                self._response(422, {"error": "INVALID_REQUEST"})
            except Exception:
                pass
        except (TimeoutError, OSError):
            try:
                self._response(408, {"error": "READ_TIMEOUT"})
            except Exception:
                pass
        except Exception:
            try:
                self._response(503, {"error": "UNAVAILABLE"})
            except Exception:
                pass


class HTTPSService:
    def __init__(self, application, certfile, keyfile, on_bound=None, *, port=0, origin=None):
        if getattr(application,'config',{}).get('mode')=='CP30_TESTNET_CONNECTION':
            from .full_configuration import validate_origin
            validate_origin(origin,port)
            if origin!=application.config.get('origin') or port!=application.config.get('httpPort'):raise InputRejected('FIXED_ORIGIN_CONFIGURATION_MISMATCH')
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certfile, keyfile)
        self.server = _Server(application, context, port=port, origin=origin)
        self.port, self.origin = self.server.server_port, self.server.origin
        if on_bound is not None:
            on_bound(self.port, self.origin)
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .1}, daemon=True)
        self.thread.start()
        return self

    def close(self):
        if self.thread is not None:
            self.server.shutdown()
            self.thread.join(timeout=10)
        self.server.server_close()
        with self.server.thread_lock:
            workers = list(self.server.threads)
        for thread in workers:
            thread.join(timeout=10)

    def __enter__(self):
        return self.start()

    def __exit__(self, *args):
        self.close()


def serve(application, certfile, keyfile, on_bound=None):
    service = HTTPSService(application, certfile, keyfile, on_bound)
    try:
        service.server.serve_forever(poll_interval=.1)
    finally:
        service.server.server_close()
