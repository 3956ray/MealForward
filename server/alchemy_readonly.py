"""CP18 isolated, read-only Monad Testnet checker. No business backend imports."""
import argparse
from collections import deque
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import stat
import threading
import time
from urllib.parse import urlsplit

from flask import Flask, jsonify, request
import requests
from werkzeug.exceptions import HTTPException
from werkzeug.serving import WSGIRequestHandler
from urllib3.exceptions import ReadTimeoutError

ORIGIN = 'http://127.0.0.1:15217'
CONFIG = Path(__file__).resolve().parents[1] / '.localbackend/alchemy/config.json'
MAX_RESPONSE = 64 * 1024
ERRORS = {
    'ORIGIN_DENIED': (403, '请求来源不允许'),
    'JSON_REQUIRED': (415, '请使用JSON请求'),
    'REQUEST_TOO_LARGE': (413, '请求内容过大'),
    'INVALID_REQUEST': (400, '检查请求格式不正确'),
    'LOCAL_RATE_LIMITED': (429, '检查过于频繁，请60秒后主动重试'),
    'CHECK_IN_PROGRESS': (429, '已有检查进行中，请1秒后再查看'),
    'UPSTREAM_RATE_LIMITED': (503, '测试网服务暂时限流，请稍后主动重试'),
    'CONFIG_UNAVAILABLE': (503, '测试网连接尚未配置或配置不可用，请联系维护者'),
    'UPSTREAM_TIMEOUT': (504, '本次未取得结果，可稍后主动重试'),
    'NETWORK_MISMATCH': (502, '当前连接不是所需测试网，请联系维护者'),
    'UPSTREAM_FAILURE': (502, '本次测试网读取失败，请稍后主动重试'),
    'NOT_FOUND': (404, '接口不存在'),
    'METHOD_NOT_ALLOWED': (405, '请求方法不允许'),
    'INTERNAL_ERROR': (500, '本次检查暂不可用'),
}


class CheckError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def load_endpoint(path):
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 16 * 1024:
            raise ValueError()
        value = json.loads(path.read_text())['testnet_rpc_url']
        if not isinstance(value, str) or len(value) > 512:
            raise ValueError()
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or parsed.netloc != 'monad-testnet.g.alchemy.com'
                or parsed.query or parsed.fragment
                or not re.fullmatch(r'/v2/[A-Za-z0-9_-]{1,256}', parsed.path)):
            raise ValueError()
        return value
    except Exception:
        raise CheckError('CONFIG_UNAVAILABLE') from None


def quantity(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})', value):
        raise CheckError('UPSTREAM_FAILURE')
    return int(value, 16)


class Checker:
    def __init__(self, config=CONFIG, *, session_factory=requests.Session, clock=time.monotonic, budget=8):
        self.config = config
        self.session_factory = session_factory
        self.clock = clock
        self.budget = budget
        self.lock = threading.Lock()
        self.inflight = False
        self.attempts = deque()

    def remaining(self, deadline):
        remaining = deadline - self.clock()
        if remaining <= 0:
            raise CheckError('UPSTREAM_TIMEOUT')
        return remaining

    def rpc(self, session, endpoint, method, identifier, deadline):
        remaining = self.remaining(deadline)
        try:
            with session.post(endpoint, json={'jsonrpc': '2.0', 'id': identifier,
                                             'method': method, 'params': []},
                              timeout=(min(2, remaining), min(3, remaining)),
                              allow_redirects=False, stream=True) as response:
                if response.status_code == 429:
                    raise CheckError('UPSTREAM_RATE_LIMITED')
                if response.status_code != 200:
                    raise CheckError('UPSTREAM_FAILURE')
                body = bytearray()
                # Small bounded responses; one-byte chunks check wall time even on trickle streams.
                for chunk in response.iter_content(chunk_size=1):
                    self.remaining(deadline)
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE:
                        raise CheckError('UPSTREAM_FAILURE')
                self.remaining(deadline)
                data = json.loads(body)
                if (not isinstance(data, dict) or data.get('jsonrpc') != '2.0'
                        or type(data.get('id')) is not int or data['id'] != identifier
                        or 'error' in data or 'result' not in data):
                    raise CheckError('UPSTREAM_FAILURE')
                return quantity(data['result'])
        except CheckError:
            raise
        except requests.Timeout:
            raise CheckError('UPSTREAM_TIMEOUT') from None
        except requests.ConnectionError as error:
            code = 'UPSTREAM_TIMEOUT' if any(isinstance(arg, ReadTimeoutError) for arg in error.args) else 'UPSTREAM_FAILURE'
            raise CheckError(code) from None
        except Exception:
            # Never propagate exceptions that may contain credential URLs or upstream bodies.
            raise CheckError('UPSTREAM_FAILURE') from None

    def run(self):
        now = self.clock()
        with self.lock:
            if self.inflight:
                raise CheckError('CHECK_IN_PROGRESS')
            while self.attempts and self.attempts[0] <= now - 60:
                self.attempts.popleft()
            if len(self.attempts) >= 5:
                raise CheckError('LOCAL_RATE_LIMITED')
            self.attempts.append(now)
            self.inflight = True
        deadline = now + self.budget
        finished = threading.Event()
        outcome = {}

        def work():
            try:
                endpoint = load_endpoint(self.config)
                with self.session_factory() as session:
                    session.trust_env = False
                    chain_id = self.rpc(session, endpoint, 'eth_chainId', 1, deadline)
                    if chain_id != 10143:
                        raise CheckError('NETWORK_MISMATCH')
                    block = self.rpc(session, endpoint, 'eth_blockNumber', 2, deadline)
                    self.remaining(deadline)
                outcome['data'] = {'chainId': 10143, 'network': 'Monad Testnet',
                                   'latestBlock': str(block), 'checkedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                                   'contractDeployed': False}
            except CheckError as error:
                outcome['error'] = error.code
            except Exception:
                outcome['error'] = 'UPSTREAM_FAILURE'
            finally:
                with self.lock:
                    self.inflight = False
                finished.set()

        try:
            threading.Thread(target=work, daemon=True, name='testnet-readonly').start()
        except Exception:
            with self.lock:
                self.inflight = False
            raise CheckError('INTERNAL_ERROR') from None
        if not finished.wait(max(0, deadline - self.clock())):
            # Work may still be unwinding a socket read. Its finally owns the admission lock.
            raise CheckError('UPSTREAM_TIMEOUT')
        if 'error' in outcome:
            raise CheckError(outcome['error'])
        return outcome['data']


def create_app(checker=None, *, port=18985):
    app = Flask(__name__, static_folder=None)
    app.config['MAX_CONTENT_LENGTH'] = 1024
    checker = checker or Checker()

    @app.before_request
    def guard():
        if request.host not in ('127.0.0.1:15217', f'127.0.0.1:{port}') or request.headers.get('Origin') != ORIGIN:
            raise CheckError('ORIGIN_DENIED')

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
        return response

    @app.errorhandler(CheckError)
    def check_error(error):
        status, message = ERRORS[error.code]
        response = jsonify(error={'code': error.code, 'message': message})
        response.status_code = status
        if error.code in ('LOCAL_RATE_LIMITED', 'UPSTREAM_RATE_LIMITED', 'CHECK_IN_PROGRESS'):
            response.headers['Retry-After'] = '1' if error.code == 'CHECK_IN_PROGRESS' else '60'
        return response

    @app.errorhandler(Exception)
    def unexpected(error):
        code = 'INTERNAL_ERROR'
        if isinstance(error, HTTPException):
            code = {400: 'INVALID_REQUEST', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
                    413: 'REQUEST_TOO_LARGE'}.get(error.code, 'INVALID_REQUEST')
        return check_error(CheckError(code))

    @app.post('/api/v1/testnet/status')
    def status():
        if request.mimetype != 'application/json':
            raise CheckError('JSON_REQUIRED')
        if request.get_json() != {}:
            raise CheckError('INVALID_REQUEST')
        return jsonify(checker.run())

    return app


class QuietHandler(WSGIRequestHandler):
    def log(self, type, message, *args):
        # Do not log caller-controlled URLs/headers, nor low-level socket exceptions.
        pass


def main():
    parser = argparse.ArgumentParser(description='CP18 read-only Monad Testnet checker')
    parser.add_argument('--port', type=int, default=18985)
    args = parser.parse_args()
    create_app(port=args.port).run(host='127.0.0.1', port=args.port, debug=False,
                                  use_reloader=False, threaded=True, request_handler=QuietHandler)


if __name__ == '__main__':
    main()
