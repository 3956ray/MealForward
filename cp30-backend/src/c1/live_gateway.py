"""Real one-store business gateway. Fixed PG commands; all chain/codec IO detached."""
from copy import deepcopy
import importlib,json,re,secrets,time,uuid,sys
from .onboarding_adapter import IntegrationRejected,NODE,wallet_bridge
from .private_business_host import business_modules
from .registration_runtime_host import persistence_module
from .ipc import Client
from .registrar_signer_journal import word_hash

PROTOCOL='CP30_LIVE_BUSINESS_V1'
READS=frozenset('public_stores public_meals public_meal public_ledger my_orders my_claims order_get intent_get my_vouchers voucher_get workbench case_get payouts wallet_material auth_me'.split())
ACTIONS=frozenset('support_review claim_review settle_review support_confirm claim_confirm settle_confirm code_check lock_confirm handover_confirm recover display wallet_attempt wallet_hash'.split())
_last_step_diagnostic=None
def word():return '0x'+secrets.token_hex(32)
def secret():return secrets.token_urlsafe(32)
def digest(s):return __import__('hashlib').sha256(s.encode()).hexdigest()
def core(descriptor):return {key:descriptor[key] for key in ('chainId','from','to','value','data','callDataDigest')}
def module(name):
    business_modules();return importlib.import_module('c1_business_integration.'+name)
def wallet_module(name):
    from .connection_composition import wallet_modules
    wallet_modules()
    if name=='approval_observer':
        import sys
        sys.modules.setdefault('approval_rpc',importlib.import_module('c1_wallet_integration.approval_rpc'))
    return importlib.import_module('c1_wallet_integration.'+name)
def validate_body(body,fields):
    if type(body) is not dict or set(body)!=set(fields):raise IntegrationRejected('INVALID_REQUEST',422)
    return deepcopy(body)

def registered_profile(config,registration):
    r=registration['record'];e=r['verifiedEvidence'];binding={key:(int(e[key]) if key=='chainId' else e[key]) for key in ('chainId','escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority')}
    asset=config['asset']
    if registration['state']!='CONFIRMED' or e['registrationId']!=r['registrationId'] or binding['asset']!=asset['address'] or binding['chainId']!=asset['chainId'] or e['catalog']!=r['original']['catalog']:raise IntegrationRejected('REGISTERED_PROFILE_MISMATCH',503)
    terms=e['catalog'][0]['terms'];meal={**r['request']['firstMeal'],'price':terms['unitPrice'],'version':terms['version'],'imageDigest':terms['imageDigest']}
    return {'binding':binding,'registrationState':'CONFIRMED','registrationEvidence':e,**{key:config['observer'][key] for key in ('genesisHash','finality','eip1898','runtimeTemplatePin','compilerPins','budget')},'maxSnapshotAgeSeconds':config['maxSnapshotAgeSeconds'],'request':r['request'],'firstMeal':meal,'assetMetadata':deepcopy(asset)}

class PrivateBusinessClient:
    live_business_protocol='CP30_LIVE_BUSINESS_HOST_V1'
    def __init__(self,ipc,role):self.ipc,self.role=ipc,role
    def setup(self,namespace):
        value=self.ipc.call(namespace,'setup',{})
        return value.get('status')=='CONFIGURED' and value.get('role')==self.role
    def execute(self,namespace,intent_id,*,lookup=False):
        result=self.ipc.call(namespace,'lookup_original' if lookup else 'execute_original',{'intentId':intent_id})
        if result.get('error'):raise IntegrationRejected('PRIVATE_ORIGINAL_UNKNOWN',503)
        return result

class LiveGateway:
    live_business_protocol=PROTOCOL
    def __init__(self,*,api_ledger,worker_ledger,config,clients,activation_gate,clock=None,codec=None,observer_factory=None,approval_factory=None):
        if config.get('enabled') is not True or not {'quoteAuthority','issuerAuthority','operatorAuthority'}<=set(clients)<={'quoteAuthority','issuerAuthority','operatorAuthority','catalogAuthority'} or any(getattr(c,'live_business_protocol',None)!='CP30_LIVE_BUSINESS_HOST_V1' for c in clients.values()):raise IntegrationRejected('LIVE_BUSINESS_NOT_CONFIGURED',503)
        for ledger in (api_ledger,worker_ledger):
            if getattr(ledger,'durability_protocol',None)!='CP30_DURABLE_ORIGINAL_LEDGER_V1':raise IntegrationRejected('EXTERNAL_RESTORE_FLOOR_REQUIRED',503)
        if api_ledger.namespace!=worker_ledger.namespace:raise IntegrationRejected('NAMESPACE_CONFLICT',503)
        self.api_ledger,self.worker_ledger,self.config,self.clients,self.gate=api_ledger,worker_ledger,deepcopy(config),clients,activation_gate
        self.clock=clock or (lambda:int(time.time()));self.codec=codec or business_modules()['codec'].BusinessCodec(NODE)
        self.observer_factory=observer_factory or self._observer;self.approval_factory=approval_factory or self._approval
        self.projection=module('projection');self._task_cursor=0
        self._last_refresh_finished=None;self._yield_refresh_to_task=False
        asset=config['asset'];required={'chainId','address','decimals','symbol','codeHash','reviewed'}
        if set(asset)!=required or type(asset['chainId']) is not int or not 0<asset['chainId']<2**53 or not re.fullmatch('0x[0-9a-f]{40}',str(asset['address'])) or int(asset['address'],16)==0 or asset['reviewed'] is not True or type(asset['decimals']) is not int or not 0<=asset['decimals']<=36 or not re.fullmatch('[A-Za-z0-9._-]{1,24}',asset['symbol']) or (not re.fullmatch('0x[0-9a-f]{64}',asset['codeHash']) or int(asset['codeHash'],16)==0):raise IntegrationRejected('REVIEWED_ASSET_REQUIRED',503)
        if type(config.get('maxSnapshotAgeSeconds')) is not int or not 1<=config['maxSnapshotAgeSeconds']<=300:raise IntegrationRejected('BOUNDED_FACT_AGE_REQUIRED',503)
        # Constructor loads fixed source only; never contacts DB, signer or RPC.
        self.configured=True
    @property
    def namespace(self):return self.api_ledger.namespace
    def close(self):
        self.api_ledger.database.close()
        if self.worker_ledger.database is not self.api_ledger.database:self.worker_ledger.database.close()
    def metadata(self):return {'mode':'CP30_TESTNET_CONNECTION','assetVerified':True,'assetDecimals':self.config['asset']['decimals'],'assetSymbol':self.config['asset']['symbol']}
    def _fixed(self,ledger,method,request,*,read_only=False):
        with ledger.transaction(read_only=read_only) as tx:
            result=tx.fixed.call(method,{'ticket':tx.ticket,**deepcopy(request)})
            if not read_only:tx.dirty=True
        return deepcopy(result)
    def call(self,op,q):
        if op not in READS|ACTIONS:raise IntegrationRejected('LIVE_OPERATION_NOT_IMPLEMENTED',503)
        request={**deepcopy(q),'op':op}
        if op.endswith('_review'):request.setdefault('review_id',str(uuid.uuid4()))
        if op.endswith('_confirm'):request.setdefault('new_id',str(uuid.uuid4()));request.setdefault('op_id',word())
        return self._fixed(self.api_ledger,'live_api',request,read_only=op in READS)
    def material(self,intent_id):return self._fixed(self.worker_ledger,'live_material',{'id':intent_id},read_only=True)
    def registration(self,registration_id=None):return self._fixed(self.worker_ledger,'live_material',{'op':'registration','registrationId':registration_id},read_only=True)
    def ready_for_store(self,registration_id):
        material=self.registration(registration_id);store=material.get('store')
        return bool(self.configured and store and store.get('snapshot') and self.clock()-int(store['snapshot']['timestamp'])<=self.config['maxSnapshotAgeSeconds'] and all(self.clients[role].setup(self.namespace) for role in ('quoteAuthority','issuerAuthority','operatorAuthority')))
    def _profile(self,registration):return registered_profile(self.config,registration)
    def _observer(self,profile,original=None,transaction_hash=None):
        settings=self.config['rpc'];strict=deepcopy({key:profile[key] for key in ('binding','registrationState','registrationEvidence','genesisHash','finality','eip1898','runtimeTemplatePin','compilerPins','budget')})
        # Only reviewed runtime read deadlines can differ from the original
        # saved profile. Projection CAS still receives that original profile.
        budget=self.config['observer']['budget'];saved=strict['budget']
        if (type(budget) is not dict or set(budget)!=set(saved)
            or type(budget.get('maxTotalMs')) is not int or not saved['maxTotalMs']<=budget['maxTotalMs']<=45000
            or type(budget.get('maxCallMs')) is not int or not saved['maxCallMs']<=budget['maxCallMs']<=5000
            or budget['maxCallMs']>budget['maxTotalMs']
            or any(budget[key]!=saved[key] for key in saved if key not in {'maxTotalMs','maxCallMs'})):
            raise IntegrationRejected('BUSINESS_OBSERVATION_BUDGET_REJECTED',503)
        strict['budget']=deepcopy(budget)
        snapshot=deepcopy(original)
        def transport():return module('rpc_transport').ReadOnlyBusinessRpcTransport(endpoint=settings['endpoint'],allowed_endpoints=settings['allowedEndpoints'],allowed_hosts=settings['allowedHosts'],python_executable=settings['pythonExecutable'],profile=strict,original_transaction_hash=transaction_hash,original_deployment=snapshot['deployment'] if snapshot else None)
        return business_modules()['observer'].StoreEscrowObserver(codec=self.codec,transport_factory=transport,profile=strict)
    def _approval(self,profile):
        settings=self.config['rpc'];asset=self.config['asset'];ap={'chainId':asset['chainId'],'genesisHash':profile['genesisHash'],'asset':asset['address'],'escrow':profile['binding']['escrow'],'assetCodeHash':asset['codeHash'],'finality':'rpc-finalized','eip1898':True,'budget':self.config['approvalBudget']}
        def transport(scope):return wallet_module('approval_rpc').ApprovalRpcTransport(endpoint=settings['endpoint'],allowed_endpoints=settings['allowedEndpoints'],allowed_hosts=settings['allowedHosts'],python_executable=settings['pythonExecutable'],profile=ap,scope=scope)
        return wallet_module('approval_observer').ApprovalObserver(node_executable=NODE,profile=ap,transport_factory=transport)
    def _meal_aliases(self,material):
        saved=material.get('store') or {};profile=saved.get('profile') or {}
        original=profile.get('registrationEvidence',{}).get('catalog',[])
        ids=list(material.get('catalogMeals',[]))
        if saved.get('meal'):ids.append('0x'+saved['meal'])
        ids.extend(item['terms']['mealId'] for item in original)
        if not ids and material.get('registration'):
            ids.extend(item['terms']['mealId'] for item in material['registration']['record']['verifiedEvidence']['catalog'])
        if any(type(value) is not str or not re.fullmatch('0x[0-9a-f]{64}',value) or int(value,16)==0 for value in ids):raise IntegrationRejected('CATALOG_MEAL_SCOPE_REJECTED',503)
        ids=sorted(set(ids))
        if not 1<=len(ids)<=3:raise IntegrationRejected('CATALOG_MEAL_SCOPE_REJECTED',503)
        return {value:value[2:] for value in ids}
    def _seed_or_refresh(self,material):
        registration=material.get('registration')
        if not registration:return {'state':'WAIT_VERIFIED_REGISTRATION'}
        saved=material.get('store');profile=saved['profile'] if saved else self._profile(registration)
        aliases=self._meal_aliases(material)
        snapshot=self.observer_factory(profile).read_finalized(meal_ids=list(aliases))
        if snapshot is None:return {'state':'ORIGINAL_OBSERVATION_UNKNOWN'}
        store=profile['binding']['storeId'][2:];meal=profile['registrationEvidence']['catalog'][0]['terms']['mealId'][2:]
        rows=self.projection.finalized_snapshot_rows(snapshot,store,aliases)
        return self._fixed(self.worker_ledger,'live_projection',{'store':store,'registrationId':registration['id'],'registrationRecord':registration['record'],'profile':profile,'expectedRevision':saved['revision'] if saved else None,'snapshot':snapshot,'rows':rows})
    def wallet_preparation(self,q,intent_id):
        value=self.call('wallet_material',{**q,'id':intent_id});i,store,attempts=value['intent'],value['store'],value['attempts'];binding=store['profile']['binding']
        if i['action']=='fund':
            if not i['signed_quote']:raise IntegrationRejected('ORIGINAL_QUOTE_PENDING',503)
            if int(i['signed_quote']['quote']['deadline'])<=int(value['now']):raise IntegrationRejected('QUOTE_EXPIRED',409)
            material={'kind':'fund','binding':binding,'expectedAccount':i['parameters']['payer'],'signedQuote':i['signed_quote']}
        else:material={'kind':'settle','binding':binding,'expectedAccount':binding['owner'],'operation':{k:i['parameters'][k] for k in ('opId','voucherId','generation')},'amount':i['parameters']['amount']}
        prepared=wallet_bridge({'op':'prepareWallet','material':material,'now':str(value['now'])})
        allowed=[]
        for tx in prepared['transactions']:
            kind=tx['functionName']
            if kind not in attempts and i['stage']!='FINAL_SUCCEEDED' and (kind!='fund' or attempts.get('approve',{}).get('confirmed') is True):allowed.append(kind)
        return {**prepared,'material':material,'now':str(value['now']),'walletActionsEnabled':self.gate.allowed(self.namespace,i['action'],intent_id),'allowedKinds':allowed,'attempts':{k:{'hash':v['hash'],'confirmed':v['confirmed']} for k,v in attempts.items()},'status':'PREPARATION_ONLY'}
    def wallet_attempt(self,q,intent_id,body):
        body=validate_body(body,{'kind'});data=self.wallet_preparation(q,intent_id);kind=body['kind']
        if not data['walletActionsEnabled'] or kind not in data['allowedKinds']:raise IntegrationRejected('ORIGINAL_WALLET_ATTEMPT_UNKNOWN',409)
        prepared=next(tx for tx in data['transactions'] if tx['functionName']==kind);descriptor=core(prepared);material=data['material'];record=None
        if kind=='fund':
            quote=material['signedQuote'];payload=self.codec.call('prepareFundingQuote',{'binding':material['binding'],'quote':quote['quote'],'now':'0'})['payloadHash']
            record=self.projection.observer_record('fund',{'quote':quote['quote'],'signature':quote['signature']},descriptor,payload)
        elif kind=='settle':
            # The wallet codec provides the actual canonical operation digest too.
            record=self.projection.observer_record('settle',material['operation'],descriptor,prepared['paramsDigest'])
        return self.call('wallet_attempt',{**q,'id':intent_id,'kind':kind,'deployment':descriptor,'observerRecord':record})
    def wallet_hash(self,q,intent_id,body):
        body=validate_body(body,{'kind','transactionHash'})
        if not re.fullmatch('0x[0-9a-f]{64}',body['transactionHash']):raise IntegrationRejected('INVALID_REQUEST',422)
        return self.call('wallet_hash',{**q,'id':intent_id,'kind':body['kind'],'hash':body['transactionHash']})
    def security(self,kind,q):return self.call({'lock':'lock_confirm'}.get(kind,kind),q)
    def _credentials(self,kind,q,voucher,body):
        validate_body(body,[] if kind=='recover' else ['access']);command={**q,'voucher':voucher};value=secret()
        if kind=='recover':
            session,csrf=secret(),secret();command.update(new_access_hash=digest(value),new_session_hash=digest(session),new_csrf_hash=digest(csrf))
        else:
            if not re.fullmatch('[A-Za-z0-9_-]{43}',body['access']):raise IntegrationRejected('INVALID_REQUEST',422)
            command.update(access_hash=digest(body['access']),new_display_hash=digest(value))
        result=self.security(kind,command)
        if not result.get('replay'):
            if kind=='recover':
                result.update(_sessionToken=session,csrf=csrf)
                if result.get('redeemable'):result['access']=value
            else:result['display']=value
        return result
    def handle(self,method,path,q,body,headers):
        from .live_catalog_images import handle as catalog_image_handle
        catalog_image=catalog_image_handle(self,method,path,q)
        if catalog_image is not None:return catalog_image
        from .live_drafts import handle as draft_handle
        draft=draft_handle(self,method,path,q,body,headers)
        if draft is not None:return draft
        reads={'/v1/stores':'public_stores','/v1/ledger':'public_ledger','/v1/my/orders':'my_orders','/v1/my/claims':'my_claims','/v1/my/vouchers':'my_vouchers'}
        if method=='GET' and path in reads:return self.call(reads[path],q)
        m=re.fullmatch('/v1/(orders|intents)/([0-9a-f-]{36})',path)
        if method=='GET' and m:return self.call('order_get' if m[1]=='orders' else 'intent_get',{**q,'id':m[2]})
        m=re.fullmatch('/v1/vouchers/(0x[0-9a-f]{64})(?:/(recover|display))?',path)
        if m:
            if method=='GET' and not m[2]:return self.call('voucher_get',{**q,'id':m[1]})
            if method=='POST' and m[2]:return self._credentials(m[2],q,m[1],body)
        if method=='POST' and path in {'/v1/support/reviews','/v1/claims/reviews'}:
            support=path.startswith('/v1/support/');data=validate_body(body,['store','meal','quantity'] if support else ['store','meal'])
            if support and (type(data['quantity']) is not int or not 1<=data['quantity']<=10):raise IntegrationRejected('INVALID_REQUEST',422)
            return self.call('support_review' if support else 'claim_review',{**q,**data})
        if method=='POST' and path in {'/v1/support/intents','/v1/claims/intents'}:return self.call('support_confirm' if path.startswith('/v1/support/') else 'claim_confirm',{**q,'client':validate_body(body,['reviewId'])})
        m=re.fullmatch('/v1/stores/([A-Za-z0-9_-]{1,64})(/.*)',path)
        if m:
            store,tail=m[1],m[2];request={**q,'store':store}
            if method=='GET':
                if tail in {'/meals','/workbench','/payouts'}:return self.call({'/meals':'public_meals','/workbench':'workbench','/payouts':'payouts'}[tail],request)
                if re.fullmatch('/meals/[A-Za-z0-9_-]{1,64}',tail):return self.call('public_meal',{**request,'meal':tail.rsplit('/',1)[1]})
                if re.fullmatch('/cases/0x[0-9a-f]{64}',tail):return self.call('case_get',{**request,'id':tail.rsplit('/',1)[1]})
            if method=='POST':
                if tail in {'/checks','/locks'}:
                    display=validate_body(body,['display'])['display']
                    if not re.fullmatch('[A-Za-z0-9_-]{43}',display):raise IntegrationRejected('INVALID_REQUEST',422)
                    return self.call('code_check' if tail=='/checks' else 'lock_confirm',{**request,'display_hash':digest(display)})
                if re.fullmatch('/cases/0x[0-9a-f]{64}/handover-intents',tail):validate_body(body,[]);return self.call('handover_confirm',{**request,'case_id':tail.split('/')[2]})
                if re.fullmatch('/payouts/0x[0-9a-f]{64}/settle-reviews',tail):validate_body(body,[]);return self.call('settle_review',{**request,'voucher':tail.split('/')[2]})
                if tail=='/settle-intents':return self.call('settle_confirm',{**request,'client':validate_body(body,['reviewId'])})
        raise IntegrationRejected('LIVE_OPERATION_NOT_IMPLEMENTED',503)
    def _check_approval(self,material):
        i,store,attempts=material['intent'],material['store'],material['attempts'];a=attempts.get('approve')
        if not a or not a['hash'] or a['confirmed'] or not i['signed_quote']:return None
        record={'attemptId':i['id']+':approve','quoteId':i['op_id'],'payer':i['parameters']['payer'],'amount':i['parameters']['amount'],'transactionHash':a['hash'],'deployment':a['deployment']}
        proof=self.approval_factory(store['profile']).verify_original_approval(record)
        if proof is None:return {'state':'ORIGINAL_APPROVAL_UNKNOWN'}
        return self._fixed(self.worker_ledger,'live_approval',{'id':i['id'],'record':record,'proof':proof,'attemptRevision':a['revision'],'intentRevision':i['revision']})
    def step(self):
        global _last_step_diagnostic
        started=time.monotonic();phase='material'
        try:
            registration=self.registration()
            phase='refresh'
            saved=registration.get('store')
            due=registration.get('registration') and (not saved or not saved.get('snapshot') or self.clock()-int(saved['snapshot']['timestamp'])>=self.config['maxSnapshotAgeSeconds']//2)
            # A refresh attempt gets a bounded cooldown and yields one turn to
            # original tasks, including when the upstream read failed.
            cooldown=self._last_refresh_finished is not None and time.monotonic()-self._last_refresh_finished<10
            yield_task=self._yield_refresh_to_task;self._yield_refresh_to_task=False
            if due and not cooldown and not yield_task:
                try:return self._seed_or_refresh(registration)
                finally:
                    self._last_refresh_finished=time.monotonic();self._yield_refresh_to_task=True
            if not saved or not saved.get('snapshot'):return {'state':'WAIT_VERIFIED_SNAPSHOT'}
            phase='tasks'
            tasks=self._fixed(self.worker_ledger,'live_material',{'op':'tasks'},read_only=True)['items']
            if not tasks:return {'state':'IDLE'}
            task=tasks[self._task_cursor%len(tasks)];self._task_cursor+=1;material=self.material(task['id']);i,store=material['intent'],material['store']
            approval=self._check_approval(material)
            if approval is not None:return approval
            if i['action'] in {'fund','issue','lock','markHandover','report','publish','setListed'} and not i['transaction_hash'] and not i['signed_quote']:
                role='quoteAuthority' if i['action']=='fund' else 'issuerAuthority' if i['action']=='issue' else 'catalogAuthority' if i['action'] in {'publish','setListed'} else 'operatorAuthority'
                if role not in self.clients:return {'state':'WAIT_CATALOG_CONFIGURATION'}
                value=self.clients[role].execute(self.namespace,i['id'],lookup=i['stage']!='ACCEPTED')
                material=self.material(i['id']);i=material['intent']
                if i['private_record'] is None:return {'state':'ORIGINAL_PRIVATE_UNKNOWN'}
                if i['action']=='fund':
                    if not value.get('signature'):return {'state':'ORIGINAL_QUOTE_UNKNOWN'}
                    signed=self.codec.call('attachFundingSignature',{'binding':store['profile']['binding'],'quote':i['private_record']['quote'],'signature':value['signature'],'now':'0'})
                    return self._fixed(self.worker_ledger,'live_result',{'id':i['id'],'privateRecord':i['private_record'],'signedQuote':signed})
                if not value.get('transactionHash'):return {'state':'ORIGINAL_PRIVATE_UNKNOWN'}
                r=i['private_record'];record=self.projection.observer_record(r['operation'],r['parameters'],core(r['deployment']),r['deployment']['paramsDigest'])
                self._fixed(self.worker_ledger,'live_result',{'id':i['id'],'privateRecord':r,'hash':value['transactionHash'],'observerRecord':record});material=self.material(i['id']);i=material['intent'];store=material['store']
            if not i['observer_record'] or not i['transaction_hash']:return {'state':'WAIT_ACTOR'}
            aliases=self._meal_aliases(material)
            proof=self.observer_factory(store['profile'],i['observer_record'],i['transaction_hash']).verify_original_operation(i['observer_record'],i['transaction_hash'],meal_ids=list(aliases))
            if proof is None:return {'state':'ORIGINAL_CHAIN_UNKNOWN','id':i['id']}
            if proof['original']!=i['observer_record'] or proof['transactionHash']!=i['transaction_hash']:raise IntegrationRejected('ORIGINAL_RECEIPT_CONFLICT',503)
            if proof.get('authority')=='VERIFIED_ORIGINAL_LOCK_REVERT':
                return self._fixed(self.worker_ledger,'live_projection',{'store':i['store'],'expectedRevision':store['revision'],'intentRevision':i['revision'],'id':i['id'],'lockRevert':proof})
            rows=self.projection.projection_rows(proof,i['id'],i['store'],aliases)
            return self._fixed(self.worker_ledger,'live_projection',{'store':i['store'],'profile':store['profile'],'expectedRevision':store['revision'],'intentRevision':i['revision'],'snapshot':proof['snapshot'],'rows':rows,'reportIntentId':str(uuid.uuid4()),'reportOpId':word(),'listingIntentId':str(uuid.uuid4()),'listingOpId':word()})
        except Exception as error:
            now=time.monotonic()
            if _last_step_diagnostic is None or now-_last_step_diagnostic>=60:
                _last_step_diagnostic=now
                code=getattr(error,'code',None)
                if code not in {'BUSINESS_OBSERVATION_BUDGET_REJECTED','PROJECTION_CAS_CONFLICT','DB_UNAVAILABLE','UNAVAILABLE'}:code='LIVE_STEP_FAILED'
                print('C1_DIAGNOSTIC '+json.dumps({'component':'live_gateway','code':code,'phase':phase,
                    'elapsedMs':max(0,round((now-started)*1000))}),file=sys.stderr,flush=True)
            return {'state':'UNKNOWN','reason':'ORIGINAL_LIVE_OBSERVATION_UNAVAILABLE'}

def compose_live(config,namespace,gate):
    source=config.get('connection',{}).get('business')
    if not source or source.get('enabled') is not True:return None
    if config.get('scope_file'):raise IntegrationRejected('FIXED_LIVE_NAMESPACE_REQUIRED',503)
    from .db import Database
    from .runtime_ledger_controller import RuntimeLedgerControllerClient
    databases=[]
    try:
        module_=persistence_module();cap=source['controller'];controller=RuntimeLedgerControllerClient(Client(cap['path'],cap['cap'],timeout=5))
        ledgers=[]
        for key in ('apiRole','observerRole'):
            database=Database(config,source[key],'runtime_internal',max_size=1);databases.append(database);ledgers.append(module_.PgRuntimeLedger(database,namespace(),controller))
        # Issuer/operator lookup already has a bounded 20s RPC budget. Let its
        # original result return instead of abandoning it after 5s.
        clients={role:PrivateBusinessClient(Client(value['path'],value['cap'],timeout=5 if role=='quoteAuthority' else 25),role) for role,value in source['authorities'].items()}
        gateway=LiveGateway(api_ledger=ledgers[0],worker_ledger=ledgers[1],config=source,clients=clients,activation_gate=gate)
        gateway.draft_run=config['run']
        return gateway
    except BaseException:
        for database in databases:database.close()
        raise
