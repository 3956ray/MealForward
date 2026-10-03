"""CP20 explicit deployment read scope layered after current Dynamic authorization."""
import json
from pathlib import Path
import requests
from flask import jsonify, request
from server.contracts import ApiError
from server.testnet_readonly.identity import SCOPE_IDENTITY, BATCH


def authorize(store, actor, path):
    denied=lambda: ApiError(403,'TESTNET_SCOPE_DENIED','No read scope for this deployment')
    if actor.role!='partner' or not actor.dynamic or not path: raise denied()
    try:
        p=Path(path)
        if p.stat().st_mode & 0o077 or p.stat().st_size>16384: raise ValueError()
        config=json.loads(p.read_text())
        if set(config)!={'version','enabled','scope','deployment','binding'}: raise ValueError()
        if not isinstance(config['version'],str) or not 1<=len(config['version'])<=128 or config['enabled'] is not True: raise ValueError()
        if not isinstance(config['binding'],dict) or type(config['binding'].get('revision')) is not int: raise ValueError()
        if config['scope']!='testnet:ledger:read' or config['deployment']!=SCOPE_IDENTITY: raise ValueError()
        mapping=store.one('SELECT * FROM dynamic_identity_mappings WHERE id=?',(actor.dynamic.mapping_id,))
        expected=dict(mappingId=actor.dynamic.mapping_id,revision=actor.dynamic.mapping_revision,
                      environment=actor.dynamic.environment_id,issuer=actor.dynamic.issuer,subjectHash=actor.dynamic.subject_hash,
                      actorId=actor.actor_id,partnerId=actor.partner_id,authorityVersion=mapping['authority_source_version'])
        if not mapping['enabled'] or mapping['revision']!=actor.dynamic.mapping_revision or config['binding']!=expected: raise ValueError()
    except Exception: raise denied() from None
    return config['version']

def summary():
    # Never forward cookies, bearer, configurable URL or raw remote error to this service.
    try:
        with requests.Session() as session:
            session.trust_env=False
            with session.get('http://127.0.0.1:18995/api/v1/testnet/batches/'+BATCH+'?cached=1',
                             timeout=(1,2),allow_redirects=False,stream=True) as response:
                data=response.raw.read(65537,decode_content=False)
                if len(data)>65536: raise ValueError()
                result=json.loads(data)
                if response.status_code not in (200,202,503) or result.get('batchId')!=BATCH: raise ValueError()
                return {k:result[k] for k in ('batchId','amounts','source','sync')}
    except Exception: raise ApiError(503,'TESTNET_READ_UNAVAILABLE','Testnet read model unavailable') from None

def register(app, service, store, scope_file, reader=summary):
    @app.get('/api/v1/work/testnet-context')
    def context():
        if request.args: raise ApiError(400,'INVALID_REQUEST','No role or deployment parameter accepted')
        actor=service.require('partner')
        version=authorize(store,actor,scope_file)
        data=reader()
        # Recheck current identity and local scope after the bounded read, including revocation during I/O.
        actor=service.require('partner')
        if authorize(store,actor,scope_file)!=version: raise ApiError(403,'TESTNET_SCOPE_DENIED','Scope changed')
        return jsonify(role='partner',partnerId=actor.partner_id,scope='testnet:ledger:read',
                       deployment=SCOPE_IDENTITY,capabilities=['read'],ledger=data,
                       historySource='CONTROLLED_TEST_CLIENT',transactionsEnabled=False)
