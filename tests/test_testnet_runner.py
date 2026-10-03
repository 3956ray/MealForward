"""CP19 isolated EVM + injected faults. No public RPC or actual CP19 keys used."""
import copy
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from eth_account import Account
import requests
from scripts.testnet.rpc import ROOT, Stop
from scripts.testnet.journal import Journal, atomic, digest
from scripts.testnet.plan import MAX_FEE, FEE_CAP, source_digest
from scripts.testnet.runner import Runner


class LocalRpc:
    """Explicit test adapter; local Anvil is NOT Monad execution/finality evidence."""
    def __init__(self,url):
        self.url=url;self.session=requests.Session();self.session.trust_env=False
        self.sent=0;self.drop_send=False;self.hide_receipts=False;self.no_finality=False;self.finality_height=None
        self.hidden_hash=None;self.receipt_edit=None;self.tx_edit=None;self.gas_override=None;self.estimate_override=None
    def call(self,method,params):
        if method=='eth_sendRawTransaction': self.sent+=1
        if method=='eth_getTransactionReceipt' and (self.hide_receipts or params[0]==self.hidden_hash): return None
        if method=='eth_getBlockByNumber' and params[0]=='finalized':
            if self.no_finality: return None
            params=['latest' if self.finality_height is None else hex(self.finality_height),False] # Explicit test model.
        if method=='eth_estimateGas' and self.estimate_override is not None: return hex(self.estimate_override)
        r=self.session.post(self.url,json={'jsonrpc':'2.0','id':1,'method':method,'params':params},timeout=5).json()
        if 'error' in r: raise Stop('RPC_REJECTED')
        result=r['result']
        if method=='eth_sendRawTransaction' and self.drop_send: raise Stop('RPC_UNAVAILABLE')
        if method=='eth_getTransactionReceipt' and result and self.receipt_edit: result=self.receipt_edit(result)
        if method=='eth_getTransactionByHash' and result and self.tx_edit: result=self.tx_edit(result)
        if method=='eth_getBlockByNumber' and result and self.gas_override: result['baseFeePerGas']=hex(self.gas_override)
        return result
    def guard(self,genesis):
        if self.call('eth_chainId',[])!='0x279f': raise Stop('WRONG_CHAIN')
        if self.call('eth_getBlockByNumber',['0x0',False])['hash']!=genesis: raise Stop('GENESIS_CHANGED')
    def mine(self,n=4):
        for _ in range(n): self.call('evm_mine',[])


class TestnetRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        listener=socket.socket();listener.bind(('127.0.0.1',0));port=listener.getsockname()[1];listener.close()
        cls.process=subprocess.Popen([str(ROOT/'node_modules/.bin/anvil'),'--port',str(port),'--host','127.0.0.1',
                                      '--chain-id','10143','--accounts','0','--base-fee','100000000000'],
                                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.url=f'http://127.0.0.1:{port}'
        probe=LocalRpc(cls.url)
        for _ in range(100):
            try: probe.call('eth_chainId',[]);break
            except Exception: time.sleep(.05)
        else: cls.process.terminate();raise RuntimeError('isolated Anvil did not start')
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate();cls.process.wait(timeout=5)
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.directory=Path(self.temp.name);self.directory.chmod(0o700)
        self.rpc=LocalRpc(self.url)
        self.keys={role:Account.create() for role in ('deployer','supporter','operator','owner')}
        self.addresses={role:account.address for role,account in self.keys.items()}
        self.rpc.call('anvil_setBalance',[self.addresses['deployer'],hex(5*10**18)])
        self.genesis=self.rpc.call('eth_getBlockByNumber',['0x0',False])['hash']
        self.runner=Runner(self.rpc,Journal(self.directory))
        self.hash=self.runner.prepare(self.addresses,self.genesis)['planHash']
    def load(self,role): return self.keys[role]
    def execute(self,owner=False):
        try: return self.runner.execute(self.hash,self.load,owner=owner)
        except Stop as error:
            if str(error)!='WAIT_EXECUTION_DELAY': raise
            self.rpc.mine();return self.runner.execute(self.hash,self.load,owner=owner)
    def state(self): return self.runner.journal.load()

    def test_full_isolated_flow_and_accounting(self):
        for index in range(13):
            result=self.execute(owner=index==12)
            self.assertEqual(self.rpc.sent,index+1)
            self.rpc.mine();self.runner.reconcile()
        # Generic Anvil charges gasUsed, so Monad fee-vs-balance check must refuse to pretend equivalence.
        with self.assertRaisesRegex(Stop,'BALANCE_RECONCILIATION_REQUIRED'): self.runner.verify()
        from scripts.testnet.verify import read
        p=self.state()['plan']
        self.assertEqual(read(self.rpc,p['contractAddress'],'getBatch',[p['batchId']],['uint256']*7)[:5],(10**15,0,0,0,10**15))
        self.assertEqual(read(self.rpc,p['contractAddress'],'liability',[],['uint256']),(0,))
        self.assertEqual(self.state()['records']['settle']['state'],'FINALIZED')
        self.assertEqual(len(self.state()['records']),13)
        self.assertEqual(result['chainId'],10143)

    def test_accepted_send_loses_response_reconcile_never_rebroadcast(self):
        self.rpc.drop_send=True
        self.execute();record=self.state()['records']['gas-supporter']
        self.assertEqual(record['state'],'UNKNOWN');self.assertEqual(self.rpc.sent,1)
        self.rpc.mine();self.runner.reconcile();self.runner.reconcile()
        self.assertEqual(self.rpc.sent,1)
        self.assertEqual(self.state()['records']['gas-supporter']['state'],'FINALIZED')

    def test_signed_before_send_crash_restart_only_queries(self):
        original=self.runner.journal.save
        def crash(data):
            original(data)
            if data['records'].get('gas-supporter',{}).get('state')=='SIGNED': raise Stop('CRASH')
        with patch.object(self.runner.journal,'save',side_effect=crash),self.assertRaisesRegex(Stop,'CRASH'):
            self.execute()
        self.assertEqual(self.rpc.sent,0)
        self.runner.reconcile()
        with self.assertRaisesRegex(Stop,'UNKNOWN_ONLY_RECONCILE'): self.execute()
        self.assertEqual(self.rpc.sent,0)

    def test_signing_boundary_crash_never_resigns(self):
        account=self.keys['deployer']
        with patch.object(account,'sign_transaction',side_effect=RuntimeError('SYNTHETIC_SECRET')),self.assertRaises(RuntimeError):
            self.execute()
        self.assertEqual(self.rpc.sent,0)
        with self.assertRaisesRegex(Stop,'SIGNING_UNKNOWN'): self.runner.reconcile()
        with self.assertRaisesRegex(Stop,'SIGNING_UNKNOWN'): self.execute()

    def test_null_pending_keeps_fee_reservation_and_original_nonce(self):
        self.execute();self.rpc.hide_receipts=True
        self.runner.reconcile()
        with self.assertRaisesRegex(Stop,'UNKNOWN_ONLY_RECONCILE'): self.execute()
        self.assertEqual(self.rpc.sent,1)
        data=self.state();record=data['records']['gas-supporter']
        expected=record['tx']['gas']*record['tx']['maxFeePerGas']+sum(s['gasCap']*MAX_FEE for s in data['plan']['steps'][1:])
        self.assertEqual(self.runner.budget(data),expected)

    def test_plan_hash_and_budget_rejected_before_sign(self):
        with self.assertRaisesRegex(Stop,'REVIEWED_PLAN_REQUIRED'): self.runner.execute('wrong',self.load)
        data=self.state();data['plan']['steps'][0]['gasCap']=100000000
        with self.assertRaisesRegex(Stop,'BUDGET_EXCEEDED'): self.runner.budget(data)
        self.assertEqual(self.rpc.sent,0)

    def test_run_lock_prevents_parallel_client(self):
        with self.runner.journal.locked(),self.assertRaisesRegex(Stop,'RUN_IN_PROGRESS'): self.runner.reconcile()
        self.assertEqual(self.rpc.sent,0)

    def test_finality_missing_and_finalized_receipt_disappearance(self):
        self.execute();self.rpc.no_finality=True
        with self.assertRaisesRegex(Stop,'FINALITY_UNAVAILABLE'): self.runner.reconcile()
        self.assertEqual(self.state()['records']['gas-supporter']['state'],'UNKNOWN')
        self.rpc.no_finality=False;self.runner.reconcile();self.rpc.hide_receipts=True
        with self.assertRaisesRegex(Stop,'FINALITY_CONFLICT'): self.runner.reconcile()
        self.assertEqual(self.rpc.sent,1)

    def test_canonical_conflict_and_transaction_mismatch(self):
        self.execute()
        self.rpc.receipt_edit=lambda r:{**r,'blockHash':'0x'+'00'*32}
        with self.assertRaisesRegex(Stop,'FINALITY_CONFLICT'): self.runner.reconcile()
        self.rpc.receipt_edit=None
        with self.assertRaisesRegex(Stop,'RUN_HALTED'): self.runner.reconcile()
        self.assertEqual(self.rpc.sent,1)

    def test_nonfinal_receipt_can_disappear_without_completion(self):
        before=int(self.rpc.call('eth_getBlockByNumber',['latest',False])['number'],16)
        self.execute();self.rpc.finality_height=before
        self.runner.reconcile()
        self.assertEqual(self.state()['records']['gas-supporter']['state'],'UNKNOWN')
        self.rpc.hide_receipts=True;self.runner.reconcile()
        self.assertEqual(self.rpc.sent,1)
        self.rpc.hide_receipts=False;self.rpc.finality_height=None;self.runner.reconcile()
        self.assertEqual(self.state()['records']['gas-supporter']['state'],'FINALIZED')

    def test_same_hash_reincluded_after_nonfinal_reorg(self):
        snapshot=self.rpc.call('evm_snapshot',[])
        before=int(self.rpc.call('eth_getBlockByNumber',['latest',False])['number'],16)
        self.execute();record=self.state()['records']['gas-supporter']
        original=self.rpc.call('eth_getTransactionReceipt',[record['hash']])
        self.rpc.finality_height=before;self.runner.reconcile()
        self.rpc.call('evm_revert',[snapshot]);self.rpc.mine(6)
        # Test harness alone re-includes original raw to model a changed provisional block.
        # The runner has no rebroadcast API and does not send again.
        self.rpc.call('eth_sendRawTransaction',[record['raw']]);self.rpc.finality_height=None
        self.runner.reconcile();current=self.state()['records']['gas-supporter']['receipt']
        self.assertEqual(current['transactionHash'],record['hash'])
        self.assertNotEqual(current['blockHash'],original['blockHash'])
        self.assertEqual(self.rpc.sent,2)

    def test_pending_grant_presence_does_not_halt_original_hash_recovery(self):
        for _ in range(4):
            self.execute();self.rpc.mine();self.runner.reconcile()
        self.execute()
        self.rpc.hidden_hash=self.state()['records']['grant-supporter']['hash']
        self.runner.reconcile()
        self.assertFalse(self.state()['halted'])
        self.assertEqual(self.state()['records']['grant-supporter']['state'],'UNKNOWN')
        self.rpc.hidden_hash=None;self.runner.reconcile()
        self.assertEqual(self.state()['records']['grant-supporter']['state'],'FINALIZED')

    def test_missing_expected_fund_event_halts(self):
        for _ in range(8):
            self.execute();self.rpc.mine();self.runner.reconcile()
        self.execute()
        self.rpc.receipt_edit=lambda receipt:{**receipt,'logs':[]} if receipt['transactionHash']==self.state()['records']['fund']['hash'] else receipt
        with self.assertRaisesRegex(Stop,'EVENT_CONFLICT'):self.runner.reconcile()
        self.assertTrue(self.state()['halted'])

    def test_missing_journal_cannot_recreate_plan(self):
        self.runner.journal.path.unlink()
        with self.assertRaisesRegex(Stop,'JOURNAL_MISSING'): self.runner.prepare(self.addresses,self.genesis)
        self.assertEqual(self.rpc.sent,0)

    def test_mismatched_tx_and_status_zero_never_advance(self):
        self.execute();self.rpc.tx_edit=lambda tx:{**tx,'value':'0x0'}
        with self.assertRaisesRegex(Stop,'TRANSACTION_CONFLICT'): self.runner.reconcile()
        self.assertTrue(self.state()['halted'])

    def test_status_zero_records_fee_and_stops(self):
        self.execute();self.rpc.receipt_edit=lambda receipt:{**receipt,'status':'0x0'}
        with self.assertRaisesRegex(Stop,'TRANSACTION_FAILED'): self.runner.reconcile()
        record=self.state()['records']['gas-supporter']
        self.assertEqual(record['state'],'FAILED')
        self.assertGreater(int(record['receipt']['feeWei']),0)
        with self.assertRaisesRegex(Stop,'TRANSACTION_FAILED'): self.execute()
        self.assertEqual(self.rpc.sent,1)

    def test_fee_gas_nonce_and_role_boundaries(self):
        self.rpc.gas_override=200*10**9
        with self.assertRaisesRegex(Stop,'FEE_CAP_EXCEEDED'): self.execute()
        self.rpc.gas_override=None;self.rpc.estimate_override=21001
        with self.assertRaisesRegex(Stop,'GAS_CAP_EXCEEDED'): self.execute()
        self.rpc.estimate_override=None
        with self.assertRaisesRegex(Stop,'OWNER_STEP_NOT_READY'): self.execute(owner=True)
        self.rpc.call('anvil_setNonce',[self.addresses['deployer'],'0x1'])
        with self.assertRaisesRegex(Stop,'NONCE_CONFLICT'): self.execute()
        self.assertEqual(self.rpc.sent,0)

    def test_disk_failure_never_sends(self):
        with patch.object(self.runner.journal,'save',side_effect=OSError('disk full')),self.assertRaises(OSError): self.execute()
        self.assertEqual(self.rpc.sent,0)

    def test_plan_is_idempotent_and_public_output_has_no_raw_or_private_key(self):
        self.assertEqual(self.runner.prepare(self.addresses,self.genesis)['planHash'],self.hash)
        self.execute();output=json.dumps(self.runner.public(self.state()))
        self.assertNotIn('raw',output);self.assertNotIn('privateKey',output)
        self.assertNotIn(self.keys['deployer'].key.hex(),output)
        self.assertEqual(self.runner.journal.path.stat().st_mode & 0o777,0o600)
        data=self.state();data['plan']['priceWei']='1';atomic(self.runner.journal.path,data)
        with self.assertRaisesRegex(Stop,'PLAN_CHANGED'): self.runner.reconcile()


if __name__=='__main__': unittest.main()
