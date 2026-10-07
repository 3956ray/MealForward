"""CP24 real Anvil/HTTP acceptance; no mocked balances or projectors."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import platform
import subprocess
import sys
import time
import requests
import threading
import unittest
from werkzeug.serving import make_server
from server.backend import digest, random_id
from server.chain.client import PRICE
from server.local import load_worker_keys
from server.local_e2e.__main__ import setup, load
from server.local_e2e.web import create_app
from server.local_e2e.bridge import create_bridge
from server.outbox import Worker
import tests.test_backend_chain as chain_tests


class CP24LocalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        arch = {'arm64':'arm64','aarch64':'arm64','x86_64':'amd64'}.get(platform.machine())
        system = {'darwin':'darwin','linux':'linux'}.get(sys.platform)
        binary = chain_tests.ROOT/f'node_modules/@foundry-rs/anvil-{system}-{arch}/bin/anvil'
        if not binary.is_file():
            raise RuntimeError('Pinned native Anvil executable missing')
        cls.rpc_port = chain_tests.free_port()
        cls.rpc_url = f'http://127.0.0.1:{cls.rpc_port}'
        cls.node = subprocess.Popen([str(binary),'--host','127.0.0.1','--port',str(cls.rpc_port),
                                     '--chain-id','31337','--silent'],
                                    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_node)
        with requests.Session() as probe:
            probe.trust_env = False
            for _ in range(100):
                if cls.node.poll() is not None:
                    raise RuntimeError('Owned native Anvil failed')
                try:
                    response = probe.post(cls.rpc_url,json={'jsonrpc':'2.0','id':1,'method':'eth_chainId','params':[]},timeout=.2)
                    if response.json().get('result') == '0x7a69':
                        return
                except requests.RequestException:
                    pass
                time.sleep(.05)
        raise RuntimeError('Owned native Anvil not ready')

    @classmethod
    def stop_node(cls):
        if cls.node.poll() is None:
            cls.node.terminate()
            try:
                cls.node.wait(timeout=10)
            except subprocess.TimeoutExpired:
                cls.node.kill(); cls.node.wait(timeout=5)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cp24-http-')
        self.addCleanup(self.tmp.cleanup)
        self.origin = 'http://127.0.0.1:'+str(chain_tests.free_port())
        port = chain_tests.free_port()
        self.config = setup(Path(self.tmp.name)/'fresh', self.rpc_url, self.origin, 'http://127.0.0.1:'+str(port))
        self.b = load(self.config)
        self.worker = Worker(self.b, load_worker_keys(self.config))
        self.app = create_app(self.b, self.config)
        self.fault_phase = None
        self.bridge = create_bridge(self.config, fault=self.fault)
        self.http = make_server('127.0.0.1', port, self.bridge, threaded=True, request_handler=chain_tests.QuietHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_http)
        self.public = self.client()
        self.partner = self.login('partner')
        self.owner = self.login('owner')
        self.recipient = self.client()

    def stop_http(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join(timeout=5)

    def fault(self, phase):
        if phase == self.fault_phase:
            raise RuntimeError('deliberate test crash at '+phase)

    def client(self):
        c = self.app.test_client(); c.cp24_csrf = None; c.cp24_cap = None
        return c

    def post(self, client, path, body=None):
        headers = {'Origin': self.origin}
        if client.cp24_csrf: headers['X-CSRF-Token'] = client.cp24_csrf
        if client.cp24_cap: headers['X-Terminal-Cap'] = client.cp24_cap
        return client.post('/api/cp24/'+path, json={} if body is None else body, headers=headers)

    def ok(self, response):
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def login(self, role):
        c = self.client()
        dto = self.ok(self.post(c, role+'/login', {'username': role+'-a', 'password':'local-only-password'}))
        c.cp24_csrf = dto['csrfToken']
        return c

    def prove(self, client=None):
        client = client or self.owner
        dto = self.ok(self.post(client, 'owner/proof'))
        self.assertEqual(self.ok(self.post(client, 'wallet/confirm', {'ticket':dto['ticket']}))['status'], 'VERIFIED')

    def finalize(self):
        self.worker.tick()
        self.b.rpc.w3.provider.make_request('anvil_mine', ['0x80'])
        self.worker.tick()

    def vector(self, a, r, h, s):
        actual = self.b.store.one('SELECT F,A,R,H,S,X FROM batches')
        self.assertEqual(actual, dict(F=PRICE,A=a,R=r,H=h,S=s,X=0))
        self.assertEqual(actual['F'], sum(actual[k] for k in ('A','R','H','S','X')))

    def issued(self):
        prepared = self.ok(self.post(self.public, 'support/prepare'))
        self.assertEqual(self.ok(self.post(self.public, 'wallet/confirm', {'ticket':prepared['ticket']}))['status'], 'SUBMITTED')
        self.finalize(); self.vector(PRICE,0,0,0)
        issue = self.ok(self.post(self.partner,'partner/issue'))
        self.finalize(); self.vector(0,PRICE,0,0)
        self.assertEqual(self.ok(self.post(self.partner,'partner/issue'))['operation']['id'],issue['operation']['id'])
        self.secret = self.ok(self.post(self.partner,'partner/invite',{'rotate':False}))['url'].split('/recipient/')[1]
        self.exchange(self.recipient)
        return self.ok(self.post(self.recipient,'recipient/display'))

    def exchange(self, client):
        client.cp24_csrf = self.ok(self.post(client,'recipient/exchange',{'secret':self.secret}))['csrfToken']

    def locked(self):
        display = self.issued(); self.prove()
        self.assertTrue(self.ok(self.post(self.owner,'owner/precheck',{'code':display['qrPayload']}))['valid'])
        self.lock_body = {'intentKey':random_id(),'code':display['manualCode']}
        result = self.ok(self.post(self.owner,'owner/lock', self.lock_body))
        self.owner.cp24_cap = result['terminalCap']
        self.assertEqual(self.post(self.owner,'owner/handoff',{'intentKey':random_id()}).status_code,409)
        self.finalize(); self.vector(0,PRICE,0,0)
        return result

    def reported(self):
        result = self.locked()
        self.ok(self.post(self.owner,'owner/handoff',{'intentKey':random_id()}))
        self.vector(0,PRICE,0,0)
        self.ok(self.post(self.owner,'owner/report',{'intentKey':random_id(),'confirmStatement':True}))
        self.finalize(); self.vector(0,0,PRICE,0)
        return result

    def test_full_http_chain_conservation_and_single_signatures(self):
        self.reported()
        settle = self.ok(self.post(self.owner,'owner/settle'))
        self.assertIsNone(self.b.store.one('SELECT * FROM outbox WHERE operation_id=?',(settle['operation']['id'],)))
        self.assertEqual(self.ok(self.post(self.owner,'wallet/confirm',{'ticket':settle['ticket']}))['status'],'SUBMITTED')
        self.ok(self.post(self.owner,'wallet/confirm',{'ticket':settle['ticket']}))
        direct = self.bridge.test_client().post('/confirm',json={'ticket':settle['ticket']},headers={'X-CP24-Bridge':self.config['bridgeToken']})
        self.assertEqual(direct.status_code,200)
        self.finalize(); self.vector(0,0,0,PRICE)
        self.assertEqual(self.b.store.one('SELECT signs FROM cp24_bridge WHERE hash=?',(digest(settle['ticket']),))['signs'],1)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM private_vouchers')['n'],1)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM voucher_claims')['n'],1)
        for row in self.b.store.all('SELECT status FROM operations'):
            self.assertEqual(row['status'],'FINALIZED_SUCCESS')
        reloaded = load(self.config)
        self.assertFalse(reloaded.quarantined())
        self.assertEqual(reloaded.store.one('SELECT S FROM batches')['S'],PRICE)

    def test_display_rotation_expiry_logout_and_cross_session(self):
        first = self.issued(); self.prove()
        second = self.ok(self.post(self.recipient,'recipient/display'))
        for code in (first['manualCode'],first['qrPayload']):
            self.assertEqual(self.post(self.owner,'owner/precheck',{'code':code}).status_code,404)
        self.assertTrue(self.ok(self.post(self.owner,'owner/precheck',{'code':second['manualCode']}))['valid'])
        self.b.store.execute('UPDATE cp24_display SET expires=0')
        self.assertEqual(self.post(self.owner,'owner/lock',{'intentKey':random_id(),'code':second['manualCode']}).status_code,404)
        other = self.client(); self.exchange(other)
        self.assertEqual(self.post(self.recipient,'recipient/display').status_code,401)
        current = self.ok(self.post(other,'recipient/display'))
        self.ok(self.post(other,'recipient/logout'))
        self.assertEqual(self.post(self.owner,'owner/precheck',{'code':current['qrPayload']}).status_code,404)
        self.assertEqual(self.post(self.partner,'partner/invite',{'rotate':True}).status_code,409)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM voucher_claims')['n'],0)
        self.vector(0,PRICE,0,0)

    def test_takeover_revokes_old_cap_and_only_one_expected_version_wins(self):
        locked = self.locked()
        other = self.login('owner'); self.prove(other)
        self.assertEqual(self.post(other,'owner/handoff',{'intentKey':random_id()}).status_code,409)
        def take(_): return self.post(other,'owner/takeover',{'expectedVersion':locked['version'],'confirmed':True})
        with ThreadPoolExecutor(max_workers=2) as pool: responses = list(pool.map(take,range(2)))
        self.assertEqual(sorted(r.status_code for r in responses),[200,409])
        other.cp24_cap = next(r.get_json()['terminalCap'] for r in responses if r.status_code==200)
        for action,body in [('handoff',{'intentKey':random_id()}),('report',{'intentKey':random_id(),'confirmStatement':True}),('settle',{})]:
            self.assertEqual(self.post(self.owner,'owner/'+action,body).status_code,409)
        self.ok(self.post(other,'owner/handoff',{'intentKey':random_id()}))
        self.ok(self.post(other,'owner/note',{'text':'请核对原交餐声明'}))
        self.assertEqual(self.post(other,'owner/report',{'intentKey':random_id()}).status_code,422)
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM operations WHERE kind='report'")['n'],0)
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM cp24_audit WHERE event IN ('LOCK','TAKEOVER')")['n'],2)
        self.vector(0,PRICE,0,0)

    def test_guess_limit_preserves_authenticated_original_recovery(self):
        locked = self.locked()
        for _ in range(10):
            self.assertEqual(self.post(self.owner,'owner/precheck',{'code':'invalid'}).status_code,404)
        self.assertEqual(self.post(self.owner,'owner/precheck',{'code':'invalid'}).status_code,429)
        original = self.ok(self.post(self.owner,'owner/lock',self.lock_body))
        self.assertEqual(original['operation']['id'],locked['operation']['id'])
        self.assertEqual(self.owner.get('/api/cp24/owner/state').status_code,200)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM voucher_claims')['n'],1)
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM outbox JOIN operations ON operations.id=outbox.operation_id WHERE kind='lock'")['n'],1)

    def test_signing_started_crash_is_query_only_even_after_bridge_restart(self):
        prepared = self.ok(self.post(self.public,'support/prepare'))
        self.fault_phase = 'signing_started'
        self.assertEqual(self.ok(self.post(self.public,'wallet/confirm',{'ticket':prepared['ticket']}))['status'],'UNKNOWN')
        self.fault_phase = None
        bridge = create_bridge(self.config).test_client()
        for _ in range(2):
            response = bridge.post('/confirm',json={'ticket':prepared['ticket']},headers={'X-CP24-Bridge':self.config['bridgeToken']})
            self.assertEqual(response.get_json()['status'],'SIGNING_STARTED')
        row = self.b.store.one('SELECT * FROM cp24_bridge WHERE hash=?',(digest(prepared['ticket']),))
        self.assertEqual(row['signs'],0); self.assertIsNone(row['raw_cipher'])
        self.assertIsNone(self.b.store.one('SELECT * FROM batches'))
        self.assertIsNone(self.ok(self.post(self.public,'support/prepare'))['ticket'])
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM operations WHERE kind='support'")['n'],1)

    def test_saved_raw_crash_does_not_send_or_sign_again(self):
        prepared = self.ok(self.post(self.public,'support/prepare'))
        nonce = self.b.rpc.w3.eth.get_transaction_count(self.b.deployment['supporter'])
        self.fault_phase = 'raw_saved'
        self.assertEqual(self.ok(self.post(self.public,'wallet/confirm',{'ticket':prepared['ticket']}))['status'],'UNKNOWN')
        self.fault_phase = None
        bridge = create_bridge(self.config).test_client()
        for _ in range(2):
            dto = bridge.post('/confirm',json={'ticket':prepared['ticket']},headers={'X-CP24-Bridge':self.config['bridgeToken']}).get_json()
            self.assertEqual(dto['status'],'RAW_SAVED')
        row = self.b.store.one('SELECT * FROM cp24_bridge WHERE hash=?',(digest(prepared['ticket']),))
        self.assertEqual(row['signs'],1); self.assertIsNotNone(row['raw_cipher'])
        self.assertEqual(self.b.rpc.w3.eth.get_transaction_count(self.b.deployment['supporter']),nonce)
        self.assertIsNone(self.b.store.one('SELECT * FROM batches'))

    def test_unknown_settle_takeover_never_grants_second_ticket(self):
        self.reported()
        prepared = self.ok(self.post(self.owner,'owner/settle'))
        self.fault_phase = 'signing_started'
        self.assertEqual(self.ok(self.post(self.owner,'wallet/confirm',{'ticket':prepared['ticket']}))['status'],'UNKNOWN')
        self.fault_phase = None
        other = self.login('owner'); self.prove(other)
        takeover = self.ok(self.post(other,'owner/takeover',{'expectedVersion':1,'confirmed':True}))
        other.cp24_cap = takeover['terminalCap']
        response = self.post(other,'owner/settle')
        if response.status_code == 200:
            self.assertIsNone(response.get_json().get('ticket'))
        else:
            self.assertEqual(response.status_code,409)
        self.assertEqual(self.post(self.owner,'wallet/confirm',{'ticket':prepared['ticket']}).status_code,409)
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM operations WHERE kind='settle'")['n'],1)
        self.assertEqual(self.b.store.one('SELECT signs FROM cp24_bridge WHERE hash=?',(digest(prepared['ticket']),))['signs'],0)
        self.vector(0,0,PRICE,0)

    def test_role_csrf_and_owner_logout_preserve_lock(self):
        self.locked()
        self.assertEqual(self.post(self.partner,'owner/handoff',{'intentKey':random_id()}).status_code,401)
        csrf = self.owner.cp24_csrf; self.owner.cp24_csrf = None
        self.assertEqual(self.post(self.owner,'owner/handoff',{'intentKey':random_id()}).status_code,403)
        self.owner.cp24_csrf = csrf
        old_anchor = self.b.store.anchor.read_text()
        self.assertEqual(self.post(self.owner,'owner/logout').status_code,204)
        self.assertNotEqual(self.b.store.anchor.read_text(),old_anchor)
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM cp24_audit WHERE event='AUTH_LOGOUT'")['n'],1)
        self.assertEqual(self.post(self.owner,'owner/handoff',{'intentKey':random_id()}).status_code,401)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM voucher_claims')['n'],1)
        self.assertEqual(self.b.store.one('SELECT revoked FROM owner_wallet_sessions')['revoked'],1)
        self.vector(0,PRICE,0,0)

    def test_takeover_orders_against_handoff_persistence(self):
        self.locked()
        other = self.login('owner'); self.prove(other)
        barrier = threading.Barrier(2)
        def handoff():
            barrier.wait()
            return self.post(self.owner,'owner/handoff',{'intentKey':random_id()})
        def takeover():
            barrier.wait()
            return self.post(other,'owner/takeover',{'expectedVersion':1,'confirmed':True})
        with ThreadPoolExecutor(max_workers=2) as pool:
            old_future = pool.submit(handoff); new_future = pool.submit(takeover)
            old_result = old_future.result(); new_result = new_future.result()
        self.assertEqual(new_result.status_code,200)
        self.assertIn(old_result.status_code,(200,409))
        statements = self.b.store.one('SELECT count(*) n FROM handoff_statements')['n']
        self.assertEqual(statements,1 if old_result.status_code==200 else 0)
        self.assertEqual(self.post(self.owner,'owner/handoff',{'intentKey':random_id()}).status_code,409)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM handoff_statements')['n'],statements)
        self.vector(0,PRICE,0,0)

    def test_out_of_band_database_rollback_is_quarantined_on_reload(self):
        self.issued()
        # Deliberate rollback fixture bypasses the normal transaction/anchor writer.
        with self.b.store.connect() as db:
            db.execute('DELETE FROM cp24_display')
        recovered = load(self.config)
        client = create_app(recovered,self.config).test_client()
        public = client.get('/api/cp24/public').get_json()
        self.assertFalse(public['recovery']['writeAvailable'])
        self.assertEqual(public['recovery']['state'],'RESTORE_QUARANTINE')
        response = client.post('/api/cp24/support/prepare',json={},headers={'Origin':self.origin})
        self.assertEqual(response.status_code,503)
        self.assertEqual(recovered.store.one('SELECT count(*) n FROM operations')['n'],2)
        self.vector(0,PRICE,0,0)

    def test_qr_and_manual_concurrent_lock_have_one_claim_and_outbox(self):
        display = self.issued(); self.prove()
        barrier = threading.Barrier(2)
        def lock(code):
            barrier.wait()
            return self.post(self.owner,'owner/lock',{'intentKey':random_id(),'code':code})
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lock,(display['qrPayload'],display['manualCode'])))
        self.assertEqual(sorted(r.status_code for r in responses),[200,409])
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM voucher_claims')['n'],1)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM redemptions')['n'],1)
        self.assertEqual(self.b.store.one("SELECT count(*) n FROM outbox JOIN operations ON operations.id=outbox.operation_id WHERE kind='lock'")['n'],1)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM cp24_display WHERE consumed IS NOT NULL')['n'],1)
        self.finalize(); self.vector(0,PRICE,0,0)

    def test_prechecked_code_refresh_cannot_be_locked(self):
        before = self.issued(); self.prove()
        self.assertTrue(self.ok(self.post(self.owner,'owner/precheck',{'code':before['qrPayload']}))['valid'])
        current = self.ok(self.post(self.recipient,'recipient/display'))
        for code in (before['qrPayload'],before['manualCode']):
            self.assertEqual(self.post(self.owner,'owner/lock',{'intentKey':random_id(),'code':code}).status_code,404)
        self.assertEqual(self.b.store.one('SELECT count(*) n FROM voucher_claims')['n'],0)
        self.assertTrue(self.ok(self.post(self.owner,'owner/precheck',{'code':current['manualCode']}))['valid'])
        self.vector(0,PRICE,0,0)


if __name__ == '__main__': unittest.main()
