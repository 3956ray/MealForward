"""Bounded queue worker; expired leases change ownership, never original rights."""
from __future__ import annotations
import argparse
from .faults import hit
from .content import verify_original
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import json
from pathlib import Path
import signal
import threading

class Worker:
    LEASE_SECONDS = 10
    HEARTBEAT_SECONDS = 3
    def __init__(self, business, controller, worker_id,config=None):
        self.business, self.controller, self.worker_id = business,controller,worker_id
        self.stopped=threading.Event();self.config=config

    def step(self, namespace):
        claimed=self.business.call('claim_job',namespace,{'worker_id':self.worker_id,'lease_seconds':10})
        if claimed.get('error'): return claimed
        if not claimed.get('job'):
            return self.business.call('continuation',namespace,{})
        job=claimed['job']
        hit(self.config,'lease_claimed',namespace,job['job_id'])
        identity={'job_id':job['job_id'],'worker_id':self.worker_id,'fencing_epoch':job['fencing_epoch']}
        original_status=job['status']
        if original_status == 'WAIT_ACTOR':
            # A worker cannot confirm actors or fund/refund/settle on their behalf.
            return {'status':'WAIT_ACTOR','job_id':job['job_id']}
        if original_status in {'DISPATCH_STARTED','AWAITING_OUTCOME','UNKNOWN'}:
            method='source_query'; ticket_id=job['ticket_id']
        else:
            if self.config:
                verified=verify_original(self.business,namespace,{**identity,'purpose':'stage_job'},self.config['run'])
                if verified.get('error'):return verified
            staged=self.business.call('stage_job',namespace,identity)
            if staged.get('error'):
                if staged['error'] in {'REVOKED','UNAUTHENTICATED','EXPIRED','NOT_FOUND'}:
                    return self.controller.call(namespace,'cancel',identity)
                if staged['error'] in {'UNAVAILABLE','FENCE_PENDING','DB_UNAVAILABLE','PENDING'}:
                    self.business.call('job_query',namespace,{**identity,'retry_unstaged':True})
                return staged
            ticket_id=staged['ticket_id']; method='source_dispatch'
            hit(self.config,'ticket_staged',namespace,ticket_id)
        # IPC is bounded by Client; heartbeat transaction is separate from IPC and stage.
        with ThreadPoolExecutor(max_workers=1) as executor:
            future=executor.submit(self.controller.call,namespace,method,{'ticket_id':ticket_id})
            while True:
                try:
                    outcome=future.result(timeout=3)
                    break
                except TimeoutError:
                    # socket.timeout is the same built-in class as Future's wait
                    # timeout. A completed failed IPC must not heartbeat forever.
                    if future.done():
                        outcome={'status':'UNKNOWN'}
                        break
                    heartbeat=self.business.call('job_query',namespace,{**identity,'heartbeat':True})
                    if heartbeat.get('error') or self.stopped.is_set():
                        # Never release reservations when ownership or response is lost.
                        outcome={'status':'UNKNOWN'}
                        break
                except Exception:
                    outcome={'status':'UNKNOWN'}
                    break
        status=outcome.get('status','UNKNOWN')
        if status not in {'FINAL_SUCCEEDED','DEFINITELY_UNEXECUTED','FINAL_REVERT','WAIT_ACTOR'}:
            status='UNKNOWN'
        if status in {'DEFINITELY_UNEXECUTED','FINAL_REVERT'}:
            return self.controller.call(namespace,'cancel',identity)
        return self.business.call('job_query',namespace,{**identity,'status':status,
            'ticket_id':ticket_id,'receipt_id':outcome.get('receipt_id')})

    def run(self, namespace):
        while not self.stopped.is_set():
            try: self.step(namespace() if callable(namespace) else namespace)
            except Exception: pass  # no private exception/log leakage; retained queue remains durable
            self.stopped.wait(0.1)

def main():
    from .db import Database
    from .ipc import Client
    parser=argparse.ArgumentParser(); parser.add_argument('--config',required=True)
    config=json.loads(open(parser.parse_args().config).read())
    if config.get('mode') != 'C1_SYNTHETIC_LOOPBACK': raise SystemExit('SYNTHETIC_MODE_REQUIRED')
    database=Database(config,'worker','business',max_size=2)
    worker=Worker(database,Client(config['controller_path'],config['controller_cap']),config['worker_id'],config)
    signal.signal(signal.SIGTERM,lambda *_:worker.stopped.set())
    signal.signal(signal.SIGINT,lambda *_:worker.stopped.set())
    try: worker.run(lambda:Path(config['scope_file']).read_text().strip() if config.get('scope_file') else config['namespace'])
    finally: database.close()

if __name__ == '__main__': main()
