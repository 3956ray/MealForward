"""Loopback-only test bridge: live original CP30 SQL -> HTTP -> production G1 Node.

Runs only inside the G2 disposal runner's open PostgreSQL transaction with
synthetic source rows. It does NOT serve a public HTTP endpoint, install a
runtime, copy real data, create an original session, or sign a transaction.
The Python bridge holds a *single* preopened test transaction. Every SQL
read uses the existing G1 read-only NOLOGIN role and original CP30 auth().
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlsplit


HERE=Path(__file__).resolve().parents[1]
NODE=HERE / "g1-export" / "live-sql-http-gate.mjs"
SECTIONS={"orders","claims","vouchers"}


def probe_real_sql_to_http(as_client, raw_tokens):
    if (os.environ.get("GITHUB_ACTIONS")!="true"
        or os.environ.get("MF_G2_DISPOSABLE_ONLY")!="ack-fresh-gha-postgres-17"
        or os.environ.get("PGHOST")!="127.0.0.1"
        or len(raw_tokens)!=2
        or any(not isinstance(t,str) or len(t)!=43 for t in raw_tokens)):
        raise ValueError("G1_C_DISPOSABLE_HTTP_ONLY")
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_args):
            # Never log a Cookie, session hash, body, voucher or network URL.
            return

        def respond(self,status,value):
            raw=json.dumps(value,separators=(",",":")).encode("utf8")
            self.send_response(status)
            self.send_header("Content-Type","application/json")
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Length",str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            if (self.client_address[0]!="127.0.0.1"
                or urlsplit(self.path).path!="/__ci_original_source"
                or self.path!="/__ci_original_source"
                or self.headers.get("Content-Type")!="application/json"):
                self.respond(403,{"error":"CI_SOURCE_UNAVAILABLE"});return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if not 60<=length<=512:
                    self.respond(413,{"error":"CI_REQUEST_SIZE"});return
                body=json.loads(self.rfile.read(length).decode("utf8"))
                if (not isinstance(body,dict)
                    or set(body)!={"section","originalSessionHash"}
                    or body["section"] not in SECTIONS
                    or not isinstance(body["originalSessionHash"],str)
                    or len(body["originalSessionHash"])!=64
                    or any(c not in "0123456789abcdef" for c in body["originalSessionHash"])):
                    self.respond(400,{"error":"CI_SOURCE_BAD_INPUT"});return
                value=as_client(body["section"],body["originalSessionHash"])
                if "body" in value:
                    self.respond(200,{"data":value["body"]})
                else:
                    # Return bounded structural error only, without SQL context.
                    reason=value.get("reason")
                    status=401 if reason=="UNAUTHENTICATED" else 503
                    self.respond(status,{"error":"UNAUTHENTICATED" if status==401
                                          else "G1_B_ORIGINAL_SOURCE_NOT_READY"})
            except Exception:
                self.respond(503,{"error":"G1_B_ORIGINAL_SOURCE_NOT_READY"})

        def do_GET(self):
            self.respond(405,{"error":"CI_READ_BRIDGE_POST_ONLY"})
    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    server.daemon_threads=True
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        cmd=["node",str(NODE)]
        env={**os.environ,
             "MF_G1_C_LOOPBACK":"http://127.0.0.1:"+str(server.server_address[1]),
             "MF_G1_C_RAW_A":raw_tokens[0],
             "MF_G1_C_RAW_B":raw_tokens[1]}
        proc=subprocess.run(cmd,env=env,stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                            text=True,timeout=20,check=False)
        if proc.returncode!=0:
            # Never emit raw stdout/stderr that might include synthetic
            # vouchers or original session values.
            raise AssertionError("G1_C_REAL_SQL_HTTP_NODE_TEST_FAILED")
        try:result=json.loads(proc.stdout.strip())
        except Exception:raise AssertionError("G1_C_HTTP_EVIDENCE_INVALID") from None
        if (result.get("status")!="G1_C_REAL_SQL_HTTP_PASS"
            or result.get("readCount")!=6
            or result.get("privateWalletsIsolated") is not True
            or result.get("originalSessionOnly") is not True
            or result.get("businessWrites")!=0):
            raise AssertionError("G1_C_HTTP_PROOF_INCOMPLETE")
        print(json.dumps(result,sort_keys=True))
        return result
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
