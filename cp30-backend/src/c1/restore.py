"""Private controller protocol for journal-fenced, owned-backup restores."""
import copy,hashlib,re
from .journal import BINDINGS,ZERO,Quarantined,canonical

def merge(left,right):
    value=copy.deepcopy(left)
    for domain,objects in right.items():
        for key,floor in objects.items():value.setdefault(domain,{})[key]=max(value.get(domain,{}).get(key,0),floor)
    return value

def prepare(controller,namespace,request):
    if set(request)!={'mutation_id','backups'} or not re.fullmatch('[0-9a-f-]{36}',request['mutation_id']):raise Quarantined('RESTORE_REQUEST')
    backups=request['backups']
    if type(backups) is not dict or not {'business'}<=set(backups)<= {'business','authority'} or any(type(value) is not str or not re.fullmatch('[0-9a-f]{64}',value) for value in backups.values()):raise Quarantined('RESTORE_BACKUP_BINDING')
    snapshot=controller.journal.snapshot(namespace)
    if snapshot.get('restore_pending'):raise Quarantined('RESTORE_ALREADY_PENDING')
    business=controller.business.call('restore_status',namespace,{})
    authority=controller.authority.call('restore_status',namespace,{})
    if business.get('error') or authority.get('error'):raise Quarantined('RESTORE_SCOPE_UNAVAILABLE')
    epochs=snapshot['epochs']
    if business['source_epoch']!=authority['source_epoch'] or business['source_epoch']!=epochs.get('source_epoch',business['source_epoch']):raise Quarantined('RESTORE_SOURCE_EPOCH')
    old_generation=max(business['restore_generation'],authority['restore_generation'],epochs.get('restore_generation',0))
    old_credentials=max(business['credential_epoch'],authority['credential_epoch'],epochs.get('credential_epoch',0),snapshot['floors'].get('credential',{}).get('global',0))
    binding={'mutation_id':request['mutation_id'],'kind':'restore','object_id':'owned-backup',
        'expected_revision':{'restore_generation':old_generation,'credential_epoch':old_credentials,
            'pending_digest':snapshot['pending']['digest'] if snapshot['pending'] else ZERO,
            'service_floor':max(business['clock_floor'],business['now'],authority['now']),
            'backup_business':backups['business'],'backup_authority':backups.get('authority',ZERO)},
        'command_digest':hashlib.sha256(canonical(request)).hexdigest(),
        'restore_generation':old_generation+1,'credential_epoch':old_credentials+1,
        'source_epoch':business['source_epoch'],'deployment_generation':epochs.get('deployment_generation',1),
        'authority_checkpoint':authority['parent'],'authority_highwater':max(authority['height'],epochs.get('authority_highwater',0)),
        'floors':snapshot['floors']}
    prepared=controller.journal.restore_prepare(namespace,binding)
    controller.quarantined.add(namespace)
    return {'prepared':True,**controller._reference(prepared),'binding':binding}

def finish(controller,namespace,request):
    if set(request)!={'mutation_id','sequence','digest'}:raise Quarantined('RESTORE_REQUEST')
    prepared=next((row for row in reversed(controller.journal.records) if row['namespace']==namespace and row['event']=='RESTORE_PREPARED' and row['data']['mutation_id']==request['mutation_id']),None)
    if not prepared or controller._reference(prepared)!=request:raise Quarantined('RESTORE_ORIGINAL_PREPARATION')
    snapshot=controller.journal.snapshot(namespace)
    if snapshot['pending']:raise Quarantined('RESTORE_ORIGINAL_PENDING_UNRESOLVED')
    # A high revision alone cannot reconstruct a lost private original record.
    # Verify every retained completed security/execution anchor independently.
    for terminal in controller.journal.records:
        if terminal['namespace']!=namespace or terminal['event'] not in {'COMMITTED','EXECUTION_COMMITTED'}:continue
        anchor=next(row for row in controller.journal.records if row['digest']==terminal['data']['prepared_digest'])
        execution=terminal['event']=='EXECUTION_COMMITTED'
        reference=controller._reference(anchor,execution)
        database=controller.authority if execution else controller.business
        proof=database.call('execution_proof' if execution else 'security_proof',namespace,reference)
        if proof.get('committed') is not True or any(proof.get(key)!=value for key,value in reference.items()) or any(proof.get(key)!=anchor['data'][key] for key in BINDINGS):
            raise Quarantined('RESTORE_PRIVATE_OR_ORIGINAL_ANCHOR_MISSING')
    for terminal in controller.journal.records:
        if terminal['namespace']!=namespace or terminal['event']!='RESTORE_COMMITTED':continue
        anchor=next(row for row in controller.journal.records if row['digest']==terminal['data']['prepared_digest'])
        if anchor['sequence']>=prepared['sequence']:continue
        reference=controller._reference(anchor)
        for database in (controller.business,controller.authority):
            proof=database.call('restore_proof',namespace,reference)
            if proof.get('installed') is not True or proof.get('binding')!=anchor['data'] or any(proof.get(key)!=value for key,value in reference.items()):
                raise Quarantined('RESTORE_PRIOR_ANCHOR_MISSING')
    floors=copy.deepcopy(prepared['data']['floors'])
    states=[]
    for database in (controller.business,controller.authority):
        proof=database.call('restore_proof',namespace,request)
        if proof.get('installed') is not True or any(proof.get(key)!=value for key,value in request.items()) or proof.get('binding')!=prepared['data']:
            raise Quarantined('RESTORE_INSTALL_PROOF_MISSING')
        floors=merge(floors,proof['floors'])
        states.append(database.call('restore_status',namespace,{}))
    if any(state.get('error') for state in states) or states[0].get('content_valid') is not True or states[0].get('reason') not in {'CONTROLLED_RESTORE','LOCAL_SYNTHETIC'} or states[0]['height']!=states[1]['height'] or states[0]['parent']!=states[1]['parent'] or states[0]['height']<prepared['data']['authority_highwater']:
        raise Quarantined('RESTORE_ORIGINAL_HISTORY_INCOMPLETE')
    check={**snapshot,'floors':floors}
    for database,method in ((controller.business,'security_startup'),(controller.authority,'startup_check')):
        if database.call(method,namespace,check).get('matched') is not True:raise Quarantined('RESTORE_PRIVATE_OR_ORIGINAL_ANCHOR_MISSING')
    completion={key:prepared['data'][key] for key in BINDINGS}
    completion.update(floors=floors,prepared_sequence=prepared['sequence'],prepared_digest=prepared['digest'])
    if snapshot.get('restore_pending'):
        if snapshot['restore_pending']['digest']!=prepared['digest']:raise Quarantined('RESTORE_OTHER_PREPARATION')
        controller.journal.restore_finish(namespace,completion)
    else:
        terminal=next((row for row in reversed(controller.journal.records) if row['namespace']==namespace and row['event']=='RESTORE_COMMITTED' and row['data'].get('prepared_digest')==prepared['digest']),None)
        if not terminal or terminal['data']!=completion:raise Quarantined('RESTORE_COMPLETION_MISSING')
    for database in (controller.business,controller.authority):
        anchor=controller.journal.snapshot(namespace)
        if database.call('restore_finish',namespace,{**request,'journal_sequence':anchor['sequence'],'journal_digest':anchor['digest']}).get('finished') is not True:raise Quarantined('RESTORE_FINISH_FAILED')
    controller._compare(namespace)
    return {'finished':True,'restore_generation':prepared['data']['restore_generation'],'credential_epoch':prepared['data']['credential_epoch']}
