"""Real loopback listeners and Vite processes; no remote RPC or wallet."""
import contextlib
import io
import json
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
import requests
from server.wallet_readiness import __main__ as launch

class StartupTests(unittest.TestCase):
    def assert_closed(self,port):
        with socket.socket() as sock:
            sock.settimeout(.5)
            self.assertNotEqual(sock.connect_ex(('127.0.0.1',port)),0)

    def test_port_rival_not_advertised_and_only_owned_resources_cleaned(self):
        real_popen=subprocess.Popen;real_server=launch.make_server
        rivals=[];children=[];apis=[];output=io.StringIO()
        class Rival(BaseHTTPRequestHandler):
            def do_GET(self):
                body=b'{"online":false,"reviewRival":true}'
                self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def log_message(self,*args):pass
        def server(*args,**kwargs):
            api=real_server(*args,**kwargs);apis.append(api);return api
        def spawn(args,**kwargs):
            port=int(args[args.index('--port')+1])
            rival=ThreadingHTTPServer(('127.0.0.1',port),Rival)
            thread=threading.Thread(target=rival.serve_forever,daemon=True);thread.start();rivals.append((rival,thread))
            child=real_popen([sys.executable,'-c','import os,sys,time;time.sleep(4);os.execv(sys.argv[1],sys.argv[1:])',*args],**kwargs)
            children.append(child);return child
        handlers={s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)}
        try:
            with patch('sys.argv',['cp26']),patch.object(launch,'make_server',side_effect=server),patch.object(launch.subprocess,'Popen',side_effect=spawn),contextlib.redirect_stdout(output):
                with self.assertRaisesRegex(RuntimeError,'instance mismatch'):launch.main()
            self.assertNotIn('CP27 read-only page:',output.getvalue())
            self.assertTrue(children);self.assertIsNotNone(children[0].poll())
            self.assert_closed(apis[0].server_port)
            with requests.Session() as session:
                session.trust_env=False
                response=session.get(f'http://127.0.0.1:{rivals[0][0].server_port}/api/cp26/config',timeout=1)
                self.assertTrue(response.json()['reviewRival'])
        finally:
            for child in children:
                if child.poll() is None:child.terminate();child.wait(timeout=5)
            for rival,thread in rivals:rival.shutdown();rival.server_close();thread.join(timeout=5)
            for sig,handler in handlers.items():signal.signal(sig,handler)

    def test_normal_start_and_shutdown(self):
        with tempfile.TemporaryFile(mode='w+') as log:
            proc=subprocess.Popen([sys.executable,'-m','server.wallet_readiness'],cwd=launch.ROOT,stdout=log,stderr=log)
            origin=None;api_port=None
            try:
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    log.seek(0);output=log.read()
                    if 'CP27 read-only page:' in output:break
                    if proc.poll() is not None:self.fail(output)
                    time.sleep(.1)
                else:self.fail('No ready URL: '+output)
                origin=output.split('CP27 read-only page: ')[1].splitlines()[0]
                api_port=int(output.split('API loopback port: ')[1].splitlines()[0])
                with requests.Session() as session:
                    session.trust_env=False
                    config=session.get(origin+'/api/cp26/config',timeout=2).json()
                    self.assertFalse(config['online']);self.assertEqual(len(config['instanceId']),32)
                    self.assertEqual(session.get(origin,timeout=2).status_code,200)
            finally:
                proc.terminate();proc.wait(timeout=15)
            self.assertEqual(proc.returncode,0)
            self.assert_closed(int(origin.rsplit(':',1)[1]));self.assert_closed(api_port)

if __name__=='__main__':unittest.main()
