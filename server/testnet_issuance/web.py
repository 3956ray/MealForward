"""Loopback, GET-only API. No keys, no POST surface, no broadcast."""
from collections import deque
import threading
import time
from flask import Flask,jsonify,request
from werkzeug.exceptions import HTTPException
from .chain import IssuanceError

BASE='/api/v1/testnet-issuance'

def create_app(service,clock=time.monotonic):
    app=Flask(__name__);app.logger.disabled=True;app.config['MAX_CONTENT_LENGTH']=8192
    admitted=deque();expensive=deque();mutex=threading.Lock()
    @app.before_request
    def admission():
        if request.host not in ('127.0.0.1:15207','127.0.0.1:19006'): raise IssuanceError('HOST_DENIED',403)
        origin=request.headers.get('Origin')
        if origin is not None and origin!='http://127.0.0.1:15207': raise IssuanceError('ORIGIN_DENIED',403)
        if request.headers.get('Sec-Fetch-Site') not in (None,'same-origin'): raise IssuanceError('ORIGIN_DENIED',403)
        if request.method not in ('GET','HEAD'): raise IssuanceError('METHOD_DENIED',405)
        if request.content_length: raise IssuanceError('INVALID_INPUT',422)
        with mutex:
            now=clock()
            while admitted and now-admitted[0]>=60: admitted.popleft()
            if len(admitted)>=120: raise IssuanceError('RATE_LIMITED',429)
            admitted.append(now)
    @app.after_request
    def headers(response):
        response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'})
        if response.status_code==429: response.headers['Retry-After']='60'
        return response
    @app.errorhandler(IssuanceError)
    def issuance(error): return jsonify(code=error.code),error.status
    @app.errorhandler(HTTPException)
    def http(error): return jsonify(code='HTTP_ERROR'),error.code
    @app.errorhandler(Exception)
    def unexpected(error): return jsonify(code='ISSUANCE_UNAVAILABLE'),503
    @app.get(BASE+'/config')
    def config(): return jsonify(service.config())
    @app.get(BASE+'/operation')
    def operation():
        if set(request.args)-{'cached'} or request.args.get('cached') not in (None,'1'): raise IssuanceError('INVALID_REQUEST',400)
        cached=request.args.get('cached')=='1'
        if not service.store.configured(): raise IssuanceError('NOT_CONFIGURED',409)
        if not cached:  # the only sync-triggering read; invalid or cached requests never consume it
            with mutex:
                now=clock()
                while expensive and now-expensive[0]>=60: expensive.popleft()
                if len(expensive)>=2: raise IssuanceError('RATE_LIMITED',429)
                expensive.append(now)
        return jsonify(service.operation(cached))
    return app
