"""Bounded read-only issuance observation. All RPC in this module is read-only."""
import time
from contextlib import contextmanager
from .chain import (ADDRESS,RULE,PRICE,GAS_CAP,MAX_FEE,TIP,OPERATOR,BATCH,ISSUER,ISSUED,ZERO,IssuanceError,
                    rpc_number,hex_data,contract_read,guard,block,verify_observed_transaction,issued_log,derive)
from .rpc import IssuanceRpc
from .store import validate_config

class IssuanceService:
    def __init__(self,store,rpc_factory=IssuanceRpc,clock=time.time):
        self.store,self.rpc_factory,self.clock=store,rpc_factory,clock
    def config(self):
        data=dict(chainId=10143,contract=ADDRESS,ruleVersion=RULE,priceWei=str(PRICE),testOnly=True,configured=self.store.configured())
        if data['configured']: data['partnerLabel']=self.store.load()['config']['partnerLabel']
        return data
    @contextmanager
    def rpc(self):
        rpc=self.rpc_factory()
        try: yield rpc
        finally:
            if hasattr(rpc,'close'): rpc.close()
    def view(self,r):
        return {'operation':{'issuanceId':r['config']['issuanceId'],'operationId':r['operationId'],'batchId':r['batchId'],
                    'voucherId':r['voucherId'],'partnerLabel':r['config']['partnerLabel'],'recipientRef':r['config']['recipientRef'],
                    'budgetViolation':r.get('budgetViolation',False),'finalizedReceipt':r.get('finalizedReceipt'),
                    'receiptConflict':r.get('receiptConflict'),
                    **{k:r[k] for k in ('status','txHash','errorCode','receiptBlock','receiptBlockHash','finalizedBlock','gasFeeWei','scanThrough')}},
                'intent':dict(chainId=10143,to=ADDRESS,data=r['data'],valueWei='0',quantity=1,ruleVersion=RULE,
                              gasLimitCap=GAS_CAP,maxFeePerGasCapWei=str(MAX_FEE)),
                'accounting':r['accounting']}
    def initialize(self,config):
        """Fresh init requires an on-chain payloadHash==0 preflight; identical re-init is idempotent.

        The scan watermark is captured in the same RPC round as the preflight and persisted
        inside store.initialize's first record, so no half-initialized (watermark-less)
        record can ever be observable."""
        if not self.store.configured() and not self.store.directory.exists():
            validate_config(config)
            operation_id,_=derive(config['issuanceId'])
            with self.rpc() as rpc:
                guard(rpc)
                payload,_=contract_read(rpc,'getOperation',[1,operation_id])
                if payload!=hex_data(ZERO): raise IssuanceError('ISSUED_BEFORE_INIT')
                height=rpc_number(block(rpc,'latest')['number'])
            return self.store.initialize(config,height)
        return self.store.initialize(config)
    def operation(self,cached=False):
        with self.store.lock():
            r=self.store.load()
            if not cached and r['status']!='HALTED':  # a conflicted record stays isolated
                try:
                    with self.rpc() as rpc: self.observe(rpc,r)
                    r['errorCode']='BUDGET_EXCEEDED' if r.get('budgetViolation') else None
                except IssuanceError as error:
                    r['errorCode']=error.code
                    if error.status!=503: r['status']='HALTED'
                self.store.save(r)
            return self.view(r)
    def observe(self,rpc,r):
        guard(rpc)
        final=block(rpc,'finalized');height=rpc_number(final['number'])
        if r['finalizedBlock'] is not None and height<r['finalizedBlock']: raise IssuanceError('FINALITY_CONFLICT')
        if r['receiptBlock'] is not None and block(rpc,r['receiptBlock'])['hash'].lower()!=r['receiptBlockHash'].lower(): raise IssuanceError('CANONICAL_CONFLICT')
        if not r['txHash']:
            if r['scanHash'] and block(rpc,r['scanThrough'])['hash'].lower()!=r['scanHash']: raise IssuanceError('SCAN_CONFLICT')
            for _ in range(8):
                start=r['scanThrough']+1
                if start>height: break
                end=min(start+9,height)
                logs=rpc.call('eth_getLogs',[{'address':ADDRESS,'fromBlock':hex(start),'toBlock':hex(end),
                    'topics':[ISSUED,r['operationId'],r['batchId']]}])
                if not isinstance(logs,list): raise IssuanceError('RPC_PROTOCOL',503)
                if len(logs)>1: raise IssuanceError('EVENT_CONFLICT')
                if logs:
                    log=logs[0]
                    if not issued_log(log,r['operationId'],r['batchId'],r['voucherId']): raise IssuanceError('EVENT_CONFLICT')
                    n=rpc_number(log.get('blockNumber'))
                    if not start<=n<=end or block(rpc,n)['hash'].lower()!=log.get('blockHash','').lower(): raise IssuanceError('EVENT_CONFLICT')
                    hex_data(log.get('transactionHash'),32);r['txHash']=log['transactionHash'].lower();r['status']='BROADCAST'
                checkpoint=block(rpc,end)
                r['scanThrough']=end;r['scanHash']=checkpoint['hash'].lower();self.store.save(r)
                if r['txHash']: break
            if not r['txHash']:
                payload,result=contract_read(rpc,'getOperation',[1,r['operationId']],height)
                if payload==hex_data(ZERO): return
                if payload!=hex_data(r['expectedPayloadHash'],32): raise IssuanceError('INTENT_CONFLICT')
                if r['scanThrough']<height: return  # next bounded round keeps looking for the receipt event
                raise IssuanceError('EVENT_CONFLICT')
        tx=rpc.call('eth_getTransactionByHash',[r['txHash']])
        if tx is None:
            if r.get('finalizedReceipt'): raise IssuanceError('TRANSACTION_UNAVAILABLE',503)
            return
        # Identity must match before a budget violation can be tracked as this issuance.
        verify_observed_transaction(tx,r['data'])
        if tx.get('hash','').lower()!=r['txHash']: raise IssuanceError('TRANSACTION_CONFLICT')
        observed={key:rpc_number(tx[key]) for key in ('gas','maxFeePerGas','maxPriorityFeePerGas')}
        limits={'gas':GAS_CAP,'maxFeePerGas':MAX_FEE,'maxPriorityFeePerGas':TIP}
        if any(value>limits[key] for key,value in observed.items()):
            r['budgetViolation']=True
            r['budgetEvidence']={key:str(value) for key,value in observed.items()}
        receipt=rpc.call('eth_getTransactionReceipt',[r['txHash']])
        if receipt is None:
            if r.get('finalizedReceipt'): raise IssuanceError('RECEIPT_UNAVAILABLE',503)
            return
        if receipt.get('transactionHash','').lower()!=r['txHash']: raise IssuanceError('RECEIPT_CONFLICT')
        n=rpc_number(receipt.get('blockNumber'));h=receipt.get('blockHash');hex_data(h,32)
        if block(rpc,n)['hash'].lower()!=h.lower(): raise IssuanceError('CANONICAL_CONFLICT')
        if tx.get('blockHash','').lower()!=h.lower() or rpc_number(tx.get('blockNumber'))!=n: raise IssuanceError('TRANSACTION_CONFLICT')
        status=rpc_number(receipt.get('status'))
        if status not in (0,1): raise IssuanceError('RECEIPT_CONFLICT')
        gas=rpc_number(receipt.get('gasUsed'));fee=rpc_number(receipt.get('effectiveGasPrice'))
        if gas>observed['gas'] or fee>observed['maxFeePerGas']: raise IssuanceError('RECEIPT_CONFLICT')
        fact={'status':status,'blockNumber':n,'blockHash':h.lower(),'gasFeeWei':str(gas*fee)}
        previous=r.get('finalizedReceipt')
        if previous is not None and previous!=fact:
            r['receiptConflict']=fact
            raise IssuanceError('FINALITY_CONFLICT')
        if status:
            matched=[l for l in receipt.get('logs',[]) if issued_log(l,r['operationId'],r['batchId'],r['voucherId'])]
            if len(matched)!=1 or matched[0].get('transactionHash','').lower()!=r['txHash'] or matched[0].get('blockHash','').lower()!=h.lower() or rpc_number(matched[0].get('blockNumber'))!=n: raise IssuanceError('EVENT_CONFLICT')
        r.update(receiptBlock=n,receiptBlockHash=h.lower(),gasFeeWei=str(gas*fee),status='INCLUDED_SUCCESS' if status else 'INCLUDED_REVERT')
        if height<n: return
        r.update(finalizedBlock=height,finalizedReceipt=fact,status='FINALIZED_SUCCESS' if status else 'FINALIZED_REVERT')
        self.store.save(r)  # accounting unavailability must not erase proven finality
        if not status: return
        values=contract_read(rpc,'getBatch',[r['batchId']],height)
        f,a,reserved,held,settled,x,l=values
        liability=contract_read(rpc,'liability',[],height)[0]
        total=contract_read(rpc,'totalFunded',[],height)[0]
        balance=rpc_number(rpc.call('eth_getBalance',[ADDRESS,hex(height)]))
        voucher=contract_read(rpc,'getVoucher',[r['voucherId']],height)
        operation=contract_read(rpc,'getOperation',[1,r['operationId']],height)
        if (values!=(PRICE,0,PRICE,0,0,0,0) or f!=a+reserved+held+settled or
            tuple(voucher)!=(hex_data(r['batchId'],32),1,hex_data(ZERO,32)) or
            tuple(operation)!=(hex_data(r['expectedPayloadHash'],32),hex_data(r['batchId'],32)) or
            liability!=PRICE or total!=2*PRICE or balance!=PRICE): raise IssuanceError('ACCOUNTING_CONFLICT')
        if block(rpc,height)['hash'].lower()!=final['hash'].lower(): raise IssuanceError('CANONICAL_CONFLICT')
        r['accounting']={**dict(zip(('F','A','R','H','S'),map(str,values[:5]))),'liabilityWei':str(liability),
            'contractBalanceWei':str(balance),'totalFundedWei':str(total),'blockNumber':height,'blockHash':final['hash'].lower()}
        r['status']='ACCOUNTING_VERIFIED'
