"""Loopback-only CP15 API. No legacy actor/reset/simulated outcomes or full work flow."""
import re
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException
from web3 import Web3
from server.contracts import ApiError, SUPPORT_COOKIE, SUPPORT_TTL
from server.chain.client import ChainConflict, hx
from server.projection import Projector


def create_app(backend, *, origin='http://127.0.0.1:8875', clock=None):
    from server.auth import register_auth
    app=Flask(__name__)
    app.config['MAX_CONTENT_LENGTH']=16*1024
    app.logger.disabled=True
    service=register_auth(app,backend.store,origin=origin,clock=clock or backend.clock,secure_cookie=False)
    projector=Projector(backend)
    app.extensions['backend']=backend
    @app.before_request
    def origin_and_json():
        if request.method=='POST':
            if request.headers.get('Origin')!=origin: raise ApiError(403,'ORIGIN_REJECTED','Origin rejected')
            if not request.is_json: raise ApiError(415,'JSON_REQUIRED','JSON body required')
    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store'
        response.headers['Referrer-Policy']='no-referrer'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['X-Robots-Tag']='noindex, nofollow'
        return response
    @app.errorhandler(ApiError)
    def api_error(error): return jsonify(code=error.code,message=error.message),error.status
    @app.errorhandler(HTTPException)
    def http_error(error): return jsonify(code='HTTP_ERROR',message=error.name),error.code
    @app.errorhandler(Exception)
    def unavailable(error):
        # Never serialize RPC exception payloads, signed raw, passwords or private row data.
        if isinstance(error,ChainConflict): backend.halt('CHAIN_CONFLICT')
        return jsonify(code='STATE_UNAVAILABLE',message='State unavailable; query the original operation'),503
    def body():
        value=request.get_json()
        if not isinstance(value,dict): raise ApiError(422,'INVALID_INPUT','Object required')
        return value
    @app.get('/healthz')
    def health(): return jsonify(status='alive',mode='localchain',recovery=backend.recovery_view())
    @app.get('/api/v1/config')
    def config():
        d=backend.deployment
        return jsonify({**{k:v for k,v in d.items() if k not in ('rpcUrl','issuer')},
                        'capabilities':[] if backend.quarantined() else ['support','issue'],
                        'recovery':backend.recovery_view(),'finalityPolicy':'receipt-canonical-finalized-local'})
    @app.post('/api/v1/support-session')
    def support_session():
        payload=body()
        if set(payload)-{'startNew'} or ('startNew' in payload and type(payload['startNew']) is not bool): raise ApiError(422,'INVALID_INPUT','Invalid session request')
        throttle='support-ip:'+str(request.remote_addr)
        if backend.store.auth_failure_count(throttle,backend.now(),60)>=30: raise ApiError(429,'RATE_LIMITED','Try later')
        backend.store.record_auth_failure(throttle,backend.now())
        token,cap=backend.support_session(request.cookies.get(SUPPORT_COOKIE),payload.get('startNew',False))
        response=jsonify(operationId=cap['operation_id'],expiresAt=cap['expires_at'])
        response.set_cookie(SUPPORT_COOKIE,token,httponly=True,samesite='Lax',secure=False,path='/api/v1',max_age=max(0,cap['expires_at']-backend.now()))
        return response
    @app.post('/api/v1/support-intents')
    def prepare(): return jsonify(backend.create_support(request.cookies.get(SUPPORT_COOKIE),body())),201
    @app.get('/api/v1/support-intents/<op_id>')
    def support_operation(op_id): return jsonify(backend.get_support(request.cookies.get(SUPPORT_COOKIE),op_id))
    @app.post('/api/v1/work/issuances')
    def issue():
        actor=service.require('partner',csrf=True)
        # RPC calls finish before the acceptance transaction begins. No optional Envio dependency.
        projector.sync()
        return jsonify(backend.issue(actor,body())),202
    @app.get('/api/v1/work/issuances/by-intent/<key>')
    def by_intent(key): return jsonify(backend.get_issue(service.require('partner'),key=key))
    @app.get('/api/v1/operations/<op_id>')
    def work_operation(op_id): return jsonify(backend.get_issue(service.require('partner'),op_id=op_id))
    @app.get('/api/v1/batches/<batch_id>')
    def batch(batch_id):
        row=backend.store.one('SELECT * FROM batches WHERE id=?',(batch_id,))
        if not row: raise ApiError(404,'NOT_FOUND','Finalized batch not observed')
        checkpoint=backend.store.one('SELECT * FROM checkpoints ORDER BY block_number DESC LIMIT 1')
        return jsonify(batch={k:str(row[k]) for k in ('F','A','R','H','S','X','L')},batchId=row['id'],
                       source={'deploymentId':backend.deployment['deploymentId'],'blockNumber':checkpoint['block_number'],'blockHash':checkpoint['block_hash']},
                       halted=bool(backend.store.one("SELECT value FROM metadata WHERE key='halted'")['value']))
    @app.get('/api/v1/public/fund-status')
    def public_fund():
        payer=request.args.get('payer',''); intent=request.args.get('intent','')
        if not Web3.is_address(payer) or not re.fullmatch(r'0x[0-9a-fA-F]{64}',intent): raise ApiError(422,'INVALID_INPUT','Invalid public lookup')
        backend.rpc.guard()
        batch_id=hx(backend.rpc.contract.functions.fundedBatch(Web3.to_checksum_address(payer),intent).call())
        # Public lookup is no private capability recovery and cannot mark absence as a safe retry.
        return jsonify(chainId=31337,contract=backend.rpc.contract.address,payer=payer,intent=intent,batchId=batch_id,
                       retryPolicy='READ_ORIGINAL_ONLY',source='public-chain-latest',finalized=False)
    return app
