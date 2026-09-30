import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestIndexer } from 'envio';
process.env.ENVIO_DEPLOYMENT_ID = 'cp15-fixture-generation-1';
const b32 = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;
const addr: `0x${string}` = `0x${'1'.repeat(40)}`;

test('SDK real handlers: two batches, N3 distinct children, partial voucher states and deterministic rebuild', async () => {
  const simulate = [
    { contract: 'MealForward', event: 'Funded', params: { batchId: b32(1), payer: addr, intentId: b32(2), amount: 9007199254740993001n, recipient_ref: "PRIVATE", secret: "PRIVATE", cookie: "PRIVATE" } },
    { contract: 'MealForward', event: 'Funded', params: { batchId: b32(3), payer: addr, intentId: b32(4), amount: 77n } },
    { contract: 'MealForward', event: 'Issued', params: { operationId: b32(5), batchId: b32(1), voucherIds: [b32(10), b32(11), b32(12)] as string[] } },
    { contract: 'MealForward', event: 'Issued', params: { operationId: b32(6), batchId: b32(3), voucherIds: [b32(13)] as string[] } },
    { contract: 'MealForward', event: 'Locked', params: { operationId: b32(7), voucherId: b32(10), lockId: b32(8) } },
    { contract: 'MealForward', event: 'Reported', params: { operationId: b32(9), voucherId: b32(10), lockId: b32(8) } },
    { contract: 'MealForward', event: 'Settled', params: { operationId: b32(14), voucherId: b32(10), merchant: addr, amount: 3002399751580331000n } },
    { contract: 'MealForward', event: 'PauseChanged', params: { paused: true } },
    { contract: 'MealForward', event: 'RoleGranted', params: { role: b32(15), account: addr, sender: addr } },
    { contract: 'MealForward', event: 'RoleRevoked', params: { role: b32(15), account: addr, sender: addr } },
    { contract: 'MealForward', event: 'RoleAdminChanged', params: { role: b32(15), previousAdminRole: b32(16), newAdminRole: b32(17) } },
  ] as const;
  const events = simulate.map((e, i) => ({ ...e, block: { number: 10, timestamp: 10, hash: b32(100) }, transaction: { hash: b32(101), transactionIndex: 0 }, logIndex: i, srcAddress: "0x0000000000000000000000000000000000000001" as const }));
  const a = createTestIndexer();
  await a.process({ chains: { 31337: { simulate: events } } });
  const batches = await a.Batch.getAll();
  assert.deepEqual(batches.map(x => [x.batchId, x.fundedWei, x.issuedCount]).sort(), [[b32(1), 9007199254740993001n, 3], [b32(3), 77n, 1]]);
  const children = await a.IssuedVoucher.getAll();
  assert.equal(children.length, 4);
  assert.equal(new Set(children.map(x => x.id)).size, 4);
  assert.equal((await a.Voucher.getOrThrow(`cp15-fixture-generation-1:${b32(10)}`)).status, 'Settled');
  assert.equal((await a.Voucher.getOrThrow(`cp15-fixture-generation-1:${b32(11)}`)).status, 'Issued');
  const chainEvents = await a.ChainEvent.getAll();
  assert.equal(chainEvents.length, 11);
  assert.equal(JSON.parse(chainEvents.find(x => x.eventName === 'Funded')!.argsJson).amount, '9007199254740993001');
  assert.ok(!JSON.stringify(chainEvents).includes('PRIVATE'));
  const duplicate = createTestIndexer();
  for (const value of chainEvents) duplicate.ChainEvent.set(value);
  for (const value of batches) duplicate.Batch.set(value);
  for (const value of await a.Voucher.getAll()) duplicate.Voucher.set(value);
  for (const value of children) duplicate.IssuedVoucher.set(value);
  await duplicate.process({ chains: { 31337: { simulate: events } } });
  assert.deepEqual(await duplicate.Batch.getAll(), batches);
  assert.deepEqual(await duplicate.IssuedVoucher.getAll(), children);
  const b = createTestIndexer();
  await b.process({ chains: { 31337: { simulate: events } } });
  assert.deepEqual(await b.Batch.getAll(), batches);
  assert.deepEqual(await b.ChainEvent.getAll(), chainEvents);
  assert.deepEqual(await b.Voucher.getAll(), await a.Voucher.getAll());
});
