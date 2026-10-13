"""Restricted observer: validate authority originals then apply ingested IDs only."""
from __future__ import annotations
import argparse
from .faults import hit
from .content import verify_original
import copy
import json
import hashlib
from pathlib import Path
import signal
import threading
from .model import ModelError, accounting, digest, require, transition

RECEIPT_FIELDS = {'receipt_id','scope','source_epoch','height','block_hash','parent','now',
                  'complete_to','tx_index','logs','operation','transition','final'}

class ReceiptValidator:
    def __init__(self, manifest, *, height=0, parent='0'*64, source_epoch=1, clock_floor=0, service_floor=None, accepted=None, manifests=None):
        self.manifest=copy.deepcopy(manifest)
        self.manifests={item['store_id']:copy.deepcopy(item) for item in (manifests or {'single':manifest}).values()}
        self.height,self.parent,self.source_epoch,self.clock_floor=height,parent,source_epoch,clock_floor
        self.service_floor=clock_floor if service_floor is None else service_floor
        self.accepted=copy.deepcopy(accepted or {})
        self.buffer={}
        self.halted=False

    def validate(self, receipt, *, now, original=None):
        try:
            require(not self.halted, 'OBSERVER_HALTED')
            require(type(receipt) is dict and set(receipt)==RECEIPT_FIELDS, 'INVALID_ENVELOPE')
            manifest=self.manifests.get(receipt['scope'].get('store_id')) if type(receipt['scope']) is dict else None
            require(manifest is not None and receipt['scope']==manifest and receipt['source_epoch']==self.source_epoch, 'WRONG_SCOPE')
            require(type(now) is int and now>=self.service_floor, 'CLOCK_ROLLBACK')
            self.service_floor=now
            require(type(receipt['now']) is int and 0<=receipt['now']<=now+2, 'SOURCE_CLOCK')
            require(receipt['final'] is True and type(receipt['height']) is int and receipt['height']>0, 'NOT_FINAL')
            require(type(receipt['complete_to']) is int and receipt['complete_to']>=receipt['height'], 'INCOMPLETE_BLOCK')
            require(receipt['tx_index']==0 and type(receipt['tx_index']) is int, 'TRANSACTION_ORDER')
            require(type(receipt['logs']) is list and len(receipt['logs'])<=30, 'EVENT_BOUND')
            require(all(type(log) is dict and set(log)=={'log_index','event'} and type(log['log_index']) is int and log['log_index']==i for i,log in enumerate(receipt['logs'])), 'LOG_ORDER')
            value=receipt['transition']
            require(type(value) is dict and value['operation']==receipt['operation'], 'OPERATION_MISMATCH')
            if original is not None:
                require({k:original[k] for k in ('op_id','kind','caller','payload')}==receipt['operation'], 'ORIGINAL_MISMATCH')
                require(original['payload_hash']==value['payload_hash'], 'PAYLOAD_MISMATCH')
            before=value['before']
            require(before['manifest']==manifest and before['source_epoch']==self.source_epoch, 'WRONG_SCOPE')
            require(before['height']+1==receipt['height'] and before['parent']==receipt['parent'] and before['now']==receipt['now'], 'BLOCK_MISMATCH')
            expected=transition(before,receipt['operation'],commitments={'payload_hash':value['payload_hash']})
            require(not expected['noop'] and expected==value, 'TRANSITION_MISMATCH')
            require(value['after']['parent']==receipt['block_hash'] and value['t0']==receipt['now'], 'BLOCK_MISMATCH')
            require([log['event'] for log in receipt['logs']]==expected['events'], 'EVENT_MISMATCH')
            accounting(value['before']);accounting(value['after'])
            encoded=digest(receipt)
            opkey=('fund:'+receipt['operation']['payload']['quote_id']) if receipt['operation']['kind']=='fund' else ('op:'+receipt['operation']['op_id'])
            prior=self.accepted.get(opkey)
            if prior:
                require(prior==encoded,'FINAL_CONFLICT')
                return 'NOOP'
            require(receipt['now']>=self.clock_floor,'SOURCE_CLOCK')
            require(receipt['height']>self.height,'LOW_WATERMARK')
            if receipt['height']>self.height+1:
                require(len(self.buffer)<1000 or receipt['height'] in self.buffer,'BUFFER_LIMIT')
                existing=self.buffer.get(receipt['height'])
                require(existing is None or existing==receipt,'FINAL_CONFLICT')
                self.buffer[receipt['height']]=copy.deepcopy(receipt)
                return 'GAP'
            require(receipt['parent']==self.parent, 'PARENT_CONFLICT')
            return 'VALID'
        except (ModelError,KeyError,TypeError,ValueError):
            self.halted=True
            raise

    def advance(self, receipt):
        # Only after the restricted business apply committed, never on candidate validation.
        require(receipt['height']==self.height+1 and receipt['parent']==self.parent,'WATERMARK_CAS')
        opkey=('fund:'+receipt['operation']['payload']['quote_id']) if receipt['operation']['kind']=='fund' else ('op:'+receipt['operation']['op_id'])
        self.accepted[opkey]=digest(receipt)
        self.height,self.parent,self.clock_floor=receipt['height'],receipt['block_hash'],receipt['now']
        self.buffer.pop(self.height,None)

class Reconciler:
    def __init__(self,business,authority,validator,config=None):
        self.business,self.authority,self.validator=business,authority,validator
        self.stopped=threading.Event();self.config=config

    def step(self,namespace):
        state=self.business.call('observer_status',namespace,{})
        if state.get('error') or (state.get('halted') and not state.get('rebuilding')): return state
        pending=self.business.call('receipt_list',namespace,{'limit':50})
        if pending.get('error'): return pending
        outcomes=[]
        for item in pending.get('receipts',[]):
            receipt_id=item['receipt_id']
            original=self.authority.call('receipt_get',namespace,{'receipt_id':receipt_id})
            if original.get('error') or not original.get('receipt'):
                # Absence never proves an unexecuted original or permits rights release.
                return {'status':'UNKNOWN'}
            receipt=original['receipt']
            try:
                candidate=self.business.call('receipt_list',namespace,{'receipt_id':receipt_id})
                require(candidate.get('receipt')==receipt,'CANDIDATE_ORIGINAL_MISMATCH')
                status=self.validator.validate(receipt,now=state['now'],original=original.get('ticket'))
            except (ModelError,KeyError,TypeError,ValueError):
                # The fixed method only records halt; it never accepts browser success fields.
                self.business.call('observer_status',namespace,{'halt':True,'reason':'INVALID_RECEIPT'})
                return {'status':'HALTED'}
            if status=='GAP': continue
            if self.config:
                verified=verify_original(self.business,namespace,{'purpose':'receipt','receipt_id':receipt_id},self.config['run'])
                if verified.get('error'):return verified
            hit(self.config,'before_apply',namespace,receipt_id)
            result=self.business.call('apply_receipt',namespace,{'receipt_id':receipt_id})
            if result.get('error'): return result
            hit(self.config,'apply_committed',namespace,receipt_id)
            if status=='VALID': self.validator.advance(receipt)
            outcomes.append({'receipt_id':receipt_id,'status':status})
        return {'status':'OK','results':outcomes}

    def run(self,namespace):
        while not self.stopped.is_set():
            try: self.step(namespace)
            except Exception: pass
            self.stopped.wait(0.1)

def main():
    from .db import Database
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True)
    config=json.loads(open(parser.parse_args().config).read())
    if config.get('mode')!='C1_SYNTHETIC_LOOPBACK':raise SystemExit('SYNTHETIC_MODE_REQUIRED')
    business=Database(config,'reconciler','business',max_size=1)
    authority=Database(config,'reconciler_authority','authority',max_size=1)
    def active_namespace():
        return Path(config['scope_file']).read_text().strip() if config.get('scope_file') else config['namespace']
    def validator_for(namespace):
        status=business.call('observer_status',namespace,{})
        manifests={store:{**manifest,'namespace':namespace} for store,manifest in config['manifests'].items()}
        for manifest in manifests.values():
            manifest.pop('config_digest',None)
            manifest['config_digest']=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()
        require(status.get('manifest',{}).get('stores')==manifests,'WRONG_SCOPE')
        validator=ReceiptValidator(next(iter(manifests.values())),height=status['height'],parent=status['parent'],source_epoch=status['source_epoch'],service_floor=status['clock_floor'],manifests=manifests)
        # Reconstruct replay commitments only from retained immutable authority originals.
        checker=ReceiptValidator(next(iter(manifests.values())),manifests=manifests,source_epoch=status['source_epoch'])
        while checker.height<status['height']:
            page=business.call('receipt_list',namespace,{'applied':True,'after':checker.height,'snapshot':status['height'],'limit':50})
            require(not page.get('error') and 0<len(page.get('receipts',[]))<=50,'ORIGINAL_HISTORY_GAP')
            for item in page['receipts']:
                receipt_id=item['receipt_id']
                original=authority.call('receipt_get',namespace,{'receipt_id':receipt_id})
                receipt=original.get('receipt')
                require(receipt is not None and receipt['height']<=status['height'],'MISSING_ORIGINAL_RECEIPT')
                require(checker.validate(receipt,now=status['now'],original=original['ticket'])=='VALID','ORIGINAL_HISTORY_GAP')
                checker.advance(receipt)
                opkey=('fund:'+receipt['operation']['payload']['quote_id']) if receipt['operation']['kind']=='fund' else ('op:'+receipt['operation']['op_id'])
                require(opkey not in validator.accepted,'ORIGINAL_CONFLICT')
                validator.accepted[opkey]=digest(receipt)
        require(checker.height==status['height'] and checker.parent==status['parent'],'ORIGINAL_HISTORY_MISMATCH')
        validator.clock_floor=checker.clock_floor
        return validator
    namespace=active_namespace()
    service=Reconciler(business,authority,validator_for(namespace),config)
    signal.signal(signal.SIGTERM,lambda *_:service.stopped.set());signal.signal(signal.SIGINT,lambda *_:service.stopped.set())
    try:
        while not service.stopped.is_set():
            current=active_namespace()
            if current!=namespace:
                namespace=current;service.validator=validator_for(namespace)
            service.step(namespace)
            service.stopped.wait(0.1)
    finally:business.close();authority.close()

if __name__=='__main__':main()
