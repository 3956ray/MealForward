"""Test driver only: disposable Anvil, CP16 C0 fixture and same-origin harness.

The disposable owner key is derived only by the existing test driver, never by the
backend or browser. Lock/report fixture uses C0 helpers; this is wallet acceptance,
not a claim that the full redemption HTTP module was exercised.
"""
import json
import os
from pathlib import Path
import signal
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import tests.test_backend_chain as chain_tests
import server.local as local
from tests.test_backend_chain_owner import OwnerC0Tests
from server.web import create_app
from flask import send_from_directory, jsonify
from werkzeug.serving import make_server

# Executable and compiled contract artifact may be reused from the primary checkout.
resources = Path(os.environ.get('OWNER_TEST_RESOURCES', str(ROOT))).resolve()
chain_tests.ROOT = resources
local.REPO = resources
OwnerC0Tests.setUpClass()
harness = OwnerC0Tests('runTest')
try:
    harness.setUp()
    redemption, prepared = harness.payable()
    h = harness.h
    h.http.shutdown(); h.http.server_close(); h.thread.join(timeout=5)
    app = create_app(h.backend, origin=h.origin)
    dist = ROOT / 'owner-wallet-harness/dist'
    @app.get('/')
    def index():
        return send_from_directory(dist, 'index.html')
    @app.get('/assets/<path:name>')
    def assets(name):
        return send_from_directory(dist / 'assets', name)
    @app.post('/__test/tick')
    def tick():
        harness.worker.tick()
        return jsonify(ok=True)
    h.http = make_server('127.0.0.1', int(h.origin.rsplit(':', 1)[1]), app, threaded=True, request_handler=chain_tests.QuietHandler)
    h.thread = threading.Thread(target=h.http.serve_forever, daemon=True); h.thread.start()
    print(json.dumps({'origin':h.origin,'rpcUrl':h.rpc_url,'redemptionId':redemption,'intentKey':'owner-c0-settle',
                      'deployment':{k:v for k,v in h.backend.deployment.items() if k not in ('rpcUrl','issuer')},
                      'prepared':prepared}), flush=True)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    stop.wait()
finally:
    harness.doCleanups()
    OwnerC0Tests.tearDownClass()
