"""Real loopback HTTP trickle regression, never a public RPC or private configuration."""
import contextlib
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
import unittest
import requests
from scripts.testnet.rpc import Rpc, Stop


class RpcStreamTests(unittest.TestCase):
    def run_stream(self, *, encoding=None):
        stopped=threading.Event();observed=[]
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                observed.append(self.headers.get('Accept-Encoding'))
                self.send_response(200)
                self.send_header('Content-Length','2048')
                if encoding: self.send_header('Content-Encoding',encoding)
                self.end_headers()
                try:
                    for _ in range(2048):
                        self.wfile.write(b' ');self.wfile.flush()
                        if stopped.wait(.014): break
                except (BrokenPipeError,ConnectionResetError): pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        rpc=object.__new__(Rpc)
        rpc.endpoint=f'http://127.0.0.1:{server.server_port}/SYNTHETIC_SECRET_CP19'
        rpc.session=requests.Session();rpc.session.trust_env=False
        output=io.StringIO();started=time.monotonic()
        try:
            with contextlib.redirect_stdout(output),contextlib.redirect_stderr(output):
                with self.assertRaises(Stop) as raised: rpc.call('eth_chainId',[])
            elapsed=time.monotonic()-started
            self.assertEqual(observed,['identity']) # exactly one request, no retries
            self.assertNotIn('SYNTHETIC_SECRET_CP19',str(raised.exception)+output.getvalue())
            return str(raised.exception),elapsed
        finally:
            stopped.set();rpc.session.close();server.shutdown();server.server_close();thread.join(2)

    def test_real_trickle_body_checks_deadline_before_1024_bytes(self):
        code,elapsed=self.run_stream()
        self.assertEqual(code,'RPC_LIMIT')
        self.assertGreaterEqual(elapsed,9.5)
        self.assertLess(elapsed,12)
        print(f'loopback trickle: {code}, {elapsed:.3f}s (budget10s, tolerance2s)')

    def test_compressed_trickle_rejected_without_waiting_for_decoder(self):
        code,elapsed=self.run_stream(encoding='gzip')
        self.assertEqual(code,'RPC_ENCODING_DENIED')
        self.assertLess(elapsed,2)
        print(f'loopback gzip: {code}, {elapsed:.3f}s')


if __name__=='__main__': unittest.main()
