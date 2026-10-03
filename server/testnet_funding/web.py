"""Loopback, capability-scoped API. No keys or broadcast endpoints."""
from collections import deque
import threading
import time
from flask import Flask,jsonify,request
from werkzeug.exceptions import HTTPException
from .chain import FundingError

BASE='/api/v1/testnet-funding'
COOKIE='mealforward_cp21_funding'

def create_app(service,clock=time.monotonic):
    app=Flask(__name__);app.logger.disabled=True;app.config['MAX_CONTENT_LENGTH']=8192
    admitted=deque();expensive=deque();mutex=threading.Lock()
    @app.before_request
    def admission():
        if request.host not in ('127.0.0.1:15207','127.0.0.1:19005'): raise FundingError('HOST_DENIED',403)
        origin=request.headers.get('Origin')
        if origin is not None and origin!='http://127.0.0.1:15207': raise FundingError('ORIGIN_DENIED',403)
        if request.headers.get('Sec-Fetch-Site') not in (None,'same-origin'): raise FundingError('ORIGIN_DENIED',403)
        if request.method not in ('GET','POST'): raise FundingError('METHOD_DENIED',405)
        if request.method=='POST':
            if origin!='http://127.0.0.1:15207' or request.headers.get('X-CP21-Request')!='1' or request.mimetype!='application/json': raise FundingError('CSRF_DENIED',403)
            body=request.get_json(silent=True)
            if not isinstance(body,dict): raise FundingError('INVALID_INPUT',422)
        with mutex:
            now=clock()
            while admitted and now-admitted[0]>=60: admitted.popleft()
            if len(admitted)>=120: raise FundingError('RATE_LIMITED',429)
            admitted.append(now)
            if request.path in (BASE+'/review',BASE+'/submit-start',BASE+'/reconcile'):
                while expensive and now-expensive[0]>=60: expensive.popleft()
                if len(expensive)>=2: raise FundingError('RATE_LIMITED',429)
                expensive.append(now)
    @app.after_request
    def headers(response):
        response.headers.update({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'})
        if response.status_code==429: response.headers['Retry-After']='60'
        return response
    @app.errorhandler(FundingError)
    def funding(error): return jsonify(code=error.code),error.status
    @app.errorhandler(HTTPException)
    def http(error): return jsonify(code='HTTP_ERROR'),error.code
    @app.errorhandler(Exception)
    def unexpected(error): return jsonify(code='FUNDING_UNAVAILABLE'),503
    def token(): return request.cookies.get(COOKIE)
    def empty():
        if request.get_json(): raise FundingError('INVALID_INPUT',422)
    @app.get(BASE+'/config')
    def config(): return jsonify(service.config())
    @app.post(BASE+'/session')
    def session():
        empty();fresh,data=service.session(token());response=jsonify(data)
        if fresh: response.set_cookie(COOKIE,fresh,max_age=86400,httponly=True,samesite='Strict',path=BASE)
        return response
    @app.get(BASE+'/operation')
    def operation(): return jsonify(service.get(token()))
    @app.post(BASE+'/review')
    def review(): return jsonify(service.review(token(),request.get_json()))
    @app.post(BASE+'/submit-start')
    def submit(): return jsonify(service.submit(token(),request.get_json()))
    @app.post(BASE+'/transaction')
    def transaction(): return jsonify(service.attach(token(),request.get_json()))
    @app.post(BASE+'/reconcile')
    def reconcile(): empty();return jsonify(service.reconcile(token()))
    return app
