"""Private live drafts, detached from published terms and chain operations."""
import base64
import re
from .codec import normalize_image
from .encoding import image_hash
from .onboarding_adapter import IntegrationRejected

CAPABILITIES={'create':True,'edit':True,'upload':True,'publish':False,'listing':False}
MEAL=r'(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'

def handle(gateway,method,path,q,body,headers):
    match=re.fullmatch(r'/v1/stores/([0-9a-f]{64})/drafts(?:/('+MEAL+r')(/image|/review|/publish)?)?',path)
    if not match:return None
    store,meal,tail=match.groups()
    if not q.get('session_hash'):raise IntegrationRejected('UNAUTHENTICATED',401)
    if tail=='/review' and method=='POST':
        from .live_catalog import review
        return review(gateway,q,store,meal,body)
    if tail=='/publish' and method=='POST':
        from .live_catalog import publish
        return publish(gateway,q,store,meal,body)
    if tail in {'/review','/publish'}:
        raise IntegrationRejected('LIVE_CATALOG_EXECUTION_UNAVAILABLE',503)
    request={**q,'store':store,'meal':meal}
    if method=='GET':
        op='list' if meal is None else 'image_get' if tail else 'get'
        result=gateway._fixed(gateway.api_ledger,'live_draft',{**request,'op':op},read_only=True)
        if op=='list':
            from .live_catalog import available
            return {**result,'capabilities':{**CAPABILITIES,'publish':available(gateway,q,store)}}
        return result
    if method!='PUT' or meal is None:raise IntegrationRejected('INVALID_REQUEST',422)
    if tail=='/image':
        revision=headers.get('x-c1-draft-revision','')
        if not re.fullmatch(r'[1-9][0-9]{0,8}',revision):raise IntegrationRejected('INVALID_REVISION',422)
        # Authorize the owner before invoking the bounded image subprocess.
        draft=gateway._fixed(gateway.api_ledger,'live_draft',{**request,'op':'get'},read_only=True)
        if not draft['saved']:raise IntegrationRejected('DRAFT_REQUIRED',409)
        normalized=normalize_image(body,headers.get('content-type'))
        digest=image_hash(normalized,gateway.draft_run)[2:]
        payload={'expectedRevision':int(revision),'image':base64.b64encode(normalized).decode(),'imageDigest':digest}
        op='image_save'
    else:
        if type(body) is not dict or set(body)!={'name','description','price','windows','expectedRevision'}:
            raise IntegrationRejected('INVALID_REQUEST',422)
        if (type(body['expectedRevision']) is not int or not 0<=body['expectedRevision']<=999999999
            or type(body['price']) is not str or not re.fullmatch(r'[1-9][0-9]{0,77}',body['price'])
            or int(body['price'])>=2**256):raise IntegrationRejected('INVALID_REQUEST',422)
        if any(type(body[k]) is not str for k in ('name','description')):raise IntegrationRejected('INVALID_REQUEST',422)
        if not body['name'].strip() or len(body['name'].encode())>200 or len(body['description'].encode())>8192:
            raise IntegrationRejected('INVALID_REQUEST',422)
        windows=body['windows']
        if (type(windows) is not list or not 1<=len(windows)<=2
            or any(type(pair) is not list or len(pair)!=2 or any(type(v) is not int for v in pair)
                or not 0<=pair[0]<pair[1]<=1440 for pair in windows)
            or len(windows)==2 and windows[0][1]>windows[1][0]):raise IntegrationRejected('INVALID_WINDOWS',422)
        payload=body;op='save'
    return gateway._fixed(gateway.api_ledger,'live_draft',{**request,'op':op,'payload':payload})
