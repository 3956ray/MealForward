import asyncio
import threading
import time
import uuid
from flask import Flask,jsonify,request
from .check import ADDRESS,PROFILE,check

def create_app(origin,online=False,checker=check,clock=time.monotonic,*,instance_id=None):
    instance_id=instance_id or uuid.uuid4().hex
    app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=4096
    lock=threading.Lock();history={};busy=set()
    @app.before_request
    def boundary():
        if request.host!=origin.removeprefix('http://') or request.remote_addr not in ('127.0.0.1','::1'):return jsonify(code='HOST_DENIED'),403
        if request.method=='POST' and (request.headers.get('Origin')!=origin or not request.is_json):return jsonify(code='ORIGIN_DENIED'),403
    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store';response.headers['X-Content-Type-Options']='nosniff';return response
    @app.errorhandler(413)
    def too_large(_):return jsonify(code='REQUEST_SIZE_LIMIT'),413
    @app.errorhandler(400)
    def invalid(_):return jsonify(code='INVALID_REQUEST'),400
    @app.get('/api/cp26/config')
    def config():return jsonify(online=online,instanceId=instance_id,profileId=PROFILE['profileId'],targetChainId=10143,sourceLabel=PROFILE['sourceLabel'],deploymentManifest=None)
    @app.post('/api/cp26/check')
    def inspect():
        body=request.get_json()
        if not isinstance(body,dict) or set(body)!={'address'} or not isinstance(body['address'],str) or not ADDRESS.fullmatch(body['address']):return jsonify(code='INVALID_REQUEST'),400
        if not online:return jsonify(code='RPC_NOT_CONFIGURED'),409
        peer=request.remote_addr;now=clock()
        with lock:
            history[peer]=[t for t in history.get(peer,[]) if t>now-60]
            if peer in busy or len(history[peer])>=10:return jsonify(code='RATE_LIMIT'),429
            history[peer].append(now);busy.add(peer)
        try:return jsonify(asyncio.run(checker(body['address'])))
        except Exception:return jsonify(code='CHECK_UNAVAILABLE'),503
        finally:
            with lock:busy.discard(peer)
    return app
