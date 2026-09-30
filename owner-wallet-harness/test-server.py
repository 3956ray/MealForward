"""Test driver only: disposable Anvil and same-origin owner workbench.

The disposable owner key is derived only by the existing test driver, never by the
backend or browser. Default mode uses a C0-helper payable for controller tests.
OWNER_TEST_FULL_HTTP=1 issues a voucher through HTTP and leaves lock/report/settle
for the browser; no prebuilt payable is provided in that mode.
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
from server.local import load_worker_keys
from server.outbox import Worker
from server.backend import random_id
from flask import send_from_directory, jsonify, request
from werkzeug.serving import make_server

# Executable and compiled contract artifact may be reused from the primary checkout.
resources = Path(os.environ.get('OWNER_TEST_RESOURCES', str(ROOT))).resolve()
chain_tests.ROOT = resources
local.REPO = resources
OwnerC0Tests.setUpClass()
full_http = os.environ.get('OWNER_TEST_FULL_HTTP') == '1'
harness = chain_tests.BackendChainTests('runTest') if full_http else OwnerC0Tests('runTest')
try:
    if full_http:
        harness.rpc_url = OwnerC0Tests.rpc_url
        harness.fixture_options = {'owner_mode': True}
    harness.setUp()
    if full_http:
        h = harness
        h.worker = Worker(h.backend, load_worker_keys(h.config))
        _, _, funded = h.funded(1)
        issued, _ = h.issue(funded['intent']['batchId'], 1)
        assert issued.status_code == 202, issued.text
        h.worker.tick(); h.mine(); h.worker.tick()
        result = h.get(h.partner, '/operations/' + issued.json()['operation']['id'])
        voucher = result.json()['vouchers'][0]['id']
        disclosed = h.post(h.partner, '/work/vouchers/' + voucher + '/invitation', {'intentKey': random_id()})
        assert disclosed.status_code == 200, disclosed.text
        delivered = h.post(h.partner, '/work/vouchers/' + voucher + '/deliveries', {'intentKey': random_id(), 'channel': 'in_person', 'result': 'sent'})
        assert delivered.status_code == 201, delivered.text
        recipient = h.session()
        exchanged = h.post(recipient, '/recipient/session', {'secret': disclosed.json()['secret']})
        assert exchanged.status_code == 200, exchanged.text
        recipient.headers['X-CSRF-Token'] = exchanged.json()['csrfToken']
        shown = h.post(recipient, '/recipient/presentations', {'intentKey': random_id()})
        assert shown.status_code == 200, shown.text
        info = {'code': shown.json()['code'], 'voucherId': voucher, 'fullHttp': True}
        worker = h.worker
    else:
        redemption, prepared = harness.payable()
        h = harness.h
        info = {'redemptionId': redemption, 'intentKey': 'owner-c0-settle', 'prepared': prepared}
        worker = harness.worker
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
        worker.tick()
        if request.get_json().get('finalize'):
            h.mine(); worker.tick()
        return jsonify(ok=True)
    @app.get('/__test/state')
    def test_state():
        return jsonify(batch=h.backend.store.one('SELECT F,A,R,H,S FROM batches'),
                       operations=h.backend.store.all('SELECT kind,status,tx_hash FROM operations'),
                       outboxKinds=h.backend.store.all('SELECT o.kind FROM outbox b JOIN operations o ON o.id=b.operation_id'))
    if full_http:
        @app.post('/__test/refresh-code')
        def refresh_test_code():
            # Actual recipient HTTP rotation invalidates the prior prechecked code.
            response = h.post(recipient, '/recipient/presentations', {'intentKey': random_id()})
            assert response.status_code == 200, response.text
            return jsonify(code=response.json()['code'])
    h.http = make_server('127.0.0.1', int(h.origin.rsplit(':', 1)[1]), app, threaded=True, request_handler=chain_tests.QuietHandler)
    h.thread = threading.Thread(target=h.http.serve_forever, daemon=True); h.thread.start()
    print(json.dumps({'origin': h.origin, 'rpcUrl': h.rpc_url, **info,
                      'deployment': {k:v for k,v in h.backend.deployment.items() if k not in ('rpcUrl','issuer')}}), flush=True)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    stop.wait()
finally:
    if full_http:
        harness.tearDown()
    else:
        harness.doCleanups()
    OwnerC0Tests.tearDownClass()
