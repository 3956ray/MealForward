import abi from '../abis/MealForward.abi.json' with { type: 'json' };
export type IndexedEvent = {
  deploymentId: string; chainId: 31337; contract: string; blockNumber: number;
  blockHash: string; transactionHash: string; transactionIndex: number; logIndex: number;
  eventName: string; args: Record<string, unknown>;
};
export type FeedPage = { events: IndexedEvent[]; indexedThrough: number; observedAt: string; nextCursor: string | null; source: 'envio' };
export interface EventFeed { fetchRange(deploymentId: string, from: number, to: number, cursor?: string): Promise<FeedPage> }
type Row = Omit<IndexedEvent, 'args'> & { argsJson: string };
type Cursor = { deploymentId: string; from: number; to: number; position: number[] };
const QUERY = `query PublicEvents($where: ChainEvent_bool_exp!, $limit: Int!) {
  ChainEvent(where: $where, order_by: [{blockNumber: asc}, {transactionIndex: asc}, {logIndex: asc}], limit: $limit) {
    deploymentId chainId contract blockNumber blockHash transactionHash transactionIndex logIndex eventName argsJson
  }
  chain_metadata(where: {chain_id: {_eq: 31337}}) { latest_processed_block }
}`;
/** Public candidates only; throws on unavailable/malformed data. Empty events never means failure. */
export class GraphqlEventFeed implements EventFeed {
  constructor(private endpoint = 'http://127.0.0.1:8085/v1/graphql', private pageSize = 100,
    private request: typeof fetch = fetch, private clock = () => new Date()) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw Error('CP15 requires loopback HTTP');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw Error('Invalid page size');
  }
  async fetchRange(deploymentId: string, from: number, to: number, cursor?: string): Promise<FeedPage> {
    if (!deploymentId || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) throw Error('Invalid range');
    const filters: unknown[] = [{deploymentId: {_eq: deploymentId}}, {blockNumber: {_gte: from, _lte: to}}];
    if (cursor) {
      const c: Cursor = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (c.deploymentId !== deploymentId || c.from !== from || c.to !== to || c.position.length !== 3 || !c.position.every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Cursor scope mismatch');
      const [b,t,l] = c.position;
      filters.push({_or: [{blockNumber: {_gt:b}}, {blockNumber: {_eq:b}, transactionIndex: {_gt:t}}, {blockNumber: {_eq:b}, transactionIndex: {_eq:t}, logIndex: {_gt:l}}]});
    }
    const response = await this.request(this.endpoint, {method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({query: QUERY, variables: {where: {_and:filters}, limit:this.pageSize + 1}}), signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw Error(`Envio unavailable (${response.status})`);
    const body = await response.json() as {errors?: unknown; data?: {ChainEvent: Row[]; chain_metadata: {latest_processed_block: number}[]}};
    if (body.errors || !body.data) throw Error('Envio GraphQL error');
    const height = body.data.chain_metadata[0]?.latest_processed_block;
    if (!Number.isSafeInteger(height) || height < 0) throw Error('Envio watermark unavailable');
    const rows = body.data.ChainEvent;
    const events = rows.slice(0, this.pageSize).map(row => {
      if (row.deploymentId !== deploymentId || row.chainId !== 31337 || row.blockNumber < from || row.blockNumber > to) throw Error('Envio scope mismatch');
      const definition = abi.find(e => e.type === 'event' && e.name === row.eventName);
      if (!definition) throw Error('Unknown event');
      const values = JSON.parse(row.argsJson);
      const args = Object.fromEntries(definition.inputs!.map(x => {
        const value: unknown = values[x.name];
        if (x.type.startsWith('uint') && (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))) throw Error('Expected exact decimal uint string');
        if (x.type === 'bool' ? typeof value !== 'boolean' : x.type.endsWith('[]') ? !Array.isArray(value) || !value.every(v => typeof v === 'string') : typeof value !== 'string') throw Error('Invalid public argument type');
        return [x.name, value];
      }));
      return { deploymentId: row.deploymentId, chainId: row.chainId, contract: row.contract,
        blockNumber: row.blockNumber, blockHash: row.blockHash, transactionHash: row.transactionHash,
        transactionIndex: row.transactionIndex, logIndex: row.logIndex, eventName: row.eventName, args };
    });
    const last = events.at(-1);
    const nextCursor = rows.length > this.pageSize && last ? Buffer.from(JSON.stringify({deploymentId, from, to, position:[last.blockNumber,last.transactionIndex,last.logIndex]})).toString('base64url') : null;
    return {events, indexedThrough: height, observedAt:this.clock().toISOString(), nextCursor, source:'envio'};
  }
}
