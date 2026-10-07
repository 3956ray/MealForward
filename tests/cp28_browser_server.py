"""Temporary UI fixture over actual CP28 HTTP + offline fake10143 composition.

Run with .venv/bin/python -m tests.cp28_browser_server. No real RPC or wallet.
Control routes exist only in this test module, never in the product launcher.
"""
import json
from pathlib import Path
from flask import request, jsonify
from werkzeug.serving import make_server
from tests.test_cp28_fake_flow import FakeFlowTests
from server.manual_business.web import create_app
from server.manual_business.auth import TrustedAuthentication


def main():
    fixture = FakeFlowTests(); fixture.fixture_origin = 'http://127.0.0.1:15288'; fixture.setUp()
    try:
        op = fixture.prepare_issue(); fixture.service_transaction('partner', op)
        invitation = fixture.post('partner', 'partner/invite', {'rotate': False})
        auth = TrustedAuthentication(fixture.b, fixture.origin, lambda req: req.headers.get('X-Synthetic-Verified-Subject'))
        app = create_app(fixture.config, fixture.b, authentication=auth,
                        dispatch=lambda op: fixture.signer.handle({'version': 1, 'operationId': op, 'capability': 's'*43}))
        records = []
        snapshot = fixture.store.one("SELECT value FROM metadata WHERE key='cp28_public_snapshot'")['value']
        evidence = Path('evidence/cp28/p2-browser-http.json')
        @app.after_request
        def record(response):
            if request.path.startswith('/api/cp28/recipient'):
                body = request.get_json(silent=True) or {}
                records.append({'method': request.method, 'path': request.path, 'status': response.status_code,
                                'secretPresent': bool(body.get('secret')), 'csrfPresent': bool(request.headers.get('X-CSRF-Token'))})
                evidence.write_text(json.dumps({'kind': 'actual-App-native-fetch-actual-HTTP-offline10143', 'requests': records}, indent=2))
            return response
        @app.get('/test-fixture')
        def controls():
            return '''<!doctype html><meta charset="utf-8"><title>CP28 offline UI fixture</title>
<h1>CP28 纯合成测试控制台</h1><p>实际 App、原生 fetch、实际 HTTP；离线 fake10143，无真实钱包或 RPC。</p>
<a href="'''+invitation['url']+'''">打开合成私密领取链接</a> · <a href="/#/ledger">查看实际公账页面</a>
<p><button data-mode="pending">模拟待核验</button><button data-mode="snapshot">恢复核验快照</button>
<button data-mode="missing">模拟缺失观察</button><button data-mode="expired">模拟会话过期</button></p>
<p id="state">fixture ready</p><script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{
const r=await fetch('/test-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:b.dataset.mode})});
document.querySelector('#state').textContent=(await r.json()).mode;});</script>'''
        @app.post('/test-control')
        def control():
            mode = request.get_json()['mode']
            with fixture.store.transaction() as db:
                if mode == 'expired': db.execute('UPDATE cp24_session SET expires=0')
                elif mode == 'missing': db.execute("DELETE FROM metadata WHERE key='cp28_public_snapshot'")
                elif mode in ('pending', 'snapshot'):
                    db.execute("INSERT OR REPLACE INTO metadata VALUES('cp28_public_snapshot',?)", (snapshot,))
                    db.execute('UPDATE cp28_signing SET state=? WHERE operation_id=?',
                               ('UNKNOWN' if mode == 'pending' else 'FINALIZED_SUCCESS', op))
                else: return jsonify(mode='invalid'), 400
            fixture.now += 60
            return jsonify(mode=mode)
        @app.get('/test-mobile')
        def mobile():
            return '<h1>390px 合成响应布局（非实体手机）</h1><iframe title="390px ledger" src="/#/ledger" width="390" height="1100"></iframe>'
        # Product frame-denial stays unchanged; allow same-origin solely for this test iframe.
        @app.after_request
        def frame_fixture(response):
            response.headers['X-Frame-Options'] = 'SAMEORIGIN'
            return response
        app.after_request_funcs[None].insert(0, app.after_request_funcs[None].pop())
        print('Offline UI fixture http://127.0.0.1:15288/test-fixture', flush=True)
        with make_server('127.0.0.1', 15288, app) as server: server.serve_forever()
    finally: fixture.doCleanups()


if __name__ == '__main__': main()
