"""Pure codec plus fake signing/transport; never keys, real runtime or RPC."""
import os,tempfile,unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock,patch
from business.catalog_codec import ExtendedBusinessCodec
from business.original_signer import AuthorityOriginalJournal,DedicatedBusinessSigner,OriginalSignerClosed
from business.private_runtime import PrivateBusinessRuntime,RuntimeRejected
from test_original_signer import profile,FakeTransactionCrypto,FakeWorker,w
from test_private_runtime import StubLedger,StubPolicy,StubCodec,StubSigner,StubBroadcaster
NODE='/Users/mili/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'

def record(operation):
    p=profile();codec=ExtendedBusinessCodec(NODE)
    terms={'mealId':w(80),'version':'1','unitPrice':'500000','bodyDigest':w(81),'imageDigest':w(82),'windowCount':'1','startMinute0':'0','endMinute0':'420','startMinute1':'0','endMinute1':'0'}
    params={'opId':w(40),'expectedControlRevision':'0',**({'input':terms} if operation=='publish' else {'mealId':w(80),'value':True})}
    prepared=codec.call('preparePublish' if operation=='publish' else 'prepareSetListed',{'binding':p['binding'],'caller':p['binding']['catalogAuthority'],'parameters':params})
    return {**{k:p[k] for k in ('namespace','binding','escrowCodeHash','chainProfileDigest')},'operation':operation,'opId':params['opId'],'parameters':params,'deployment':prepared,'transaction':{'nonce':'0','gas':'10','maxFeePerGas':'10','maxPriorityFeePerGas':'1'}}

class CatalogRuntimeTest(unittest.TestCase):
    def test_catalog_signer_retains_original_and_rejects_other_role(self):
        for operation in ('publish','setListed'):
            original=record(operation)
            with tempfile.TemporaryDirectory() as directory:
                os.chmod(directory,0o700)
                j=AuthorityOriginalJournal(directory,role='catalogAuthority',profile=profile(),initialize=True)
                try:
                    worker=FakeWorker(j)
                    signer=DedicatedBusinessSigner(role='catalogAuthority',profile=profile(),journal=j,business_codec=ExtendedBusinessCodec(NODE),transaction_crypto=FakeTransactionCrypto(),worker=worker,clock=lambda:100)
                    self.assertEqual(signer.sign_original_transaction(original),'0x02aa')
                    self.assertEqual(signer.sign_original_transaction(original),'0x02aa')
                    self.assertEqual(signer.lookup_original_transaction(original),'0x02aa');self.assertEqual(worker.calls,1)
                    with self.assertRaisesRegex(OriginalSignerClosed,'PRIVATE_SIGNER_OPERATION_FORBIDDEN'):signer.sign_original_transaction({**original,'operation':'issue'})
                finally:j.close()
    def test_catalog_runtime_reserves_once_recovers_unknown_without_resending(self):
        for operation in ('publish','setListed'):
            original=record(operation);ledger=StubLedger();policy=StubPolicy(original);signer=StubSigner(ledger);broadcaster=StubBroadcaster(ledger)
            runtime=PrivateBusinessRuntime(policy=policy,ledger=ledger,signer=signer,broadcaster=broadcaster,codec=StubCodec(ledger),clock=lambda:100,expected_role='catalogAuthority')
            broadcaster.fail_response=True
            with self.assertRaises(RuntimeError):runtime.send_original(original)
            self.assertEqual(runtime.lookup_original(original),w(80));self.assertEqual(runtime.send_original(original),w(80))
            self.assertEqual((signer.tx_count,broadcaster.count,ledger.signature_spent,ledger.gas_spent),(1,1,1,100))
            other=PrivateBusinessRuntime(policy=policy,ledger=ledger,signer=signer,broadcaster=broadcaster,codec=StubCodec(ledger),clock=lambda:100,expected_role='issuerAuthority')
            with self.assertRaisesRegex(RuntimeRejected,'PRIVATE_OPERATION_FORBIDDEN'):other.send_original(original)
    def test_optional_activation_keeps_original_hosts_when_unavailable(self):
        from c1.automatic_business import AutomaticBusiness
        p=profile();source={'grantId':'catalog-grant','runtimeRole':'runtime','db':{'runtime':{'user':'c1_business_catalog_login'}}}
        compose=Mock(return_value=(object(),[]));journal=SimpleNamespace(original={'profiles':[{'profile':p}]})
        app=AutomaticBusiness({'services':{'catalogAuthority':source}},None,journal,compose_host=compose,signer_leaf=object())
        app.hosts={'issuerAuthority':object()};original=app.hosts.copy();app.fixed=Mock(return_value={})
        app._activate_catalog();self.assertEqual(app.hosts,original);compose.assert_not_called()
        app.fixed.return_value={'catalogActivation':{'grantId':'catalog-grant','profile':p}}
        app._activate_catalog();compose.assert_not_called()
        app._catalog_attempt=None;app._activate_catalog();compose.assert_called_once_with({**source,'profile':p})
        self.assertIs(app.hosts['issuerAuthority'],original['issuerAuthority']);app._activate_catalog();self.assertEqual(compose.call_count,1)
        broken=AutomaticBusiness({'services':{'catalogAuthority':source}},None,journal,compose_host=Mock(side_effect=ValueError('missing journal')),signer_leaf=object())
        broken.hosts=original.copy();broken.fixed=app.fixed;broken._activate_catalog();self.assertEqual(broken.hosts,original)

if __name__=='__main__':unittest.main()
