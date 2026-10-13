"""Owner catalog review preparation, with immutable chain-bound terms."""
import uuid
from .encoding import encode_hash
from .onboarding_adapter import IntegrationRejected,NODE

def available(gateway,q,store):
    client=getattr(gateway,'clients',{}).get('catalogAuthority')
    if client is None:return False
    try:
        if not client.setup(gateway.namespace):return False
        return gateway._fixed(gateway.api_ledger,'live_draft',{**q,'store':store,'op':'catalog_capabilities'},read_only=True).get('publish') is True
    except Exception:return False

def publish(gateway,q,store,draft_id,body):
    if type(body) is not dict or set(body)!={'reviewId'}:raise IntegrationRejected('INVALID_REQUEST',422)
    try:
        if str(uuid.UUID(body['reviewId']))!=body['reviewId']:raise ValueError()
    except (ValueError,TypeError,AttributeError):raise IntegrationRejected('INVALID_REQUEST',422) from None
    if not available(gateway,q,store):raise IntegrationRejected('LIVE_CATALOG_EXECUTION_UNAVAILABLE',503)
    from .live_gateway import word
    return gateway._fixed(gateway.api_ledger,'live_draft',{**q,'store':store,'meal':draft_id,'op':'catalog_publish',
        'reviewId':body['reviewId'],'new_id':str(uuid.uuid4()),'op_id':word()})

def review(gateway,q,store,draft_id,body):
    if type(body) is not dict or set(body)!={'expectedRevision'} or type(body['expectedRevision']) is not int or body['expectedRevision']<1:
        raise IntegrationRejected('INVALID_REQUEST',422)
    request={**q,'store':store,'meal':draft_id,'expectedRevision':body['expectedRevision']}
    material=gateway._fixed(gateway.api_ledger,'live_draft',{**request,'op':'catalog_material'},read_only=True)
    draft=material['draft'];binding=material['binding'];windows=draft['body']['windows']+[[0,0]]*(2-len(draft['body']['windows']))
    terms={'mealId':material['mealId'],'version':material['version'],'unitPrice':draft['body']['price'],
           'bodyDigest':encode_hash('body',name=draft['body']['name'],description=draft['body']['description'])['bodyDigest'],
           'imageDigest':'0x'+draft['imageDigest'],'windowCount':str(len(draft['body']['windows'])),
           **{f'{edge}Minute{i}':str(windows[i][j]) for i in (0,1) for j,edge in enumerate(('start','end'))}}
    from .live_gateway import module
    digest=module('catalog_codec').CatalogCodec(NODE).call('catalogTermsHash',{'binding':binding,'input':terms})['termsHash']
    return gateway._fixed(gateway.api_ledger,'live_draft',{**request,'op':'catalog_review','reviewId':str(uuid.uuid4()),
        'storeRevision':material['storeRevision'],'input':terms,'termsHash':digest,
        'expectedControlRevision':material['expectedControlRevision']})
