"""Durable policy/ledger and actual codec facets for the private business domain.

No signing, RPC or runtime is started at import. Approved originals/grants are
private authority records; this host never accepts approval fields from browsers.
"""
from contextlib import contextmanager
from copy import deepcopy
import importlib
import json
import sys
import types
from .onboarding_adapter import ROOT,NODE,IntegrationRejected

def business_modules():
    name='c1_business_integration'
    if name not in sys.modules:
        package=types.ModuleType(name);package.__path__=[str(ROOT/'integrations/business')];sys.modules[name]=package
    return {item:importlib.import_module(name+'.'+item) for item in ('codec','transaction_crypto','private_runtime','observer')}

class RuntimeCodec:
    transaction_codec_protocol='CP30_CANONICAL_SIGNED_TRANSACTION_V1'
    def __init__(self):
        modules=business_modules();self.business=importlib.import_module('c1_business_integration.catalog_codec').ExtendedBusinessCodec(NODE);self.crypto=modules['transaction_crypto'].TransactionCrypto(NODE)
    def prepare_quote(self,record,now):return self.business.call('prepareFundingQuote',{'binding':record['binding'],'quote':record['quote'],'now':str(now)})
    def verify_quote_signature(self,record,prepared,signature):
        try:
            actual=self.business.call('attachFundingSignature',{'binding':record['binding'],'quote':prepared['quote'],'signature':signature,'now':'0'})
            return actual['signature'].lower()==signature.lower()
        except ValueError:return False
    def prepare_operation(self,record,method,now):
        role='catalogAuthority' if record['operation'] in {'publish','setListed'} else 'issuerAuthority' if record['operation']=='issue' else 'operatorAuthority'
        return self.business.call(method,{'binding':record['binding'],'caller':record['binding'][role],'parameters':record['parameters'],'now':str(now)})
    def verify_signed_transaction(self,record,raw):
        plan=record['transaction'];cost=int(plan['gas'])*int(plan['maxFeePerGas'])
        return self.crypto.verify_signed_transaction(record,raw,gas_budget_wei=str(cost))

class PrivateOriginalSignerClient:
    original_signer_protocol='CP30_ORIGINAL_SIGNER_V1'
    def __init__(self,ipc,namespace):self.ipc,self.namespace=ipc,namespace
    def _call(self,operation,record,prepared=None):
        response=self.ipc.call(self.namespace,operation,{'record':record,**({'prepared':prepared} if prepared is not None else {})})
        if response.get('error'):raise IntegrationRejected('ORIGINAL_SIGNER_UNAVAILABLE',503)
        return response.get('signature' if 'quote' in operation else 'raw')
    def sign_original_quote(self,record,prepared):return self._call('sign_original_quote',record,prepared)
    def lookup_original_quote(self,record):return self._call('lookup_original_quote',record)
    def sign_original_transaction(self,record):return self._call('sign_original_transaction',record)
    def lookup_original_transaction(self,record):return self._call('lookup_original_transaction',record)

def build_private_runtime(database,namespace,*,signer,broadcaster,role,clock,controller):
    from .registration_runtime_host import persistence_module
    module=persistence_module()
    return business_modules()['private_runtime'].PrivateBusinessRuntime(policy=module.PgRuntimePolicy(),
        ledger=module.PgRuntimeLedger(database,namespace,controller),signer=signer,broadcaster=broadcaster,
        codec=RuntimeCodec(),clock=clock,expected_role=role)
