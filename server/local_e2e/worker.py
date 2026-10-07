"""Use one conservative finalized watermark for a local worker observation pass."""
from server.outbox import Worker
from server.owner_wallet import OwnerWalletService

class LocalWorker(Worker):
    def __init__(self, backend, keys, fault=None):
        self.watermark=0
        super().__init__(backend,keys,fault,finality_source=lambda:self.watermark)
        backend.owner_wallet=OwnerWalletService(backend,finality_source=lambda:self.watermark)
    def tick(self):
        # Projector.sync inside the base tick sees this height or later. A block
        # finalized after that sync must wait for the next projection pass, not
        # be treated as a missing event. Only this process advances CP24 projection.
        self.watermark=self.rpc.w3.eth.get_block('finalized')['number']
        return super().tick()
