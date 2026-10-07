"""Isolated actual HTTP/JWT UI fixture. Alias SDK and injected provider are synthetic."""
import json
import time
from pathlib import Path
from flask import request, jsonify, send_from_directory
from werkzeug.serving import make_server
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from server.dynamic_contracts import ClaimProfile, ENVIRONMENT_ID
from server.dynamic_jwt import FixedJwksCache
from server.manual_business.identity_preparation import IdentityPreparation
from server.manual_business.web import create_app


def main():
    origin='http://127.0.0.1:15288'; now=[int(time.time())]
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    public=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()));public.update(kid='offline',alg='RS256',use='sig')
    profile=ClaimProfile(ENVIRONMENT_ID,'app.dynamicauth.com/'+ENVIRONMENT_ID,(origin,),verified=True)
    service=IdentityPreparation(origin,profile=profile,clock=lambda:now[0],
        jwks=FixedJwksCache(clock=lambda:now[0],transport=lambda:json.dumps({'keys':[public]}).encode()))
    app=create_app({'origin':origin,'runId':'identity-offline-synthetic'},identity_preparation=service)
    root=Path('dist/cp28-identity-fixture'); records=[]; assets=[]
    controls='''<aside style="padding:12px;background:#ffeab9"><strong>纯合成SDK / 钱包 / JWT：实际App与HTTP，无真实登录、邮件、钱包或网络</strong>
<p>合成验证码：000000</p><button id="account-change">模拟账户变化</button><button id="chain-change">模拟网络变化</button>
<button id="token-change">模拟登录失效</button><button id="profile-missing">模拟未配置profile</button><pre id="provider-log">Provider methods: none</pre></aside>
<script>const listeners=new Map(),calls=[];let chain='0x279f',address='0x'+'11'.repeat(20);
window.ethereum={isMetaMask:true,on:(e,f)=>listeners.set(e,f),removeListener:e=>listeners.delete(e),request:async({method})=>{
calls.push(method);document.querySelector('#provider-log').textContent='Provider methods: '+calls.join(', ');
if(method==='eth_chainId')return chain;if(method==='eth_requestAccounts'||method==='eth_accounts')return[address];throw new Error('Signing forbidden');}};
document.querySelector('#account-change').onclick=()=>{address='0x'+'22'.repeat(20);listeners.get('accountsChanged')?.([address])};
document.querySelector('#chain-change').onclick=()=>{chain='0x1';listeners.get('chainChanged')?.(chain)};
document.querySelector('#token-change').onclick=()=>window.dispatchEvent(new Event('fixture-token-change'));
document.querySelector('#profile-missing').onclick=async()=>{await fetch('/test-profile-missing',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});location.reload()};</script>'''
    app.view_functions['index']=lambda:(root/'index.html').read_text().replace('<body>','<body>'+controls)
    app.view_functions['asset']=lambda name:send_from_directory(root.resolve()/'assets',name)
    @app.get('/test-token')
    def token():
        return jsonify(token=jwt.encode({'iss':profile.issuer,'aud':origin,'environment_id':ENVIRONMENT_ID,
            'sub':'synthetic-person','sid':'synthetic-session','iat':now[0]-1,'exp':now[0]+600,'scope':'user:basic'},key,algorithm='RS256',headers={'kid':'offline'}))
    @app.post('/test-profile-missing')
    def missing():service.profile=None;service.sessions.clear();return jsonify(changed=True)
    @app.get('/test-mobile')
    def mobile():return '<h1>390px身份准备合成布局（非实体手机）</h1><iframe title="390px identity" src="/#/identity" width="390" height="2100"></iframe>'
    @app.after_request
    def evidence(response):
        if request.path.startswith('/assets/'):assets.append(request.path)
        if request.path.startswith('/api/cp28/identity/'):
            data=response.get_json(silent=True) or {}
            records.append({'method':request.method,'path':request.path,'status':response.status_code,
                'hasBearer':bool(request.headers.get('Authorization')),'hasCsrf':bool(request.headers.get('X-CSRF-Token')),
                'identityVerified':data.get('serverIdentityVerified'),'candidateConfirmed':bool(data.get('candidate'))})
        Path('evidence/cp28/identity-browser-http.json').write_text(json.dumps({'kind':'synthetic-SDK-provider-actual-HTTP-JWT','requests':records,'assets':assets},indent=2))
        return response
    @app.after_request
    def test_frame(response):response.headers['X-Frame-Options']='SAMEORIGIN';return response
    app.after_request_funcs[None].insert(0,app.after_request_funcs[None].pop())
    print(origin+'/#/recipient',flush=True)
    with make_server('127.0.0.1',15288,app) as server:server.serve_forever()


if __name__=='__main__':main()
