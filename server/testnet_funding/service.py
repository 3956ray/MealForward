"""Persistent external wallet intent. All RPC in this module is read-only."""
import secrets
import time
from contextlib import contextmanager
from .chain import (ADDRESS,RULE,PRICE,MAX_FEE,TIP,SUPPORTER,ZERO,FUNDED,FundingError,rpc_number,
                    address,hex_data,contract_read,guard,block,verify_transaction,funded_log)
from .store import digest
from .rpc import FundingRpc

class FundingService:
    def __init__(self,store,rpc_factory=FundingRpc,clock=time.time):
        self.store,self.rpc_factory,self.clock=store,rpc_factory,clock
    def config(self):
        return dict(chainId=10143,contract=ADDRESS,ruleVersion=RULE,priceWei=str(PRICE),testOnly=True,configured=self.store.configured())
    @contextmanager
    def rpc(self):
        rpc=self.rpc_factory()
        try: yield rpc
        finally:
            if hasattr(rpc,'close'): rpc.close()
    def view(self,r):
        return {'operation':{'id':r['config']['campaignId'],'intentId':r['intentId'],'batchId':r['batchId'],'payer':r['config']['payer'],
                    'budgetViolation':r.get('budgetViolation',False),'finalizedReceipt':r.get('finalizedReceipt'),
                    'receiptConflict':r.get('receiptConflict'),
                    **{k:r[k] for k in ('status','txHash','errorCode','submitted','receiptBlock','receiptBlockHash','finalizedBlock','gasFeeWei','scanThrough')}},
                'intent':dict(chainId=10143,to=ADDRESS,data=r['data'],valueWei=str(PRICE),quantity=1,ruleVersion=RULE,
                              gasLimitCap=250000,maxFeePerGasCapWei=str(MAX_FEE)),
                'review':r['review'] if not r['submitted'] else None,'accounting':r['accounting']}
    def session(self,token):
        with self.store.lock():
            r=self.store.load()
            if r['capHash']:
                self.store.require_cap(r,token,self.clock());return None,self.view(r)
            token=secrets.token_urlsafe(32);r['capHash']=digest(token);r['capExpires']=self.clock()+86400
            self.store.transition(r,'BOUND');return token,self.view(r)
    def get(self,token):
        with self.store.lock():
            r=self.store.load();self.store.require_cap(r,token,self.clock());return self.view(r)
    def review(self,token,body):
        with self.store.lock():
            r=self.store.load();self.store.require_cap(r,token,self.clock())
            if r['submitted']: raise FundingError('READ_ORIGINAL_ONLY')
            if set(body)!= {'account','chainId'} or body['chainId']!=10143 or address(body['account'])!=address(r['config']['payer']): raise FundingError('PAYER_CHANGED')
            r['review']=None;self.store.save(r)
            with self.rpc() as rpc:
                latest=block(rpc,'latest');height=rpc_number(latest['number']);guard(rpc,height)
                tx=self.preflight(rpc,r,latest)
                r['review']={'id':secrets.token_hex(32),'expiresAt':int((self.clock()+120)*1000),'transaction':tx}
                r['scanStart']=height;r['scanThrough']=height-1;r['scanHash']=None;r['errorCode']=None
                self.store.save(r);return self.view(r)
    def preflight(self,rpc,r,latest,quoted=None):
        payer=r['config']['payer']
        if contract_read(rpc,'paused',[])[0]: raise FundingError('CONTRACT_PAUSED')
        if not contract_read(rpc,'hasRole',[SUPPORTER,payer])[0]: raise FundingError('SUPPORTER_ROLE_REQUIRED')
        final=block(rpc,'finalized');final_height=rpc_number(final['number'])
        if not contract_read(rpc,'hasRole',[SUPPORTER,payer],final_height)[0]: raise FundingError('SUPPORTER_ROLE_NOT_FINALIZED')
        if block(rpc,final_height)['hash'].lower()!=final['hash'].lower(): raise FundingError('FINALITY_CONFLICT')
        if contract_read(rpc,'totalFunded',[])[0]+PRICE>10**16: raise FundingError('FUNDING_CAP_EXCEEDED')
        if contract_read(rpc,'fundedBatch',[payer,r['intentId']])[0]!=hex_data(ZERO): raise FundingError('INTENT_ALREADY_FUNDED')
        for tag in ('latest','pending'):
            if rpc_number(rpc.call('eth_getTransactionCount',[payer,tag]))!=r['config']['nonce']: raise FundingError('NONCE_CONFLICT')
        if rpc.call('eth_getCode',[payer,'latest'])!='0x': raise FundingError('DELEGATED_IDENTITY_DENIED')
        base=rpc_number(latest['baseFeePerGas'])
        fee=rpc_number(quoted['maxFeePerGas']) if quoted else (base*125+99)//100+TIP
        if fee>MAX_FEE or base+TIP>fee: raise FundingError('FEE_CAP_EXCEEDED')
        tx={'from':payer,'to':ADDRESS,'chainId':hex(10143),'nonce':hex(r['config']['nonce']),'data':r['data'],
            'value':hex(PRICE),'type':'0x2','maxFeePerGas':hex(fee),'maxPriorityFeePerGas':hex(TIP)}
        estimate=rpc_number(rpc.call('eth_estimateGas',[tx]));gas=rpc_number(quoted['gas']) if quoted else (estimate*10750+9999)//10000
        if estimate<21000 or gas<estimate or gas>250000: raise FundingError('GAS_CAP_EXCEEDED')
        tx['gas']=hex(gas)
        if rpc_number(rpc.call('eth_getBalance',[payer,'latest']))<PRICE+gas*fee: raise FundingError('INSUFFICIENT_FUNDS')
        rpc.call('eth_call',[tx,'latest'])
        return tx
    def submit(self,token,body):
        with self.store.lock():
            r=self.store.load();self.store.require_cap(r,token,self.clock())
            if r['submitted']: raise FundingError('READ_ORIGINAL_ONLY')
            q=r['review']
            if set(body)!={'reviewId'} or not q or body['reviewId']!=q['id'] or self.clock()*1000>=q['expiresAt']: raise FundingError('REVIEW_REQUIRED')
            # Final preflight repeats under the exclusive process lock before consuming permission.
            with self.rpc() as rpc:
                latest=block(rpc,'latest');guard(rpc,rpc_number(latest['number']))
                current=self.preflight(rpc,r,latest,q['transaction'])
                if current!=q['transaction']:
                    r['review']=None;self.store.save(r);raise FundingError('QUOTE_CHANGED')
            r['transaction']=q['transaction'];r['submitted']=True;r['status']='SUBMISSION_UNKNOWN'
            self.store.transition(r,'CONSUMED')
            return {**self.view(r),'transaction':r['transaction']}
    def attach(self,token,body):
        with self.store.lock():
            r=self.store.load();self.store.require_cap(r,token,self.clock())
            if set(body)!={'txHash'}: raise FundingError('INVALID_INPUT',422)
            hex_data(body['txHash'],32)
            if not r['submitted']: raise FundingError('SUBMISSION_REQUIRED')
            if r['txHash'] and r['txHash'].lower()!=body['txHash'].lower(): raise FundingError('HASH_CONFLICT')
            r['txHash']=body['txHash'].lower()
            if r['status']=='SUBMISSION_UNKNOWN': r['status']='BROADCAST'
            self.store.save(r);return self.view(r)
    def reconcile(self,token):
        with self.store.lock():
            r=self.store.load();self.store.require_cap(r,token,self.clock())
            if not r['submitted'] or (r['status']=='HALTED' and r['errorCode']!='BUDGET_EXCEEDED'): return self.view(r)
            if r['status']=='HALTED':
                r['budgetViolation']=True;r['status']='BROADCAST'  # legacy budget-only halt may still be observed
            try:
                with self.rpc() as rpc: self.observe(rpc,r)
                r['errorCode']='BUDGET_EXCEEDED' if r.get('budgetViolation') else None
            except FundingError as error:
                r['errorCode']=error.code
                if error.status!=503:
                    r['status']='HALTED'
            self.store.save(r);return self.view(r)
    def observe(self,rpc,r):
        guard(rpc)
        final=block(rpc,'finalized');height=rpc_number(final['number'])
        if r['finalizedBlock'] is not None and height<r['finalizedBlock']: raise FundingError('FINALITY_CONFLICT')
        if r['receiptBlock'] is not None and block(rpc,r['receiptBlock'])['hash'].lower()!=r['receiptBlockHash'].lower(): raise FundingError('CANONICAL_CONFLICT')
        if not r['txHash']:
            mapping=contract_read(rpc,'fundedBatch',[r['config']['payer'],r['intentId']])[0]
            if mapping not in (hex_data(ZERO),hex_data(r['batchId'])): raise FundingError('BATCH_CONFLICT')
            if r['scanHash'] and block(rpc,r['scanThrough'])['hash'].lower()!=r['scanHash']: raise FundingError('SCAN_CONFLICT')
            for _ in range(8):
                start=r['scanThrough']+1
                if start>height: break
                end=min(start+9,height)
                logs=rpc.call('eth_getLogs',[{'address':ADDRESS,'fromBlock':hex(start),'toBlock':hex(end),
                    'topics':[FUNDED,r['batchId'],'0x'+r['config']['payer'][2:].lower().rjust(64,'0'),r['intentId']]}])
                if not isinstance(logs,list): raise FundingError('RPC_PROTOCOL',503)
                if len(logs)>1: raise FundingError('EVENT_CONFLICT')
                if logs:
                    log=logs[0]
                    if not funded_log(log,r['intentId'],r['config']['payer'],r['batchId']): raise FundingError('EVENT_CONFLICT')
                    n=rpc_number(log.get('blockNumber'))
                    if not start<=n<=end or block(rpc,n)['hash'].lower()!=log.get('blockHash','').lower(): raise FundingError('EVENT_CONFLICT')
                    hex_data(log.get('transactionHash'),32);r['txHash']=log['transactionHash'].lower();r['status']='BROADCAST'
                checkpoint=block(rpc,end)
                r['scanThrough']=end;r['scanHash']=checkpoint['hash'].lower();self.store.save(r)
                if r['txHash']: break
            if not r['txHash']: return
        tx=rpc.call('eth_getTransactionByHash',[r['txHash']])
        if tx is None:
            if r.get('finalizedReceipt'): raise FundingError('TRANSACTION_UNAVAILABLE',503)
            return
        # Identity must match before a budget violation can be tracked as this intent.
        verify_transaction(tx,r['transaction'],check_budget=False)
        if tx.get('hash','').lower()!=r['txHash']: raise FundingError('TRANSACTION_CONFLICT')
        observed={key:rpc_number(tx[key]) for key in ('gas','maxFeePerGas','maxPriorityFeePerGas')}
        if any(value>rpc_number(r['transaction'][key]) for key,value in observed.items()):
            r['budgetViolation']=True
            r['budgetEvidence']={key:str(value) for key,value in observed.items()}
        receipt=rpc.call('eth_getTransactionReceipt',[r['txHash']])
        if receipt is None:
            if r.get('finalizedReceipt'): raise FundingError('RECEIPT_UNAVAILABLE',503)
            return
        if receipt.get('transactionHash','').lower()!=r['txHash']: raise FundingError('RECEIPT_CONFLICT')
        n=rpc_number(receipt.get('blockNumber'));h=receipt.get('blockHash');hex_data(h,32)
        if block(rpc,n)['hash'].lower()!=h.lower(): raise FundingError('CANONICAL_CONFLICT')
        if tx.get('blockHash','').lower()!=h.lower() or rpc_number(tx.get('blockNumber'))!=n: raise FundingError('TRANSACTION_CONFLICT')
        status=rpc_number(receipt.get('status'))
        if status not in (0,1): raise FundingError('RECEIPT_CONFLICT')
        gas=rpc_number(receipt.get('gasUsed'));fee=rpc_number(receipt.get('effectiveGasPrice'))
        if gas>observed['gas'] or fee>observed['maxFeePerGas']: raise FundingError('RECEIPT_CONFLICT')
        fact={'status':status,'blockNumber':n,'blockHash':h.lower(),'gasFeeWei':str(gas*fee)}
        previous=r.get('finalizedReceipt')
        if previous is not None and previous!=fact:
            r['receiptConflict']=fact
            raise FundingError('FINALITY_CONFLICT')
        if status:
            matched=[l for l in receipt.get('logs',[]) if funded_log(l,r['intentId'],r['config']['payer'],r['batchId'])]
            if len(matched)!=1 or matched[0].get('transactionHash','').lower()!=r['txHash'] or matched[0].get('blockHash','').lower()!=h.lower() or rpc_number(matched[0].get('blockNumber'))!=n: raise FundingError('EVENT_CONFLICT')
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
        if (values!=(PRICE,PRICE,0,0,0,0,0) or f!=a+reserved+held+settled or liability<a+reserved+held or balance<liability or total<f): raise FundingError('ACCOUNTING_CONFLICT')
        if block(rpc,height)['hash'].lower()!=final['hash'].lower(): raise FundingError('CANONICAL_CONFLICT')
        r['accounting']={**dict(zip(('F','A','R','H','S'),map(str,values[:5]))),'liabilityWei':str(liability),
            'contractBalanceWei':str(balance),'totalFundedWei':str(total),'blockNumber':height,'blockHash':final['hash'].lower()}
        r['status']='ACCOUNTING_VERIFIED'
