import base64
import json
import logging
import threading
import time
from collections import deque
from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException
from .identity import ADDRESS, BATCH, public_config


def create_app(sync, clock=time.monotonic):
    app=Flask(__name__); app.logger.disabled=True
    admitted=deque(); mutex=threading.Lock()
    @app.before_request
    def admission():
        if request.host not in ('127.0.0.1:15207','127.0.0.1:18995'): return jsonify(code='HOST_DENIED'),403
        origin=request.headers.get('Origin')
        if origin is not None and origin!='http://'+request.host: return jsonify(code='ORIGIN_DENIED'),403
        if request.method not in ('GET','HEAD'): return jsonify(code='READ_ONLY'),405
        with mutex:
            now=clock()
            while admitted and now-admitted[0]>=60: admitted.popleft()
            if len(admitted)>=120: return jsonify(code='RATE_LIMITED'),429,{'Retry-After':'60'}
            admitted.append(now)
    @app.after_request
    def headers(response):
        response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'})
        return response
    @app.errorhandler(HTTPException)
    def http(error): return jsonify(code='HTTP_ERROR'),error.code
    @app.errorhandler(Exception)
    def unavailable(error): return jsonify(code='READ_UNAVAILABLE'),503
    @app.get('/api/v1/testnet/config')
    def config(): return jsonify(public_config())
    @app.get('/api/v1/testnet/batches/<batch_id>')
    def batch(batch_id):
        if batch_id!=BATCH: return jsonify(code='NOT_FOUND'),404
        if set(request.args)-{'cached'} or request.args.get('cached') not in (None,'1'): return jsonify(code='INVALID_REQUEST'),400
        if request.args.get('cached')!='1': sync.trigger()
        data=sync.view(); state=data['sync']['state']
        return jsonify(data),503 if state in ('HALTED','UNAVAILABLE') else 202 if data['amounts'] is None else 200
    @app.get('/api/v1/testnet/batches/<batch_id>/events')
    def events(batch_id):
        if batch_id!=BATCH: return jsonify(code='NOT_FOUND'),404
        if set(request.args)-{'cursor'}: return jsonify(code='INVALID_REQUEST'),400
        if sync.store.state()['halted']: return jsonify(code='HALTED'),503
        data=sync.view(); watermark=data['sync']['verifiedThrough']
        if watermark is None or not sync.ready: return jsonify(events=[],nextCursor=None,sync=data['sync']),202
        position=-1
        cursor=request.args.get('cursor')
        if cursor:
            try:
                if len(cursor)>512: raise ValueError()
                parsed=json.loads(base64.urlsafe_b64decode(cursor.encode()))
                if set(parsed)!={'contract','batch','watermark','position'} or parsed['contract']!=ADDRESS or parsed['batch']!=BATCH:
                    raise ValueError()
                if type(parsed['watermark']) is not int or not 0<=parsed['watermark']<=watermark: raise ValueError()
                if type(parsed['position']) is not int or parsed['position']<0: raise ValueError()
                watermark=parsed['watermark']; position=parsed['position']
            except Exception: return jsonify(code='INVALID_CURSOR'),400
        rows=[e for e in sync.store.events() if e['blockNumber']<=watermark]
        page=rows[position+1:position+21]
        next_cursor=None
        if position+21<len(rows):
            next_cursor=base64.urlsafe_b64encode(json.dumps(dict(contract=ADDRESS,batch=BATCH,watermark=watermark,position=position+20)).encode()).decode()
        allowed=('kind','amountWei','transactionHash','blockNumber','blockHash','logIndex','source')
        return jsonify(events=[{k:e[k] for k in allowed} for e in page],nextCursor=next_cursor,sync=data['sync'])
    return app
