"""Only canonical finalized events can change authoritative business projections."""
import json
from server.backend import canonical
from server.chain.client import ChainConflict, ChainUnavailable, PRICE, hx

class Projector:
    def __init__(self, backend): self.b,self.rpc,self.store=backend,backend.rpc,backend.store
    def sync(self):
        self.b.check_halted()
        try:
            self.rpc.guard()
            last=self.store.one('SELECT * FROM checkpoints ORDER BY block_number DESC LIMIT 1')
            if last and hx(self.rpc.w3.eth.get_block(last['block_number'])['hash'])!=last['block_hash']:
                raise ChainConflict('Finalized checkpoint changed')
            final=self.rpc.w3.eth.get_block('finalized')
            end=final['number']
            if last and end<last['block_number']: raise ChainUnavailable('Finality source behind saved checkpoint')
            start=int(self.b.deployment['deploymentBlock'])
            # CP13 funding cap bounds business events; bounded pages, replay/dedup repairs read gaps.
            events=[]
            for low in range(start,end+1,256): events.extend(self.rpc.events(low,min(end,low+255)))
            for event in events:
                self.rpc.verify_event(event)
                self.validate_operation_event(event)
            # New issuance is also checked against live pause, not an optional indexer's lag.
            paused=self.rpc.contract.functions.paused().call()
            with self.store.transaction() as db:
                self.b._healthy_in_transaction(db)
                current=db.execute('SELECT max(block_number) AS height FROM checkpoints').fetchone()['height']
                if current is not None and end<current:
                    raise ChainUnavailable('Concurrent projection already advanced')
                for event in events:
                    event_id=f"{event['deploymentId']}:{event['transactionHash']}:{event['logIndex']}"
                    existing=db.execute('SELECT * FROM chain_events WHERE event_id=?',(event_id,)).fetchone()
                    if existing:
                        if existing['block_hash']!=event['blockHash'] or existing['args_json']!=canonical(event['args']):
                            raise ChainConflict('Saved event contradicted')
                        continue
                    self.apply(db,event)
                    db.execute('INSERT INTO chain_events VALUES(?,?,?,?,?,?,?,?)',
                        (event_id,event['blockNumber'],event['blockHash'],event['transactionHash'],event['logIndex'],event['transactionIndex'],event['eventName'],canonical(event['args'])))
                # Duplicate feeds cannot count again, but can resolve an intent persisted after observation.
                for event in events: self.finalize(db,event,end)
                db.execute('INSERT OR REPLACE INTO checkpoints VALUES(?,?)',(end,hx(final['hash'])))
                db.execute("UPDATE metadata SET value=? WHERE key='paused'",('1' if paused else '0',))
                db.execute("INSERT OR REPLACE INTO metadata VALUES('observed_at',?)",(str(self.b.now()),))
            return end
        except ChainConflict:
            self.b.halt('CANONICAL_CONFLICT')
            raise
    def validate_operation_event(self, event):
        args=event['args']; name=event['eventName']
        if name=='Funded':
            row=self.store.one('SELECT * FROM support_intents WHERE intent_id=? AND lower(payer)=?',(args['intentId'],args['payer'].lower()))
            if row and (row['batch_id']!=args['batchId'] or row['value_wei']!=args['amount'] or not self.rpc.transaction_matches(event['transactionHash'],sender=row['payer'],data=row['data'],value=row['value_wei'])):
                raise ChainConflict('Original support payload mismatch')
        if name=='Issued':
            row=self.store.one('SELECT * FROM outbox WHERE operation_id=?',(args['operationId'],))
            if row:
                tx=json.loads(row['tx_json'])
                if not self.rpc.transaction_matches(event['transactionHash'],sender=row['signer'],data=tx['data'],value=0):
                    raise ChainConflict('Original issue payload mismatch')
            elif self.rpc.w3.eth.get_transaction(event['transactionHash'])['from'].lower()==self.b.signer.lower():
                # A backup older than acceptance lost private quota/recipient context.
                # Public events cannot safely reconstruct that authorization.
                raise ChainConflict('Local issuance missing private recovery context')
    def apply(self, db, event):
        a=event['args']; name=event['eventName']
        if name=='Funded':
            db.execute('INSERT INTO batches(id,payer,F,A,R,H,S) VALUES(?,?,?,?,0,0,0)',(a['batchId'],a['payer'],a['amount'],a['amount']))
        elif name=='Issued':
            amount=len(a['voucherIds'])*PRICE
            if db.execute('UPDATE batches SET A=A-?,R=R+? WHERE id=?',(amount,amount,a['batchId'])).rowcount!=1:
                raise ChainConflict('Missing funding event')
            for voucher in a['voucherIds']: db.execute('INSERT INTO public_vouchers VALUES(?,?,1,NULL)',(voucher,a['batchId']))
        elif name=='Locked':
            if db.execute('UPDATE public_vouchers SET status=2,lock_id=? WHERE id=?',(a['lockId'],a['voucherId'])).rowcount!=1:
                raise ChainConflict('Missing issuance event')
        elif name in ('Reported','Settled'):
            voucher=db.execute('SELECT * FROM public_vouchers WHERE id=?',(a['voucherId'],)).fetchone()
            if not voucher: raise ChainConflict('Event gap')
            if name=='Reported':
                db.execute('UPDATE batches SET R=R-?,H=H+? WHERE id=?',(PRICE,PRICE,voucher['batch_id']))
                db.execute('UPDATE public_vouchers SET status=3 WHERE id=?',(a['voucherId'],))
            else:
                if a['amount']!=PRICE: raise ChainConflict('Settlement amount mismatch')
                db.execute('UPDATE batches SET H=H-?,S=S+? WHERE id=?',(PRICE,PRICE,voucher['batch_id']))
                db.execute('UPDATE public_vouchers SET status=4 WHERE id=?',(a['voucherId'],))
    def finalize(self, db, event, final_height):
        a=event['args']; op_id=None
        if event['eventName']=='Funded':
            row=db.execute('SELECT operation_id FROM support_intents WHERE intent_id=? AND lower(payer)=?',(a['intentId'],a['payer'].lower())).fetchone()
            if row: op_id=row['operation_id']
        elif event['eventName']=='Issued':
            op=db.execute("SELECT * FROM operations WHERE id=? AND kind='issue'",(a['operationId'],)).fetchone()
            if op:
                op_id=op['id']; self.b.resolve_reservation(db,op_id,True)
                db.execute('UPDATE private_vouchers SET confirmed=1 WHERE operation_id=?',(op_id,))
                db.execute("UPDATE outbox SET state='DONE' WHERE operation_id=?",(op_id,))
        if op_id:
            db.execute("UPDATE operations SET status='FINALIZED_SUCCESS',tx_hash=?,receipt_block=?,receipt_hash=?,finalized_block=?,error_code=NULL,updated_at=? WHERE id=?",
                       (event['transactionHash'],event['blockNumber'],event['blockHash'],final_height,self.b.now(),op_id))
