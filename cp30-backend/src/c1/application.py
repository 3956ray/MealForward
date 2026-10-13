"""Fixed local API; browser input never becomes identity or execution evidence."""
from __future__ import annotations
import argparse,base64,hashlib,hmac,json,os,re,secrets,signal,stat,threading,uuid
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
from .faults import hit
from .db import Database
from .ipc import Client
from .http import decode_json,HTTPSService,InputRejected
from .codec import normalize_image
from .encoding import encode_hash,terms,batch_hash,content_hash
from .content import verify_original
from .onboarding_adapter import OnboardingGateway,IntegrationRejected
from .db import DatabaseRejected
from .identity_adapter import IdentityGateway
from .static_assets import StaticAssets
COOKIE='__Host-mcpay_c1_session';PRE='__Host-mcpay_c1_pre'
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def token():return secrets.token_urlsafe(32)
ERROR_STATUS={'UNAUTHENTICATED':401,'CSRF':403,'FORBIDDEN':403,'NOT_FOUND':404,'INVALID_ASSERTION':401,'INVALID_CODE':409,'INVALID_INTEGER':422,'INVALID_WINDOWS':422,'INVALID_BODY':422,'INVALID_KEY':422,'PAGE_LIMIT':422,'RATE_LIMIT':429,'UNAVAILABLE':503,'FENCE_PENDING':503,'DB_UNAVAILABLE':503,'QUEUE_FULL':429,'CONTENT_UNAVAILABLE':503,'REAUTH_REQUIRED':401}
class Application:
    def __init__(self,config,*,services=None):
        self.static_assets=StaticAssets.from_config(config)
        self.config=config;self.database=Database(config,'api','business',max_size=3)
        self.controller=Client(config['controller_path'],config['controller_cap']);self.origin=None
        self.cursor_key=bytes.fromhex(config['cursor_key'])
        from .connection_composition import compose_services
        composed=compose_services(config,self.database,lambda:self.namespace,services=services)
        self.onboarding,self.identity,self.dispatcher=composed['onboarding'],composed['identity'],composed.get('dispatcher')
        candidate=composed.get('business_gateway')
        self.real_business=candidate if getattr(candidate,'live_business_protocol',None)=='CP30_LIVE_BUSINESS_V1' and getattr(candidate,'configured',False) is True else None
    def close(self):
        self.database.close()
        if self.real_business is not None:self.real_business.close()
        if self.dispatcher is not None:self.dispatcher.close()
    @property
    def namespace(self):
        if self.config.get('scope_file'):return Path(self.config['scope_file']).read_text().strip()
        return self.config['namespace']
    def call(self,method,request):
        if self.config.get('mode')=='CP30_TESTNET_CONNECTION':
            from .live_gateway import READS,ACTIONS
            if method in READS|ACTIONS:
                if self.real_business is None:return {'error':'LIVE_BUSINESS_NOT_CONFIGURED','status':503}
                return self.real_business.call(method,request)
            if method not in {'rate_limit','auth_pre_session','auth_touch','security_apply'}:return {'error':'LIVE_OPERATION_NOT_IMPLEMENTED','status':503}
        if method in {'support_review','claim_review','support_confirm','claim_confirm','code_check','handover_confirm','settle_review','settle_confirm'}:
            verified=verify_original(self.database,self.namespace,{**request,'purpose':method},self.config['run'])
            if verified.get('error'):return verified
        return self.database.call(method,self.namespace,request)
    def security(self,kind,command):
        if self.config.get('mode')=='CP30_TESTNET_CONNECTION' and kind in {'display','recover','lock'}:
            if self.real_business is None:return {'error':'LIVE_BUSINESS_NOT_CONFIGURED','status':503}
            return self.real_business.security(kind,command)
        if self.config.get('mode')=='CP30_TESTNET_CONNECTION' and kind!='logout':return {'error':'SYNTHETIC_AUTH_DISABLED','status':503}
        if kind in {'display','recover','lock'}:
            verified=verify_original(self.database,self.namespace,{**command,'purpose':kind},self.config['run'])
            if verified.get('error'):return verified
        prepared=self.controller.call(self.namespace,'security',{'kind':kind,'mutation_id':str(uuid.uuid4()),'command':command})
        if prepared.get('error') or prepared.get('replay'):return prepared
        reference={k:prepared[k] for k in ('mutation_id','sequence','digest')}
        result=self.call('security_apply',reference)
        if not result.get('error'):hit(self.config,'security_applied',self.namespace,reference['mutation_id'])
        phase='abort' if result.get('error') else 'finish'
        final=self.controller.call(self.namespace,'security',{'phase':phase,**reference})
        if final.get('error'):return final
        return result
    def _schema(self,body,fields,required=None):
        if type(body) is not dict or not set(body)<=set(fields) or not set(required or fields)<=set(body):raise ValueError('INVALID_REQUEST')
        for field,value in body.items():
            if field in {'quantity','expectedRevision'}:
                if type(value) is not int or value<0 or value>9223372036854775807 or (field=='quantity' and not 1<=value<=10):raise ValueError('INVALID_REQUEST')
            elif field in {'listed','paused'}:
                if type(value) is not bool:raise ValueError('INVALID_REQUEST')
            elif field=='windows':
                if type(value) is not list or not 1<=len(value)<=2 or any(type(pair) is not list or len(pair)!=2 or any(type(v) is not int for v in pair) for pair in value):raise ValueError('INVALID_REQUEST')
            else:
                if type(value) is not str or '\x00' in value:raise ValueError('INVALID_REQUEST')
                if field in {'store','meal'} and not re.fullmatch('[A-Za-z0-9_-]{1,64}',value):raise ValueError('INVALID_REQUEST')
                if field=='reviewId' and not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',value):raise ValueError('INVALID_REQUEST')
                if field in {'assertion','access','display'} and not re.fullmatch('[A-Za-z0-9_-]{43}',value):raise ValueError('INVALID_REQUEST')
        return body
    def _cookie(self,name,value,age=86400):return f'{name}={value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={age}'
    def _rate(self,q,path,mutating,store=None):
        key=q.get('session_hash','anonymous');b=[]
        if '/auth/' in path:
            name=path.rsplit('/',1)[-1];b=[{'key':'auth:'+name+':loopback','period':60,'limit':5},{'key':'auth:'+name+':loopback','period':3600,'limit':20}]
        elif mutating:
            b=[{'key':'mutation:'+key,'period':60,'limit':30}]
            if store:b.append({'key':'store:'+store,'period':60,'limit':120})
            if path.endswith(('/display','/checks')):
                b.extend([{'key':'short:'+key,'period':60,'limit':30},{'key':'short-store:'+str(store),'period':60,'limit':30}])
            if path.endswith('/recover'):b.append({'key':'recover:'+key,'period':60,'limit':5})
        else:b=[{'key':'public:loopback','period':60,'limit':120}]
        return self.call('rate_limit',{**q,'buckets':b,'support':mutating and (path=='/v1/support/intents' or bool(re.fullmatch(r'/v1/support/intents/[0-9a-f-]{36}/cancel',path)))})
    def handle(self,method,path,headers,cookies,body,origin):
        response_headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
        try:
            split=urlsplit(path);p=split.path
            assets=getattr(self,'static_assets',None)
            if assets is not None and method=='GET' and p!='/v1' and not p.startswith('/v1/'):
                asset=assets.get(p)
                if asset is None:return 404,{'error':'NOT_FOUND'},response_headers
                response_headers['Content-Type']=asset[0]
                return 200,asset[1],response_headers
            if method=='GET' and p in {'/','/consumer.js','/consumer.css','/assets/qr.js','/connection.js','/collection-link.mjs','/assets/wallet.js','/assets/identity.js'}:
                file=Path(__file__).resolve().parents[2]/'consumer'/({'/':'index.html','/consumer.js':'consumer.js','/consumer.css':'consumer.css','/assets/qr.js':'assets/qr.js','/connection.js':'connection.js','/collection-link.mjs':'collection-link.mjs','/assets/wallet.js':'assets/wallet.js','/assets/identity.js':'assets/identity.js'}[p]);response_headers['Content-Type']='text/html; charset=utf-8' if p=='/' else 'text/css; charset=utf-8' if p=='/consumer.css' else 'text/javascript; charset=utf-8';return 200,file.read_bytes(),response_headers
            if not p.startswith('/v1/'):return 404,{'error':'NOT_FOUND'},response_headers
            if method=='GET' and p=='/v1/connection':return 200,self.onboarding.setup(),response_headers
            if method=='GET' and p=='/v1/identity/setup':return 200,self.identity.setup(),response_headers
            live_mode=self.config.get('mode')=='CP30_TESTNET_CONNECTION'
            if live_mode:
                connection_route=p.startswith(('/v1/identity/','/v1/store-registrations','/v1/store-registration-images','/v1/registered-stores','/v1/registered-store-images/')) or bool(re.fullmatch(r'/v1/intents/[0-9a-f-]{36}/wallet-(preparation|transactions|attempts)',p))
                common_auth=p in {'/v1/auth/pre-session','/v1/auth/logout','/v1/me'}
                if p in {'/v1/auth/login','/v1/auth/reauth'}:return 503,{'error':'SYNTHETIC_AUTH_DISABLED'},response_headers
                if not connection_route and not common_auth and self.real_business is None:
                    return 503,{'error':'LIVE_BUSINESS_NOT_CONFIGURED','setup':{'missing':['Real finalized facts → persistent quote/issue/lock/handover/report/settle projection']}},response_headers
            mutating=method in {'POST','PUT'}
            # Request origin is independently checked by transport and app.
            if mutating and (origin!=self.origin or headers.get('host')!=urlsplit(self.origin).netloc):return 403,{'error':'ORIGIN'},response_headers
            public_read=method=='GET' and (p in {'/v1/stores','/v1/ledger','/v1/registered-stores'} or bool(re.fullmatch(r'/v1/(registered-store-images/0x[0-9a-f]{64}|images/[0-9a-f]{64}|stores/[A-Za-z0-9_-]{1,64}/meals(?:/[A-Za-z0-9_-]{1,64})?)',p)))
            try:trust=self.controller.call(self.namespace,'query',{})
            except Exception:trust={'error':'CONTROLLER_UNAVAILABLE','quarantined':True,'riskBlocked':True}
            untrusted=bool(trust.get('error') or trust.get('quarantined'))
            if (untrusted and not public_read) or (mutating and trust.get('riskBlocked')):return 503,{'error':'UNAVAILABLE'},response_headers
            q={}
            if cookies.get(COOKIE):q['session_hash']=digest(cookies[COOKIE])
            if method=='GET' and p in {'/v1/me','/v1/store-registrations'} and not q.get('session_hash'):
                return 401,{'error':'UNAUTHENTICATED'},response_headers
            if headers.get('x-c1-csrf'):q['csrf_hash']=digest(headers['x-c1-csrf'])
            if mutating:
                key=headers.get('idempotency-key','')
                if not re.fullmatch(r'[ -~]{16,128}',key):raise ValueError('INVALID_KEY')
                q.update(key=key,new_id=str(uuid.uuid4()))
            if q.get('session_hash') and not untrusted:self.call('auth_touch',q)
            store_match=re.match(r'^/v1/stores/([A-Za-z0-9_-]{1,64})(?:/|$)',p);store=store_match.group(1) if store_match else None
            rate=self._rate(q,p,mutating,store)
            if rate.get('error'):return rate['status'],{'error':rate['error']},{**response_headers,'Retry-After':str(rate.get('retryAfter',1))}
            is_image=method=='PUT' and (p.endswith('/image') or p=='/v1/store-registration-images')
            data={} if not mutating or is_image else decode_json(body)
            parameters=parse_qs(split.query,strict_parsing=True) if split.query else {}
            if any(k not in {'limit','cursor'} or len(v)!=1 for k,v in parameters.items()):raise ValueError('INVALID_REQUEST')
            page=int(parameters.get('limit',['20'])[0])
            if not 1<=page<=50:raise ValueError('PAGE_LIMIT')
            q.update(limit=page)
            principal=hmac.new(self.cursor_key,('cursor-principal:'+q.get('session_hash','anonymous')).encode(),hashlib.sha256).hexdigest()
            cursor_expiry=rate['now']+900
            if parameters.get('cursor'):
                raw=parameters['cursor'][0];encoded,signature=raw.split('.')
                if not hmac.compare_digest(hmac.new(self.cursor_key,encoded.encode(),hashlib.sha256).hexdigest(),signature):raise ValueError('CURSOR')
                cursor=json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))
                if cursor['scope']!=p or cursor['principal']!=principal or cursor.get('namespaceDigest')!=digest(self.namespace) or type(cursor.get('expiresAt')) is not int or rate['now']>=cursor['expiresAt']:raise ValueError('CURSOR')
                if type(cursor.get('after')) is not str or not cursor['after'] or type(cursor.get('snapshot')) is not dict:raise ValueError('CURSOR')
                q.update(after=cursor['after'],snapshot=cursor['snapshot']['height'],catalog_snapshot=cursor['snapshot']['catalogRevision'])
                cursor_expiry=cursor['expiresAt']
            result=None
            if live_mode and method=='GET' and re.fullmatch('/v1/images/[0-9a-f]{64}',p):
                image=self.onboarding.public_image('0x'+p.rsplit('/',1)[1]);response_headers['Content-Type']='image/png';return 200,base64.b64decode(image['image']),response_headers
            if live_mode and not connection_route and not common_auth:
                result=self.real_business.handle(method,p,q,body if is_image else data,headers)
                if method=='GET' and re.fullmatch(r'/v1/stores/[0-9a-f]{64}/(?:drafts/[0-9a-f-]+|meals/[0-9a-f]{64}/versions/[1-9][0-9]{0,77})/image',p) and not result.get('error'):
                    response_headers['Content-Type']='image/png'
                    return 200,base64.b64decode(result['image']),response_headers
            elif p=='/v1/store-registrations' and method=='GET':
                if split.query:raise ValueError('INVALID_REQUEST')
                result=self.onboarding.list_owned(q)
            elif p=='/v1/store-registrations' and method=='POST':result=self.onboarding.register(q,headers['idempotency-key'],data)
            elif p=='/v1/identity/login' and method=='POST':
                result=self.identity.login(data,{**q,'pre_hash':digest(cookies.get(PRE,''))})
                if not result.get('error'):
                    session=result.pop('sessionToken');result['csrf']=result.pop('csrfToken');response_headers['Set-Cookie']=self._cookie(COOKIE,session)
            elif p=='/v1/identity/wallet/challenge' and method=='POST':result=self.identity.wallet_login_challenge(data,{**q,'pre_hash':digest(cookies.get(PRE,''))})
            elif p=='/v1/identity/wallet/login' and method=='POST':
                result=self.identity.wallet_login(data,{**q,'pre_hash':digest(cookies.get(PRE,''))})
                if not result.get('error'):
                    session=result.pop('sessionToken');result['csrf']=result.pop('csrfToken');response_headers['Set-Cookie']=self._cookie(COOKIE,session)
            elif p=='/v1/identity/wallet-challenges' and method=='POST':result=self.identity.wallet_prepare(data,q)
            elif p=='/v1/identity/wallet-proofs' and method=='POST':result=self.identity.wallet_submit(data,q)
            elif p=='/v1/registered-stores' and method=='GET':result=self.onboarding.public_catalog()
            elif re.fullmatch(r'/v1/registered-store-images/0x[0-9a-f]{64}',p) and method=='GET':
                result=self.onboarding.public_image(p.rsplit('/',1)[1])
                if not result.get('error'):response_headers['Content-Type']='image/png';return 200,base64.b64decode(result['image']),response_headers
            elif p=='/v1/store-registration-images' and method=='PUT':result=self.onboarding.image(q,body,headers.get('content-type'))
            elif re.fullmatch(r'/v1/store-registrations/0x[0-9a-f]{64}',p) and method=='GET':result=self.onboarding.get(q,p.rsplit('/',1)[1])
            elif re.fullmatch(r'/v1/store-registrations/0x[0-9a-f]{64}/enable',p) and method=='POST':result=self.onboarding.enable(q,p.split('/')[3],data)
            elif re.fullmatch(r'/v1/intents/[0-9a-f-]{36}/wallet-preparation',p) and method=='GET':result=self.onboarding.wallet_preparation(q,p.split('/')[3])
            elif re.fullmatch(r'/v1/intents/[0-9a-f-]{36}/wallet-transactions',p) and method=='POST':result=self.onboarding.observe_wallet_transaction(q,p.split('/')[3],data)
            elif re.fullmatch(r'/v1/intents/[0-9a-f-]{36}/wallet-attempts',p) and method=='POST':result=self.onboarding.begin_wallet_attempt(q,p.split('/')[3],data)
            elif p=='/v1/auth/pre-session' and method=='POST':
                self._schema(data,[]);pre=token();csrf=token()
                if headers.get('x-c1-bootstrap')!='1':return 403,{'error':'BOOTSTRAP'},response_headers
                result=self.call('auth_pre_session',{'pre_hash':digest(pre),'csrf_hash':digest(csrf)})
                if not result.get('error'):result['csrf']=csrf;response_headers['Set-Cookie']=self._cookie(PRE,pre,300)
            elif p in {'/v1/auth/login','/v1/auth/reauth'} and method=='POST':
                self._schema(data,['assertion']);session=token();csrf=token();kind=p.rsplit('/',1)[1]
                command={**q,'assertion_hash':digest(data['assertion']),'new_session_hash':digest(session),'new_csrf_hash':digest(csrf)}
                if kind=='login':command['pre_hash']=digest(cookies.get(PRE,''))
                result=self.security(kind,command)
                if not result.get('error'):response_headers['Set-Cookie']=self._cookie(COOKIE,session);result['csrf']=csrf
            elif p=='/v1/auth/logout' and method=='POST':
                self._schema(data,[]);result=self.security('logout',q)
                if not result.get('error') and headers.get('x-c1-preserve-session-cookie')!='1':response_headers['Set-Cookie']=self._cookie(COOKIE,'',0)
            elif p=='/v1/me' and method=='GET':result=self.call('auth_me',q)
            elif p=='/v1/stores' and method=='GET':result=self.call('public_stores',q)
            elif p=='/v1/ledger' and method=='GET':result=self.call('public_ledger',q)
            elif re.fullmatch('/v1/images/[0-9a-f]{64}',p) and method=='GET':
                result=self.call('public_image',{'digest':p.rsplit('/',1)[1]})
                if not result.get('error'):response_headers['Content-Type']='image/png';return 200,base64.b64decode(result['image']),response_headers
            elif p=='/v1/my/orders' and method=='GET':result=self.call('my_orders',q)
            elif p=='/v1/my/vouchers' and method=='GET':result=self.call('my_vouchers',q)
            elif re.fullmatch(r'/v1/(orders|intents)/[0-9a-f-]{36}',p) and method=='GET':result=self.call('order_get' if p.split('/')[2]=='orders' else 'intent_get',{**q,'id':p.rsplit('/',1)[1]})
            elif re.fullmatch(r'/v1/vouchers/0x[0-9a-f]{64}',p) and method=='GET':result=self.call('voucher_get',{**q,'id':p.rsplit('/',1)[1]})
            elif p in {'/v1/support/reviews','/v1/claims/reviews'} and method=='POST':
                fields=['store','meal','quantity'] if '/support/' in p else ['store','meal'];self._schema(data,fields);result=self.call('support_review' if '/support/' in p else 'claim_review',{**q,**data,'review_id':str(uuid.uuid4())})
            elif p in {'/v1/support/intents','/v1/claims/intents','/v1/refund-intents'} and method=='POST':
                self._schema(data,['reviewId']);action='fund' if '/support/' in p else 'issue' if '/claims/' in p else 'refund';q.update(client=data,action=action)
                result=self.call('intent_retry',q)
                if not result.get('error') and not result.get('id'):
                    if action=='fund':
                        material=self.call('review_material',{**q,'review_id':data['reviewId']})
                        if material.get('error'):result=material
                        else:
                            quote='0x'+secrets.token_hex(32);q.update(quote_id=quote,batch_id=batch_hash(material['scope']['escrow'],quote));result=self.call('support_confirm',q)
                    else:result=self.call('claim_confirm' if action=='issue' else 'refund_confirm',q)
            elif re.fullmatch(r'/v1/orders/[0-9a-f-]{36}/refund-reviews',p) and method=='POST':self._schema(data,[]);result=self.call('refund_review',{**q,'id':p.split('/')[3],'review_id':str(uuid.uuid4())})
            elif re.fullmatch(r'/v1/support/intents/[0-9a-f-]{36}/cancel',p) and method=='POST':
                self._schema(data,[]);case=self.call('intent_get',{**q,'id':p.split('/')[4]})
                if case.get('error'):result=case
                else:result=self.controller.call(self.namespace,'cancel',{'intent_id':p.split('/')[4],'session_hash':q['session_hash'],'csrf_hash':q['csrf_hash']})
            elif re.fullmatch(r'/v1/vouchers/0x[0-9a-f]{64}/(recover|display)',p) and method=='POST':
                kind=p.rsplit('/',1)[1];vid=p.split('/')[3];self._schema(data,[] if kind=='recover' else ['access']);command={**q,'voucher':vid}
                if kind=='recover':
                    access=token();session=token();csrf=token();command.update(new_access_hash=digest(access),new_session_hash=digest(session),new_csrf_hash=digest(csrf));result=self.security(kind,command)
                    if not result.get('error') and not result.get('replay'):
                        if result.get('redeemable'):result['access']=access
                        result['csrf']=csrf;response_headers['Set-Cookie']=self._cookie(COOKIE,session)
                else:
                    display=token();command.update(access_hash=digest(data['access']),new_display_hash=digest(display));result=self.security(kind,command)
                    if not result.get('error') and not result.get('replay'):result['display']=display
            elif store:
                q['store']=store;tail=p[len('/v1/stores/'+store):]
                if tail=='/meals' and method=='GET':result=self.call('public_meals',q)
                elif re.fullmatch(r'/meals/[A-Za-z0-9_-]{1,64}',tail) and method=='GET':result=self.call('public_meal',{**q,'meal':tail.rsplit('/',1)[1]})
                elif tail=='/workbench' and method=='GET':result=self.call('workbench',q)
                elif tail=='/payouts' and method=='GET':result=self.call('payouts',q)
                elif re.fullmatch(r'/cases/0x[0-9a-f]{64}',tail) and method=='GET':result=self.call('case_get',{**q,'id':tail.rsplit('/',1)[1]})
                elif re.fullmatch(r'/drafts/[A-Za-z0-9_-]{1,64}',tail):
                    q['meal']=tail.rsplit('/',1)[1]
                    if method=='GET':result=self.call('draft_get',q)
                    elif method=='PUT':self._schema(data,['name','description','price','windows','expectedRevision']);result=self.call('draft_save',{**q,**data})
                elif re.fullmatch(r'/drafts/[A-Za-z0-9_-]{1,64}/image',tail) and method=='PUT':
                    normalized=normalize_image(body,headers.get('content-type'));ih=__import__('c1.encoding',fromlist=['image_hash']).image_hash(normalized,self.config['run']);result=self.call('draft_image',{**q,'meal':tail.split('/')[2],'expectedRevision':int(headers.get('x-c1-draft-revision','-1')),'image':base64.b64encode(normalized).decode(),'image_digest':ih[2:]})
                elif re.fullmatch(r'/drafts/[A-Za-z0-9_-]{1,64}/review',tail) and method=='POST':self._schema(data,['expectedRevision']);result=self.call('draft_review',{**q,**data,'meal':tail.split('/')[2],'review_id':str(uuid.uuid4())})
                elif re.fullmatch(r'/drafts/[A-Za-z0-9_-]{1,64}/publish',tail) and method=='POST':
                    self._schema(data,['reviewId']);q.update(client=data,action='publish',meal=tail.split('/')[2]);result=self.call('intent_retry',q)
                    if not result.get('error') and not result.get('id'):
                        material=self.call('review_material',{**q,'review_id':data['reviewId']})
                        if material.get('error'):result=material
                        else:
                            pterm=material['payload'];hashes=content_hash(base64.b64decode(pterm['image']),self.config['run'],material['scope'],pterm['meal'],pterm['version'],pterm['price'],pterm['name'],pterm['description'],pterm['windows']);bh=hashes['bodyDigest'];th=hashes['termsHash'];
                            if hashes['imageDigest']!='0x'+pterm['imageDigest']:return 503,{'error':'CONTENT_UNAVAILABLE'},response_headers
                            q.update(body=base64.b64encode(json.dumps([pterm['name'],pterm['description']],ensure_ascii=False).encode()).decode(),body_digest=bh[2:],terms_hash=th[2:]);result=self.call('draft_publish',q)
                elif tail in {'/list','/pause','/close'} and method=='POST':
                    action=tail[1:];fields={'list':['expectedRevision','meal','listed'],'pause':['expectedRevision','paused'],'close':['expectedRevision']}[action];self._schema(data,fields);result=self.call('control_confirm',{**q,'action':action,'client':data})
                elif tail=='/checks' and method=='POST':self._schema(data,['display']);result=self.call('code_check',{**q,'display_hash':digest(data['display'])})
                elif tail=='/locks' and method=='POST':self._schema(data,['display']);result=self.security('lock',{**q,'display_hash':digest(data['display']),'client':{'displayDigest':digest(data['display'])}})
                elif re.fullmatch(r'/cases/0x[0-9a-f]{64}/handover-intents',tail) and method=='POST':self._schema(data,[]);result=self.call('handover_confirm',{**q,'case_id':tail.split('/')[2],'client':{'caseId':tail.split('/')[2]}})
                elif re.fullmatch(r'/payouts/0x[0-9a-f]{64}/settle-reviews',tail) and method=='POST':self._schema(data,[]);result=self.call('settle_review',{**q,'id':tail.split('/')[2],'review_id':str(uuid.uuid4())})
                elif tail=='/settle-intents' and method=='POST':self._schema(data,['reviewId']);result=self.call('settle_confirm',{**q,'client':data})
            if result is not None and result.get('_sessionToken'):
                response_headers['Set-Cookie']=self._cookie(COOKIE,result.pop('_sessionToken'))
            if result is not None and mutating and result.get('id') and not result.get('replay'):hit(self.config,'domain_committed',self.namespace,result['id'])
            if result is None:return 404,{'error':'NOT_FOUND'},response_headers
            if result.get('error'):return result.get('status',ERROR_STATUS.get(result['error'],409)),{'error':result['error']},response_headers
            if untrusted and 'provenance' in result:result['provenance'].update(stale=True,halted=True,reason='CONTROLLER_UNAVAILABLE')
            if 'items' in result and 'provenance' in result and len(result['items'])==page:
                prov=result['provenance'];item=result['items'][-1]
                last=item['meal'] if re.fullmatch(r'/v1/stores/[^/]+/meals',p) else item['id']
                value={'scope':p,'principal':principal,'namespaceDigest':digest(self.namespace),'expiresAt':cursor_expiry,'after':last,'snapshot':{key:prov[key] for key in ('height','catalogRevision')}}
                encoded=base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
                result['cursor']=encoded+'.'+hmac.new(self.cursor_key,encoded.encode(),hashlib.sha256).hexdigest()
            return 200,result,response_headers
        except (IntegrationRejected,DatabaseRejected) as exc:return exc.status,{'error':exc.code,'setup':self.onboarding.setup() if exc.code=='NOT_CONFIGURED' else None},response_headers
        except (ValueError,KeyError,TypeError,InputRejected):return 422,{'error':'INVALID_REQUEST'},response_headers
        except Exception:return 503,{'error':'DEPENDENCY_UNAVAILABLE'},response_headers

def write_bound_file(path,value):
    path=Path(path)
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        parent=os.fstat(directory)
        if parent.st_uid!=os.getuid() or stat.S_IMODE(parent.st_mode)!=0o700:raise ValueError('OWNED_BOUND_DIRECTORY_REQUIRED')
        fd=os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=directory)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_nlink!=1:raise ValueError('OWNED_BOUND_FILE_REQUIRED')
            os.fchmod(fd,0o600);os.ftruncate(fd,0)
            raw=memoryview(json.dumps(value).encode())
            while raw:
                written=os.write(fd,raw)
                if written<=0:raise ValueError('BOUND_FILE_WRITE_FAILED')
                raw=raw[written:]
            os.fsync(fd)
        finally:os.close(fd)
        os.fsync(directory)
    finally:os.close(directory)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);config_path=parser.parse_args().config;config=json.loads(Path(config_path).read_text())
    if config.get('mode')=='CP30_TESTNET_CONNECTION':
        from .private_connection_config import load
        config=load(config_path)
    if config.get('mode') not in {'C1_SYNTHETIC_LOOPBACK','CP30_TESTNET_CONNECTION'} or os.environ:raise SystemExit('EXPLICIT_ISOLATED_MODE_REQUIRED')
    if config.get('mode')=='CP30_TESTNET_CONNECTION':
        from .full_configuration import validate_origin
        validate_origin(config['origin'],config['httpPort'])
    app=Application(config)
    def bound(port,origin):
        if config.get('mode')=='CP30_TESTNET_CONNECTION' and (port!=config['httpPort'] or origin!=config['origin']):raise ValueError('BOUND_ORIGIN_MISMATCH')
        app.origin=origin;write_bound_file(config['bound_file'],{'port':port,'origin':origin,'pid':os.getpid()})
    service=HTTPSService(app,config['certfile'],config['keyfile'],on_bound=bound,port=config.get('httpPort',0),origin=config.get('origin') if config.get('mode')=='CP30_TESTNET_CONNECTION' else None);event=threading.Event();signal.signal(signal.SIGTERM,lambda *_:event.set());service.start()
    try:
        if app.dispatcher is None and app.real_business is None:event.wait()
        else:
            while not event.wait(2):
                if app.dispatcher is not None:app.dispatcher.step()
                if app.real_business is not None:app.real_business.step()
    finally:service.close();app.close()
if __name__=='__main__':main()
