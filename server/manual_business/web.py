"""Same-origin business HTTP, without a wallet bridge or arbitrary RPC endpoint."""
import json
import secrets
import threading
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from server.backend import canonical, digest, random_id
from server.contracts import ApiError
from server.local_e2e.credentials import Credentials, LocalRedemption
from .service import BusinessService
from .observer import Observer
from .identity import PRICE, CHAIN_ID


def create_app(config, backend=None, *, authentication=None, dispatch=None, identity_preparation=None):
    app = Flask(__name__); app.config['MAX_CONTENT_LENGTH'] = 16384; app.logger.disabled = True
    b = backend; gate = threading.RLock(); origin = config['origin']
    service = BusinessService(b) if b else None
    creds = Credentials(b) if b else None
    red = LocalRedemption(b) if b else None
    if identity_preparation is not None:
        if b is not None: raise ValueError('Identity preparation cannot enable business runtime')
        if identity_preparation.origin != origin: raise ValueError('Identity preparation origin mismatch')
        identity_preparation.register(app)

    def body():
        value = request.get_json(silent=True)
        if not isinstance(value, dict): raise ApiError(422, 'INVALID_INPUT', '需要有效请求')
        return value

    def ready(write=True):
        if not b: raise ApiError(503, 'BUSINESS_NOT_CONFIGURED', '新业务身份、部署和运行预算尚未配置')
        if write:
            with b.store.transaction() as db: b.runtime.require(db)

    def actor(role, write=True, runtime=True):
        ready(runtime)
        if authentication is None: raise ApiError(503, 'IDENTITY_NOT_CONFIGURED', '等待选择并配置可信登录方式')
        a = authentication.require(role, csrf=write)
        with b.store.transaction() as db: b.work.require_actor(db, a, role)
        return a

    def terminal(db, a, required=True):
        row = db.execute('SELECT * FROM cp24_terminal').fetchone()
        valid = bool(row and row['session_id'] == a.session_id and row['expires'] > b.now() and
                     secrets.compare_digest(row['hash'], digest(request.headers.get('X-Terminal-Cap', ''))))
        if required and not valid: raise ApiError(409, 'TERMINAL_CHANGED', '请查询原处理并显式接管终端')
        return row, valid

    def bind(db, a, rid, version):
        token = secrets.token_urlsafe(32)
        old = db.execute('SELECT * FROM cp24_terminal WHERE redemption_id=?', (rid,)).fetchone()
        db.execute('INSERT OR REPLACE INTO cp24_terminal VALUES(?,?,?,?,?)', (rid, a.session_id, digest(token), version, b.now()+1800))
        db.execute('INSERT INTO cp24_audit(redemption_id,actor,old_hash,new_hash,event,created) VALUES(?,?,?,?,?,?)',
                   (rid, a.actor_id, old['hash'] if old else None, digest(token), 'TAKEOVER' if old else 'LOCK', b.now()))
        return {'terminalCap': token, 'version': version}

    def original(op_id):
        ready(False)
        op = b.store.one('SELECT * FROM operations WHERE id=?', (op_id,))
        if not op: raise ApiError(404, 'NOT_FOUND', '原操作不可用')
        a = None
        if op['kind'] == 'support':
            cap = b.cap(request.cookies.get('cp28_support'))
            if cap['operation_id'] != op_id: raise ApiError(403, 'FORBIDDEN', '需要原支持会话')
        else:
            a = actor('partner' if op['kind'] == 'issue' else 'owner', request.method == 'POST', runtime=False)
            if op['actor_id'] != a.actor_id: raise ApiError(403, 'FORBIDDEN', '需要原操作身份')
        return op, a

    @app.before_request
    def guard():
        if request.host_url.rstrip('/') != origin: raise ApiError(403, 'HOST_DENIED', '仅接受指定本机入口')
        if request.method == 'POST':
            if request.headers.get('Origin') != origin: raise ApiError(403, 'ORIGIN_DENIED', '页面来源不符')
            body()

    @app.after_request
    def headers(response):
        response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                                 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY'})
        return response

    @app.errorhandler(ApiError)
    def error(e): return jsonify(code=e.code, message=e.message), e.status

    @app.errorhandler(Exception)
    def unavailable(e): return jsonify(code='STATE_UNAVAILABLE', message='状态暂不可用，请查询原操作；不要重新签名'), 503

    @app.get('/api/cp28/status')
    def status():
        missing = []
        identity_info = {}
        identity_ready = authentication is not None
        if authentication is not None and hasattr(authentication, 'public_identity'):
            try: identity_info = authentication.public_identity()
            except Exception:
                identity_ready = False
                missing.append('工作身份配置已失效，请核对本轮授权')
        if authentication is None: missing.append('Dynamic已选；业务机构/老板可信身份映射待配置' if identity_preparation else '可信登录方式及机构/老板身份映射待配置')
        if not b: missing.extend(['管理员与老板共用钱包；公开候选地址待本人确认' if identity_preparation else '管理员与老板钱包分工待确认', '新部署及链上角色尚未核验', '后台签名服务待配置', '具体交易笔数、本金与 Gas 预算尚未批准'])
        else:
            if dispatch is None: missing.append('后台签名服务待配置')
            try:
                with b.store.transaction() as db:
                    b._writable_in_transaction(db); b._healthy_in_transaction(db)
            except Exception: missing.append('运行授权缺失、过期或恢复记录需要核对')
        return jsonify(status='BLOCKED' if missing else 'READY', missing=missing, runId=config['runId'],
                       sourceSha=config.get('sourceSha', 'uncommitted-build'), chainId=b.policy.chain_id if b else CHAIN_ID,
                       walletTesting='NOT_RUN', runtimeAuthorized=not missing,
                       identityConfigured=identity_ready, **identity_info,
                       message='完整手动业务测试尚未就绪' if missing else '按批准计划逐步确认，每次只执行原操作')

    @app.get('/api/cp28/public')
    def public():
        if not b: return jsonify(batch=None, operations=[], priceWei=str(PRICE), ruleVersion=None,
                                contract=None, observation=None, sync={'state': 'NOT_CONFIGURED', 'pendingCount': 0})
        with b.store.transaction() as db:
            batch = db.execute('SELECT * FROM batches LIMIT 1').fetchone()
            values = {k: str(batch[k]) for k in ('id', 'F', 'A', 'R', 'H', 'S', 'X')} if batch else None
            saved = db.execute("SELECT value FROM metadata WHERE key='cp28_public_snapshot'").fetchone()
            snapshot = json.loads(saved['value']) if saved else None
            valid = bool(snapshot and snapshot.get('batch') == values and
                         snapshot.get('deploymentId') == b.deployment['deploymentId'] and
                         snapshot.get('chainId') == b.policy.chain_id and snapshot.get('contract', '').lower() == b.deployment['contractAddress'].lower())
            pending = db.execute("SELECT count(*) FROM cp28_signing WHERE kind!='proof' AND state NOT IN ('FINALIZED_SUCCESS','FINALIZED_REVERT')").fetchone()[0]
            state = 'WAITING_VERIFICATION' if pending else 'SNAPSHOT_ONLY' if valid else 'MISSING_OBSERVATION'
            halted = db.execute('SELECT halted FROM cp28_identity WHERE id=1').fetchone()['halted']
            if halted: state = 'HALTED'
            return jsonify(batch=values if valid else None,
                           priceWei=str(PRICE), ruleVersion=b.policy.rule, contract=b.deployment['contractAddress'],
                           observation={k: v for k, v in snapshot.items() if k != 'batch'} if valid else None,
                           sync={'state': state, 'pendingCount': pending, 'amountsVerified': valid,
                                 'snapshotAgeSeconds': max(0, b.now()-snapshot['observedAt']) if valid else None},
                           operations=[{'action': r['kind'], 'status': r['status']} for r in db.execute('SELECT kind,status FROM operations ORDER BY created_at')])

    @app.post('/api/cp28/<role>/login')
    def login(role):
        ready(False)
        if role not in ('partner', 'owner') or authentication is None:
            raise ApiError(503, 'IDENTITY_NOT_CONFIGURED', '可信登录尚未配置')
        # Adapter validates credentials/token itself; role or wallet strings never mint identity.
        return authentication.login(role)

    @app.get('/api/cp28/<role>/session')
    def session(role):
        if role == 'recipient':
            ready(); token = request.cookies.get('cp28_recipient', '')
            with b.store.transaction() as db: return jsonify(creds.payload(db, creds.session(db, token), token))
        a = actor(role, False, runtime=False)
        return authentication.session(role)

    @app.post('/api/cp28/<role>/logout')
    def logout(role):
        ready(False)
        if role == 'recipient':
            ready()
            with gate, b.store.transaction() as db:
                row = creds.session(db, request.cookies.get('cp28_recipient', ''), request.headers.get('X-CSRF-Token', ''))
                db.execute('UPDATE cp24_session SET revoked=1 WHERE hash=?', (row['hash'],))
                db.execute('DELETE FROM cp24_display WHERE session_hash=?', (row['hash'],))
            return jsonify(loggedOut=True)
        if authentication is None: raise ApiError(503, 'IDENTITY_NOT_CONFIGURED', '可信登录尚未配置')
        return authentication.logout(role)

    @app.post('/api/cp28/support/prepare')
    def support():
        ready(); p = body()
        with gate, b.store.transaction():
            token, cap = b.support_session(request.cookies.get('cp28_support'))
            dto = b.create_support(token, p)
        response = jsonify(dto)
        response.set_cookie('cp28_support', token, httponly=True, samesite='Strict', path='/api/cp28', max_age=3600)
        return response

    @app.get('/api/cp28/support/state')
    def support_state():
        ready(False)
        cap = b.cap(request.cookies.get('cp28_support'))
        if not cap['operation_id']: return jsonify(operation=None)
        return jsonify(b.get_support(request.cookies.get('cp28_support'), cap['operation_id']))

    @app.get('/api/cp28/partner/state')
    def partner():
        a = actor('partner', False, runtime=False)
        with b.store.transaction() as db:
            ops = [b.operation_view(dict(r)) for r in db.execute("SELECT * FROM operations WHERE actor_id=? AND kind='issue'", (a.actor_id,))]
            refs = [dict(r) for r in db.execute('SELECT recipient_ref,eligible,channel_verified,quota,used,reserved FROM qualifications WHERE partner_id=?', (a.partner_id,))]
            vouchers = [dict(r) for r in db.execute('SELECT v.id FROM private_vouchers v JOIN operations o ON o.id=v.operation_id WHERE o.actor_id=? AND v.confirmed=1', (a.actor_id,))]
            return jsonify(operations=ops, qualifications=refs, vouchers=vouchers)

    @app.post('/api/cp28/partner/issue')
    def issue(): return jsonify(b.issue(actor('partner'), body()))

    @app.post('/api/cp28/partner/invite')
    def invite():
        a = actor('partner'); p = body()
        if set(p) != {'rotate'} or type(p['rotate']) is not bool: raise ApiError(422, 'INVALID_INPUT', '需要明确链接动作')
        with gate: value = creds.invite(a, p['rotate'])
        return jsonify(url=origin+'/#/recipient/'+value['secret'], expiresAt=value['expiresAt'])

    @app.post('/api/cp28/recipient/exchange')
    def exchange():
        ready()
        with gate: token, dto = creds.exchange(body().get('secret'))
        response = jsonify(dto)
        response.set_cookie('cp28_recipient', token, httponly=True, samesite='Strict', path='/api/cp28/recipient', max_age=8*3600)
        return response

    @app.post('/api/cp28/recipient/display')
    def display():
        ready()
        with gate: return jsonify(creds.display(request.cookies.get('cp28_recipient', ''), request.headers.get('X-CSRF-Token', '')))

    @app.get('/api/cp28/owner/state')
    def owner_state():
        a = actor('owner', False, runtime=False)
        with b.store.transaction() as db:
            rows = [dict(r) for r in db.execute('SELECT id,state FROM redemptions WHERE actor_id=? AND shop_id=?', (a.actor_id, a.shop_id))]
            t, valid = terminal(db, a, False)
            return jsonify(wallet=b.owner_wallet.session(a), redemptions=rows, terminalVersion=t['version'] if t else 0, canAct=valid)

    @app.post('/api/cp28/owner/proof/prepare')
    def proof_prepare(): return jsonify(b.owner_wallet.challenge(actor('owner'), {}, origin))

    @app.post('/api/cp28/owner/proof/start')
    def proof_start():
        a = actor('owner'); challenge_id = body().get('challengeId')
        with b.store.transaction() as db:
            b.owner_wallet.binding(db, a)
            row = db.execute('SELECT * FROM owner_wallet_challenges WHERE id=?', (challenge_id,)).fetchone()
            if not row or row['session_id'] != a.session_id or row['consumed'] or row['expires_at'] <= b.now():
                raise ApiError(403, 'PROOF_UNAVAILABLE', '原钱包证明不可用')
            from .runtime import plan_digest
            if json.loads(row['message'].split('\n', 1)[1])['authorizationDigest'] != plan_digest(b.runtime.plan):
                raise ApiError(403, 'PROOF_UNAVAILABLE', '运行授权已变化，请保留原证明记录')
            tx = {'from': b.deployment['merchant'], 'message': row['message']}
            may_sign = b.runtime.start(db, challenge_id, 'proof', tx, {'sessionId': a.session_id})
            return jsonify(maySign=may_sign, transaction=tx, chainId=b.policy.chain_id, operationId=challenge_id)

    @app.post('/api/cp28/owner/proof/verify')
    def proof_verify(): return jsonify(b.owner_wallet.verify(actor('owner'), body(), origin))

    @app.post('/api/cp28/owner/proof/invalidate')
    def proof_invalidate(): return jsonify(b.owner_wallet.logout(actor('owner'), {}))

    @app.post('/api/cp28/owner/precheck', defaults={'locking': False})
    @app.post('/api/cp28/owner/lock', defaults={'locking': True})
    def code(locking):
        a = actor('owner'); p = body(); throttle = 'cp28-code:'+a.session_id
        with gate:
            if b.store.auth_failure_count(throttle, b.now(), 60) >= 10: raise ApiError(429, 'RATE_LIMITED', '请稍后核对展示码')
            try:
                with b.store.transaction() as db:
                    if not locking: return jsonify(red.precheck(a, p, request.remote_addr))
                    original_op = db.execute("SELECT * FROM operations WHERE actor_id=? AND kind='lock'", (a.actor_id,)).fetchone()
                    if original_op:
                        if original_op['request_json'] != canonical(red._code_request(p)): raise ApiError(409, 'ORIGINAL_REQUIRED', '请查询原锁定操作')
                        return jsonify(red.operation(a, op_id=original_op['id']))
                    dto = red.lock(a, p, request.remote_addr)
                    b.bind_review(db, a, dto['operation']['id'])
                    return jsonify(**dto, **bind(db, a, dto['redemptionId'], 1))
            except ApiError as exc:
                if exc.code == 'CODE_UNAVAILABLE': b.store.record_auth_failure(throttle, b.now())
                raise

    @app.post('/api/cp28/owner/takeover')
    def takeover():
        a = actor('owner'); p = body()
        with gate, b.store.transaction() as db:
            b.work.require_owner(db, a); old, _ = terminal(db, a, False)
            if not old or p.get('confirmed') is not True or p.get('expectedVersion') != old['version']:
                raise ApiError(409, 'VERSION_CHANGED', '请确认原终端停止并核对处理版本')
            return jsonify(bind(db, a, old['redemption_id'], old['version']+1))

    @app.post('/api/cp28/owner/handoff', defaults={'action': 'handoff'})
    @app.post('/api/cp28/owner/report', defaults={'action': 'report'})
    @app.post('/api/cp28/owner/settle', defaults={'action': 'settle'})
    def owner_action(action):
        a = actor('owner'); p = body()
        with gate, b.store.transaction() as db:
            b.work.require_owner(db, a); t, _ = terminal(db, a)
            if action == 'handoff': return jsonify(red.handoff(a, t['redemption_id'], p))
            if action == 'report':
                if p.get('confirmStatement') is not True: raise ApiError(422, 'CONFIRM_REQUIRED', '请确认原交餐声明')
                dto = red.report(a, t['redemption_id'], {'intentKey': p.get('intentKey')})
                b.bind_review(db, a, dto['operation']['id']); return jsonify(dto)
            if action == 'settle':
                dto = b.owner_wallet.prepare(a, t['redemption_id'], p)
                b.bind_review(db, a, dto['operation']['id']); return jsonify(dto)
            raise ApiError(404, 'NOT_FOUND', '动作不存在')

    @app.post('/api/cp28/operations/<op_id>/<action>')
    def operation(op_id, action):
        op, a = original(op_id)
        if action == 'review': return jsonify(service.review(op_id))
        if action == 'start':
            if a:
                with b.store.transaction() as db: terminal(db, a)
            saved = b.store.one('SELECT review FROM cp28_wallet_reviews WHERE operation_id=?', (op_id,))
            if not saved: raise ApiError(409, 'REVIEW_REQUIRED', '请先核对交易')
            review = json.loads(saved['review'])
            return jsonify(**review, maySubmit=service.start(review, actor=a))
        if action == 'hash':
            b.runtime.record_hash(op_id, body().get('txHash')); return jsonify(state='UNKNOWN')
        if action == 'unknown':
            b.runtime.unknown(op_id); return jsonify(state='UNKNOWN')
        if action == 'observe': return jsonify(Observer(b).observe(op_id))
        if action == 'dispatch':
            if not a or op['kind'] not in ('issue', 'lock', 'report') or dispatch is None:
                raise ApiError(503, 'SIGNER_UNCONFIGURED', '受限后台签名服务不可用')
            if op['kind'] != 'issue':
                with b.store.transaction() as db: terminal(db, a)
            return jsonify(dispatch(op_id))
        raise ApiError(404, 'NOT_FOUND', '动作不存在')

    @app.get('/api/cp28/operations/<op_id>')
    def get_operation(op_id):
        op, _ = original(op_id)
        return jsonify(operation=b.operation_view(op))

    dist = Path(__file__).parents[2]/'manual-business-harness/dist'
    @app.get('/')
    def index(): return send_from_directory(dist, 'index.html')
    @app.get('/assets/<path:name>')
    def asset(name): return send_from_directory(dist/'assets', name)
    return app
