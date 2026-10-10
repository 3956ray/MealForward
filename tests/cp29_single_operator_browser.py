"""Random-port synthetic UI fixture. Never run against real business files.
Only this test transport translates the random loopback Host/Origin to the
production fixed origin. Production guards remain unchanged and are tested
separately by the HTTP unit suite. No network JWKS, RPC or signer is available.
"""
import json
import threading
import time
from pathlib import Path
from flask import jsonify, request, send_from_directory
from werkzeug.serving import make_server, WSGIRequestHandler
from tests.test_cp29_single_operator import IdentityHttpTests, ORIGIN


class Quiet(WSGIRequestHandler):
    def log(self,*args,**kwargs): pass


def main():
    fixture=IdentityHttpTests();fixture.setUpClass();fixture.setup_mode(True,now=int(time.time()))
    app=fixture.app
    root=Path(__file__).resolve().parents[1]/'dist/cp29-single-operator-fixture'
    assets=[];calls=[];delay=threading.Event();release=threading.Event()
    banner='''<aside style="padding:12px;background:#fff1c7;overflow-wrap:anywhere">
<strong>CP29 纯合成浏览器测试：无真实邮件、钱包、RPC 或交易。验证码 000000。</strong>
<p>随机端口测试适配器仅在此 fixture 内翻译 Origin；生产绑定仍为 15287。</p>
<button id="fixture-change">模拟 SDK 身份失效</button>
<button id="fixture-delay">延迟下次业务登录</button><button id="fixture-release">释放迟到登录</button>
<a href="/test-evidence">脱敏测试状态</a></aside>
<script>
document.querySelector('#fixture-change').onclick=()=>window.dispatchEvent(new Event('fixture-token-change'));
for(const action of ['delay','release'])document.querySelector('#fixture-'+action).onclick=()=>fetch('/test-'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
</script>'''
    app.view_functions['index']=lambda:(root/'index.html').read_text().replace('<body>','<body>'+banner)
    app.view_functions['asset']=lambda name:send_from_directory(root/'assets',name)

    @app.before_request
    def record():
        if request.path.startswith('/assets/'):assets.append(request.path)
        if request.path.startswith('/api/'):calls.append(request.path)

    @app.after_request
    def delayed(response):
        if request.path.endswith('/login') and response.status_code==200 and delay.is_set():
            delay.clear();release.wait(20);release.clear()
        return response

    @app.get('/test-token')
    def token():return jsonify(token=fixture.token(exp=fixture.now+1800))

    @app.post('/test-delay')
    def wait_login():delay.set();return jsonify(ok=True)

    @app.post('/test-release')
    def release_login():release.set();return jsonify(ok=True)

    @app.get('/test-evidence')
    def evidence():
        rows=fixture.store.all('SELECT user_id,expires_at,revoked FROM work_sessions')
        return jsonify(synthetic=True,realE2E='NOT_RUN',sessions=rows,
                       audit=[json.loads(r['event']) for r in fixture.store.all('SELECT event FROM cp24_audit')],
                       assets=sorted(set(assets)),requests=calls)

    server=make_server('127.0.0.1',0,app,threaded=True,request_handler=Quiet)
    origin=f'http://127.0.0.1:{server.server_port}'
    production=app.wsgi_app
    def isolated_transport(environ,start):
        if (environ.get('REMOTE_ADDR')!='127.0.0.1' or environ.get('HTTP_HOST')!=origin[7:] or
            (environ.get('REQUEST_METHOD')=='POST' and environ.get('HTTP_ORIGIN')!=origin)):
            start('403 Forbidden',[('Content-Type','text/plain')]);return [b'Fixture loopback origin required']
        environ['HTTP_HOST']=ORIGIN[7:]
        if environ.get('HTTP_ORIGIN')==origin:environ['HTTP_ORIGIN']=ORIGIN
        return production(environ,start)
    app.wsgi_app=isolated_transport
    print(origin,flush=True)
    try:server.serve_forever()
    finally:server.server_close();fixture.doCleanups()

if __name__=='__main__':main()
