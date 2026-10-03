import fcntl
import json
import threading
import time
from collections import deque
from datetime import datetime, timezone
from eth_abi import decode
from .identity import ADDRESS, BATCH, START, MANIFEST, EVENTS, ReadError, block, guard, read, raw, hx, number
from .rpc import ReadRpc


def utc(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

class Synchronizer:
    def __init__(self, store, rpc_factory=ReadRpc, clock=time.monotonic):
        self.store,self.rpc_factory,self.clock=store,rpc_factory,clock
        self.mutex=threading.Lock(); self.active=False; self.ready=False
        self.snapshot_committed=False
        self.started=deque(); self.last_started=None
        self.lease=open(str(store.path)+'.read.lock','a'); self.lease.flush()
        import os
        os.chmod(self.lease.name,0o600)
        try: fcntl.flock(self.lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            self.lease.close(); raise ReadError('READER_ALREADY_RUNNING') from None
    def close(self):
        if self.active: raise RuntimeError('Reader still running')
        self.lease.close()
    def trigger(self):
        with self.mutex:
            now=self.clock()
            if self.active or self.store.state()['halted']: return False
            if self.last_started is not None and now-self.last_started<30: return False
            while self.started and now-self.started[0]>=60: self.started.popleft()
            if len(self.started)>=2: return False
            self.started.append(now); self.last_started=now; self.active=True
            threading.Thread(target=self._background,daemon=True).start()
            return True
    def _background(self):
        try: self.run()
        finally:
            with self.mutex: self.active=False
    def event(self, rpc, log, height, receipts, blocks):
        if not isinstance(log,dict) or log.get('address','').lower()!=ADDRESS.lower() or log.get('removed',False):
            raise ReadError('EVENT_CONFLICT',True)
        topics=log.get('topics',[])
        definition=EVENTS.get(topics[0].lower()) if topics else None
        if not definition: raise ReadError('EVENT_CONFLICT',True)
        inputs=definition['inputs']; indexed=[i for i in inputs if i['indexed']]
        if len(topics)!=1+len(indexed): raise ReadError('EVENT_CONFLICT',True)
        try:
            args={i['name']:decode([i['type']],raw(t))[0] for i,t in zip(indexed,topics[1:])}
            regular=[i for i in inputs if not i['indexed']]
            args.update(zip([i['name'] for i in regular],decode([i['type'] for i in regular],raw(log['data']))))
        except Exception: raise ReadError('EVENT_CONFLICT',True) from None
        kind=definition['name']
        # Only the historical fictional batch/voucher may become product public data.
        if kind in ('Funded','Issued'):
            if hx(args['batchId'])!=BATCH: return None
            if kind=='Issued' and list(args['voucherIds'])!=[raw(MANIFEST['voucherId'])]:
                raise ReadError('HISTORY_CONFLICT',True)
        elif hx(args['voucherId'])!=MANIFEST['voucherId']: return None
        tx=log.get('transactionHash','').lower()
        expected=next(e['transactionHash'] for e in MANIFEST['history'] if e['kind']==kind)
        if tx!=expected: raise ReadError('HISTORY_CONFLICT',True)
        b=number(log['blockNumber']); index=number(log['logIndex']); tx_index=number(log['transactionIndex'])
        if not START<=b<=height: raise ReadError('EVENT_CONFLICT',True)
        if b not in blocks: blocks[b]=block(rpc,hex(b))[1]
        if log['blockHash'].lower()!=blocks[b]: raise ReadError('BLOCK_CONFLICT',True)
        if tx not in receipts: receipts[tx]=rpc.call('eth_getTransactionReceipt',[tx])
        receipt=receipts[tx]
        if (not isinstance(receipt,dict) or number(receipt['status'])!=1 or receipt['transactionHash'].lower()!=tx
            or receipt['blockHash'].lower()!=blocks[b] or number(receipt['blockNumber'])!=b
            or receipt.get('to','').lower()!=ADDRESS.lower() or number(receipt['transactionIndex'])!=tx_index):
            raise ReadError('RECEIPT_CONFLICT',True)
        matches=[l for l in receipt['logs'] if number(l['logIndex'])==index]
        fields=('address','blockNumber','blockHash','transactionHash','transactionIndex','logIndex','topics','data')
        if len(matches)!=1 or any(matches[0].get(k)!=log.get(k) for k in fields):
            raise ReadError('RECEIPT_CONFLICT',True)
        if kind=='Settled' and args['merchant'].lower()!=MANIFEST['merchant'].lower():
            raise ReadError('HISTORY_CONFLICT',True)
        return dict(kind=kind,amountWei=str(args['amount']) if 'amount' in args else None,
                    transactionHash=tx,blockNumber=b,blockHash=blocks[b],logIndex=index,transactionIndex=tx_index,
                    source='CONTROLLED_TEST_CLIENT')
    def run(self):
        rpc=None
        if self.store.state()['halted']: return
        # A budget failure may only preserve VERIFIED after this round commits a snapshot.
        self.snapshot_committed=False
        self.store.attempt(utc())
        try:
            rpc=self.rpc_factory()
            height,bhash=block(rpc,'finalized')
            if height<START: raise ReadError('FINALITY_BEHIND')
            guard(rpc,height)
            state=self.store.state(); previous=json.loads(state['snapshot']) if state['snapshot'] else None
            checkpoints={}
            if previous: checkpoints[previous['source']['blockNumber']]=previous['source']['blockHash']
            if state['cursor_hash']: checkpoints[state['cursor']]=state['cursor_hash']
            if not self.ready:
                for e in self.store.events(): checkpoints[e['blockNumber']]=e['blockHash']
            if any(b>height for b in checkpoints): raise ReadError('FINALITY_BEHIND')
            for b,h in checkpoints.items():
                if block(rpc,hex(b))[1]!=h: raise ReadError('CHECKPOINT_CONFLICT',True)
            amounts=read(rpc,'getBatch',[raw(BATCH)],height)
            liability=read(rpc,'liability',[],height)[0]
            balance=number(rpc.call('eth_getBalance',[ADDRESS,hex(height)]))
            f,a,r,h,s,x,l=amounts
            if f!=a+r+h+s or x or l or f==0 or liability<a+r+h or balance<liability:
                raise ReadError('ACCOUNTING_CONFLICT',True)
            # This fixed historical batch is complete. Changes require investigation, never overwrite from report.
            voucher=read(rpc,'getVoucher',[raw(MANIFEST['voucherId'])],height)
            if voucher[0]!=raw(BATCH) or voucher[1]!=4: raise ReadError('HISTORY_CONFLICT',True)
            if block(rpc,hex(height))[1]!=bhash: raise ReadError('BLOCK_CONFLICT',True)
            self.store.snapshot(dict(amounts={k:str(v) for k,v in zip('FARHS',amounts[:5])},
                contractBalanceWei=str(balance),liabilityWei=str(liability),
                source=dict(chainId=10143,contract=ADDRESS,blockNumber=height,blockHash=bhash,finality='finalized',checkedAt=utc())))
            self.snapshot_committed=True
            self.ready=True
            receipts={}; blocks={height:bhash}
            # Seed only candidate locations from public manifest; independently verify every receipt and log.
            saved={e['kind'] for e in self.store.events()}
            for item in MANIFEST['history']:
                if item['kind'] in saved: continue
                tx=item['transactionHash']; receipt=rpc.call('eth_getTransactionReceipt',[tx]); receipts[tx]=receipt
                if not isinstance(receipt,dict): raise ReadError('RECEIPT_UNAVAILABLE')
                found=[]
                for log in receipt.get('logs',[]):
                    if log.get('address','').lower()==ADDRESS.lower() and log.get('topics',[None])[0] in EVENTS:
                        value=self.event(rpc,log,height,receipts,blocks)
                        if value: found.append(value)
                if len(found)!=1 or found[0]['kind']!=item['kind']: raise ReadError('HISTORY_CONFLICT',True)
                self.store.save_events(found)
            for _ in range(8):
                state=self.store.state(); low=state['cursor']+1
                if low>height: break
                high=min(low+9,height)
                logs=rpc.call('eth_getLogs',[{'address':ADDRESS,'fromBlock':hex(low),'toBlock':hex(high),'topics':[list(EVENTS)]}])
                if not isinstance(logs,list) or len(logs)>200: raise ReadError('RANGE_LIMIT')
                values=[]
                for log in logs:
                    if not low<=number(log['blockNumber'])<=high: raise ReadError('EVENT_CONFLICT',True)
                    value=self.event(rpc,log,height,receipts,blocks)
                    if value: values.append(value)
                page_hash=block(rpc,hex(high))[1]
                self.store.save_events(values,high,page_hash)
        except ReadError as error: self.store.failure(error)
        except Exception: self.store.failure(ReadError('READ_UNAVAILABLE'))
        finally:
            if rpc is not None: rpc.close()
    def view(self):
        state=self.store.state(); snapshot=json.loads(state['snapshot']) if state['snapshot'] else None
        verified=snapshot['source']['blockNumber'] if snapshot else None
        scan=state['cursor']; halted=bool(state['halted'])
        budget=state['error']=='SYNC_BUDGET' and self.snapshot_committed
        if halted: status='HALTED'
        elif self.active: status='SYNCING'
        elif not self.ready: status='STALE' if snapshot else 'UNAVAILABLE'
        elif state['error'] and not budget: status='STALE'
        elif scan<verified: status='HISTORY_SYNCING'
        else: status='VERIFIED'
        current=snapshot if not halted else None
        return dict(batchId=BATCH,**(current or dict(amounts=None,source=None,contractBalanceWei=None,liabilityWei=None)),
                    capabilities=dict(refund=False,offchainReservation=False),
                    sync=dict(state=status,accountingState='HALTED' if halted else 'VERIFIED' if self.ready and (not state['error'] or budget) else 'STALE' if snapshot else 'UNAVAILABLE',
                              eventsState='HALTED' if halted else 'COMPLETE' if verified is not None and scan>=verified and self.ready else 'SYNCING',
                              scannedThrough=scan,verifiedThrough=verified,targetBlock=verified,
                              lastAttemptAt=state['attempt_at'],lastErrorCode=state['halted'] or state['error']))
