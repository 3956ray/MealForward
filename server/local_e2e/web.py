"""Small CP24 composition of the existing authenticated local domain services."""
import json
import secrets
import threading
import requests
from flask import Flask, jsonify, request
from server.auth import AuthService
from server.backend import canonical, digest, random_id
from server.contracts import ApiError
from server.chain.client import RULE, PRICE
from server.projection import Projector
from server.local_e2e.credentials import Credentials, LocalRedemption


def create_app(b, config):
    app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=16384;app.logger.disabled=True
    origin=config['origin'];gate=threading.RLock();creds=Credentials(b);red=LocalRedemption(b)
    auth={role:AuthService(b.store,origin=origin,clock=b.clock,secure_cookie=False,
                          cookie_name='cp24_'+role,cookie_path='/api/cp24') for role in ('partner','owner')}
    def body():
        value=request.get_json(silent=True)
        if not isinstance(value,dict): raise ApiError(422,'INVALID_INPUT','需要有效请求')
        return value
    def actor(role,write=True): return auth[role].require(role,csrf=write)
    def sync(): Projector(b).sync()
    def anchor_ok():
        with b.store.connect() as db: return b.store.valid_anchor(db)
    def terminal(db,a,*,required=True):
        b.work.require_actor(db,a,'owner')
        row=db.execute('SELECT * FROM cp24_terminal').fetchone()
        token=request.headers.get('X-Terminal-Cap','')
        valid=bool(row and row['hash']==digest(token) and row['session_id']==a.session_id and row['expires']>b.now())
        if required and not valid: raise ApiError(409,'TERMINAL_CHANGED','处理已由另一终端接管或凭证失效；请查看原状态并显式接管')
        return dict(row) if row else None,valid
    def owned(db,a):
        b.work.require_actor(db,a,'owner')
        row=db.execute('SELECT * FROM redemptions WHERE actor_id=? AND shop_id=?',(a.actor_id,a.shop_id)).fetchone()
        if not row: raise ApiError(404,'NOT_FOUND','尚无原处理记录')
        return dict(row)
    def bind(db,a,rid,version):
        token=secrets.token_urlsafe(32)
        old=db.execute('SELECT * FROM cp24_terminal WHERE redemption_id=?',(rid,)).fetchone()
        db.execute('INSERT OR REPLACE INTO cp24_terminal VALUES(?,?,?,?,?)',(rid,a.session_id,digest(token),version,b.now()+1800))
        db.execute('INSERT INTO cp24_audit(redemption_id,actor,old_hash,new_hash,event,created) VALUES(?,?,?,?,?,?)',
                   (rid,a.actor_id,old['hash'] if old else None,digest(token),'TAKEOVER' if old else 'LOCK',b.now()))
        return {'terminalCap':token,'version':version}
    def ticket(db,kind,operation,payload,a=None,version=None):
        token=b.work.code_hash('cp24-ticket:'+kind+operation+(a.session_id if a else 'support'))
        old=db.execute('SELECT * FROM cp24_tickets WHERE kind=? AND operation_id=?',(kind,operation)).fetchone()
        if old and old['state']!='PREPARED':
            return {'ticket':None,'status':old['state'],'review':payload}
        if old:
            db.execute('UPDATE cp24_tickets SET hash=?,session_id=?,expires=?,terminal_version=? WHERE hash=?',(digest(token),a.session_id if a else None,b.now()+300,version,old['hash']))
        else:
            db.execute('INSERT INTO cp24_tickets(hash,kind,operation_id,session_id,terminal_version,payload,expires) VALUES(?,?,?,?,?,?,?)',
                       (digest(token),kind,operation,a.session_id if a else None,version,canonical(payload),b.now()+300))
        return {'ticket':token,'review':payload}
    def txreview(kind,intent):
        estimate=None
        try:
            gas=b.rpc.w3.eth.estimate_gas({'from':intent.get('from',intent.get('account')),'to':intent['to'],'data':intent['data'],'value':int(intent.get('value',intent.get('valueWei',0)))})
            estimate=str(((gas*110+99)//100)*b.rpc.w3.eth.gas_price)
        except Exception: pass  # Original submitted intents remain queryable when estimation no longer applies.
        return {'kind':kind,'chainId':31337,'to':intent.get('to'),'from':intent.get('from',intent.get('account')),
                'data':intent['data'],'value':str(intent.get('value',intent.get('valueWei',0))),
                'amountWei':str(PRICE),'gasSeparate':True,'estimatedGasFeeWei':estimate}
    @app.before_request
    def guard():
        if request.method=='POST':
            if request.headers.get('Origin')!=origin: raise ApiError(403,'ORIGIN_DENIED','仅接受本机演练页面请求')
            body()
    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store';response.headers['Referrer-Policy']='no-referrer'
        response.headers['X-Content-Type-Options']='nosniff';return response
    @app.errorhandler(ApiError)
    def error(e): return jsonify(code=e.code,message=e.message),e.status
    @app.errorhandler(Exception)
    def unknown(e):
        from server.chain.client import ChainConflict
        if isinstance(e,ChainConflict): b.halt('CP24_CHAIN_CONFLICT')
        return jsonify(code='STATE_UNAVAILABLE',message='状态暂不可用，请查询原操作；请勿再次提交'),503
    @app.get('/api/cp24/public')
    def public():
        checkpoint=b.store.one('SELECT * FROM checkpoints ORDER BY block_number DESC LIMIT 1');observed=b.store.one("SELECT value FROM metadata WHERE key='observed_at'")
        batch=b.store.one('SELECT * FROM batches LIMIT 1');support=b.store.one("SELECT status FROM operations WHERE kind='support'")
        return jsonify(instanceId=b.deployment['deploymentId'],chainId=31337,priceWei=str(PRICE),contract=b.deployment['contractAddress'],
                       merchant=b.deployment['merchant'],supporter=b.deployment['supporter'],source={'kind':'Anvil finalized projector','blockNumber':checkpoint['block_number'] if checkpoint else None,'observedAt':int(observed['value']) if observed else None},
                       batch={k:str(batch[k]) for k in ('id','F','A','R','H','S')} if batch else None,
                       recovery=({**b.recovery_view(),'state':'RESTORE_QUARANTINE','writeAvailable':False} if not anchor_ok() else b.recovery_view()),supportStatus=support['status'] if support else None)
    @app.post('/api/cp24/<role>/login')
    def login(role):
        if role not in auth: raise ApiError(404,'NOT_FOUND','入口不存在')
        username=body().get('username')
        if username!=('partner-a' if role=='partner' else 'owner-a'): raise ApiError(403,'FORBIDDEN','请使用该角色的专用虚构账号')
        return auth[role].login()
    @app.get('/api/cp24/<role>/session')
    def session(role):
        if role=='recipient':
            token=request.cookies.get('cp24_recipient','')
            with b.store.transaction() as db: return jsonify(creds.payload(db,creds.session(db,token),token))
        if role not in auth: raise ApiError(404,'NOT_FOUND','入口不存在')
        actor(role,False);return auth[role].session()
    @app.post('/api/cp24/<role>/logout')
    def logout(role):
        if role=='recipient':
            with b.store.transaction() as db:
                row=creds.session(db,request.cookies.get('cp24_recipient',''),request.headers.get('X-CSRF-Token',''))
                db.execute('UPDATE cp24_session SET revoked=1 WHERE hash=?',(row['hash'],))
                db.execute('DELETE FROM cp24_display WHERE session_hash=?',(row['hash'],))
            response=jsonify(ok=True);response.delete_cookie('cp24_recipient',path='/api/cp24/recipient');return response
        if role not in auth: raise ApiError(404,'NOT_FOUND','入口不存在')
        with gate,b.store.transaction():
            a=actor(role)
            if role=='owner': b.owner_wallet.logout(a,{})
            response=auth[role].logout()
        return response
    @app.get('/api/cp24/support/state')
    def support_state():
        # One virtual public supporter per isolated instance; no private recipient data.
        row=b.store.one("SELECT * FROM operations WHERE kind='support'")
        return jsonify(operation=b.operation_view(row) if row else None)
    @app.post('/api/cp24/support/prepare')
    def support_prepare():
        if body(): raise ApiError(422,'INVALID_INPUT','固定一份支持')
        with gate,b.store.transaction() as db:
            b.work.writable(db)
            instance=db.execute('SELECT * FROM cp24_instance').fetchone()
            token=instance['support_token']
            if not token:
                token,_=b.support_session(None)
                db.execute('UPDATE cp24_instance SET support_token=?',(b.encrypt(token),))
            else: token=b.decrypt(token)
            dto=b.create_support(token,{'clientRequestId':instance['support_key'],'account':b.deployment['supporter'],'chainId':31337,
                                       'quantity':1,'ruleVersion':RULE,'walletKind':'local-test'})
            return jsonify(**dto,**ticket(db,'support',dto['operation']['id'],txreview('support',dto['intent'])))
    @app.get('/api/cp24/partner/state')
    def partner_state():
        a=actor('partner',False)
        op=b.store.one("SELECT * FROM operations WHERE kind='issue' AND partner_id=?",(a.partner_id,))
        v=b.store.one('SELECT v.id,p.status FROM private_vouchers v JOIN public_vouchers p ON p.id=v.id WHERE v.confirmed=1')
        inv=b.store.one('SELECT opened,expires FROM cp24_invite');batch=b.store.one('SELECT id FROM batches')
        return jsonify(issuance=b.operation_view(op) if op else None,voucher={'id':v['id'],'state':{1:'ISSUED',2:'LOCKED',3:'REPORTED',4:'SETTLED'}.get(v['status'],'UNKNOWN')} if v else None,
                       invite={'opened':bool(inv['opened']),'expiresAt':inv['expires']} if inv else None,batchId=batch['id'] if batch else None)
    @app.post('/api/cp24/partner/issue')
    def issue():
        a=actor('partner');sync()
        with gate,b.store.transaction() as db:
            i=db.execute('SELECT * FROM cp24_instance').fetchone();batch=db.execute('SELECT id FROM batches').fetchone()
            if not batch: raise ApiError(409,'FUNDS_REQUIRED','请等待支持入款确认')
            return jsonify(b.issue(a,{'intentKey':i['issue_key'],'recipientRef':i['ref'],'batchId':batch['id'],'quantity':1,
                                     'quotePriceWei':str(PRICE),'ruleVersion':RULE}))
    @app.post('/api/cp24/partner/invite')
    def invite():
        a=actor('partner');payload=body()
        if set(payload)!={'rotate'} or type(payload['rotate']) is not bool: raise ApiError(422,'INVALID_INPUT','需要明确链接动作')
        with gate: value=creds.invite(a,payload['rotate'])
        return jsonify(url=origin+'/#/recipient/'+value['secret'],expiresAt=value['expiresAt'])
    @app.post('/api/cp24/recipient/exchange')
    def exchange():
        with gate: token,dto=creds.exchange(body().get('secret'))
        response=jsonify(dto);response.set_cookie('cp24_recipient',token,httponly=True,samesite='Lax',path='/api/cp24/recipient',max_age=8*3600)
        return response
    @app.post('/api/cp24/recipient/display')
    def display():
        with gate: return jsonify(creds.display(request.cookies.get('cp24_recipient',''),request.headers.get('X-CSRF-Token','')))
    @app.get('/api/cp24/owner/state')
    def owner_state():
        a=actor('owner',False)
        with b.store.transaction() as db:
            r=db.execute('SELECT * FROM redemptions WHERE actor_id=? AND shop_id=?',(a.actor_id,a.shop_id)).fetchone()
            t,valid=terminal(db,a,required=False)
            wallet=b.owner_wallet.session(a)
            value=None
            if r:
                value={'id':r['id'],'state':r['state'],'voucherId':r['voucher_id'],'version':t['version'] if t else 0,
                       'handoff':next(({'actor':h['actor_id'],'created':h['created_at']} for h in db.execute('SELECT actor_id,created_at FROM handoff_statements WHERE redemption_id=?',(r['id'],))),None),
                       'notes':[dict(n) for n in db.execute('SELECT text,actor,created FROM cp24_notes WHERE redemption_id=?',(r['id'],))],
                       'operations':[b.operation_view(dict(o)) for o in db.execute('SELECT * FROM operations WHERE redemption_id=?',(r['id'],))]}
            return jsonify(wallet=wallet,redemption=value,canAct=valid and wallet['verified'])
    @app.post('/api/cp24/owner/proof')
    def proof():
        a=actor('owner')
        with gate,b.store.transaction() as db:
            challenge=b.owner_wallet.challenge(a,{},origin)
            payload={'kind':'proof','chainId':31337,'from':challenge['address'],'to':b.deployment['contractAddress'],
                     'value':'0','amountWei':'0','gasSeparate':False,**challenge}
            return jsonify(ticket(db,'proof',challenge['challengeId'],payload,a))
    def code_action(lock):
        a=actor('owner');payload=body();now=b.now();ip=request.remote_addr or ''
        keys=[('cp24:code:session:'+a.session_id,10),('cp24:code:ip:'+digest(ip),30)]
        with gate:
            # Original intent recovery bypasses guessing throttles, but never grants lost terminal capability.
            if lock:
                original=b.store.one("SELECT * FROM operations WHERE kind='lock' AND actor_id=? AND intent_key=?",(a.actor_id,payload.get('intentKey')))
                if original:
                    if original['request_json']!=canonical(red._code_request(payload)): raise ApiError(409,'INTENT_CONFLICT','原锁请求内容已变化，请查询原处理')
                    return jsonify(red.operation(a,op_id=original['id']))
                if b.store.one('SELECT 1 FROM redemptions'): raise ApiError(409,'ORIGINAL_REQUIRED','已有原处理记录，请查询原操作')
            if any(b.store.auth_failure_count(k,now,60)>=limit for k,limit in keys):
                raise ApiError(429,'CODE_RATE_LIMITED','检查次数过多，请在60秒内稍后再试；仍可查询原操作')
            try:
                with b.store.transaction() as db:
                    if lock:
                        dto=red.lock(a,payload,ip)
                        return jsonify(**dto,**bind(db,a,dto['redemptionId'],1))
                    return jsonify(**red.precheck(a,payload,ip),valid=True,message='餐券当前有效，尚未取得处理权')
            except ApiError as e:
                if e.code=='CODE_UNAVAILABLE':
                    for k,_ in keys: b.store.record_auth_failure(k,now)
                raise
    @app.post('/api/cp24/owner/precheck')
    def precheck(): return code_action(False)
    @app.post('/api/cp24/owner/lock')
    def lock(): return code_action(True)
    @app.post('/api/cp24/owner/takeover')
    def takeover():
        a=actor('owner');p=body()
        if p.get('confirmed') is not True: raise ApiError(422,'CONFIRM_REQUIRED','请确认原终端已停止处理')
        with gate,b.store.transaction() as db:
            b.work.require_owner(db,a);b.work.writable(db,allow_paused=True);r=owned(db,a)
            old,_=terminal(db,a,required=False)
            if not old or type(p.get('expectedVersion')) is not int or p['expectedVersion']!=old['version']:
                raise ApiError(409,'VERSION_CHANGED','原处理版本已变化，请先刷新原状态')
            return jsonify(bind(db,a,r['id'],old['version']+1))
    @app.post('/api/cp24/owner/handoff', defaults={'action':'handoff'})
    @app.post('/api/cp24/owner/report', defaults={'action':'report'})
    @app.post('/api/cp24/owner/note', defaults={'action':'note'})
    @app.post('/api/cp24/owner/settle', defaults={'action':'settle'})
    def owner_action(action):
        if action not in ('handoff','report','note','settle'): raise ApiError(404,'NOT_FOUND','动作不存在')
        a=actor('owner');p=body();sync()
        with gate,b.store.transaction() as db:
            b.work.require_owner(db,a);b.work.writable(db,allow_paused=True);t,_=terminal(db,a);r=owned(db,a)
            if action=='note':
                text=p.get('text','')
                if not isinstance(text,str) or not 1<=len(text.strip())<=500: raise ApiError(422,'INVALID_INPUT','备注需要1至500字')
                if not db.execute('SELECT 1 FROM handoff_statements WHERE redemption_id=?',(r['id'],)).fetchone(): raise ApiError(409,'HANDOFF_REQUIRED','尚无交餐声明')
                db.execute('INSERT INTO cp24_notes(redemption_id,actor,text,created) VALUES(?,?,?,?)',(r['id'],a.actor_id,text.strip(),b.now()))
                return jsonify(status='待核对')
            if action=='handoff': return jsonify(red.handoff(a,r['id'],p))
            if action=='report':
                if p.get('confirmStatement') is not True: raise ApiError(422,'CONFIRM_REQUIRED','请重新确认原交餐声明内容')
                original=db.execute("SELECT id FROM operations WHERE redemption_id=? AND kind='report'",(r['id'],)).fetchone()
                if original: return jsonify(red.operation(a,op_id=original['id']))
                return jsonify(red.report(a,r['id'],{'intentKey':p.get('intentKey')}))
            dto=b.owner_wallet.prepare(a,r['id'],{'intentKey':'0x'+digest('cp24-settle:'+r['id'])})
            return jsonify(**dto,**ticket(db,'settle',dto['operation']['id'],txreview('settle',dto['intent']),a,t['version']))
    @app.post('/api/cp24/wallet/confirm')
    def wallet_confirm():
        token=body().get('ticket','')
        if not isinstance(token,str): raise ApiError(422,'INVALID_INPUT','钱包审核凭证不可用')
        a=None
        with gate,b.store.transaction() as db:
            row=db.execute('SELECT * FROM cp24_tickets WHERE hash=?',(digest(token),)).fetchone()
            if not row: raise ApiError(404,'NOT_FOUND','钱包审核凭证不可用')
            if row['kind']!='support':
                a=actor('owner')
                if row['session_id']!=a.session_id: raise ApiError(403,'FORBIDDEN','原钱包会话不可用')
                if row['kind']=='settle':
                    t,_=terminal(db,a)
                    if t['version']!=row['terminal_version']: raise ApiError(409,'TERMINAL_CHANGED','请查询原处理，旧审核已失效')
            b.work.writable(db,allow_paused=True)
            if row['state']!='PREPARED':
                return jsonify(status=row['state'],**(json.loads(row['result']) if row['result'] else {}))
            if row['expires']<=b.now(): raise ApiError(409,'REVIEW_EXPIRED','审核已过期，请查询原操作')
            if row['kind']=='settle':
                started=b.owner_wallet.start(a,row['operation_id'],{})
                if not started['maySubmit']: return jsonify(status='QUERY_ONLY')
            if row['kind']=='support':
                db.execute("UPDATE operations SET status='SUBMISSION_UNKNOWN' WHERE id=? AND status='PREPARED'",(row['operation_id'],))
            db.execute("UPDATE cp24_tickets SET state='AUTHORIZED' WHERE hash=?",(row['hash'],))
        # Permission acceptance is durable before the bridge; no network retry or new ticket on response loss.
        session=requests.Session();session.trust_env=False
        try:
            response=session.post(config['bridgeOrigin']+'/confirm',json={'ticket':token},headers={'X-CP24-Bridge':config['bridgeToken']},timeout=15,allow_redirects=False)
            result=response.json()
            if response.status_code!=200: return jsonify(status='UNKNOWN')
        except (requests.RequestException,ValueError): return jsonify(status='UNKNOWN')
        if row['kind']=='proof' and result.get('signature'):
            # Never return proof signatures to the UI or its storage.
            dto=b.owner_wallet.verify(a,{'challengeId':row['operation_id'],'signature':result['signature']},origin)
            return jsonify(status='VERIFIED',**dto)
        return jsonify(status=result.get('status','UNKNOWN'),txHash=result.get('txHash'))
    return app
