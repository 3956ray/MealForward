import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphqlEventFeed } from '../src/EventFeed.js';
const row = (logIndex: number) => ({deploymentId:'fixture', chainId:31337, contract:`0x${'1'.repeat(40)}`, blockNumber:9, blockHash:'0xblock', transactionHash:'0xtx', transactionIndex:0, logIndex, eventName:'Funded', argsJson:JSON.stringify({batchId:'b', payer:'p', intentId:'i', amount:'9007199254740993001', recipient_ref:'must-not-escape',secret:'must-not-escape',cookie:'must-not-escape'})});
test('EventFeed scoped keyset cursor, exact amount, lag watermark and ABI field allowlist', async () => {
  const requests: {variables: {where: unknown; limit: number}}[] = [];
  const mock: typeof fetch = async (_, init) => {
    requests.push(JSON.parse(init!.body as string));
    return Response.json({data:{ChainEvent:requests.length === 1 ? [row(0),row(1)] : [row(1)],chain_metadata:[{latest_processed_block:9}]}});
  };
  const feed = new GraphqlEventFeed(undefined, 1, mock, () => new Date('2026-09-30T00:00:00Z'));
  const first = await feed.fetchRange('fixture',0,20);
  assert.equal(first.indexedThrough,9);
  assert.equal(first.events[0].args.amount,'9007199254740993001');
  assert.deepEqual(Object.keys(first.events[0].args),['batchId','payer','intentId','amount']);
  const next = await feed.fetchRange('fixture',0,20,first.nextCursor!);
  assert.equal(next.events[0].logIndex,1);
  assert.equal(next.nextCursor,null);
  assert.match(JSON.stringify(requests[1]), /"logIndex":\{"_gt":0\}/);
  await assert.rejects(feed.fetchRange('other',0,20,first.nextCursor!), /scope/);
  await assert.rejects(feed.fetchRange('fixture',1,20,first.nextCursor!), /scope/);
});
test('503, GraphQL errors and missing watermark remain unavailable, never fabricated empty success', async () => {
  for (const response of [new Response('',{status:503}),Response.json({errors:[{message:'offline'}]}),Response.json({data:{ChainEvent:[],chain_metadata:[]}})]) {
    const feed = new GraphqlEventFeed(undefined,100,async () => response);
    await assert.rejects(feed.fetchRange('fixture',0,20));
  }
  assert.throws(() => new GraphqlEventFeed('https://example.com/graphql'),/loopback/);
});

test('unsafe numeric amount from GraphQL is rejected', async () => {
  const bad = {...row(0), argsJson:JSON.stringify({batchId:'b',payer:'p',intentId:'i',amount:9007199254740993001})};
  const feed = new GraphqlEventFeed(undefined,100,async () => Response.json({data:{ChainEvent:[bad],chain_metadata:[{latest_processed_block:9}]}}));
  await assert.rejects(feed.fetchRange('fixture',0,20),/decimal/);
});
