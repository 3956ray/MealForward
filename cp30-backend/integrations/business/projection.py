"""Pure conversion of detached trusted observer facts, never chain/DB authority."""
from copy import deepcopy
import re
import uuid

SCHEMA='CP30_CHAIN_PROJECTION_V1'
DEPLOYMENT_FIELDS=('chainId','from','to','value','data','callDataDigest')
BUCKETS=('A','R','H','S','X')
ZERO_WORD='0x'+'0'*64
ZERO_ADDRESS='0x'+'0'*40
PARAMETERS={
 'publish':{'opId':'W','expectedControlRevision':'u','input':'t'},
 'setListed':{'opId':'W','expectedControlRevision':'u','mealId':'W','value':'b'},
 'issue':{'opId':'W','mealId':'W','expectedUnitSeq':'u','expectedNextGeneration':'U','expectedTermsHash':'W','deadline':'U'},
 'lock':{'opId':'W','voucherId':'W','generation':'U','deadline':'U'},
 'markHandover':{'opId':'W','voucherId':'W','generation':'U','lockId':'W','deadline':'U'},
 'report':{'opId':'W','voucherId':'W','generation':'U','lockId':'W','markerId':'W'},
 'settle':{'opId':'W','voucherId':'W','generation':'U'},
}
QUOTE={'quoteId':'W','payer':'A','mealId':'W','currentVersion':'U','termsHash':'W',
       'quantity':'U','unitPrice':'U','amount':'U','deadline':'U'}
UNIT={'seq':'u','batchId':'W','localIndex':'u','payer':'A','mealId':'W','version':'U',
      'termsHash':'W','unitPrice':'U','bucket':'u','generation':'u','voucherId':'w'}
BATCH={'payer':'A','mealId':'W','version':'U','termsHash':'W','unitPrice':'U','quantity':'U','firstUnit':'u','refundedMask':'u'}
VOUCHER={'unitSeq':'u','generation':'u','termsHash':'w','issuedAt':'u','expiresAt':'u','issuer':'a',
         'lockId':'w','lockedAt':'u','operator':'a','processor':'a','markerId':'w',
         'handoverRecordedAt':'u','handoverBlock':'u','reportId':'w','settleId':'w','expired':'b'}
OPERATION={'kind':'u','caller':'a','payloadHash':'w','result':'w','executedAt':'u'}
TERMS={'unitPrice':'U','termsHash':'W','bodyDigest':'W','imageDigest':'W','windowCount':'U',
       'startMinute0':'u','endMinute0':'u','startMinute1':'u','endMinute1':'u'}
TERMS_INPUT={'mealId':'W','version':'U','unitPrice':'U','bodyDigest':'W','imageDigest':'W','windowCount':'U','startMinute0':'u','endMinute0':'u','startMinute1':'u','endMinute1':'u'}
EVENTS={
 'publish':('Published',{'mealId':'W','version':'U','termsHash':'W','revision':'U'}),
 'setListed':('ControlChanged',{'kind':'u','mealId':'W','value':'b','revision':'U'}),
 'issue':('Issued',{'voucherId':'W','unitSeq':'u','generation':'U','termsHash':'W','issuedAt':'U','expiresAt':'U'}),
 'lock':('Locked',{'voucherId':'W','lockId':'W','generation':'U','at':'U','operator':'A','processor':'A'}),
 'markHandover':('HandoverMarked',{'voucherId':'W','markerId':'W','lockId':'W','generation':'U','at':'U','blockNumber':'u'}),
 'report':('Reported',{'voucherId':'W','resultId':'W','markerId':'W','amount':'U'}),
 'settle':('Settled',{'voucherId':'W','opId':'W','receiver':'A','amount':'U'}),
 'fund':('Funded',{'quoteId':'W','batchId':'W','payer':'A','mealId':'W','version':'U','termsHash':'W','unitPrice':'U','quantity':'U','firstUnit':'u','amount':'U'}),
}
KINDS={'publish':'1','setListed':'2','issue':'5','lock':'6','markHandover':'7','report':'8','settle':'9'}


class ProjectionRejected(ValueError):pass


def _require(condition,code='CHAIN_PROJECTION_MISMATCH'):
    if not condition:raise ProjectionRejected(code)


def _uint(value,positive=False):
    _require(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*',value) is not None,'INVALID_CHAIN_INTEGER')
    _require(len(value)<=78 and int(value)<2**256 and (not positive or int(value)>0),'INVALID_CHAIN_INTEGER')
    return int(value)


def _hex(value,length,nonzero=False):
    _require(type(value) is str and re.fullmatch('0x[0-9a-f]{'+str(length)+'}',value) is not None,'INVALID_CHAIN_HEX')
    _require(not nonzero or int(value,16)>0,'INVALID_CHAIN_HEX')
    return value


def _shape(value,fields):
    _require(type(value) is dict and set(value)==set(fields),'CHAIN_FACT_FIELDS')
    for name,kind in fields.items():
        item=value[name]
        if kind in ('u','U'):_uint(item,kind=='U')
        elif kind in ('w','W'):_hex(item,64,kind=='W')
        elif kind in ('a','A'):_hex(item,40,kind=='A')
        elif kind=='t':_shape(item,TERMS_INPUT)
        elif kind=='b':_require(type(item) is bool,'INVALID_CHAIN_BOOL')
    return value


def _alias(value):
    _require(type(value) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',value) is not None,'TRUSTED_ALIAS_REQUIRED')
    return value


def _nullable(value):return None if value==ZERO_WORD else value


def observer_record(functionName,parameters,deployment,payloadHash):
    """Accept the already saved six-field core; do not derive/guess calldata hashes."""
    _require(type(functionName) is str and functionName in EVENTS,'UNSUPPORTED_CHAIN_OPERATION')
    _require(type(deployment) is dict and set(deployment)==set(DEPLOYMENT_FIELDS),'ORIGINAL_DEPLOYMENT_REQUIRED')
    _require(type(deployment['chainId']) is int and 0<deployment['chainId']<=2**53-1,'INVALID_CHAIN_ID')
    _hex(deployment['from'],40,True);_hex(deployment['to'],40,True)
    _require(deployment['value']=='0','ZERO_VALUE_REQUIRED')
    _hex(deployment['callDataDigest'],64,True);_hex(payloadHash,64,True)
    _require(type(deployment['data']) is str and re.fullmatch(r'0x(?:[0-9a-f]{2}){4,65536}',deployment['data']) is not None,'ORIGINAL_CALLDATA_REQUIRED')
    if functionName=='fund':
        _require(type(parameters) is dict and set(parameters)=={'quote','signature'},'CHAIN_FACT_FIELDS')
        q=_shape(parameters['quote'],QUOTE)
        _require(1<=_uint(q['quantity'])<=10 and _uint(q['amount'])==_uint(q['quantity'])*_uint(q['unitPrice']))
        _hex(parameters['signature'],130)
        _require(q['payer']==deployment['from'])
    else:
        _shape(parameters,PARAMETERS[functionName])
        if functionName=='issue':_require(_uint(parameters['expectedUnitSeq'])<10)
    return deepcopy({'functionName':functionName,'parameters':parameters,'deployment':deployment,'payloadHash':payloadHash})


def _snapshot_rows(snapshot,storeAlias,mealAliases):
    _require(type(snapshot) is dict and set(snapshot)=={'chainId','escrow','blockNumber','blockHash','timestamp','accounting',
        'units','batches','vouchers','operations','menu','controls','terms','authority'},'COMPLETE_CHAIN_SNAPSHOT_REQUIRED')
    _require(snapshot['authority']=='CANONICAL_FINALIZED_CHAIN_FACTS','FINALIZED_CHAIN_FACTS_REQUIRED')
    _require(type(snapshot['chainId']) is int and 0<snapshot['chainId']<=2**53-1,'INVALID_CHAIN_ID')
    _hex(snapshot['escrow'],40,True);_hex(snapshot['blockHash'],64,True)
    _uint(snapshot['blockNumber']);_uint(snapshot['timestamp']);store=_alias(storeAlias)
    _require(type(mealAliases) is dict and 1<=len(mealAliases)<=3,'BOUNDED_TRUSTED_MEAL_ALIASES_REQUIRED')
    for meal,alias in mealAliases.items():_hex(meal,64,True);_alias(alias)
    _require(type(snapshot['menu']) is dict and set(snapshot['menu'])==set(mealAliases),'MEAL_MAPPING_MISMATCH')
    for menu in snapshot['menu'].values():
        _require(type(menu) is dict and set(menu)=={'currentVersion','listed','candidate','terms'},'CHAIN_FACT_FIELDS')
        _uint(menu['currentVersion']);_require(type(menu['listed']) is bool,'INVALID_CHAIN_BOOL')
        _shape(menu['candidate'],{'available':'b','unitSeq':'u','nextGeneration':'u','termsHash':'w','needsExpiry':'b'})
        if menu['currentVersion']=='0':_require(menu['terms'] is None)
        else:_shape(menu['terms'],TERMS)
    _require(type(snapshot['terms']) is list and len(snapshot['terms'])<=10,'COMPLETE_TERMS_REQUIRED')
    historical={}
    for term in snapshot['terms']:
        _shape(term,{'mealId':'W','version':'U',**TERMS});key=(term['mealId'],term['version'])
        _require(key not in historical and term['mealId'] in mealAliases,'IMMUTABLE_TERMS_MISMATCH')
        historical[key]=term
    a=snapshot['accounting']
    _require(type(a) is dict and set(a)=={'fundedUnits','fundedAmount','counts','amounts','liability'},'CHAIN_FACT_FIELDS')
    funded=_uint(a['fundedUnits']);_require(funded<=10)
    for name in ('counts','amounts'):
        _require(type(a[name]) is list and len(a[name])==5,'ACCOUNTING_SHAPE')
        for value in a[name]:_uint(value)
    _require(sum(map(int,a['counts']))==funded and sum(map(int,a['amounts']))==_uint(a['fundedAmount'])
             and sum(map(int,a['amounts'][:3]))==_uint(a['liability']),'ACCOUNTING_MISMATCH')
    _require(type(snapshot['units']) is list and len(snapshot['units'])==funded,'COMPLETE_UNITS_REQUIRED')
    for name,maximum in (('batches',10),('vouchers',14),('operations',4)):
        _require(type(snapshot[name]) is dict and len(snapshot[name])<=maximum,'CHAIN_FACT_LIMIT')
    batches=[];vouchers=[];units=[];counts=[0]*5;amounts=[0]*5;absent=[]
    for batchId,b in sorted(snapshot['batches'].items()):
        _hex(batchId,64,True);_shape(b,BATCH);_require(b['mealId'] in mealAliases)
        _require(1<=_uint(b['quantity'])<=10 and _uint(b['firstUnit'])+_uint(b['quantity'])<=funded and _uint(b['refundedMask'])<2**10)
        batches.append({'id':batchId,'store':store,'payer':b['payer'],'meal':mealAliases[b['mealId']],
            'meal_id':b['mealId'],'version':b['version'],'terms_hash':b['termsHash'],'price':b['unitPrice'],
            'quantity':b['quantity'],'first_unit':b['firstUnit'],'refunded_mask':b['refundedMask']})
    for voucherId,v in sorted(snapshot['vouchers'].items()):
        _hex(voucherId,64,True);_shape(v,VOUCHER)
        if v['generation']=='0':
            _require(all(value in ('0',ZERO_WORD,ZERO_ADDRESS,False) for value in v.values()),'ABSENT_VOUCHER_MISMATCH')
            absent.append(voucherId);continue
        _require(_uint(v['unitSeq'])<funded and _uint(v['expiresAt'])==_uint(v['issuedAt'])+259200)
        _hex(v['termsHash'],64,True);_hex(v['issuer'],40,True)
        vouchers.append({'id':voucherId,'store':store,'seq':v['unitSeq'],'generation':v['generation'],
            'terms_hash':v['termsHash'],'issued_at':v['issuedAt'],'expires_at':v['expiresAt'],'issuer':v['issuer'],
            'lock_id':_nullable(v['lockId']),'locked_at':v['lockedAt'],'operator':v['operator'],'processor':v['processor'],
            'marker_id':_nullable(v['markerId']),'marker_at':v['handoverRecordedAt'],'handover_block':v['handoverBlock'],
            'report_id':_nullable(v['reportId']),'settle_id':_nullable(v['settleId']),'expired':v['expired']})
    for seq,u in enumerate(snapshot['units']):
        _shape(u,UNIT);bucket=_uint(u['bucket']);_require(u['seq']==str(seq) and bucket<5 and u['mealId'] in mealAliases)
        t=historical.get((u['mealId'],u['version']))
        _require(t is not None and t['termsHash']==u['termsHash'] and t['unitPrice']==u['unitPrice'],'IMMUTABLE_TERMS_MISMATCH')
        b=snapshot['batches'].get(u['batchId']);_require(b is not None,'ORIGINAL_BATCH_REQUIRED')
        _require(all(u[k]==b[k] for k in ('payer','mealId','version','termsHash','unitPrice'))
                 and seq==_uint(b['firstUnit'])+_uint(u['localIndex']) and _uint(u['localIndex'])<_uint(b['quantity']))
        _require((u['generation']=='0')==(u['voucherId']==ZERO_WORD) and (bucket not in (1,2,3) or u['generation']!='0'))
        v=None if u['voucherId']==ZERO_WORD else snapshot['vouchers'].get(u['voucherId'])
        if u['voucherId']!=ZERO_WORD:
            _require(v is not None and v['unitSeq']==u['seq'] and v['generation']==u['generation'] and v['termsHash']==u['termsHash'])
        counts[bucket]+=1;amounts[bucket]+=_uint(u['unitPrice'])
        row={'store':store,'seq':u['seq'],'batch_id':u['batchId'],'local_index':u['localIndex'],'payer':u['payer'],
             'meal':mealAliases[u['mealId']],'meal_id':u['mealId'],'version':u['version'],'terms_hash':u['termsHash'],
             'price':u['unitPrice'],'bucket':BUCKETS[bucket],'generation':u['generation'],'voucher_id':_nullable(u['voucherId'])}
        # These values come only from an existing chain voucher; absent is not a fabricated zero voucher.
        row.update({name:None for name in ('issued_at','expires_at','lock_id','marker_id','marker_at','report_id','settle_id')})
        if v is not None:
            row.update(issued_at=v['issuedAt'],expires_at=v['expiresAt'],lock_id=_nullable(v['lockId']),
                       marker_id=_nullable(v['markerId']),marker_at=v['handoverRecordedAt'],
                       report_id=_nullable(v['reportId']),settle_id=_nullable(v['settleId']))
        units.append(row)
    _require(counts==list(map(int,a['counts'])) and amounts==list(map(int,a['amounts'])),'ACCOUNTING_MISMATCH')
    _require({u['batchId'] for u in snapshot['units']}==set(snapshot['batches']),'COMPLETE_BATCHES_REQUIRED')
    operations=[]
    for opId,op in sorted(snapshot['operations'].items()):
        _hex(opId,64,True);_shape(op,OPERATION)
        operations.append({'op_id':opId,'kind':op['kind'],'caller':op['caller'],'payload_hash':op['payloadHash'],
                           'result':op['result'],'executed_at':op['executedAt'],'present':op['kind']!='0'})
    controls=_shape(snapshot['controls'],{'paused':'b','closed':'b','revision':'u'})
    header={key:deepcopy(snapshot[key]) for key in ('chainId','escrow','blockNumber','blockHash','timestamp')}
    totals={'F':a['fundedAmount'],**dict(zip(BUCKETS,a['amounts'])),'liability':a['liability'],
            'counts':{'F':a['fundedUnits'],**dict(zip(BUCKETS,a['counts']))}}
    return {'schema':SCHEMA,'authority':snapshot['authority'],'snapshot':header,'units':units,'vouchers':vouchers,
            'batches':batches,'operations':operations,'absentVoucherIds':absent,'accounting':{'store':store,'totals':totals},
            'controls':{'store':store,'paused':controls['paused'],'closed':controls['closed'],
                        'control_revision':controls['revision'],'lifetime':a['fundedUnits']}}


def finalized_snapshot_rows(snapshot,storeAlias,mealAliases):
    """Initial finalized facts only. Never returns a receipt or successful intent."""
    return deepcopy(_snapshot_rows(snapshot,storeAlias,mealAliases))


def projection_rows(verifiedProof,intentId,storeAlias,mealAliases):
    _require(type(verifiedProof) is dict and set(verifiedProof)=={'original','transactionHash','chainId','escrow',
        'blockHash','blockNumber','logIndex','event','operation','snapshot','authority'},'COMPLETE_VERIFIED_PROOF_REQUIRED')
    p=verifiedProof;_require(p['authority']=='VERIFIED_ORIGINAL_CHAIN_OPERATION','VERIFIED_ORIGINAL_PROOF_REQUIRED')
    _require(type(p['chainId']) is int,'INVALID_CHAIN_ID')
    _uint(p['blockNumber']);_hex(p['blockHash'],64,True)
    _require(type(intentId) is str,'ORIGINAL_INTENT_REQUIRED')
    try:_require(str(uuid.UUID(intentId))==intentId,'ORIGINAL_INTENT_REQUIRED')
    except (ValueError,AttributeError):raise ProjectionRejected('ORIGINAL_INTENT_REQUIRED') from None
    _require(type(p['original']) is dict and set(p['original'])=={'functionName','parameters','deployment','payloadHash'},'ORIGINAL_RECORD_REQUIRED')
    record=observer_record(**p['original']);fn=record['functionName'];params=record['parameters']
    rows=_snapshot_rows(p['snapshot'],storeAlias,mealAliases)
    for name in ('chainId','escrow','blockHash','blockNumber'):_require(p[name]==rows['snapshot'][name],'ORIGINAL_BLOCK_MISMATCH')
    _require(p['chainId']==record['deployment']['chainId'] and p['escrow']==record['deployment']['to'],'ORIGINAL_DEPLOYMENT_MISMATCH')
    _hex(p['transactionHash'],64,True);_uint(p['logIndex'])
    event=p['event'];_require(type(event) is dict and set(event)=={'eventName','args','logIndex'},'ORIGINAL_EVENT_REQUIRED')
    _require(event['eventName']==EVENTS[fn][0] and event['logIndex']==p['logIndex'],'ORIGINAL_EVENT_REQUIRED')
    args=_shape(event['args'],EVENTS[fn][1])
    opId=None;quoteId=None
    if fn=='fund':
        _require(p['operation'] is None,'FUND_OPERATION_MISMATCH');q=params['quote'];quoteId=q['quoteId']
        for field,qfield in (('quoteId','quoteId'),('payer','payer'),('mealId','mealId'),('version','currentVersion'),
            ('termsHash','termsHash'),('unitPrice','unitPrice'),('quantity','quantity'),('amount','amount')):_require(args[field]==q[qfield])
        b=p['snapshot']['batches'].get(args['batchId']);_require(b is not None and b['firstUnit']==args['firstUnit'])
        _require(all(b[field]==args[field] for field in ('payer','mealId','version','termsHash','unitPrice','quantity')))
    elif fn in ('publish','setListed'):
        opId=params['opId'];op=_shape(p['operation'],OPERATION)
        _require(op==p['snapshot']['operations'].get(opId) and op['kind']==KINDS[fn]
            and op['caller']==record['deployment']['from'] and op['payloadHash']==record['payloadHash']
            and op['executedAt']==p['snapshot']['timestamp'],'ORIGINAL_OPERATION_MISMATCH')
        meal=params['input']['mealId'] if fn=='publish' else params['mealId']
        _require(args['mealId']==meal and _uint(args['revision'])==_uint(params['expectedControlRevision'])+1
            and args['revision']==p['snapshot']['controls']['revision'])
        menu=p['snapshot']['menu'][meal]
        if fn=='publish':
            _require(args['version']==params['input']['version']==menu['currentVersion'])
            _require(args['termsHash']==menu['terms']['termsHash']==op['result'])
            for field in TERMS_INPUT:
                if field not in ('mealId','version'):_require(menu['terms'][field]==params['input'][field])
        else:_require(args['kind']=='2' and args['value']==params['value']==menu['listed'] and int(op['result'],16)==_uint(args['revision']))
    else:
        opId=params['opId'];op=_shape(p['operation'],OPERATION)
        _require(op==p['snapshot']['operations'].get(opId) and op['kind']==KINDS[fn]
            and op['caller']==record['deployment']['from'] and op['payloadHash']==record['payloadHash']
            and op['executedAt']==p['snapshot']['timestamp'],'ORIGINAL_OPERATION_MISMATCH')
        v=p['snapshot']['vouchers'].get(args['voucherId']);_require(v is not None and v['generation']!='0','ORIGINAL_VOUCHER_REQUIRED')
        if fn=='issue':
            _require(op['result']==args['voucherId'] and args['unitSeq']==params['expectedUnitSeq']
                and args['generation']==params['expectedNextGeneration'] and args['termsHash']==params['expectedTermsHash'])
            _require(v['unitSeq']==params['expectedUnitSeq'] and v['generation']==params['expectedNextGeneration']
                and v['issuedAt']==args['issuedAt'] and v['expiresAt']==args['expiresAt']
                and args['issuedAt']==p['snapshot']['timestamp']
                and p['snapshot']['units'][int(v['unitSeq'])]['mealId']==params['mealId'])
        else:
            _require(args['voucherId']==params['voucherId'] and v['generation']==params['generation'])
            if fn=='settle':_require(args['opId']==opId and int(op['result'],16)==_uint(args['amount']) and v['settleId']==opId)
            else:
                _require(op['result']==opId)
                idfield={'lock':'lockId','markHandover':'markerId','report':'resultId'}[fn]
                _require(args[idfield]==opId and v[{'lock':'lockId','markHandover':'markerId','report':'reportId'}[fn]]==opId)
            if fn in ('lock','markHandover'):
                _require(args['generation']==params['generation'] and args['at']==p['snapshot']['timestamp'])
            if fn=='lock':_require(args['operator']==record['deployment']['from'] and v['operator']==args['operator']
                and v['processor']==args['processor'] and v['lockedAt']==args['at'])
            if fn=='markHandover':_require(args['lockId']==params['lockId']==v['lockId']
                and args['blockNumber']==p['blockNumber']==v['handoverBlock'] and v['handoverRecordedAt']==args['at'])
            if fn=='report':_require(args['markerId']==params['markerId']==v['markerId'] and v['lockId']==params['lockId'])
            if fn in ('report','settle'):_require(args['amount']==p['snapshot']['units'][int(v['unitSeq'])]['unitPrice'])
    rows['authority']=p['authority']
    rows['receipt']={'intentId':intentId,'store':_alias(storeAlias),'functionName':fn,'opId':opId,'quoteId':quoteId,
        'payloadHash':record['payloadHash'],'original':record,'event':deepcopy(event),'operation':deepcopy(p['operation']),
        'proof':deepcopy(p),
        **{key:deepcopy(p[key]) for key in ('chainId','escrow','transactionHash','blockHash','blockNumber','logIndex')}}
    return deepcopy(rows)
