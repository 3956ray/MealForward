"""Fake signer/codec + owned synthetic response journal only. Never keys/worker/network/PG."""
from copy import deepcopy
import ast
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from business.original_signer import AuthorityOriginalJournal, DedicatedBusinessSigner, OriginalSignerClosed, PROTOCOL


def w(n): return '0x'+f'{n:064x}'
def a(n): return '0x'+f'{n:040x}'


def profile():
    return {'namespace':'private-synthetic','binding':{'chainId':10143,'escrow':a(1),'asset':a(2),'storeId':w(3),'owner':a(4),'receiver':a(4),
             'quoteAuthority':a(5),'catalogAuthority':a(6),'issuerAuthority':a(7),'operatorAuthority':a(8)},
            'escrowCodeHash':w(9),'chainProfileDigest':w(10),'registrar':a(11),
            'maxGas':'100000','maxFeePerGas':'100','maxPriorityFeePerGas':'10','maxTransactionCostWei':'10000000'}


class FakeBusinessCodec:
    def call(self,method,parameters):
        if method=='prepareFundingQuote':
            quote=parameters['quote'];b=parameters['binding']
            return {'quote':deepcopy(quote),'typedData':{'domain':{'name':'MealForward C0 Funding','version':'1','chainId':b['chainId'],'verifyingContract':b['escrow']},'message':deepcopy(quote),'types':{'synthetic':True},'primaryType':'FundingQuote'},'digest':w(20),'payloadHash':w(21),'authority':'PREPARATION_ONLY'}
        if method=='attachFundingSignature': return {'signature':parameters['signature']}
        operation={'prepareIssue':'issue','prepareLock':'lock','prepareMarkHandover':'markHandover','prepareReport':'report'}[method]
        p=parameters['parameters'];b=parameters['binding'];role='issuerAuthority' if operation=='issue' else 'operatorAuthority'
        return {'chainId':b['chainId'],'from':b[role],'to':b['escrow'],'value':'0','data':'0x1234',
                'callDataDigest':w(22),'opId':p['opId'],'parametersHash':w(23),'paramsDigest':w(24),
                'functionName':operation,'expectedRole':role,'args':list(p.values()),'authority':'PREPARATION_ONLY'}


class FakeTransactionCrypto:
    transaction_codec_protocol='CP30_CANONICAL_SIGNED_TRANSACTION_V1'
    def prepare_original_envelope(self,descriptor,approved_plan):
        return {**{k:descriptor[k] for k in ('chainId','from','to','value','data')},**approved_plan}
    def inspect_signed_transaction(self,raw,expected):
        if raw!='0x02aa': raise ValueError('fake raw mismatch')
        return {**expected,'hash':w(50)}


class FakeWorker:
    def __init__(self,journal,fail=False): self.journal=journal;self.calls=0;self.fail=fail
    def _intent(self,record):
        self.calls+=1
        entries=[row for row in self.journal.rows.values() if row['original']['record']==record]
        assert len(entries)==1 and entries[0]['stage']=='SIGNING'
        # Only synthetic journal bytes: prove committed intent exists before injected signing call.
        assert b'"kind":"SIGNING"' in os.pread(self.journal.fd,os.fstat(self.journal.fd).st_size,0)
        if self.fail: raise RuntimeError('private fake worker failure must not leak')
    def sign_quote(self,record,prepared): self._intent(record);return '0x'+'11'*65
    def sign_transaction(self,record,expected): self._intent(record);return {'raw':'0x02aa','hash':w(50)}


def quote_record(p,codec):
    quote={'quoteId':w(30),'payer':a(31),'mealId':w(32),'currentVersion':'1','termsHash':w(33),'quantity':'1','unitPrice':'100','amount':'100','deadline':'200'}
    prepared=codec.call('prepareFundingQuote',{'binding':p['binding'],'quote':quote,'now':'0'})
    return {'namespace':p['namespace'],'binding':p['binding'],'escrowCodeHash':p['escrowCodeHash'],'chainProfileDigest':p['chainProfileDigest'],
            'quoteId':quote['quoteId'],'quote':quote,'typedData':prepared['typedData'],'digest':prepared['digest']},prepared


def operation_record(p,codec,operation='issue',op_id=None):
    method={'issue':'prepareIssue','lock':'prepareLock','markHandover':'prepareMarkHandover','report':'prepareReport'}[operation]
    params={'opId':op_id or w(40),'voucherId':w(41),'generation':'1'}
    if operation=='issue':params={'opId':op_id or w(40),'mealId':w(32),'expectedUnitSeq':'0','expectedNextGeneration':'1','expectedTermsHash':w(33),'deadline':'200'}
    if operation=='lock':params['deadline']='200'
    if operation=='markHandover':params.update(lockId=w(42),deadline='200')
    if operation=='report':params.update(lockId=w(42),markerId=w(43))
    role='issuerAuthority' if operation=='issue' else 'operatorAuthority'
    prepared=codec.call(method,{'binding':p['binding'],'caller':p['binding'][role],'parameters':params,'now':'0'})
    return {'namespace':p['namespace'],'binding':p['binding'],'escrowCodeHash':p['escrowCodeHash'],'chainProfileDigest':p['chainProfileDigest'],
            'operation':operation,'opId':params['opId'],'parameters':params,'deployment':prepared,
            'transaction':{'nonce':'0','gas':'10000','maxFeePerGas':'20','maxPriorityFeePerGas':'1'}}


class OriginalSignerTest(unittest.TestCase):
    def signer(self,journal,worker,clock=lambda:100):
        return DedicatedBusinessSigner(role=journal.role,profile=journal.profile,journal=journal,business_codec=FakeBusinessCodec(),transaction_crypto=FakeTransactionCrypto(),worker=worker,clock=clock)

    def test_quote_intent_retention_and_restart_lookup_do_not_resign(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory,0o700);p=profile();record,prepared=quote_record(p,FakeBusinessCodec())
            j=AuthorityOriginalJournal(directory,role='quoteAuthority',profile=p,initialize=True);worker=FakeWorker(j);signer=self.signer(j,worker)
            signature=signer.sign_original_quote(record,prepared)
            self.assertEqual(signer.sign_original_quote(record,prepared),signature);self.assertEqual(worker.calls,1)
            j.close();j.close()
            reopened=AuthorityOriginalJournal(directory,role='quoteAuthority',profile=p)
            other=FakeWorker(reopened);lookup=self.signer(reopened,other,clock=lambda:300)
            self.assertEqual(lookup.lookup_original_quote(record),signature)
            self.assertEqual(lookup.sign_original_quote(record,prepared),signature);self.assertEqual(other.calls,0)
            changed=deepcopy(record);changed['quote']['deadline']='400'
            with self.assertRaises(OriginalSignerClosed): lookup.lookup_original_quote(changed)
            reopened.close()

    def test_transaction_retained_raw_and_nonce_scope_original_only(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory,0o700);p=profile();record=operation_record(p,FakeBusinessCodec())
            j=AuthorityOriginalJournal(directory,role='issuerAuthority',profile=p,initialize=True);worker=FakeWorker(j);signer=self.signer(j,worker)
            self.assertEqual(signer.sign_original_transaction(record),'0x02aa')
            self.assertEqual(signer.lookup_original_transaction(record),'0x02aa');self.assertEqual(worker.calls,1)
            with self.assertRaisesRegex(OriginalSignerClosed,'SIGNER_NONCE_CONFLICT'): signer.sign_original_transaction(operation_record(p,FakeBusinessCodec(),op_id=w(44)))
            j.close()

    def test_uncertain_attempt_lookup_never_worker_and_forbidden_roles_methods(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory,0o700);p=profile();record=operation_record(p,FakeBusinessCodec(),'lock')
            j=AuthorityOriginalJournal(directory,role='operatorAuthority',profile=p,initialize=True);worker=FakeWorker(j,fail=True);signer=self.signer(j,worker)
            with self.assertRaisesRegex(OriginalSignerClosed,'^ORIGINAL_SIGNING_UNKNOWN$'): signer.sign_original_transaction(record)
            self.assertIsNone(signer.lookup_original_transaction(record))
            with self.assertRaisesRegex(OriginalSignerClosed,'^ORIGINAL_SIGNING_UNKNOWN$'): signer.sign_original_transaction(record)
            self.assertEqual(worker.calls,1)
            for operation in ('fund','settle','createStore'):
                with self.assertRaisesRegex(OriginalSignerClosed,'PRIVATE_SIGNER_OPERATION_FORBIDDEN'): signer.sign_original_transaction({**record,'operation':operation})
            j.close()
            with self.assertRaises(OriginalSignerClosed): AuthorityOriginalJournal(directory,role='owner',profile=p)

    def test_production_worker_is_only_source_and_fixed_fd_protocol(self):
        root=Path(__file__).resolve().parent
        ast.parse((root/'original_signer.py').read_text())
        code=(root/'original-signer-worker.mjs').read_text()
        self.assertIn("['quoteAuthority','issuerAuthority','operatorAuthority','catalogAuthority']",code)
        self.assertIn('privateKeyToAccount',code);self.assertIn('readSync(Number(process.argv[2])',code)
        self.assertNotIn('sign_original_transaction',code)  # No runtime IPC/dispatch execution API inside Node worker.
        self.assertNotIn('sendTransaction',code);self.assertNotIn('createWalletClient',code)
        self.assertEqual(DedicatedBusinessSigner.original_signer_protocol,PROTOCOL)


if __name__=='__main__': unittest.main()
