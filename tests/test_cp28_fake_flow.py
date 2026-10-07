"""Production composition over offline 10143 wire data, never LOCAL_POLICY/Anvil."""
import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from eth_account import Account
from eth_account.messages import encode_defunct
from cryptography.fernet import Fernet
from server.backend import canonical, digest, random_id
from server.manual_business.identity import RULE, PRICE
from server.manual_business.policy import MANUAL_POLICY
from server.manual_business.rpc import TestnetRpc
from server.manual_business.store import ManualStore
from server.manual_business.runtime import RuntimeGate
from server.manual_business.backend import ManualBackend
from server.manual_business.auth import TrustedAuthentication
from server.manual_business.service import BusinessService
from server.manual_business.signer import Signer
from server.manual_business.web import create_app
from tests.cp28_fake_chain import Fake10143, hx


class FakeFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cp28-offline10143-'); self.addCleanup(self.temp.cleanup)
        self.now = int(time.time()); self.origin = getattr(self, 'fixture_origin', 'http://127.0.0.1:15287')
        # Fresh ephemeral synthetic keys, no files/key provider/user wallet read.
        self.accounts = {r: Account.create() for r in ('admin', 'supporter', 'merchant', 'issuer', 'operator')}
        participants = {r: a.address for r, a in self.accounts.items()}
        self.fake = Fake10143(participants); d = self.fake.deployment
        self.rpc = TestnetRpc(d, participants, self.fake)
        self.config = {**{k: d[k] for k in ('runId', 'chainId', 'genesisHash', 'deploymentId', 'contractAddress')},
                       'origin': self.origin, 'participants': participants,
                       'trustedSubjects': {r: {'actorId': r, 'revision': 1} for r in ('partner', 'owner')}}
        self.plan = {'version': 1, **{k: self.config[k] for k in ('runId', 'chainId', 'genesisHash', 'deploymentId', 'participants')},
                     'configDigest': digest(canonical(self.config)), 'expiresAt': self.now+3600,
                     'totalValueWei': PRICE, 'totalFeeWei': 10**17,
                     'actions': {k: {'count': 1, 'gas': 500000, 'maxFeePerGas': 2*10**9, 'maxPriorityFeePerGas': 10**9,
                                     'value': PRICE if k == 'fund' else 0} for k in ('fund', 'issue', 'lock', 'report', 'settle')}}
        self.plan['actions']['proof'] = {'count': 1, 'gas': 0, 'maxFeePerGas': 0, 'maxPriorityFeePerGas': 0, 'value': 0}
        self.store = ManualStore(Path(self.temp.name)/'business.db', self.config, create=True)
        self.runtime = RuntimeGate(self.store, self.config, self.plan, clock=lambda: self.now)
        self.b = ManualBackend(self.store, self.rpc, Fernet.generate_key(), self.runtime, lambda: self.now)
        self.assertIs(self.b.policy, MANUAL_POLICY)
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
            role = 'issuer' if tx['from'] == participants['issuer'] else 'operator'
            return Account.sign_transaction(tx, self.accounts[role].key).raw_transaction
        self.signer = Signer(BusinessService(self.b), sign, lambda raw, tx: self.fake.submit(tx, raw), 's'*43)
        auth = TrustedAuthentication(self.b, self.origin, lambda req: req.headers.get('X-Synthetic-Verified-Subject'))
        self.app = create_app(self.config, self.b, authentication=auth,
                              dispatch=lambda op: self.signer.handle({'version': 1, 'operationId': op, 'capability': 's'*43}))
        self.clients = {r: self.app.test_client() for r in ('support', 'partner', 'recipient', 'owner')}
        self.csrf = {}; self.terminal = ''
        for role in ('partner', 'owner'):
            self.csrf[role] = self.post(role, role+'/login', extra={'X-Synthetic-Verified-Subject': role})['csrfToken']

    def post(self, role, path, body=None, expected=200, extra=None):
        response = self.clients[role].post('/api/cp28/'+path, json=body or {}, base_url=self.origin,
            headers={'Origin': self.origin, 'X-CSRF-Token': self.csrf.get(role, ''), 'X-Terminal-Cap': self.terminal, **(extra or {})})
        self.assertEqual(response.status_code, expected, response.get_data(as_text=True))
        return response.get_json()

    def public(self): return self.clients['support'].get('/api/cp28/public', base_url=self.origin).get_json()

    def observe(self, role, op):
        result = self.post(role, 'operations/'+op+'/observe')
        self.assertEqual(result['state'], 'FINALIZED_SUCCESS')
        ledger = self.public(); snapshot = ledger['observation']
        self.assertEqual(snapshot['deploymentId'], self.config['deploymentId'])
        self.assertEqual(snapshot['contract'], self.config['contractAddress'])
        self.assertEqual(snapshot['blockHash'], self.fake.blocks[self.fake.final]['hash'])
        self.assertEqual(snapshot['blockNumber'], self.fake.final)
        self.assertEqual([int(ledger['batch'][k]) for k in ('F', 'A', 'R', 'H', 'S', 'X')], self.fake.amounts[:6])
        self.now += 10
        self.assertEqual(self.public()['observation'], snapshot)
        self.assertEqual(self.public()['sync']['snapshotAgeSeconds'], 10)
        return ledger

    def prepare_fund(self):
        return self.post('support', 'support/prepare', {'clientRequestId': random_id(),
            'account': self.config['participants']['supporter'], 'chainId': 10143, 'quantity': 1,
            'ruleVersion': RULE, 'walletKind': 'metamask'})['operation']['id']

    def submit_user(self, role, op, *, attach_hash=True):
        review = self.post(role, 'operations/'+op+'/review')
        self.assertTrue(self.post(role, 'operations/'+op+'/start')['maySubmit'])
        tx_hash = self.fake.submit(review['transaction'])
        if attach_hash: self.post(role, 'operations/'+op+'/hash', {'txHash': tx_hash})
        return tx_hash

    def prepare_issue(self):
        op = self.prepare_fund(); self.submit_user('support', op); self.observe('support', op)
        return self.post('partner', 'partner/issue', {'intentKey': random_id(), 'recipientRef': 'SYNTHETIC-REF',
            'batchId': self.public()['batch']['id'], 'quantity': 1, 'quotePriceWei': str(PRICE), 'ruleVersion': RULE})['operation']['id']

    def service_transaction(self, role, op):
        self.assertIsNotNone(self.post(role, 'operations/'+op+'/dispatch').get('txHash'))
        before = len(self.signs)
        self.post(role, 'operations/'+op+'/dispatch')
        self.assertEqual(len(self.signs), before)
        self.observe(role, op)

    def test_complete_production_composition_five_steps_and_recipient_recovery(self):
        op = self.prepare_issue(); self.service_transaction('partner', op)
        invitation = self.post('partner', 'partner/invite', {'rotate': False})
        dto = self.post('recipient', 'recipient/exchange', {'secret': invitation['url'].split('/recipient/')[1]})
        self.csrf['recipient'] = dto['csrfToken']; old = self.post('recipient', 'recipient/display')
        self.csrf.pop('recipient')  # browser memory lost; retain only HttpOnly cookie
        response = self.clients['recipient'].get('/api/cp28/recipient/session', base_url=self.origin)
        self.assertEqual(response.status_code, 200); recovered = response.get_json()
        self.assertNotIn('secret', json.dumps(recovered)); self.csrf['recipient'] = recovered['csrfToken']
        display = self.post('recipient', 'recipient/display')
        self.assertNotEqual(old['manualCode'], display['manualCode'])
        challenge = self.post('owner', 'owner/proof/prepare')
        self.assertTrue(self.post('owner', 'owner/proof/start', {'challengeId': challenge['challengeId']})['maySign'])
        sig = hx(Account.sign_message(encode_defunct(text=challenge['message']), self.accounts['merchant'].key).signature)
        self.post('owner', 'owner/proof/verify', {'challengeId': challenge['challengeId'], 'signature': sig})
        self.post('owner', 'owner/precheck', {'code': old['manualCode']}, expected=404)
        self.post('owner', 'owner/precheck', {'code': display['manualCode']})
        lock = self.post('owner', 'owner/lock', {'intentKey': random_id(), 'code': display['manualCode']})
        self.terminal = lock['terminalCap']; self.service_transaction('owner', lock['operation']['id'])
        self.post('owner', 'owner/handoff', {'intentKey': random_id()})
        report = self.post('owner', 'owner/report', {'intentKey': random_id(), 'confirmStatement': True})
        self.service_transaction('owner', report['operation']['id'])
        settle = self.post('owner', 'owner/settle', {'intentKey': random_id()})['operation']['id']
        self.submit_user('owner', settle); ledger = self.observe('owner', settle)
        self.assertEqual(self.fake.amounts, [PRICE, 0, 0, 0, PRICE, 0, 0]); self.assertEqual(len(self.signs), 3)
        self.assertNotIn('SYNTHETIC-REF', json.dumps(ledger))
        self.assertEqual(len(self.store.all("SELECT * FROM cp28_signing WHERE state='FINALIZED_SUCCESS'")), 5)
        self.assertFalse(any(p['method'].startswith('eth_send') for p in self.fake.calls))
        self.assertTrue(all(p['id'] <= 48 for p in self.fake.calls))
        self.assertEqual(self.store.one('SELECT chain_id FROM owner_settlements')['chain_id'], 10143)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.execute('UPDATE owner_settlements SET chain_id=31337')
        resumed = ManualStore(self.store.path, self.config)
        self.assertEqual(resumed.one('SELECT chain_id FROM owner_settlements')['chain_id'], 10143)
        self.assertEqual(resumed.one("SELECT value FROM metadata WHERE key='cp28_public_snapshot'"),
                         self.store.one("SELECT value FROM metadata WHERE key='cp28_public_snapshot'"))

    def test_hashless_original_event_scan_recovers_without_new_signature(self):
        op = self.prepare_fund(); tx_hash = self.submit_user('support', op, attach_hash=False)
        self.observe('support', op)
        self.assertEqual(self.store.one('SELECT tx_hash FROM cp28_signing WHERE operation_id=?', (op,))['tx_hash'], tx_hash)
        self.assertTrue(any(p['method'] == 'eth_getLogs' for p in self.fake.calls))
        self.assertFalse(self.post('support', 'operations/'+op+'/start')['maySubmit'])

    def test_lagging_finality_preserves_snapshot_and_pending_budget(self):
        op = self.prepare_issue(); previous = self.public()
        self.post('partner', 'operations/'+op+'/dispatch'); self.fake.final -= 1
        self.assertEqual(self.post('partner', 'operations/'+op+'/observe')['state'], 'UNKNOWN')
        current = self.public()
        self.assertEqual(current['batch'], previous['batch']); self.assertEqual(current['observation'], previous['observation'])
        self.assertEqual(current['sync']['state'], 'WAITING_VERIFICATION')
        self.assertGreater(int(self.store.one('SELECT fee_reserved FROM cp28_signing WHERE operation_id=?', (op,))['fee_reserved']), 0)
        self.now += 6; self.fake.final += 1; self.observe('partner', op)

    def test_transaction_receipt_event_accounting_and_final_block_conflicts_halt_atomically(self):
        for mode in ('tx-position', 'event-position', 'event-payload', 'batch', 'liability', 'final-block'):
            with self.subTest(mode=mode):
                if mode != 'tx-position': self.setUp()
                op = self.prepare_issue(); previous = self.public()
                dispatched = self.post('partner', 'operations/'+op+'/dispatch'); tx_hash = dispatched['txHash']
                def fault(method, params, value):
                    if mode == 'tx-position' and method == 'eth_getTransactionByHash': value['transactionIndex'] = '0x9'
                    if mode.startswith('event-') and method == 'eth_getTransactionReceipt':
                        if mode == 'event-position': value['logs'][0]['transactionIndex'] = '0x1'
                        else: value['logs'][0]['topics'][1] = '0x'+'99'*32
                    if mode in ('batch', 'liability') and method == 'eth_call':
                        fn, _ = self.fake.contract.decode_function_input(params[0]['data'])
                        if fn.fn_name == ('getBatch' if mode == 'batch' else 'liability'):
                            from eth_abi import encode
                            value = hx(encode(['uint256']*7, [0]*7)) if mode == 'batch' else hx(encode(['uint256'], [0]))
                    if mode == 'final-block' and method == 'eth_getBlockByNumber' and params[0] == hex(self.fake.final):
                        # First numeric read is canonical receipt; second is end-of-observation recheck.
                        fault.reads += 1
                        if fault.reads == 2: value['hash'] = '0x'+'99'*32
                    return value
                fault.reads = 0; self.fake.fault = fault
                self.post('partner', 'operations/'+op+'/observe', expected=503)
                current = self.public()
                self.assertEqual(current['sync']['state'], 'HALTED')
                self.assertEqual(current['batch'], previous['batch']); self.assertEqual(current['observation'], previous['observation'])
                row = self.store.one('SELECT * FROM cp28_signing WHERE operation_id=?', (op,))
                self.assertNotEqual(row['state'], 'FINALIZED_SUCCESS'); self.assertGreater(int(row['fee_reserved']), 0)
                self.assertIsNone(self.store.one('SELECT * FROM chain_events WHERE tx_hash=?', (tx_hash,)))

    def test_excess_service_role_rejected_before_signing(self):
        op = self.prepare_issue(); self.fake.roles[bytes(32)] = self.config['participants']['issuer'].lower()
        self.post('partner', 'operations/'+op+'/dispatch', expected=403)
        self.assertEqual(self.signs, [])
        self.assertIsNone(self.store.one('SELECT * FROM cp28_signing WHERE operation_id=?', (op,)))


if __name__ == '__main__': unittest.main()
