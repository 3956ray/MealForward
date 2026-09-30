import { indexer } from 'envio';
import abi from '../../abis/MealForward.abi.json' with { type: 'json' };

const deploymentId = process.env.ENVIO_DEPLOYMENT_ID;
if (!deploymentId) throw Error('ENVIO_DEPLOYMENT_ID must identify this deployment, including chain reset generation');
const fields = { transaction: ['hash', 'transactionIndex'], block: ['hash'] } as const;
const names = ['Funded', 'Issued', 'Locked', 'Reported', 'Settled', 'PauseChanged', 'RoleGranted', 'RoleRevoked', 'RoleAdminChanged'] as const;

for (const name of names) indexer.onEvent({ contract: 'MealForward', event: name, fields }, async ({ event, context }) => {
  const id = `${deploymentId}:${event.transaction.hash}:${event.logIndex}`;
  const old = await context.ChainEvent.get(id);
  // Copy only ABI fields: a transport object cannot introduce private metadata.
  const params = event.params as Record<string, unknown>;
  const args = Object.fromEntries(abi.find(x => x.type === 'event' && x.name === name)!.inputs!.map(x => [x.name, params[x.name]]));
  const batchId = typeof args.batchId === 'string' ? args.batchId : undefined;
  const batchKey = `${deploymentId}:${batchId}`;
  const batch = batchId ? await context.Batch.get(batchKey) : undefined;
  const voucherId = typeof args.voucherId === 'string' ? args.voucherId : undefined;
  const voucherKey = `${deploymentId}:${voucherId}`;
  const voucher = voucherId ? await context.Voucher.get(voucherKey) : undefined;
  if (context.isPreload || old) return;
  context.ChainEvent.set({ id, deploymentId, chainId: event.chainId, contract: event.srcAddress,
    blockNumber: event.block.number, blockHash: event.block.hash, transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex, logIndex: event.logIndex, eventName: name,
    argsJson: JSON.stringify(args, (_, v) => typeof v === 'bigint' ? v.toString() : v) });
  if (batchId) {
    const current = batch ?? { id: batchKey, deploymentId, batchId, fundedWei: 0n, issuedCount: 0 };
    context.Batch.set({ ...current,
      fundedWei: current.fundedWei + (name === 'Funded' ? args.amount as bigint : 0n),
      issuedCount: current.issuedCount + (name === 'Issued' ? (args.voucherIds as string[]).length : 0) });
  }
  if (name === 'Issued') (args.voucherIds as string[]).forEach((vid, arrayIndex) => {
    context.IssuedVoucher.set({ id: `${id}:${vid}:${arrayIndex}`, eventId: id, voucherId: vid, arrayIndex, batchId: batchId! });
    context.Voucher.set({ id: `${deploymentId}:${vid}`, deploymentId, voucherId: vid, batchId: batchId!, status: 'Issued', lastEventId: id, settledWei: 0n });
  });
  if (voucherId && ['Locked', 'Reported', 'Settled'].includes(name)) {
    if (!voucher) throw Error('Missing Issued event: reindex from deployment block');
    context.Voucher.set({ ...voucher, status: name, lastEventId: id, settledWei: name === 'Settled' ? args.amount as bigint : voucher.settledWei });
  }
});
