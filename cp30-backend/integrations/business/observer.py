"""Block-pinned readonly StoreEscrow facts. No network client, DB or signing implementation."""
from __future__ import annotations
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

_last_diagnostic=None
def observation_diagnostic(error,phase,started):
    global _last_diagnostic
    now=time.monotonic()
    if _last_diagnostic is not None and now-_last_diagnostic<60:return
    _last_diagnostic=now
    allowed={'TOTAL_TIME_LIMIT','CALL_TIME_LIMIT','CALL_LIMIT','RESPONSE_LIMIT','PROOF_UNAVAILABLE',
        'BUSINESS_RPC_TIME_LIMIT','BUSINESS_RPC_UNAVAILABLE','PROFILE_OR_PINS_REQUIRED'}
    code=str(error) if str(error) in allowed else 'OBSERVATION_FAILED'
    print('C1_DIAGNOSTIC '+json.dumps({'component':'business_observer','code':code,
        'phase':phase,'elapsedMs':max(0,round((now-started)*1000))}),file=sys.stderr,flush=True)


class BusinessObservationError(ValueError):
    """Fixed errors only. Main must retain UNKNOWN on any absent evidence/error."""


# Independent business read scope; registration transport is intentionally not reused/changed.
READS = frozenset(('getAccounting', 'getUnit', 'getBatch', 'getVoucher', 'nextCandidate', 'getOperation',
                  'currentVersion', 'listed', 'paused', 'closed', 'controlRevision', 'getTerms', 'quoteUses',
                  'asset', 'storeId', 'owner', 'receiver', 'quoteAuthority', 'catalogAuthority',
                  'issuerAuthority', 'operatorAuthority', 'operationPayloadHash'))
METHODS = frozenset(('eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getTransactionByHash',
                     'eth_getTransactionReceipt', 'eth_call'))
BINDING_FIELDS = ('escrow', 'asset', 'storeId', 'owner', 'receiver', 'quoteAuthority', 'catalogAuthority', 'issuerAuthority', 'operatorAuthority')
KINDS = {'publish':1,'setListed':2,'issue': 5, 'lock': 6, 'markHandover': 7, 'report': 8, 'settle': 9}
EVENTS = {'publish':'Published','setListed':'ControlChanged','issue': 'Issued', 'lock': 'Locked', 'markHandover': 'HandoverMarked', 'report': 'Reported', 'settle': 'Settled', 'fund': 'Funded'}
ZERO_WORD = '0x' + '0' * 64
ZERO_ADDRESS = '0x' + '0' * 40
RUNTIME_PIN = '0x2d6f320edd2627a18683f2fd37f45acd41f7fb4951c89b99e062650487ce191b'
PINS = {
    'index.mjs': 'aa29a72b051c95e1d96a49b4fc6c4fbb118b20abf77e4144123cee62f5580c1c',
    'bridge.mjs': 'b67034cff7e0c54620c5d7dda3a526718e620221109a2c8a1d92f73aae81f359',
    'escrow-abi.mjs': '1e751fbb8e7c900a87f9b01ddf3a6a2a76af081d849deabf8fb2bd19ee18d74e',
    'codec.py': '63736cb1dae6049ac5e9710e6c425e755702dccb823c210515361b1580bc0589',
    '../wallet/index.mjs': '5a5c2c1961e55519829e78824b306308c09657f32712dccbc0dda13ccf44eca0',
    '../wallet/escrow-abi.mjs': '1f8c6f4e1d1657042ed89f0f76a16dac8ff7d608099d2edfa58dee6be0e69af7',
    '../wallet/factory-abi.mjs': 'e32e4605f0333b04464e3cdf55155016c512cb44ed05fdaceeb9af15c9aed838',
    '../wallet/escrow-creation-code.mjs': 'bd1eb01f7cfc4ce219df5e577bea09db63c2f9f20b06af5380264d0fb8908df7',
    '../wallet/registration-observer.mjs': 'e3ed91083c9d6e6dd8adff396ff1f2c64334ed2378c95544e190a0e294ed4926',
    '../wallet/observer-artifacts.mjs': '823728c980f74db6e8271b288c708db4d5346a711f0d2862c457f66caeac10bf',
}
# Fixed pure viem bridge; stdin contains data, never executable source/module paths.
_PROOF_JS = r'''
import {readFileSync} from 'node:fs';
import {decodeFunctionData,decodeEventLog,encodeFunctionData,encodeEventTopics,encodeAbiParameters,keccak256,stringToHex} from 'viem';
import {catalogAbi as businessEscrowAbi,preparePublish,prepareSetListed} from './catalog.mjs';
import {prepareIssue,prepareLock,prepareMarkHandover,prepareReport,prepareFundingQuote,jsonValue,trustedBinding} from './index.mjs';
import {prepareSettle} from '../wallet/index.mjs';
import {verifyRuntimeTemplate} from '../wallet/registration-observer.mjs';
const same=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error('MISMATCH');};
const observed=v=>typeof v==='number'||typeof v==='bigint'?String(v):typeof v==='string'&&v.startsWith('0x')?v.toLowerCase():Array.isArray(v)?v.map(observed):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,observed(x)])):v;
try {
 const raw=readFileSync(0);if(raw.length>131072)throw Error('LIMIT');const q=JSON.parse(raw);
 let result;
 if(q.op==='runtime'){verifyRuntimeTemplate(q.code,'escrow',q.pin);result={valid:true};}
 else if(q.op==='event'){
  const e=decodeEventLog({abi:businessEscrowAbi,data:q.log.data,topics:q.log.topics,strict:true});
  const abi=businessEscrowAbi.find(x=>x.type==='event'&&x.name===e.eventName);
  same(encodeEventTopics({abi:[abi],eventName:e.eventName,args:e.args}).map(x=>x.toLowerCase()),q.log.topics.map(x=>x.toLowerCase()));
  same(encodeAbiParameters(abi.inputs.filter(x=>!x.indexed),abi.inputs.filter(x=>!x.indexed).map(x=>e.args[x.name])).toLowerCase(),q.log.data.toLowerCase());
  result=observed(e);
 } else if(q.op==='operation'){
  const b=trustedBinding(q.binding),r=q.record,d=r.deployment;
  const call=decodeFunctionData({abi:businessEscrowAbi,data:d.data});if(call.functionName!==r.functionName)throw Error('FUNCTION');
  const abi=businessEscrowAbi.find(x=>x.type==='function'&&x.name===call.functionName);
  if(Object.keys(r.parameters).sort().join(',')!==abi.inputs.map(x=>x.name).sort().join(','))throw Error('FIELDS');
  same(encodeFunctionData({abi:businessEscrowAbi,functionName:call.functionName,args:abi.inputs.map(x=>r.parameters[x.name])}).toLowerCase(),d.data.toLowerCase());
  const roles={publish:['catalogAuthority',1],setListed:['catalogAuthority',2],issue:['issuerAuthority',5],lock:['operatorAuthority',6],markHandover:['operatorAuthority',7],report:['operatorAuthority',8],settle:['owner',9]};
  if(call.functionName==='fund'){
   const p=prepareFundingQuote({binding:b,quote:r.parameters.quote,now:'0'});
   if(d.from.toLowerCase()!==p.quote.payer)throw Error('PAYER');
   if(!/^0x[0-9a-fA-F]{130}$/.test(r.parameters.signature))throw Error('SIGNATURE');
   result={functionName:'fund',payloadHash:p.payloadHash,quoteDigest:p.digest,parameters:p.quote};
  } else {
   if(!roles[call.functionName])throw Error('UNSUPPORTED');const [role,kind]=roles[call.functionName];
   if(d.from.toLowerCase()!==b[role])throw Error('ROLE');
   let p;
   if(call.functionName==='settle')p=prepareSettle({binding:b,wallet:{chainId:b.chainId,account:d.from},...r.parameters});
   else p=({publish:preparePublish,setListed:prepareSetListed,issue:prepareIssue,lock:prepareLock,markHandover:prepareMarkHandover,report:prepareReport})[call.functionName]({binding:b,caller:d.from,parameters:r.parameters,now:'0'});
   same(p.data.toLowerCase(),d.data.toLowerCase());
   const parametersHash=keccak256(encodeAbiParameters(abi.inputs.slice(1),call.args.slice(1)));
   const opInputs=businessEscrowAbi.find(x=>x.name==='operationPayloadHash').inputs;
   const payloadHash=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'},{type:'address'},...opInputs],
     [keccak256(stringToHex('MealForwardOperationV1')),1n,BigInt(b.chainId),b.escrow,kind,d.from,call.args[0],parametersHash]));
   result={functionName:call.functionName,kind:String(kind),opId:call.args[0],payloadHash,parametersHash,parameters:r.parameters};
  }
  if(d.chainId!==b.chainId||d.to.toLowerCase()!==b.escrow||d.value!=='0'||d.callDataDigest!==keccak256(d.data)||r.payloadHash!==result.payloadHash)throw Error('ORIGINAL');
 } else throw Error('UNSUPPORTED');
 process.stdout.write(JSON.stringify(jsonValue(result)));
}catch{process.stdout.write('{"error":"BUSINESS_OBSERVER_CODEC_REJECTED"}');process.exitCode=1;}
'''


def _word(value, nonzero=False):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{64}', value) or (nonzero and value == ZERO_WORD):
        raise BusinessObservationError('INVALID_WORD')
    return value


def _address(value, nonzero=False):
    if type(value) is not str or not re.fullmatch(r'0x[0-9a-f]{40}', value) or (nonzero and value == ZERO_ADDRESS):
        raise BusinessObservationError('INVALID_ADDRESS')
    return value


def _uint(value):
    if type(value) is not str or not re.fullmatch(r'(?:0|[1-9][0-9]*)', value) or int(value) >= 2**256:
        raise BusinessObservationError('INVALID_INTEGER')
    return int(value)


def _rpc_uint(value):
    if type(value) is not str or not re.fullmatch(r'0x(?:0|[1-9a-f][0-9a-f]*)', value): raise BusinessObservationError('INVALID_RPC_INTEGER')
    return int(value, 16)


def _equal(a, b):
    if a != b: raise BusinessObservationError('ORIGINAL_OR_FACT_MISMATCH')


def _json(value):
    return json.dumps(value, separators=(',', ':'), allow_nan=False).encode()


class _Session:
    def __init__(self, observer):
        self.owner = observer
        self.started = time.monotonic()
        self.deadline = self.started + observer.budget['maxTotalMs'] / 1000
        self.transport = observer.transport_factory()
        if not callable(getattr(self.transport, 'request', None)): raise BusinessObservationError('TRANSPORT_REQUIRED')
        self.calls, self.bytes, self.cache = 0, 0, {}
        self.block = None

    def remaining(self):
        value = self.deadline-time.monotonic()
        if value <= 0: raise BusinessObservationError('TOTAL_TIME_LIMIT')
        return value

    def request(self, method, params):
        if method not in METHODS: raise BusinessObservationError('UNSUPPORTED_RPC')
        self.calls += 1
        if self.calls > self.owner.budget['maxCalls']: raise BusinessObservationError('CALL_LIMIT')
        end = min(self.deadline, time.monotonic() + self.owner.budget['maxCallMs']/1000)
        result = self.transport.request(method, deepcopy(params), deadline=end)
        if time.monotonic() > end: raise BusinessObservationError('CALL_TIME_LIMIT')
        size = len(_json(result)); self.bytes += size
        if size > self.owner.budget['maxResponseBytes'] or self.bytes > self.owner.budget['maxTotalBytes']:
            raise BusinessObservationError('RESPONSE_LIMIT')
        return result

    def codec(self, method, parameters):
        # Existing BusinessCodec has a fixed 2s subprocess bound; never start with less remaining time.
        if self.remaining() < 2.05: raise BusinessObservationError('TOTAL_TIME_LIMIT')
        result = self.owner.codec.call(method, parameters)
        self.remaining()
        return result

    def proof(self, **parameters):
        raw = _json(parameters)
        if len(raw)>131072: raise BusinessObservationError('PROOF_INPUT_LIMIT')
        result = subprocess.run([self.owner.codec.node, '--input-type=module', '-e', _PROOF_JS], input=raw,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={}, cwd=str(self.owner.root),
                                timeout=min(2, self.remaining()), check=False)
        self.remaining()
        if result.returncode or len(result.stdout)>1048576: raise BusinessObservationError('PROOF_UNAVAILABLE')
        value = json.loads(result.stdout)
        if type(value) is not dict or value.get('error'): raise BusinessObservationError('PROOF_UNAVAILABLE')
        return value

    def read(self, function_name, args=()):
        if function_name not in READS: raise BusinessObservationError('UNSUPPORTED_READ')
        key = (function_name, json.dumps(args))
        if key in self.cache: return deepcopy(self.cache[key])
        binding = self.owner.binding
        description = self.codec('prepareRead', {'binding':binding, 'functionName':function_name, 'args':list(args), 'block':self.block})
        expected_tag = {'blockHash':self.block['hash'], 'requireCanonical':True}
        _equal(description['chainId'], binding['chainId']); _equal(description['to'], binding['escrow'])
        _equal(description['functionName'], function_name); _equal(description['blockTag'], expected_tag)
        raw = self.request('eth_call', [{'to':binding['escrow'], 'data':description['data']}, expected_tag])
        observation = self.codec('decodeRead', {'binding':binding, 'read':description, 'result':raw})
        for field, expected in [('chainId',binding['chainId']),('escrow',binding['escrow']),('blockNumber',self.block['number']),('blockHash',self.block['hash']),('functionName',function_name),('authority','OBSERVATION_ONLY')]:
            _equal(observation[field], expected)
        self.cache[key] = observation['value']
        return deepcopy(observation['value'])

    def start(self, receipt=None):
        _equal(_rpc_uint(self.request('eth_chainId', [])), self.owner.binding['chainId'])
        genesis = self.request('eth_getBlockByNumber', ['0x0', False])
        _equal(genesis['hash'], self.owner.profile['genesisHash']); _equal(_rpc_uint(genesis['number']), 0)
        finalized = self.request('eth_getBlockByNumber', ['finalized', False])
        if finalized is None: raise BusinessObservationError('FINALIZED_UNAVAILABLE')
        final_number = _rpc_uint(finalized['number']); _word(finalized['hash'], True)
        final_canonical = self.request('eth_getBlockByNumber', [hex(final_number), False])
        _equal(final_canonical['hash'], finalized['hash']); _equal(_rpc_uint(final_canonical['number']), final_number)
        header = final_canonical
        if receipt is not None:
            number = _rpc_uint(receipt['blockNumber'])
            if number>final_number: raise BusinessObservationError('NOT_FINALIZED')
            header = self.request('eth_getBlockByNumber', [hex(number), False])
            _equal(header['hash'], receipt['blockHash']); _equal(_rpc_uint(header['number']), number)
        self.block = {'number':str(_rpc_uint(header['number'])), 'hash':_word(header['hash'], True)}
        self.timestamp = str(_rpc_uint(header['timestamp']))
        raw = self.request('eth_getCode', [self.owner.binding['escrow'], {'blockHash':self.block['hash'], 'requireCanonical':True}])
        self.proof(op='runtime', code=raw, pin=self.owner.profile['runtimeTemplatePin'])
        for name in BINDING_FIELDS:
            if name!='escrow': _equal(self.read(name), self.owner.binding[name])

    def finish(self):
        header = self.request('eth_getBlockByNumber', [hex(int(self.block['number'])), False])
        _equal(header['hash'], self.block['hash']); _equal(str(_rpc_uint(header['number'])), self.block['number'])
        _equal(_rpc_uint(self.request('eth_chainId', [])), self.owner.binding['chainId'])
        self.remaining()


class StoreEscrowObserver:
    def __init__(self, *, codec, transport_factory, profile):
        # This entire profile is loaded from trusted persisted CONFIRMED+VERIFIED registration evidence.
        if not callable(getattr(codec,'call',None)) or not Path(getattr(codec,'node','')).is_absolute() or not callable(transport_factory):
            raise BusinessObservationError('CONFIGURATION_REQUIRED')
        if type(profile) is not dict or set(profile)!= {'binding','registrationState','registrationEvidence','genesisHash','finality','eip1898','runtimeTemplatePin','compilerPins','budget'}:
            raise BusinessObservationError('CONFIGURATION_REQUIRED')
        self.root = Path(__file__).resolve().parent
        self.profile = deepcopy(profile); self.binding = deepcopy(profile['binding']); self.budget=deepcopy(profile['budget'])
        if set(self.binding)!= {'chainId', *BINDING_FIELDS} or type(self.binding['chainId']) is not int or not 1<=self.binding['chainId']<2**53:
            raise BusinessObservationError('BINDING_REQUIRED')
        for field in BINDING_FIELDS:
            (_word if field=='storeId' else _address)(self.binding[field], True)
        _equal(self.binding['owner'], self.binding['receiver'])
        evidence = profile['registrationEvidence']
        if profile['registrationState']!='CONFIRMED' or type(evidence) is not dict: raise BusinessObservationError('VERIFIED_REGISTRATION_REQUIRED')
        for field in BINDING_FIELDS: _equal(evidence.get(field),self.binding[field])
        _equal(evidence.get('chainId'),str(self.binding['chainId']))
        for field in ('configHash','parametersDigest','transactionHash','blockHash','registrationId'): _word(evidence.get(field),True)
        if type(evidence.get('deployment')) is not dict or not evidence.get('catalog'): raise BusinessObservationError('VERIFIED_REGISTRATION_REQUIRED')
        _word(profile['genesisHash'],True)
        if profile['finality']!='rpc-finalized' or profile['eip1898'] is not True or profile['runtimeTemplatePin']!=RUNTIME_PIN or profile['compilerPins']!=PINS:
            raise BusinessObservationError('PROFILE_OR_PINS_REQUIRED')
        caps={'maxCalls':96,'maxTotalMs':45000,'maxCallMs':5000,'maxResponseBytes':1048576,'maxTotalBytes':1048576,'maxMealIds':3}
        if set(self.budget)!=set(caps) or any(type(self.budget[k]) is not int or not 1<=self.budget[k]<=cap for k,cap in caps.items()): raise BusinessObservationError('BUDGET_REQUIRED')
        if self.budget['maxCallMs']>self.budget['maxTotalMs']: raise BusinessObservationError('BUDGET_REQUIRED')
        self.codec, self.transport_factory = codec, transport_factory
        self._pins()

    def _pins(self):
        from .catalog_codec import verify_pins
        verify_pins()
        for path, digest in PINS.items():
            if hashlib.sha256((self.root/path).read_bytes()).hexdigest()!=digest: raise BusinessObservationError('SOURCE_PIN_MISMATCH')

    def _snapshot(self, session, meal_ids=(), voucher_ids=(), op_ids=()):
        if len(voucher_ids)>4 or len(op_ids)>4: raise BusinessObservationError('RELATED_ID_LIMIT')
        accounting = session.read('getAccounting')
        funded = _uint(accounting['fundedUnits'])
        if funded>10 or len(accounting['counts'])!=5 or len(accounting['amounts'])!=5: raise BusinessObservationError('ACCOUNTING_SHAPE')
        counts=list(map(_uint,accounting['counts'])); amounts=list(map(_uint,accounting['amounts']))
        _equal(sum(counts),funded); _equal(sum(amounts),_uint(accounting['fundedAmount'])); _equal(sum(amounts[:3]),_uint(accounting['liability']))
        units=[]; observed_counts=[0]*5; observed_amounts=[0]*5; vouchers={}; batches={}; terms={}
        meals=set(meal_ids)
        meals.update(e['terms']['mealId'] for e in self.profile['registrationEvidence']['catalog'])
        for seq in range(funded):
            unit=session.read('getUnit',[str(seq)])
            bucket=_uint(unit['bucket']); price=_uint(unit['unitPrice']); generation=_uint(unit['generation'])
            if bucket>4 or price==0: raise BusinessObservationError('UNIT_SHAPE')
            for field in ('batchId','mealId','termsHash'): _word(unit[field],True)
            _address(unit['payer'],True); _uint(unit['localIndex'])
            if _uint(unit['version'])==0: raise BusinessObservationError('UNIT_VERSION')
            if _uint(unit['localIndex'])>9: raise BusinessObservationError('UNIT_INDEX')
            _word(unit['voucherId'])
            if (generation==0)!=(unit['voucherId']==ZERO_WORD): raise BusinessObservationError('UNIT_GENERATION')
            if bucket in (1,2,3) and generation==0: raise BusinessObservationError('UNIT_VOUCHER_REQUIRED')
            observed_counts[bucket]+=1; observed_amounts[bucket]+=price
            units.append({'seq':str(seq),**unit}); meals.add(unit['mealId'])
            if unit['batchId'] not in batches: batches[unit['batchId']]=session.read('getBatch',[unit['batchId']])
            batch=batches[unit['batchId']]
            for field in ('payer','mealId','version','termsHash','unitPrice'): _equal(unit[field],batch[field])
            _equal(seq,_uint(batch['firstUnit'])+_uint(unit['localIndex']))
            if not 1<=_uint(batch['quantity'])<=10 or _uint(unit['localIndex'])>=_uint(batch['quantity']): raise BusinessObservationError('BATCH_UNIT_INDEX')
            if unit['voucherId']!=ZERO_WORD:
                voucher=session.read('getVoucher',[unit['voucherId']]); vouchers[unit['voucherId']]=voucher
                for field, value in [('unitSeq',str(seq)),('generation',unit['generation']),('termsHash',unit['termsHash']),('issuer',self.binding['issuerAuthority'])]: _equal(voucher[field],value)
                _equal(_uint(voucher['expiresAt']),_uint(voucher['issuedAt'])+259200)
                if voucher['expired'] and bucket not in (0,4): raise BusinessObservationError('VOUCHER_BUCKET')
                if voucher['lockId']!=ZERO_WORD:
                    _equal(voucher['operator'],self.binding['operatorAuthority']); _equal(voucher['processor'],self.binding['owner'])
                    if not _uint(voucher['issuedAt'])<=_uint(voucher['lockedAt'])<_uint(voucher['expiresAt']): raise BusinessObservationError('LOCK_TIME')
                if voucher['markerId']!=ZERO_WORD:
                    if voucher['lockId']==ZERO_WORD or not _uint(voucher['issuedAt'])<=_uint(voucher['handoverRecordedAt'])<_uint(voucher['expiresAt']) or _uint(voucher['handoverBlock'])>int(session.block['number']): raise BusinessObservationError('MARKER_FACT')
                if voucher['reportId']!=ZERO_WORD and voucher['markerId']==ZERO_WORD: raise BusinessObservationError('REPORT_FACT')
                if voucher['settleId']!=ZERO_WORD and (voucher['reportId']==ZERO_WORD or bucket!=3): raise BusinessObservationError('SETTLE_FACT')
                if bucket in (2,3) and voucher['reportId']==ZERO_WORD: raise BusinessObservationError('REPORT_FACT')
            key=(unit['mealId'],unit['version'])
            if key not in terms: terms[key]=session.read('getTerms',list(key))
            _equal(terms[key]['unitPrice'],unit['unitPrice']); _equal(terms[key]['termsHash'],unit['termsHash'])
        _equal(observed_counts,counts); _equal(observed_amounts,amounts)
        if len(meals)>self.budget['maxMealIds']: raise BusinessObservationError('MEAL_LIMIT')
        controls={'paused':session.read('paused'),'closed':session.read('closed'),'revision':session.read('controlRevision')}
        menu={}
        for meal_id in sorted(meals):
            _word(meal_id,True)
            version=session.read('currentVersion',[meal_id]); listed=session.read('listed',[meal_id]); candidate=session.read('nextCandidate',[meal_id])
            _uint(version)
            if candidate['available']:
                seq=_uint(candidate['unitSeq'])
                if seq>=funded or controls['paused'] or controls['closed'] or not listed: raise BusinessObservationError('CANDIDATE_MISMATCH')
                unit=units[seq]
                _equal(unit['mealId'],meal_id); _equal(candidate['termsHash'],unit['termsHash']); _equal(_uint(candidate['nextGeneration']),_uint(unit['generation'])+1)
                if candidate['needsExpiry']:
                    voucher=vouchers.get(unit['voucherId'])
                    if unit['bucket']!='1' or not voucher or voucher['expired'] or voucher['lockId']!=ZERO_WORD or voucher['markerId']!=ZERO_WORD or _uint(voucher['expiresAt'])>int(session.timestamp): raise BusinessObservationError('CANDIDATE_EXPIRY')
                elif unit['bucket']!='0': raise BusinessObservationError('CANDIDATE_BUCKET')
            # available=false is the actual all-zero Candidate, not a fabricated missing unit.
            current_terms=session.read('getTerms',[meal_id,version]) if version!='0' else None
            menu[meal_id]={'currentVersion':version,'listed':listed,'candidate':candidate,'terms':current_terms}
        for voucher_id in voucher_ids:
            _word(voucher_id,True)
            if voucher_id not in vouchers: vouchers[voucher_id]=session.read('getVoucher',[voucher_id])
        operations={_word(op_id,True):session.read('getOperation',[op_id]) for op_id in op_ids}
        return {'chainId':self.binding['chainId'],'escrow':self.binding['escrow'],'blockNumber':session.block['number'],
                'blockHash':session.block['hash'],'timestamp':session.timestamp,'accounting':accounting,'units':units,
                'batches':batches,'vouchers':vouchers,'operations':operations,'menu':menu,'controls':controls,
                'terms':[{'mealId':m,'version':v,**t} for (m,v),t in terms.items()], 'authority':'CANONICAL_FINALIZED_CHAIN_FACTS'}

    def read_finalized(self, *, meal_ids=(), voucher_ids=(), op_ids=()):
        started=time.monotonic();phase='pins'
        try:
            self._pins();phase='start';session=_Session(self);session.start()
            phase='snapshot';snapshot=self._snapshot(session,meal_ids,voucher_ids,op_ids)
            phase='finish';session.finish()
            return snapshot
        except Exception as error:
            observation_diagnostic(error,phase,started)
            return None  # Missing facts/error remains unknown; no partial projection.

    def verify_original_operation(self, record, tx_hash, *, meal_ids=()):
        if tx_hash is None: return None
        started=time.monotonic()
        try:
            self._pins(); _word(tx_hash,True)
            if type(record) is not dict or set(record)!= {'functionName','parameters','deployment','payloadHash'} or record['functionName'] not in EVENTS: raise BusinessObservationError('UNSUPPORTED_RECORD')
            deployment=record['deployment']
            if type(deployment) is not dict or set(deployment)!= {'chainId','from','to','value','data','callDataDigest'}: raise BusinessObservationError('ORIGINAL_DEPLOYMENT_REQUIRED')
            session=_Session(self)
            proof=session.proof(op='operation',binding=self.binding,record=record)
            tx=session.request('eth_getTransactionByHash',[tx_hash])
            if tx is None: return None
            for field,expected in [('hash',tx_hash),('from',deployment['from']),('to',self.binding['escrow']),('input',deployment['data'])]: _equal(tx[field],expected)
            _equal(_rpc_uint(tx['chainId']),self.binding['chainId']); _equal(_rpc_uint(tx['value']),0)
            receipt=session.request('eth_getTransactionReceipt',[tx_hash])
            if receipt is None: return None
            for field,expected in [('transactionHash',tx_hash),('from',deployment['from']),('to',self.binding['escrow'])]: _equal(receipt[field],expected)
            status=_rpc_uint(receipt['status'])
            if status not in (0,1): return None
            _equal(tx['blockHash'],receipt['blockHash']); _equal(tx['blockNumber'],receipt['blockNumber'])
            session.start(receipt)
            if status==0:
                if record['functionName']!='lock':return None
                p=record['parameters'];voucher=session.read('getVoucher',[p['voucherId']]);operation=session.read('getOperation',[p['opId']])
                _equal(voucher['generation'],p['generation']);_equal(operation['kind'],'0')
                for field in ('lockId','markerId','reportId','settleId'):_equal(voucher[field],'0x'+'0'*64)
                session.finish()
                return {'authority':'VERIFIED_ORIGINAL_LOCK_REVERT','original':deepcopy(record),'transactionHash':tx_hash,
                        'blockNumber':session.block['number'],'blockHash':session.block['hash'],'timestamp':session.timestamp,
                        'receiptStatus':'0','voucher':voucher,'operation':operation}
            events=[]
            for log in receipt['logs']:
                if log['address']!=self.binding['escrow']: continue
                if log.get('removed') is True: raise BusinessObservationError('REMOVED_EVENT')
                for field,expected in [('transactionHash',tx_hash),('blockHash',session.block['hash'])]: _equal(log[field],expected)
                _equal(str(_rpc_uint(log['blockNumber'])),session.block['number'])
                event=session.proof(op='event',log={'data':log['data'],'topics':log['topics']})
                events.append({**event,'logIndex':str(_rpc_uint(log['logIndex']))})
            relevant=[e for e in events if e['eventName']==EVENTS[record['functionName']]]
            if len(relevant)!=1: raise BusinessObservationError('ORIGINAL_EVENT_REQUIRED')
            event=relevant[0]; args=event['args']; p=record['parameters']; operation=None
            voucher_ids=[]; op_ids=[]
            if record['functionName']=='fund':
                q=proof['parameters']; uses=session.read('quoteUses',[q['quoteId']])
                _equal(uses[0],proof['payloadHash']); _equal(uses[1],args['batchId'])
                for field,value in [('quoteId',q['quoteId']),('payer',q['payer']),('mealId',q['mealId']),('version',q['currentVersion']),('termsHash',q['termsHash']),('unitPrice',q['unitPrice']),('quantity',q['quantity']),('amount',q['amount'])]: _equal(args[field],value)
                batch=session.read('getBatch',[args['batchId']])
                for field,value in [('payer',q['payer']),('mealId',q['mealId']),('version',q['currentVersion']),('termsHash',q['termsHash']),('unitPrice',q['unitPrice']),('quantity',q['quantity']),('firstUnit',args['firstUnit'])]: _equal(batch[field],value)
            else:
                op_id=proof['opId']; op_ids=[op_id]; operation=session.read('getOperation',[op_id])
                for field,value in [('kind',proof['kind']),('caller',deployment['from']),('payloadHash',proof['payloadHash']),('executedAt',session.timestamp)]: _equal(operation[field],value)
                _equal(session.read('operationPayloadHash',[proof['kind'],deployment['from'],op_id,proof['parametersHash']]),proof['payloadHash'])
                executed=[e for e in events if e['eventName']=='OperationExecuted' and e['args']['opId']==op_id]
                if len(executed)!=1: raise BusinessObservationError('OPERATION_EVENT_REQUIRED')
                for field in ('kind','caller','payloadHash','result'): _equal(executed[0]['args'][field],operation[field])
                if record['functionName'] in {'publish','setListed'}:
                    meal=p['input']['mealId'] if record['functionName']=='publish' else p['mealId']
                    _equal(args['mealId'],meal);_equal(args['revision'],str(int(p['expectedControlRevision'])+1))
                    _equal(session.read('controlRevision'),args['revision'])
                    if record['functionName']=='publish':
                        _equal(args['version'],p['input']['version']);_equal(session.read('currentVersion',[meal]),args['version'])
                        terms=session.read('getTerms',[meal,args['version']])
                        for name in ('unitPrice','bodyDigest','imageDigest','windowCount','startMinute0','endMinute0','startMinute1','endMinute1'):_equal(terms[name],p['input'][name])
                        _equal(terms['termsHash'],args['termsHash']);_equal(operation['result'],args['termsHash'])
                    else:
                        _equal(args['kind'],'2');_equal(args['value'],p['value']);_equal(session.read('listed',[meal]),p['value'])
                        _equal(int(operation['result'],16),int(args['revision']))
                    meal_ids=tuple(set(meal_ids)|{meal})
                else:
                    voucher_id=args['voucherId']; voucher_ids=[voucher_id]
                    if record['functionName']=='issue':
                        for field,value in [('unitSeq',p['expectedUnitSeq']),('generation',p['expectedNextGeneration']),('termsHash',p['expectedTermsHash']),('issuedAt',session.timestamp)]: _equal(args[field],value)
                        _equal(operation['result'],voucher_id)
                    else:
                        _equal(voucher_id,p['voucherId'])
                        if record['functionName']=='lock':
                            for field,value in [('lockId',op_id),('generation',p['generation']),('at',session.timestamp),('operator',deployment['from']),('processor',self.binding['owner'])]: _equal(args[field],value)
                        elif record['functionName']=='markHandover':
                            for field,value in [('markerId',op_id),('lockId',p['lockId']),('generation',p['generation']),('at',session.timestamp),('blockNumber',session.block['number'])]: _equal(args[field],value)
                        elif record['functionName']=='report': _equal(args['resultId'],op_id); _equal(args['markerId'],p['markerId'])
                        else: _equal(args['opId'],op_id); _equal(args['receiver'],self.binding['receiver'])
                        if record['functionName']!='settle': _equal(operation['result'],op_id)
                        else: _equal(str(int(operation['result'],16)),args['amount'])
            snapshot=self._snapshot(session,meal_ids=meal_ids,voucher_ids=voucher_ids,op_ids=op_ids)
            if voucher_ids:
                voucher=snapshot['vouchers'][voucher_ids[0]]
                expected_generation=p['expectedNextGeneration'] if record['functionName']=='issue' else p['generation']
                _equal(voucher['generation'],expected_generation)
                unit=snapshot['units'][_uint(voucher['unitSeq'])]
                _equal(unit['voucherId'],voucher_ids[0]); _equal(unit['termsHash'],voucher['termsHash'])
                if record['functionName']=='issue': _equal(unit['mealId'],p['mealId']); _equal(voucher['issuer'],deployment['from']); _equal(voucher['issuedAt'],args['issuedAt']); _equal(voucher['expiresAt'],args['expiresAt'])
                if record['functionName']=='lock': _equal(voucher['lockId'],proof['opId']); _equal(voucher['operator'],deployment['from']); _equal(voucher['processor'],self.binding['owner'])
                if record['functionName']=='markHandover': _equal(voucher['markerId'],proof['opId']); _equal(voucher['lockId'],p['lockId']); _equal(voucher['handoverBlock'],session.block['number'])
                if record['functionName']=='report': _equal(voucher['reportId'],proof['opId']); _equal(voucher['lockId'],p['lockId']); _equal(voucher['markerId'],p['markerId']); _equal(args['amount'],unit['unitPrice'])
                if record['functionName']=='settle': _equal(voucher['settleId'],proof['opId']); _equal(args['amount'],unit['unitPrice'])
            if record['functionName']=='fund':
                start=_uint(args['firstUnit']); quantity=_uint(args['quantity'])
                if start+quantity>len(snapshot['units']): raise BusinessObservationError('FUNDED_UNIT_RANGE')
                for unit in snapshot['units'][start:start+quantity]: _equal(unit['batchId'],args['batchId'])
            session.finish()
            return {'original':deepcopy(record),'transactionHash':tx_hash,'chainId':self.binding['chainId'],'escrow':self.binding['escrow'],
                    'blockHash':session.block['hash'],'blockNumber':session.block['number'],'logIndex':event['logIndex'],
                    'event':event,'operation':operation,'snapshot':snapshot,'authority':'VERIFIED_ORIGINAL_CHAIN_OPERATION'}
        except Exception as error:
            observation_diagnostic(error,'original_operation',started)
            return None
