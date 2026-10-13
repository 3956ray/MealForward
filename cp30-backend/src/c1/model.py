"""Independent bounded S0b synthetic authority, with no business/auth imports.

S0b static ABI commitments use an independent pure Keccak implementation.
Envelope/typed JSON commitments are separately labelled synthetic SHA256.
Every transition works on a copy; rejects cannot partially normalize stock.
"""
from __future__ import annotations
import copy
import hashlib
import json
import re

TTL = 259200
UINT256 = (1 << 256) - 1
KINDS = {'publish', 'listed', 'paused', 'close', 'fund', 'issue', 'lock', 'handover', 'report', 'settle', 'expire', 'refund'}
SCHEMAS = {
 'publish': {'expected_control_revision', 'meal_id', 'version', 'terms'},
 'listed': {'expected_control_revision', 'meal_id', 'listed'},
 'paused': {'expected_control_revision', 'paused'}, 'close': {'expected_control_revision'},
 'fund': {'meal_id', 'version', 'terms_hash', 'quantity', 'unit_price', 'amount', 'deadline', 'batch_id', 'quote_id'},
 'issue': {'meal_id', 'expected_unit_seq', 'expected_next_generation', 'expected_terms_hash', 'deadline'},
 'lock': {'voucher_id', 'generation', 'deadline'},
 'handover': {'voucher_id', 'generation', 'lock_id', 'deadline'},
 'report': {'voucher_id', 'generation', 'lock_id', 'marker_id'},
 'settle': {'voucher_id', 'generation'}, 'expire': {'voucher_id', 'generation'},
 'refund': {'batch_id', 'mask'},
}

class ModelError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def require(condition, code):
    if not condition:
        raise ModelError(code)

def integer(value, *, positive=False, maximum=UINT256):
    require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*', value) is not None, 'INVALID_INTEGER')
    parsed = int(value)
    require(parsed <= maximum and (parsed > 0 if positive else parsed >= 0), 'INTEGER_RANGE')
    return parsed

def number(value, *, maximum=UINT256):
    require(type(value) is int and 0 <= value <= maximum, 'INVALID_NUMBER')
    return value

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()

_ROT = ((0,36,3,41,18),(1,44,10,45,2),(62,6,43,15,61),(28,55,25,21,56),(27,20,39,8,14))
_RC = (1,0x8082,0x800000000000808a,0x8000000080008000,0x808b,0x80000001,0x8000000080008081,0x8000000000008009,0x8a,0x88,0x80008009,0x8000000a,0x8000808b,0x800000000000008b,0x8000000000008089,0x8000000000008003,0x8000000000008002,0x8000000000000080,0x800a,0x800000008000000a,0x8000000080008081,0x8000000000008080,0x80000001,0x8000000080008008)
_MASK64 = (1 << 64) - 1

def keccak256(data):
    """Keccak-f[1600], legacy Ethereum 0x01 domain, 136-byte rate."""
    padded = bytearray(data); padded.append(1)
    padded.extend(bytes((-len(padded)) % 136)); padded[-1] |= 128
    state = [0] * 25
    def rotate(x,n): return ((x << n) | (x >> ((64-n) % 64))) & _MASK64
    for offset in range(0,len(padded),136):
        for i in range(17): state[i] ^= int.from_bytes(padded[offset+8*i:offset+8*i+8], 'little')
        for rc in _RC:
            c = [state[x]^state[x+5]^state[x+10]^state[x+15]^state[x+20] for x in range(5)]
            d = [c[(x-1)%5]^rotate(c[(x+1)%5],1) for x in range(5)]
            for x in range(5):
                for y in range(5): state[x+5*y] ^= d[x]
            b=[0]*25
            for x in range(5):
                for y in range(5): b[y+5*((2*x+3*y)%5)] = rotate(state[x+5*y],_ROT[x][y])
            for x in range(5):
                for y in range(5): state[x+5*y] = b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y])
            state[0] ^= rc
    return b''.join(v.to_bytes(8,'little') for v in state)[:32]

def word(value):
    if type(value) is bool: return int(value).to_bytes(32,'big')
    if type(value) is int: return number(value).to_bytes(32,'big')
    if type(value) is str and value.startswith('0x'):
        require(re.fullmatch(r'0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})',value) is not None, 'INVALID_ABI')
        return bytes.fromhex(value[2:]).rjust(32,bytes(1))
    raise ModelError('INVALID_ABI')

def abi_hash(values): return '0x'+keccak256(b''.join(word(v) for v in values)).hex()

def voucher_hash(manifest, seq, generation):
    return abi_hash(['0x'+keccak256(b'MealForwardVoucherV1').hex(), manifest['chain_id'],manifest['escrow'],seq,generation])

_TERMS_TYPE = b'MealForwardTerms(uint256 schemaVersion,uint256 chainId,address escrow,bytes32 storeId,bytes32 mealId,uint256 version,address asset,uint256 unitPrice,bytes32 bodyDigest,bytes32 imageDigest,uint8 windowCount,uint16 startMinute0,uint16 endMinute0,uint16 startMinute1,uint16 endMinute1,uint16 utcOffsetMinutes)'

def terms_hash(manifest, meal_id, version, terms):
    pairs=windows(terms); flat=[v for pair in pairs for v in pair] + ([0,0] if len(pairs)==1 else [])
    return abi_hash(['0x'+keccak256(_TERMS_TYPE).hex(),1,manifest['chain_id'],manifest['escrow'],manifest['store_id'],meal_id,version,manifest['asset'],integer(terms['price'],positive=True),terms['body_digest'],terms['image_digest'],len(pairs),*flat,480])

def operation_hash(manifest, op):
    p,k = op['payload'],op['kind']
    kinds={'publish':1,'listed':2,'paused':3,'close':4,'issue':5,'lock':6,'handover':7,'report':8,'settle':9,'expire':10,'refund':11}
    require(k in kinds,'INVALID_OPERATION_DOMAIN')
    if k=='publish':
        t=p['terms']; pairs=windows(t); flat=[v for pair in pairs for v in pair]+([0,0] if len(pairs)==1 else [])
        args=[p['expected_control_revision'],p['meal_id'],p['version'],integer(t['price']),t['body_digest'],t['image_digest'],len(pairs),*flat]
    else:
        orders={'listed':['expected_control_revision','meal_id','listed'],'paused':['expected_control_revision','paused'],'close':['expected_control_revision'],
            'issue':['meal_id','expected_unit_seq','expected_next_generation','expected_terms_hash','deadline'],
            'lock':['voucher_id','generation','deadline'],'handover':['voucher_id','generation','lock_id','deadline'],
            'report':['voucher_id','generation','lock_id','marker_id'],'settle':['voucher_id','generation'],'expire':['voucher_id','generation'],
            'refund':['batch_id','mask']}
        args=[p[a] for a in orders[k]]
    return abi_hash(['0x'+keccak256(b'MealForwardOperationV1').hex(),1,manifest['chain_id'],manifest['escrow'],kinds[k],op['caller'],op['op_id'],abi_hash(args)])

def windows(terms):
    pairs = terms['windows']
    require(type(pairs) is list and 1 <= len(pairs) <= 2, 'INVALID_WINDOWS')
    prior = -1
    for pair in pairs:
        require(type(pair) is list and len(pair) == 2, 'INVALID_WINDOWS')
        start, end = pair
        number(start, maximum=1439); number(end, maximum=1440)
        require(start < end and start >= prior, 'INVALID_WINDOWS')
        prior = end
    return pairs

def window_end(terms, now):
    local = (now + 28800) % 86400
    for start, end in windows(terms):
        if start * 60 <= local < end * 60:
            return now + end * 60 - local
    return None

def validate_terms(terms):
    require(type(terms) is dict and set(terms) == {'price','terms_hash','body_digest','image_digest','windows','body_available','image_available'}, 'INVALID_TERMS')
    integer(terms['price'], positive=True)
    for key in ('terms_hash', 'body_digest', 'image_digest'):
        require(type(terms[key]) is str and bool(terms[key]) and terms[key] != '0' * 64, 'INVALID_COMMITMENT')
    require(type(terms['body_available']) is bool and type(terms['image_available']) is bool, 'INVALID_CONTENT')
    windows(terms)

def accounting(snapshot):
    totals = {key: 0 for key in 'FARHSX'}
    counts = {key: 0 for key in 'FARHSX'}
    for unit in snapshot['units']:
        require(unit['state'] in 'ARHSX' and len(unit['state']) == 1, 'INVALID_BUCKET')
        amount = integer(unit['price'], positive=True)
        totals['F'] += amount; totals[unit['state']] += amount
        counts['F'] += 1; counts[unit['state']] += 1
    require(totals['F'] == sum(totals[k] for k in 'ARHSX'), 'ACCOUNTING_MISMATCH')
    require(all(amount <= UINT256 for amount in totals.values()), 'ACCOUNTING_OVERFLOW')
    require(counts['F'] <= 10, 'LIFETIME_CAP')
    return {'amounts': {k: str(v) for k, v in totals.items()}, 'counts': counts,
            'liability': str(sum(totals[k] for k in 'ARH'))}

def safe_expired(unit, now):
    return unit['state'] == 'R' and now >= unit['expires_at'] and not unit.get('lock') and not unit.get('marker')

def next_candidate(snapshot, meal_id):
    for unit in sorted(snapshot['units'], key=lambda u: u['seq']):
        if unit['meal_id'] == meal_id and (unit['state'] == 'A' or safe_expired(unit, snapshot['now'])):
            return unit
    return None

def initial_snapshot(manifest, catalog=None, balances=None, now=0, source_epoch=1):
    require(manifest['owner'] == manifest['receiver'], 'INVALID_RECEIVER')
    require(manifest['chain_id'] == 31337, 'WRONG_CHAIN')
    for key in ('escrow','asset','owner','receiver','catalog','issuer','operator','quote'):
        require(re.fullmatch(r'0x[0-9a-fA-F]{40}',manifest[key]) is not None and int(manifest[key][2:],16)>0, 'INVALID_ADDRESS')
    require(manifest['escrow'] not in {manifest[k] for k in ('owner','catalog','issuer','operator','quote')}, 'INVALID_ROLES')
    require(word(manifest['store_id']) != bytes(32),'INVALID_STORE')
    roles = [manifest[k] for k in ('owner','catalog','issuer','operator','quote')]
    require(all(type(v) is str and v for v in roles) and len(set(roles)) == len(roles), 'INVALID_ROLES')
    catalog = copy.deepcopy(catalog or {})
    heads = {}
    for meal, records in catalog.items():
        for record in records.values(): validate_terms(record)
        heads[meal] = {'version': max(int(v) for v in records), 'listed': True}
    snapshot = {'manifest':copy.deepcopy(manifest), 'catalog':catalog, 'heads':heads,
        'controls':{'revision':0,'paused':False,'closed':False}, 'units':[], 'operations':{},
        'balances':copy.deepcopy(balances or {}), 'height':0, 'parent':'0'*64,
        'now':number(now), 'revision':0, 'source_epoch':source_epoch}
    for meal,records in catalog.items():
        for version,terms in records.items():
            require(terms['terms_hash'] == terms_hash(manifest,meal,int(version),terms), 'WRONG_TERMS_HASH')
    for amount in snapshot['balances'].values(): integer(amount)
    return snapshot

_QUOTE_TYPE = b'FundingQuote(bytes32 quoteId,address payer,bytes32 mealId,uint256 currentVersion,bytes32 termsHash,uint256 quantity,uint256 unitPrice,uint256 amount,uint256 deadline)'

def funding_hash(snapshot,op):
    p=op['payload']
    return abi_hash(['0x'+keccak256(_QUOTE_TYPE).hex(),p['quote_id'],op['caller'],p['meal_id'],p['version'],p['terms_hash'],p['quantity'],integer(p['unit_price'],positive=True),integer(p['amount']),p['deadline']])

def batch_hash(manifest,quote_id):
    return abi_hash([manifest['chain_id'],manifest['escrow'],quote_id])

def _authorize(snapshot, op):
    kind, caller, payload = op['kind'], op['caller'], op['payload']
    manifest = snapshot['manifest']
    role = {'publish':'catalog','listed':'catalog','paused':'catalog','close':'catalog',
        'issue':'issuer','expire':'issuer','lock':'operator','handover':'operator','report':'operator','settle':'owner'}.get(kind)
    if role:
        require(caller == manifest[role], 'WRONG_CALLER')
    elif kind == 'refund':
        batch = [u for u in snapshot['units'] if u['batch_id'] == payload['batch_id']]
        require(batch and all(u['payer'] == caller for u in batch), 'WRONG_PAYER')
    elif kind == 'fund':
        require(type(caller) is str and re.fullmatch(r'0x[0-9a-fA-F]{40}',caller) is not None and int(caller[2:],16)>0 and caller not in {manifest[k] for k in ('escrow','catalog','issuer','operator','quote')}, 'WRONG_PAYER')

def validate_snapshot(snapshot):
    require(type(snapshot['units']) is list and len(snapshot['units'])<=10, 'LIFETIME_CAP')
    require([u['seq'] for u in snapshot['units']]==list(range(len(snapshot['units']))), 'INVALID_SEQUENCE')
    require(snapshot['manifest']['owner']==snapshot['manifest']['receiver'],'INVALID_RECEIVER')
    number(snapshot['revision']);number(snapshot['height']);number(snapshot['now']);number(snapshot['source_epoch'])
    number(snapshot['controls']['revision'])
    require(type(snapshot['controls']['closed']) is bool and type(snapshot['controls']['paused']) is bool,'INVALID_CONTROL')
    local=set()
    for u in snapshot['units']:
        number(u['generation']);number(u['local_index'],maximum=9)
        require((u['batch_id'],u['local_index']) not in local,'INVALID_BATCH')
        local.add((u['batch_id'],u['local_index']))
        t=snapshot['catalog'][u['meal_id']][str(u['version'])]
        validate_terms(t)
        require(u['price']==t['price'] and u['terms_hash']==t['terms_hash'],'ORIGINAL_TERMS_MISMATCH')
        if u['generation']:
            require(u['voucher_id']==voucher_hash(snapshot['manifest'],u['seq'],u['generation']),'WRONG_VOUCHER_HASH')
            require(u['expires_at']==u['issued_at']+TTL,'WRONG_ORIGINAL_TIME')
    for balance in snapshot['balances'].values():integer(balance)
    accounting(snapshot)

def transition(snapshot, operation, commitments=None):
    validate_snapshot(snapshot)
    require(type(operation) is dict and set(operation) == {'op_id','kind','caller','payload'}, 'INVALID_OPERATION')
    op = copy.deepcopy(operation)
    kind, payload = op['kind'], op['payload']
    require(kind in KINDS and type(op['op_id']) is str and re.fullmatch(r'0x[0-9a-fA-F]{64}',op['op_id']) is not None and int(op['op_id'][2:],16)>0, 'INVALID_OPERATION')
    require(type(payload) is dict and set(payload) == SCHEMAS[kind], 'INVALID_PAYLOAD')
    _authorize(snapshot, op)  # original caller first, even on historical lookup
    typed_digest = digest(op if kind != 'fund' else {k:v for k,v in op.items() if k != 'op_id'})
    payload_hash = operation_hash(snapshot['manifest'],op) if kind != 'fund' else funding_hash(snapshot,op)
    if commitments and commitments.get('payload_hash'):
        require(commitments['payload_hash'] == payload_hash, 'WRONG_PAYLOAD_HASH')
    operation_key = ('fund:'+payload['quote_id']) if kind == 'fund' else ('op:'+op['op_id'])
    original = snapshot['operations'].get(operation_key)
    if original:
        require(original['payload_hash'] == payload_hash and original['typed_digest'] == typed_digest, 'IDEMPOTENCY_CONFLICT')
        return {'before':copy.deepcopy(snapshot), 'after':copy.deepcopy(snapshot), 'events':[],
            'result':copy.deepcopy(original['result']), 'caller':op['caller'], 'payload':payload,
            'payload_hash':payload_hash, 't0':original['t0'], 'typed_digest':typed_digest, 'noop':True, 'operation':op}
    before = copy.deepcopy(snapshot)
    after = copy.deepcopy(snapshot)
    now, control, manifest = number(after['now']), after['controls'], after['manifest']
    events = []
    result = None
    def emit(event, **fields): events.append({'event':event, **fields})
    def solvent(): require(integer(after['balances'].get(manifest['escrow'], '0')) >= integer(accounting(after)['liability']), 'INSOLVENT')
    def transfer(sender, receiver, amount):
        debit = integer(after['balances'].get(sender, '0'))
        credit = integer(after['balances'].get(receiver, '0'))
        require(debit >= amount and credit + amount <= UINT256, 'TRANSFER_FAILED')
        after['balances'][sender] = str(debit-amount); after['balances'][receiver] = str(credit+amount)
        emit('Transfer', sender=sender, receiver=receiver, amount=str(amount))
    def operating(meal):
        require(not control['closed'] and not control['paused'] and after['heads'].get(meal, {}).get('listed', False), 'NOT_OPERATING')
    def voucher():
        number(payload['generation'])
        matches = [u for u in after['units'] if u.get('voucher_id') == payload['voucher_id']]
        require(len(matches) == 1 and matches[0]['generation'] == payload['generation'], 'WRONG_VOUCHER')
        return matches[0]
    def live(unit):
        require(unit['state'] == 'R' and not control['paused'], 'NOT_REDEEMABLE')
        number(payload['deadline'])
        require(now < unit['expires_at'] and now < payload['deadline'], 'EXPIRED')
        require(window_end(after['catalog'][unit['meal_id']][str(unit['version'])], now) is not None, 'OUTSIDE_WINDOW')
        solvent()
    if kind in {'publish','listed','paused','close'}:
        require(number(payload['expected_control_revision']) == control['revision'], 'STALE_CONTROL')
        if kind == 'publish':
            meal, version, terms = payload['meal_id'], number(payload['version']), payload['terms']
            validate_terms(terms)
            require(terms['terms_hash'] == terms_hash(manifest,meal,version,terms), 'WRONG_TERMS_HASH')
            require(word(meal) != bytes(32), 'INVALID_MEAL')
            require(version == after['heads'].get(meal, {'version':0})['version'] + 1, 'STALE_VERSION')
            require(str(version) not in after['catalog'].get(meal, {}), 'IMMUTABLE_VERSION')
            after['catalog'].setdefault(meal,{})[str(version)] = copy.deepcopy(terms)
            after['heads'][meal] = {'version':version, 'listed':after['heads'].get(meal,{}).get('listed',False)}
            emit('Published', meal_id=meal, version=version, terms=copy.deepcopy(terms))
        elif kind == 'listed':
            require(payload['meal_id'] in after['heads'] and type(payload['listed']) is bool, 'INVALID_MEAL')
            head = after['heads'][payload['meal_id']]
            require(head['listed'] != payload['listed'], 'NO_CHANGE')
            head['listed'] = payload['listed']; emit('Listed', meal_id=payload['meal_id'], listed=payload['listed'])
        elif kind == 'paused':
            require(type(payload['paused']) is bool and payload['paused'] != control['paused'], 'NO_CHANGE')
            control['paused'] = payload['paused']; emit('Paused', paused=payload['paused'])
        else:
            require(not control['closed'], 'ALREADY_CLOSED')
            control['closed'] = True; emit('Closed')
        control['revision'] += 1; result = payload['terms']['terms_hash'] if kind == 'publish' else control['revision']
    elif kind == 'fund':
        meal = payload['meal_id']; operating(meal); solvent()
        require(now < number(payload['deadline']), 'EXPIRED')
        quantity = number(payload['quantity'], maximum=10)
        require(quantity > 0 and len(after['units']) + quantity <= 10, 'LIFETIME_CAP')
        require(word(payload['quote_id']) != bytes(32), 'INVALID_QUOTE')
        head = after['heads'][meal]
        require(number(payload['version']) == head['version'], 'STALE_TERMS')
        terms = after['catalog'][meal][str(head['version'])]
        require(payload['terms_hash'] == terms['terms_hash'] and payload['unit_price'] == terms['price'], 'STALE_TERMS')
        require(payload['batch_id'] == batch_hash(manifest,payload['quote_id']), 'WRONG_BATCH_HASH')
        require(not any(u['batch_id'] == payload['batch_id'] for u in after['units']), 'BATCH_EXISTS')
        amount = integer(payload['amount'], positive=True)
        require(amount == integer(terms['price'])*quantity and amount <= UINT256, 'WRONG_AMOUNT')
        transfer(op['caller'], manifest['escrow'], amount)
        for i in range(quantity):
            unit = {'seq':len(after['units']), 'batch_id':payload['batch_id'], 'local_index':i,
                'payer':op['caller'], 'meal_id':meal, 'version':head['version'], 'terms_hash':terms['terms_hash'],
                'price':terms['price'], 'state':'A', 'generation':0}
            after['units'].append(unit); emit('Funded', unit=copy.deepcopy(unit), quote_id=payload['quote_id'])
        result = payload['batch_id']
    elif kind == 'issue':
        require(now <= UINT256 - TTL, 'TIME_OVERFLOW')
        operating(payload['meal_id']); solvent()
        require(now < number(payload['deadline']), 'EXPIRED')
        for unit in after['units']:
            if safe_expired(unit, now):
                unit['state'] = 'A'; emit('Expired', seq=unit['seq'], generation=unit['generation'], voucher_id=unit['voucher_id'])
        unit = next_candidate(after, payload['meal_id'])
        require(unit is not None, 'NO_CANDIDATE')
        require(unit['seq'] == number(payload['expected_unit_seq'], maximum=9) and unit['generation']+1 == number(payload['expected_next_generation']) and unit['terms_hash'] == payload['expected_terms_hash'], 'STALE_CANDIDATE')
        terms = after['catalog'][unit['meal_id']][str(unit['version'])]
        require(terms['body_available'] and terms['image_available'], 'CONTENT_UNAVAILABLE')
        require(unit['generation'] < UINT256, 'GENERATION_OVERFLOW')
        unit.update(state='R', generation=unit['generation']+1, issued_at=now, expires_at=now+TTL, lock=None, marker=None)
        unit['voucher_id'] = voucher_hash(manifest, unit['seq'], unit['generation'])
        if commitments and commitments.get('voucher_id'):
            require(commitments['voucher_id'] == unit['voucher_id'], 'WRONG_VOUCHER_HASH')
        emit('Issued', unit=copy.deepcopy(unit)); result = unit['voucher_id']
    elif kind in {'lock','handover','report','settle','expire'}:
        unit = voucher()
        if kind == 'lock':
            live(unit); require(not unit.get('lock') and not unit.get('marker'), 'ALREADY_LOCKED')
            unit['lock'] = {'id':op['op_id'], 'caller':op['caller'], 'at':now}
            emit('Locked', seq=unit['seq'], generation=unit['generation'], lock=copy.deepcopy(unit['lock'])); result = op['op_id']
        elif kind == 'handover':
            live(unit)
            require(unit.get('lock') and unit['lock']['id'] == payload['lock_id'] and not unit.get('marker'), 'WRONG_LOCK')
            unit['marker'] = {'id':op['op_id'],'at':now,'height':after['height']+1,'lock_id':payload['lock_id']}
            emit('Handover', seq=unit['seq'], generation=unit['generation'], marker=copy.deepcopy(unit['marker'])); result = op['op_id']
        elif kind == 'report':
            require(unit['state'] == 'R' and unit.get('lock') and unit['lock']['id'] == payload['lock_id'] and unit.get('marker') and unit['marker']['id'] == payload['marker_id'], 'WRONG_MARKER')
            original_terms=after['catalog'][unit['meal_id']][str(unit['version'])]
            require(unit['issued_at'] <= unit['marker']['at'] < unit['expires_at'] and window_end(original_terms,unit['marker']['at']) is not None, 'UNLAWFUL_MARKER')
            require(unit['lock']['caller'] == op['caller'], 'WRONG_OPERATOR')
            unit['state'] = 'H'; emit('Reported', seq=unit['seq'], generation=unit['generation'], marker_id=payload['marker_id'], amount=unit['price']); result=op['op_id']
        elif kind == 'settle':
            require(unit['state'] == 'H', 'NOT_REPORTED'); solvent()
            unit['state'] = 'S'; transfer(manifest['escrow'], manifest['receiver'], integer(unit['price']))
            emit('Settled', seq=unit['seq'], generation=unit['generation'], receiver=manifest['receiver'], amount=unit['price']); result=unit['price']
        else:
            require(safe_expired(unit, now), 'UNSAFE_EXPIRY')
            unit['state'] = 'A'; emit('Expired', seq=unit['seq'], generation=unit['generation'], voucher_id=unit['voucher_id']); result=unit['seq']
    elif kind == 'refund':
        mask = number(payload['mask'], maximum=1023)
        require(mask > 0, 'INVALID_MASK')
        batch = [u for u in after['units'] if u['batch_id'] == payload['batch_id']]
        require(mask < (1 << len(batch)), 'INVALID_MASK')
        selected = [u for u in batch if mask & (1 << u['local_index'])]
        require(selected and all(u['state'] == 'A' for u in selected), 'UNSAFE_REFUND'); solvent()
        amount = sum(integer(u['price']) for u in selected)
        for unit in selected:
            unit['state']='X'; emit('Refunded', seq=unit['seq'], payer=op['caller'], amount=unit['price'])
        transfer(manifest['escrow'], op['caller'], amount); result=str(amount)
    accounting(after)
    after['revision'] += 1
    after['height'] += 1
    after['operations'][operation_key] = {'kind':kind, 'caller':op['caller'], 'payload':payload,
        'payload_hash':payload_hash, 'typed_digest':typed_digest, 'result':result, 't0':now, 'execute_count':1}
    after['parent'] = digest({'synthetic_block':True, 'parent':before['parent'], 'height':after['height'], 'now':now, 'operation':op, 'events':events, 'result':result})
    return {'before':before,'after':after,'events':events,'result':result,'caller':op['caller'],
        'payload':payload,'payload_hash':payload_hash,'typed_digest':typed_digest,'t0':now,'noop':False,'operation':op}
