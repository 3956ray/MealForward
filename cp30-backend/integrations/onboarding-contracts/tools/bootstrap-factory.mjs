// One reviewed Factory deployment, one original transaction, one possible send.
// This module's author checked only unsigned source. Root executes after review.
import { constants, openSync, closeSync, readFileSync, writeSync, fsyncSync,
  fstatSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPublicClient, http, encodeDeployData, getContractAddress, keccak256,
  parseTransaction, recoverTransactionAddress, encodeFunctionData, decodeFunctionResult } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RUN = '/Users/mili/.mf-cp30-20261013';
const MODULE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JOURNAL = `${RUN}/factory-deploy.original.jsonl`;
const RPC = 'https://testnet-rpc.monad.xyz';
const RPC_URL = new URL(RPC).href; // viem parseUrl canonicalizes the same root URL.
const CHAIN = 10143;
const GENESIS = '0x298034669ee44327d2da9744b9b2782848e2f2a6959756b7b0471b09a404f5c9';
const ASSET_HASH = '0x96215e6049ed615cdc22fea7701e85458a8e51a2df3e7d45e8f9fa1d521b5a78';
const ARTIFACT_SHA = 'ae31889a9ebc4440317ec107262b05ef9193de9560980764c812b3e1265748bf';
const ESCROW_SHA = 'b61cd842ab12e61beedc0cef7a6ed0e92dc55f7ea8076c34f69972ab715b50b8';
const PREVIEW_SHA = '5a95b7dd30a25d7efb70587be605e4e916b8750e61fe5a3d19c2cc94d108b0e3';
const INIT_HASH = '0x25a0e972e8a1509ed72a8ee76fa6f221c075bb796ac33a7bea4586ed654f16ac';
const ESCROW_HASH = '0x3aed59967d18f9b80a436f1080f9b55b5ea9299f62eb1c7d8f612d7ed8d30b4e';
const FROM = '0x7b9ac33903b17b442c9f2e8f9c2f479d339f2543';
const FACTORY = '0x645d1176e8315afd04fe40f0c528e5370545acfb';
const ARGS = ['0x534b2f3a21130d7a60830c2df862319e593943a3', FROM,
  '0x814232fa062dc7b6d14610db8b614715b2dd0fc5', '0x864218503e18bb73d86bcbffbb3a27d7f7a34a2d',
  '0x177d5dbb0fc6cc03c209fc81987065380fed667c', '0x5f8e8eeec17778da5d0681217c8c98fc0c249371'];
const GETTERS = ['asset', 'registrar', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority'];
const GAS = 2100000n, FEE = 120000000000n, PRIORITY = 2000000000n, COST = 252000000000000000n;
const DEADLINE_MS = 60000, MAX_CALLS = 24, MAX_RESPONSE = 1048576;
class BootstrapClosed extends Error {}
function fail(code) { throw new BootstrapClosed(code); }
const diagnostics = { stage: 'FIXED_PLAN', method: null, requestNumber: 0 };
function stage(value) { diagnostics.stage = value; diagnostics.method = null; }
const ERROR_NAMES = new Set(['HttpRequestError', 'RpcRequestError', 'TimeoutError',
  'ResponseBodyTooLargeError', 'TypeError', 'SyntaxError', 'AbortError', 'Error',
  'InvalidParamsRpcError', 'InvalidInputRpcError', 'MethodNotFoundRpcError',
  'InternalRpcError', 'LimitExceededRpcError', 'UnknownRpcError']);
const SYSTEM_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED',
  'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN']);
const RPC_CODES = new Set([-32700, -32600, -32601, -32602, -32603,
  -32000, -32001, -32002, -32003, -32004, -32005, -32006, -32099]);
export function safeFailure(error) {
  const classes = [], seen = new Set();
  let systemCode = null, rpcCode = null, httpStatus = null, reason = 'FACTORY_BOOTSTRAP_CLOSED_USE_ORIGINAL_ONLY';
  for (let e = error, depth = 0; e && typeof e === 'object' && depth < 8 && !seen.has(e); e = e.cause, depth++) {
    seen.add(e);
    if (e instanceof BootstrapClosed) reason = e.message; // Our fixed codes only.
    if (ERROR_NAMES.has(e.name) && !classes.includes(e.name)) classes.push(e.name);
    if (SYSTEM_CODES.has(e.code)) systemCode = e.code;
    if (RPC_CODES.has(e.code)) rpcCode = e.code;
    if (Number.isInteger(e.status) && e.status >= 100 && e.status <= 599) httpStatus = e.status;
  }
  const category = reason !== 'FACTORY_BOOTSTRAP_CLOSED_USE_ORIGINAL_ONLY' ? 'FIXED_GUARD'
    : systemCode ? 'NETWORK_SYSTEM' : httpStatus ? 'HTTP_STATUS' : rpcCode ? 'RPC_ERROR'
      : classes.includes('TimeoutError') || classes.includes('AbortError') ? 'TIMEOUT'
        : classes.includes('TypeError') || classes.includes('SyntaxError') ? 'SDK_OR_RESPONSE_SHAPE' : 'SDK_OR_NETWORK';
  return { reason, category, classes, systemCode, rpcCode, httpStatus, ...diagnostics };
}
function assert(test, code = 'FACTORY_BOOTSTRAP_CLOSED') { if (!test) fail(code); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function word(v) { assert(typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v)); return v; }
function addr(v) { assert(typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)); return v.toLowerCase(); }
function hex(v) { assert(typeof v === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(v)); return v.toLowerCase(); }
function q(v) { assert(typeof v === 'string' && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v) && v.length <= 66); return BigInt(v); }
function scalar(v) { assert(typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)); return BigInt(v); }
function directory(path) {
  const st = lstatSync(path);
  assert(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid()
    && (st.mode & 0o777) === 0o700 && realpathSync(path) === path, 'OWNED_DIRECTORY_REQUIRED');
}
function file(path, { privateFile = false, max = 1048576 } = {}) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    assert(st.isFile() && st.size <= max && (!privateFile || (st.uid === process.getuid()
      && (st.mode & 0o777) === 0o600 && st.nlink === 1)), 'OWNED_FILE_REQUIRED');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function json(path, options) { return JSON.parse(file(path, options).toString('utf8')); }
function planMaterial(p) {
  return { chainId: CHAIN, from: FROM, expectedFactory: FACTORY, nonce: '0', value: '0',
    data: p.data, gas: String(GAS), maxFeePerGas: String(FEE), maxPriorityFeePerGas: String(PRIORITY),
    maxTransactionCostWei: String(COST), constructorArguments: ARGS, artifactSHA256: ARTIFACT_SHA,
    initcodeHash: INIT_HASH, escrowCreationCodeHash: ESCROW_HASH, genesisHash: GENESIS, assetCodeHash: ASSET_HASH };
}

export function loadReviewed() {
  directory(RUN);
  const previewBytes = file(`${RUN}/factory-deploy.preview.json`, { privateFile: true });
  assert(sha(previewBytes) === PREVIEW_SHA, 'REVIEWED_PREVIEW_CHANGED');
  const p = JSON.parse(previewBytes.toString('utf8'));
  const bytes = file(`${MODULE}/out/RegistrationFactory.sol/RegistrationFactory.json`);
  const escrowBytes = file(`${MODULE}/abi/StoreEscrow.creationCode.json`);
  assert(sha(bytes) === ARTIFACT_SHA && sha(escrowBytes) === ESCROW_SHA, 'ARTIFACT_PIN_CHANGED');
  const artifact = JSON.parse(bytes.toString('utf8')), escrow = JSON.parse(escrowBytes.toString('utf8'));
  assert(keccak256(hex(escrow.bytecode)) === ESCROW_HASH && escrow.keccak256 === ESCROW_HASH, 'ESCROW_CODE_PIN_CHANGED');
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: ARGS });
  assert(p.chainId === CHAIN && p.from === FROM && p.nonce === '0' && p.expectedFactory === FACTORY
    && p.value === '0' && p.data === data && p.initcodeHash === keccak256(data) && p.initcodeHash === INIT_HASH
    && p.initcodeBytes === 32758 && (data.length - 2) / 2 === p.initcodeBytes
    && JSON.stringify(p.constructorArguments) === JSON.stringify(ARGS) && p.artifactSHA256 === ARTIFACT_SHA
    && p.gas === String(GAS) && p.maxFeePerGas === String(FEE) && p.maxPriorityFeePerGas === String(PRIORITY)
    && p.maxTransactionCostWei === String(COST) && GAS * FEE === COST
    && addr(getContractAddress({ from: FROM, nonce: 0n })) === FACTORY, 'REVIEWED_DEPLOYMENT_MISMATCH');
  const accountsBytes = file(`${RUN}/public-accounts.json`, { privateFile: true });
  const custodyBytes = file(`${RUN}/custody-metadata.json`, { privateFile: true });
  const accounts = JSON.parse(accountsBytes.toString('utf8')), custody = JSON.parse(custodyBytes.toString('utf8'));
  for (const [i, role] of GETTERS.entries()) {
    if (role === 'asset') continue;
    assert(accounts[role] === ARGS[i] && custody[role]?.account === ARGS[i], 'PUBLIC_CUSTODY_ACCOUNT_MISMATCH');
  }
  const meta = custody.registrar;
  assert(meta.directory === `${RUN}/registrar` && meta.keyHandle.name === 'registrar.key'
    && meta.keyHandle.device === 16777232 && meta.keyHandle.inode === 9593453, 'DEDICATED_CUSTODY_CHANGED');
  directory(meta.directory); // No key stat/open/read occurs in prepare/loadReviewed.
  const chain = json(`${RUN}/public-chain.json`, { privateFile: true });
  assert(chain.verified === true && chain.endpoint === RPC && chain.host === 'testnet-rpc.monad.xyz'
    && chain.assetAddress === ARGS[0] && chain.facts.chainId === CHAIN && chain.facts.genesisHash === GENESIS
    && chain.facts.assetCodeHash === ASSET_HASH && chain.facts.canonicalFinalizedHeaderRechecked === true
    && chain.facts.eip1898CanonicalCodeSupported === true, 'RETAINED_PUBLIC_CHAIN_MISMATCH');
  const material = { ...planMaterial(p), publicAccountsSHA256: sha(accountsBytes), custodyMetadataSHA256: sha(custodyBytes) };
  return { p, artifact, meta, material, planDigest: sha(JSON.stringify(material)) };
}
function summary(c, status, extra = {}) {
  return { status, chainId: CHAIN, from: FROM, expectedFactory: FACTORY, nonce: '0',
    initcodeHash: INIT_HASH, artifactSHA256: ARTIFACT_SHA, planDigest: c.planDigest,
    maxTransactionCostWei: String(COST), ...extra };
}

function readJournal(c) {
  let bytes;
  try { bytes = file(JOURNAL, { privateFile: true, max: 262144 }); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  assert(bytes.length > 0 && bytes.at(-1) === 10, 'ORIGINAL_JOURNAL_TORN');
  const rows = bytes.toString('utf8').trimEnd().split('\n').map(x => JSON.parse(x));
  let prev = '0'.repeat(64), retained = null, broadcast = false;
  for (let i = 0; i < rows.length; i++) {
    const { digest, ...body } = rows[i];
    assert(body.sequence === i && body.previous === prev && body.planDigest === c.planDigest
      && digest === sha(JSON.stringify(body)), 'ORIGINAL_JOURNAL_CONFLICT');
    if (i === 0) assert(body.state === 'SIGNING' && body.material && sha(JSON.stringify(body.material)) === c.planDigest);
    else if (body.state === 'RETAINED') {
      assert(i === 1 && retained === null && body.raw && word(body.transactionHash) === keccak256(hex(body.raw)));
      retained = body;
    } else if (body.state === 'BROADCAST_UNKNOWN') {
      assert(i === 2 && retained && !broadcast && body.transactionHash === retained.transactionHash); broadcast = true;
    } else if (body.state === 'SEND_RETURNED') {
      assert(i === 3 && broadcast && body.transactionHash === retained.transactionHash);
    } else fail('ORIGINAL_JOURNAL_CONFLICT');
    prev = digest;
  }
  return { rows, retained, previous: prev };
}
function append(fd, c, prior, state, fields) {
  const body = { sequence: prior?.rows.length ?? 0, previous: prior?.previous ?? '0'.repeat(64),
    planDigest: c.planDigest, state, ...fields };
  const row = { ...body, digest: sha(JSON.stringify(body)) };
  const bytes = Buffer.from(JSON.stringify(row) + '\n');
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
  return { rows: [...(prior?.rows ?? []), row], retained: state === 'RETAINED' ? row : prior?.retained,
    previous: row.digest };
}
function syncDirectory() { const fd = openSync(RUN, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }

function rpcSession({ readOnly = false } = {}) {
  stage('RPC_SETUP');
  diagnostics.requestNumber = 0;
  const end = performance.now() + DEADLINE_MS;
  let calls = 0, sent = false;
  const check = () => assert(performance.now() < end && calls < MAX_CALLS, 'RPC_BUDGET_EXHAUSTED');
  const client = createPublicClient({ transport: http(RPC, { retryCount: 0, timeout: 4000,
    batch: false, maxResponseBodySize: MAX_RESPONSE,
    fetchOptions: { redirect: 'error', credentials: 'omit' },
    fetchFn: (url, options) => {
      assert(String(url) === RPC_URL && performance.now() < end, 'RPC_ENDPOINT_REJECTED');
      const local = AbortSignal.timeout(Math.max(1, Math.min(4000, Math.floor(end - performance.now()))));
      return fetch(url, { ...options, redirect: 'error', credentials: 'omit',
        signal: options?.signal ? AbortSignal.any([options.signal, local]) : local });
    } }) });
  async function request(method, params) {
    check();
    const block = v => v === 'finalized' || v === 'latest' || v === '0x0' || /^0x[1-9a-f][0-9a-f]*$/.test(v);
    const ref = v => v && Object.keys(v).sort().join(',') === 'blockHash,requireCanonical'
      && /^0x[0-9a-f]{64}$/.test(v.blockHash) && v.requireCanonical === true;
    const selectors = [...GETTERS, 'escrowCreationCodeHash', 'eip712Domain'].map(name => encodeFunctionData({
      abi: [{ type: 'function', name, stateMutability: 'view', inputs: [], outputs: [] }], functionName: name }));
    let allowed = method === 'eth_chainId' && params.length === 0;
    if (method === 'eth_getBlockByNumber') allowed = params.length === 2 && block(params[0]) && params[1] === false;
    if (method === 'eth_getTransactionCount') allowed = params.length === 2 && params[0] === FROM && params[1] === 'pending';
    if (method === 'eth_getBalance') allowed = params.length === 2 && params[0] === FROM && ref(params[1]);
    if (method === 'eth_getCode') allowed = params.length === 2 && [FROM, FACTORY, ARGS[0]].includes(params[0]) && ref(params[1]);
    if (method === 'eth_call') allowed = params.length === 2 && params[0].to === FACTORY
      && Object.keys(params[0]).sort().join(',') === 'data,gas,to' && params[0].gas === '0x186a0'
      && selectors.includes(params[0].data) && ref(params[1]);
    if (method === 'eth_estimateGas') allowed = JSON.stringify(params) === JSON.stringify([rpcEnvelope()]);
    if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt')
      allowed = params.length === 1 && params[0] === session.originalHash;
    if (method === 'eth_sendRawTransaction') {
      allowed = !readOnly && !sent && params.length === 1 && params[0] === session.originalRaw
        && session.sendAuthorized === true; sent = true;
    }
    assert(allowed, 'RPC_REQUEST_REJECTED'); calls++;
    diagnostics.method = method; diagnostics.requestNumber = calls;
    const value = await client.request({ method, params }, { retryCount: 0, dedupe: false });
    assert(performance.now() < end, 'RPC_BUDGET_EXHAUSTED');
    return value;
  }
  const session = { request, check, originalHash: null, originalRaw: null, sendAuthorized: false };
  return session;
}
let reviewedData; // Set only by the fixed artifact loader; never caller-provided.
function rpcEnvelope() { return { from: FROM, data: reviewedData, value: '0x0', nonce: '0x0',
  gas: '0x200b20', maxFeePerGas: '0x1bf08eb000', maxPriorityFeePerGas: '0x77359400' }; }
function header(value, number, hash) {
  assert(value && (number === undefined || q(value.number) === number)
    && (hash === undefined || value.hash === hash), 'CANONICAL_HEADER_CONFLICT');
  word(value.hash); q(value.number); return value;
}
async function network(rpc) {
  stage('CHAIN_ID');
  assert(q(await rpc.request('eth_chainId', [])) === BigInt(CHAIN), 'CHAIN_MISMATCH');
  stage('GENESIS');
  header(await rpc.request('eth_getBlockByNumber', ['0x0', false]), 0n, GENESIS);
}
async function canonical(rpc, h) { header(await rpc.request('eth_getBlockByNumber', [h.number, false]), q(h.number), h.hash); }
async function inspectRaw(raw, hash, c) {
  const tx = parseTransaction(hex(raw));
  assert(tx.type === 'eip1559' && tx.chainId === CHAIN && tx.to === undefined && tx.nonce === 0
    && tx.gas === GAS && tx.maxFeePerGas === FEE && tx.maxPriorityFeePerGas === PRIORITY
    && (tx.value ?? 0n) === 0n && tx.data === c.p.data && (tx.accessList?.length ?? 0) === 0
    && keccak256(raw) === hash && addr(await recoverTransactionAddress({ serializedTransaction: raw })) === FROM,
    'ORIGINAL_SIGNED_ENVELOPE_CONFLICT');
  return tx;
}
async function preflight(rpc) {
  await network(rpc);
  stage('ORIGINAL_PENDING_NONCE');
  assert(q(await rpc.request('eth_getTransactionCount', [FROM, 'pending'])) === 0n, 'ORIGINAL_NONCE_UNAVAILABLE');
  stage('FINALIZED_HEADER');
  const finalized = header(await rpc.request('eth_getBlockByNumber', ['finalized', false]));
  const ref = { blockHash: finalized.hash, requireCanonical: true };
  stage('FINALIZED_TEST_MON_BALANCE');
  assert(q(await rpc.request('eth_getBalance', [FROM, ref])) >= COST, 'INSUFFICIENT_TEST_MON');
  stage('ASSET_CODE');
  assert(keccak256(hex(await rpc.request('eth_getCode', [ARGS[0], ref]))) === ASSET_HASH, 'ASSET_CODE_CHANGED');
  stage('DEDICATED_EOA_CODE');
  assert(await rpc.request('eth_getCode', [FROM, ref]) === '0x', 'DEDICATED_EOA_REQUIRED');
  stage('EXPECTED_FACTORY_ABSENCE');
  assert(await rpc.request('eth_getCode', [FACTORY, ref]) === '0x', 'ORIGINAL_FACTORY_ALREADY_HAS_CODE');
  stage('LATEST_FEE_CEILING');
  const latest = header(await rpc.request('eth_getBlockByNumber', ['latest', false]));
  assert(q(latest.baseFeePerGas) + PRIORITY <= FEE, 'ORIGINAL_FEE_CEILING_UNAVAILABLE');
  stage('FIXED_INITCODE_GAS_ESTIMATE');
  const estimate = q(await rpc.request('eth_estimateGas', [rpcEnvelope()]));
  assert(estimate > 0n && estimate <= GAS, 'ORIGINAL_GAS_CEILING_UNAVAILABLE');
  stage('FINALIZED_CANONICAL_RECHECK');
  await canonical(rpc, finalized);
  stage('ORIGINAL_PENDING_NONCE_RECHECK');
  assert(q(await rpc.request('eth_getTransactionCount', [FROM, 'pending'])) === 0n, 'ORIGINAL_NONCE_UNAVAILABLE');
  return { finalizedBlockHash: finalized.hash, finalizedBlockNumber: String(q(finalized.number)),
    estimatedGas: String(estimate), baseFeePerGas: String(q(latest.baseFeePerGas)) };
}
export async function readOnlyPreflight() {
  stage('FIXED_PLAN');
  const c = loadReviewed();
  reviewedData = c.p.data;
  const observed = await preflight(rpcSession({ readOnly: true }));
  return summary(c, 'READONLY_PREFLIGHT_PASSED', { ...observed, signing: false,
    broadcast: false, journalAccess: false, keyAccess: false, requestCount: diagnostics.requestNumber });
}
function custodyAccount(c) {
  directory(c.meta.directory);
  const path = `${c.meta.directory}/${c.meta.keyHandle.name}`;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const s = fstatSync(fd), m = c.meta.keyHandle;
    assert(s.isFile() && s.uid === process.getuid() && (s.mode & 0o777) === 0o600 && s.nlink === 1
      && s.dev === m.device && s.ino === m.inode && s.size === 67, 'DEDICATED_KEY_METADATA_MISMATCH');
    bytes = readFileSync(fd);
    assert(/^0x[0-9a-fA-F]{64}\n$/.test(bytes.toString('ascii')), 'DEDICATED_KEY_FORMAT_REJECTED');
    const account = privateKeyToAccount(bytes.toString('ascii').trim());
    assert(addr(account.address) === FROM, 'DEDICATED_KEY_ACCOUNT_MISMATCH');
    return account;
  } finally { bytes?.fill(0); closeSync(fd); }
}

async function execute(c) {
  const existing = readJournal(c);
  if (existing) return summary(c, 'UNKNOWN_ORIGINAL_ONLY', { transactionHash: existing.retained?.transactionHash ?? null,
    reason: 'USE_OBSERVE_NO_RESIGN_NO_RESEND' });
  reviewedData = c.p.data;
  const rpc = rpcSession(), observed = await preflight(rpc);
  // Exclusive creation wins concurrent invocations. SIGNING is durable before
  // key open/read, so any interruption permanently prohibits a second signature.
  const fd = openSync(JOURNAL, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let prior;
  try {
    prior = append(fd, c, null, 'SIGNING', { material: c.material, observed }); syncDirectory();
    rpc.check();
    let account = custodyAccount(c);
    const raw = await account.signTransaction({ type: 'eip1559', chainId: CHAIN, nonce: 0,
      gas: GAS, maxFeePerGas: FEE, maxPriorityFeePerGas: PRIORITY, value: 0n,
      data: c.p.data, accessList: [] });
    account = null;
    const transactionHash = keccak256(raw);
    await inspectRaw(raw, transactionHash, c); rpc.check();
    prior = append(fd, c, prior, 'RETAINED', { raw, transactionHash });
    prior = append(fd, c, prior, 'BROADCAST_UNKNOWN', { transactionHash });
    rpc.originalRaw = raw; rpc.originalHash = transactionHash; rpc.sendAuthorized = true;
    const returned = await rpc.request('eth_sendRawTransaction', [raw]);
    assert(returned === transactionHash, 'ORIGINAL_BROADCAST_LOCATOR_CONFLICT');
    append(fd, c, prior, 'SEND_RETURNED', { transactionHash });
    return summary(c, 'BROADCAST_UNKNOWN', { transactionHash, reason: 'OBSERVE_ORIGINAL_FINALIZED_RECEIPT' });
  } finally { closeSync(fd); }
}

export function compareTemplate(code, deployed) {
  const actual = Buffer.from(hex(code).slice(2), 'hex');
  const template = Buffer.from(hex(deployed.object).slice(2), 'hex');
  assert(actual.length === template.length && actual.length <= 24576, 'FACTORY_RUNTIME_SIZE_MISMATCH');
  const covered = new Set();
  for (const refs of Object.values(deployed.immutableReferences ?? {})) for (const r of refs) {
    assert(Number.isSafeInteger(r.start) && r.start >= 0 && r.length === 32 && r.start + r.length <= actual.length);
    for (let i = r.start; i < r.start + r.length; i++) { assert(!covered.has(i)); covered.add(i); }
    actual.fill(0, r.start, r.start + r.length); template.fill(0, r.start, r.start + r.length);
  }
  assert(covered.size > 0 && actual.equals(template), 'FACTORY_RUNTIME_TEMPLATE_MISMATCH');
}
function receipt(value, hash) {
  assert(value && value.transactionHash === hash && addr(value.from) === FROM && value.to === null
    && addr(value.contractAddress) === FACTORY && q(value.status) === 1n
    && q(value.gasUsed) <= GAS && q(value.effectiveGasPrice) <= FEE
    && q(value.gasUsed) * q(value.effectiveGasPrice) <= COST, 'ORIGINAL_RECEIPT_NOT_VERIFIED');
  word(value.blockHash); q(value.blockNumber); q(value.transactionIndex); return value;
}
async function observe(c) {
  const journal = readJournal(c);
  if (!journal?.retained) return summary(c, 'UNKNOWN', { reason: 'NO_RETAINED_ORIGINAL_HASH' });
  const { raw, transactionHash } = journal.retained;
  const signed = await inspectRaw(raw, transactionHash, c);
  const rpc = rpcSession(); rpc.originalHash = transactionHash;
  await network(rpc);
  const tx = await rpc.request('eth_getTransactionByHash', [transactionHash]);
  const r = receipt(await rpc.request('eth_getTransactionReceipt', [transactionHash]), transactionHash);
  assert(tx && tx.hash === transactionHash && addr(tx.from) === FROM && tx.to === null && q(tx.type) === 2n
    && q(tx.chainId) === BigInt(CHAIN) && q(tx.nonce) === 0n && q(tx.value) === 0n && hex(tx.input) === c.p.data
    && q(tx.gas) === GAS && q(tx.maxFeePerGas) === FEE && q(tx.maxPriorityFeePerGas) === PRIORITY
    && scalar(tx.r) === BigInt(signed.r) && scalar(tx.s) === BigInt(signed.s)
    && q(tx.yParity ?? tx.v) === BigInt(signed.yParity) && Array.isArray(tx.accessList) && tx.accessList.length === 0
    && tx.blockHash === r.blockHash && q(tx.blockNumber) === q(r.blockNumber)
    && q(tx.transactionIndex) === q(r.transactionIndex), 'ORIGINAL_CHAIN_TRANSACTION_CONFLICT');
  const finalized = header(await rpc.request('eth_getBlockByNumber', ['finalized', false]));
  assert(q(r.blockNumber) <= q(finalized.number), 'ORIGINAL_RECEIPT_NOT_FINALIZED');
  header(await rpc.request('eth_getBlockByNumber', [r.blockNumber, false]), q(r.blockNumber), r.blockHash);
  const ref = { blockHash: finalized.hash, requireCanonical: true };
  const code = hex(await rpc.request('eth_getCode', [FACTORY, ref]));
  compareTemplate(code, c.artifact.deployedBytecode);
  assert(keccak256(hex(await rpc.request('eth_getCode', [ARGS[0], ref]))) === ASSET_HASH, 'ASSET_CODE_CHANGED');
  for (let i = 0; i < GETTERS.length + 1; i++) {
    const name = GETTERS[i] ?? 'escrowCreationCodeHash';
    const result = await rpc.request('eth_call', [{ to: FACTORY, data: encodeFunctionData({
      abi: c.artifact.abi, functionName: name }), gas: '0x186a0' }, ref]);
    assert(hex(result).length === 66, 'FACTORY_GETTER_RESULT_REJECTED');
    const decoded = decodeFunctionResult({ abi: c.artifact.abi, functionName: name, data: result });
    assert(i < GETTERS.length ? addr(decoded) === ARGS[i] : decoded === ESCROW_HASH, 'FACTORY_IMMUTABLE_MISMATCH');
  }
  const domainResult = await rpc.request('eth_call', [{ to: FACTORY, data: encodeFunctionData({
    abi: c.artifact.abi, functionName: 'eip712Domain' }), gas: '0x186a0' }, ref]);
  const domain = decodeFunctionResult({ abi: c.artifact.abi, functionName: 'eip712Domain', data: domainResult });
  assert(domain[0] === '0x0f' && domain[1] === 'MealForward Store Registration' && domain[2] === '1'
    && domain[3] === BigInt(CHAIN) && addr(domain[4]) === FACTORY && domain[5] === '0x' + '0'.repeat(64)
    && domain[6].length === 0, 'FACTORY_EIP712_DOMAIN_MISMATCH');
  await canonical(rpc, finalized);
  header(await rpc.request('eth_getBlockByNumber', [r.blockNumber, false]), q(r.blockNumber), r.blockHash);
  const again = receipt(await rpc.request('eth_getTransactionReceipt', [transactionHash]), transactionHash);
  assert(again.blockHash === r.blockHash && again.blockNumber === r.blockNumber
    && again.transactionIndex === r.transactionIndex, 'ORIGINAL_RECEIPT_CANONICAL_CONFLICT');
  const evidence = { transactionHash, factory: FACTORY, realFactoryCodeHash: keccak256(code),
    receiptBlockHash: r.blockHash, receiptBlockNumber: String(q(r.blockNumber)),
    finalizedBlockHash: finalized.hash, finalizedBlockNumber: String(q(finalized.number)),
    gasUsed: String(q(r.gasUsed)), effectiveGasPrice: String(q(r.effectiveGasPrice)),
    actualCostWei: String(q(r.gasUsed) * q(r.effectiveGasPrice)), escrowCreationCodeHash: ESCROW_HASH,
    templateArtifactSHA256: ARTIFACT_SHA, immutableGettersVerified: true, domainVerified: true };
  // Observe never mutates the original journal. Root retains this public proof
  // separately. Concurrent signing/sending must not bless a changing journal.
  const current = readJournal(c); assert(current.previous === journal.previous, 'ORIGINAL_JOURNAL_CHANGED');
  return summary(c, 'VERIFIED', evidence);
}

async function main() {
  let c;
  try {
    assert(process.argv.length === 3 && ['prepare', 'preflight', 'execute', 'observe'].includes(process.argv[2]), 'FIXED_ACTION_REQUIRED');
    // macOS injects its text-encoding marker even into env={}. No value is
    // inspected; accept only that OS marker and remove it before runtime work.
    assert(Object.keys(process.env).every(name => name === '__CF_USER_TEXT_ENCODING'), 'EMPTY_ENVIRONMENT_REQUIRED');
    delete process.env.__CF_USER_TEXT_ENCODING;
    if (process.argv[2] === 'preflight') {
      process.stdout.write(JSON.stringify(await readOnlyPreflight()) + '\n'); return;
    }
    c = loadReviewed();
    const value = process.argv[2] === 'prepare' ? summary(c, 'UNSIGNED_FIXED_PLAN_MATCHED')
      : await (process.argv[2] === 'execute' ? execute(c) : observe(c));
    process.stdout.write(JSON.stringify(value) + '\n');
  } catch (error) {
    // Never emit SDK/RPC exceptions, calldata, raw, key bytes or environment.
    let hash = null;
    try { hash = c && process.argv[2] !== 'prepare' ? readJournal(c)?.retained?.transactionHash ?? null : null; } catch {}
    process.stdout.write(JSON.stringify({ status: 'UNKNOWN', transactionHash: hash,
      ...safeFailure(error) }) + '\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
