"""Actual isolated Anvil31337 transactions through CP28 domain/runtime/HTTP/observer.

The explicit test adapter has local finality; this is not evidence of Monad10143.
"""
import json
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from eth_account import Account
from eth_account.messages import encode_defunct
from cryptography.fernet import Fernet
from server.local import fixture, load_worker_keys
from server.chain.client import ChainRpc, hx, plain
from server.backend import canonical, digest, random_id
from server.business_policy import LOCAL_POLICY
from server.manual_business.store import ManualStore
from server.manual_business.runtime import RuntimeGate
from server.manual_business.backend import ManualBackend
from server.manual_business.auth import TrustedAuthentication
from server.manual_business.web import create_app
from server.manual_business.service import BusinessService
from server.manual_business.signer import Signer
from tests import test_cp24_local_e2e as local_fixture


class LocalEvidenceRpc:
    def __init__(self, deployment):
        self.local = ChainRpc(deployment)
        self.deployment, self.w3, self.contract, self.event_abis = deployment, self.local.w3, self.local.contract, self.local.event_abis
    @contextmanager
    def observation(self, **_):
        self.local.guard(); yield self
    def guard(self):
        self.local.guard(); block = self.w3.eth.get_block('latest')
        return {'number': block['number'], 'hash': hx(block['hash'])}
    def read(self, name, args, height): return getattr(self.contract.functions, name)(*args).call(block_identifier=height)
    def nonce(self, sender): return self.w3.eth.get_transaction_count(self.w3.to_checksum_address(sender), 'pending')
    def balance(self, sender): return self.w3.eth.get_balance(sender)
    def estimate(self, tx): return self.w3.eth.estimate_gas(tx)
    def block(self, height):
        block = self.w3.eth.get_block(height)
        return {'number': block['number'], 'hash': hx(block['hash'])}
    def receipt(self, tx_hash): return self.w3.provider.make_request('eth_getTransactionReceipt', [tx_hash])['result']
    def transaction(self, tx_hash): return self.w3.provider.make_request('eth_getTransactionByHash', [tx_hash])['result']
    def events(self, start, end, name): return [e for e in self.local.events(start, end) if e['eventName'] == name]


class LocalFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reuse only the accepted isolated-node lifecycle, not the CP24 test cases.
        local_fixture.CP24LocalTests.setUpClass.__func__(cls)
    @classmethod
    def stop_node(cls): local_fixture.CP24LocalTests.stop_node.__func__(cls)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cp28-local-')
        self.addCleanup(self.temp.cleanup)
        self.origin = 'http://127.0.0.1:15287'
        local = fixture(Path(self.temp.name)/'fixture', self.rpc_url, self.origin, owner_mode=True)
        self.keys = load_worker_keys(local)  # only keys generated immediately above for this owned Anvil
        self.rpc = LocalEvidenceRpc(local['deployment']); self.now = int(time.time())
        d = local['deployment']
        self.config = {'runId': 'cp28-isolated-local', 'chainId': 31337, 'genesisHash': d['genesisHash'],
                       'deploymentId': d['deploymentId'], 'contractAddress': d['contractAddress'],
                       'origin': self.origin, 'trustedSubjects': {r: {'actorId': r, 'revision': 1} for r in ('partner', 'owner')},
                       'participants': {'admin': self.rpc.w3.eth.accounts[0], 'supporter': d['supporter'],
                                        'merchant': d['merchant'], 'issuer': d['issuer'], 'operator': local['workSigners']['operator']}}
        self.plan = {'version': 1, **{k: self.config[k] for k in ('runId', 'chainId', 'genesisHash', 'deploymentId', 'participants')},
                     'configDigest': digest(canonical(self.config)), 'expiresAt': self.now+3600,
                     'totalValueWei': 10**15, 'totalFeeWei': 10**17,
                     'actions': {k: {'count': 1, 'gas': 500000, 'maxFeePerGas': 2*10**9, 'maxPriorityFeePerGas': 10**9,
                                     'value': 10**15 if k == 'fund' else 0} for k in ('fund', 'issue', 'lock', 'report', 'settle')}}
        self.plan['actions']['proof'] = {'count': 1, 'gas': 0, 'maxFeePerGas': 0, 'maxPriorityFeePerGas': 0, 'value': 0}
        self.store = ManualStore(Path(self.temp.name)/'cp28'/'business.db', self.config, create=True)
        runtime = RuntimeGate(self.store, self.config, self.plan, clock=lambda: self.now)
        self.b = ManualBackend(self.store, self.rpc, Fernet.generate_key(), runtime, lambda: self.now, policy=LOCAL_POLICY)
        with self.store.transaction() as db:
            for role in ('partner', 'owner'):
                partner = 'partner-a' if role == 'partner' else None
                self.store.create_user(role, role, 'NO_PASSWORD_AUTH', role, partner, 'shop-local')
                scope = canonical({'role': role, 'partnerId': partner, 'shopId': 'shop-local', 'deploymentId': d['deploymentId']})
                db.execute('INSERT INTO cp28_mapping VALUES(?,1,1,?)', (role, scope))
            db.execute("INSERT INTO qualifications VALUES('partner-a','SYNTHETIC-REF',1,1,1,0,0)")
            db.execute("INSERT INTO owner_wallet_bindings VALUES('owner','shop-local',?,?,1)", (d['deploymentId'], d['merchant']))
        self.signs = []
        def sign(tx):
            self.signs.append(tx)
            key = self.keys['issuer' if tx['from'] == d['issuer'] else 'operator']
            return Account.sign_transaction(tx, key).raw_transaction
        self.signer = Signer(BusinessService(self.b), sign, lambda raw, tx: hx(self.rpc.w3.eth.send_raw_transaction(raw)), 's'*43)
        self.auth = TrustedAuthentication(self.b, self.origin, lambda req: req.headers.get('X-Synthetic-Verified-Subject'))
        self.app = create_app(self.config, self.b, authentication=self.auth,
                              dispatch=lambda op: self.signer.handle({'version': 1, 'operationId': op, 'capability': 's'*43}))
        self.clients = {role: self.app.test_client() for role in ('support', 'partner', 'owner', 'recipient')}
        self.csrf = {}; self.terminal = ''
        for role in ('partner', 'owner'):
            result = self.post(role, role+'/login', {}, extra={'X-Synthetic-Verified-Subject': role})
            self.csrf[role] = result['csrfToken']

    def post(self, role, path, body=None, extra=None, expected=200):
        headers = {'Origin': self.origin, 'X-CSRF-Token': self.csrf.get(role, ''), 'X-Terminal-Cap': self.terminal, **(extra or {})}
        response = self.clients[role].post('/api/cp28/'+path, json=body or {}, base_url=self.origin, headers=headers)
        self.assertEqual(response.status_code, expected, response.get_data(as_text=True))
        return response.get_json()

    def user_transaction(self, role, op):
        review = self.post(role, 'operations/'+op+'/review')
        start = self.post(role, 'operations/'+op+'/start')
        self.assertTrue(start['maySubmit'])
        tx_hash = hx(self.rpc.w3.eth.send_transaction(review['transaction']))
        self.post(role, 'operations/'+op+'/hash', {'txHash': tx_hash})
        result = self.post(role, 'operations/'+op+'/observe')
        self.assertEqual(result['state'], 'FINALIZED_SUCCESS')

    def service_transaction(self, role, op):
        result = self.post(role, 'operations/'+op+'/dispatch')
        self.assertIsNotNone(result.get('txHash'), result)
        self.post(role, 'operations/'+op+'/dispatch')
        self.assertEqual(self.post(role, 'operations/'+op+'/observe')['state'], 'FINALIZED_SUCCESS')

    def test_complete_actual_local_business_with_manual_gate_and_service(self):
        support = self.post('support', 'support/prepare', {'clientRequestId': random_id(), 'account': self.config['participants']['supporter'],
            'chainId': 31337, 'quantity': 1, 'ruleVersion': LOCAL_POLICY.rule, 'walletKind': 'local-test'})
        self.user_transaction('support', support['operation']['id'])
        issue = self.post('partner', 'partner/issue', {'intentKey': random_id(), 'recipientRef': 'SYNTHETIC-REF',
            'batchId': support['intent']['batchId'], 'quantity': 1, 'quotePriceWei': str(10**15), 'ruleVersion': LOCAL_POLICY.rule})
        self.service_transaction('partner', issue['operation']['id'])
        invitation = self.post('partner', 'partner/invite', {'rotate': False})
        session = self.post('recipient', 'recipient/exchange', {'secret': invitation['url'].split('/recipient/')[1]})
        self.csrf['recipient'] = session['csrfToken']
        display = self.post('recipient', 'recipient/display')
        self.assertTrue(display['qrPayload'].startswith('mealforward:manual:v1:'))
        challenge = self.post('owner', 'owner/proof/prepare')
        self.assertTrue(self.post('owner', 'owner/proof/start', {'challengeId': challenge['challengeId']})['maySign'])
        # Dedicated Anvil owner signing via RPC, no real user's wallet or key.
        sig = self.rpc.w3.provider.make_request('eth_sign', [challenge['address'], '0x'+challenge['message'].encode().hex()])['result']
        self.post('owner', 'owner/proof/verify', {'challengeId': challenge['challengeId'], 'signature': sig})
        self.post('owner', 'owner/proof/verify', {'challengeId': challenge['challengeId'], 'signature': sig}, expected=403)
        self.post('owner', 'owner/precheck', {'code': display['manualCode']})
        lock = self.post('owner', 'owner/lock', {'intentKey': random_id(), 'code': display['manualCode']})
        self.terminal = lock['terminalCap']; self.service_transaction('owner', lock['operation']['id'])
        self.post('owner', 'owner/handoff', {'intentKey': random_id()})
        report = self.post('owner', 'owner/report', {'intentKey': random_id(), 'confirmStatement': True})
        self.service_transaction('owner', report['operation']['id'])
        settle = self.post('owner', 'owner/settle', {'intentKey': random_id()})
        self.user_transaction('owner', settle['operation']['id'])
        ledger = self.clients['support'].get('/api/cp28/public', base_url=self.origin).get_json()
        self.assertEqual({k: ledger['batch'][k] for k in ('F', 'A', 'R', 'H', 'S')},
                         {'F': str(10**15), 'A': '0', 'R': '0', 'H': '0', 'S': str(10**15)})
        self.assertEqual(len(self.signs), 3)
        self.assertNotIn('SYNTHETIC-REF', json.dumps(ledger))
        self.post('owner', 'owner/precheck', {'code': display['manualCode']}, expected=404)
        states = self.store.all('SELECT state FROM cp28_signing')
        self.assertEqual(sum(r['state'] == 'FINALIZED_SUCCESS' for r in states), 5)

    def test_revoked_mapping_and_runtime_missing_never_sign(self):
        self.store.execute("UPDATE cp28_mapping SET revision=2 WHERE actor_id='partner'")
        self.post('partner', 'partner/issue', {}, expected=403)
        self.b.runtime.plan = None
        self.post('support', 'support/prepare', {}, expected=409)
        self.assertEqual(self.signs, [])

    def prepare_issue(self):
        support = self.post('support', 'support/prepare', {'clientRequestId': random_id(), 'account': self.config['participants']['supporter'],
            'chainId': 31337, 'quantity': 1, 'ruleVersion': LOCAL_POLICY.rule, 'walletKind': 'local-test'})
        self.user_transaction('support', support['operation']['id'])
        return self.post('partner', 'partner/issue', {'intentKey': random_id(), 'recipientRef': 'SYNTHETIC-REF',
            'batchId': support['intent']['batchId'], 'quantity': 1, 'quotePriceWei': str(10**15), 'ruleVersion': LOCAL_POLICY.rule})['operation']['id']

    def test_signer_timeout_restart_preserves_nonce_and_budget_no_second_signature(self):
        op = self.prepare_issue(); attempts = []
        def uncertain(tx):
            attempts.append(tx)
            raise TimeoutError('synthetic key provider result lost')
        self.signer.sign = uncertain
        result = self.post('partner', 'operations/'+op+'/dispatch')
        self.assertEqual(result['state'], 'UNKNOWN')
        self.signer = Signer(BusinessService(self.b), uncertain, lambda *_: self.fail('must not broadcast'), 's'*43)
        result = self.post('partner', 'operations/'+op+'/dispatch')
        self.assertEqual(len(attempts), 1)
        reservation = self.store.one('SELECT * FROM cp28_signing WHERE operation_id=?', (op,))
        self.assertEqual(reservation['state'], 'UNKNOWN')
        self.assertGreater(int(reservation['fee_reserved']), 0)
        self.assertIsNotNone(reservation['nonce'])
        self.b.runtime.plan['expiresAt'] = self.now-1
        # Expired execution authority must not stop original operation reads.
        observed = self.post('partner', 'operations/'+op+'/observe')
        self.assertEqual(observed['state'], 'UNKNOWN')

    def test_ipc_rejects_arbitrary_payload_and_role_before_key_use(self):
        from server.contracts import ApiError
        for request in ({'version': 1, 'operationId': 'x', 'capability': 'wrong'},
                        {'version': 1, 'operationId': 'x', 'capability': 's'*43, 'data': '0xdeadbeef'}):
            with self.assertRaises(ApiError): self.signer.handle(request)
        op = self.prepare_issue()
        self.store.execute("UPDATE cp28_mapping SET enabled=0 WHERE actor_id='partner'")
        with self.assertRaises(ApiError): self.signer.handle({'version': 1, 'operationId': op, 'capability': 's'*43})
        self.assertEqual(self.signs, [])

    def test_modified_review_nonce_cannot_reach_signing(self):
        from server.chain.client import ChainConflict
        op = self.prepare_issue(); service = BusinessService(self.b)
        review = service.review(op)
        review['transaction']['nonce'] += 1
        with self.assertRaises(ChainConflict): service.start(review, service=True)
        self.assertIsNone(self.store.one('SELECT * FROM cp28_signing WHERE operation_id=?', (op,)))


if __name__ == '__main__': unittest.main()
