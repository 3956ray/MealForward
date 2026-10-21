"""G1-D disposable original-CP30 SQL source -> Node signed public pipeline.

Only callable while the original G2 PG17 fixture transaction is open.
No real CP30 Mac runtime, Render PG, signer or external HTTP server.
The local loopback GET exposes only the exact c1_g1_export.public_snapshot()
allowlisted projection and never returns raw CP30 rows or credentials.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlsplit

DB="mf_g2_disposable_ci_20261017"
ALLOWED_SECTION="/__ci_original_public_projection"
SCRIPT=Path(__file__).resolve().parents[1]/"g1-export"/"live-public-sql-pipeline.ci.mjs"


def prove_sql_public_pipeline(db, as_reader):
    if (os.environ.get("GITHUB_ACTIONS")!="true"
        or os.environ.get("MF_G2_DISPOSABLE_ONLY")!="ack-fresh-gha-postgres-17"
        or os.environ.get("MF_G1_D_DISPOSABLE_ONLY")!="ack-three-isolated-pg17-public-sql"
        or os.environ.get("PGHOST")!="127.0.0.1"
        or db.execute("SELECT current_database()").fetchone()[0]!=DB
        or not SCRIPT.is_file()):
        raise ValueError("G1_D_DISPOSABLE_PIPELINE_REQUIRED")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def reply(self, status, body):
            response=json.dumps(body,separators=(",",":"),ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type","application/json")
            self.send_header("Cache-Control","no-store")
            self.send_header("Content-Length",str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def do_GET(self):
            if (self.client_address[0]!="127.0.0.1"
                or self.path!=ALLOWED_SECTION
                or urlsplit(self.path).query
                or self.headers.get("Cookie")
                or self.headers.get("Authorization")):
                self.reply(403,{"error":"CI_PUBLIC_SOURCE_NOT_AUTHORIZED"})
                return
            try:
                source=as_reader()
                if ("value" not in source
                    or source["value"] is None
                    or len(source["value"])!=1
                    or not isinstance(source["value"][0],dict)):
                    self.reply(503,{"error":"CI_PUBLIC_SOURCE_UNAVAILABLE"})
                    return
                payload=source["value"][0]
                if (payload.get("mode")!="G1_PUBLIC_SOURCE_PROJECTION_ONLY"
                    or payload.get("businessTransactionsAllowed") is not False):
                    self.reply(503,{"error":"CI_PUBLIC_SOURCE_UNVERIFIED"})
                    return
                self.reply(200,payload)
            except Exception:
                self.reply(503,{"error":"CI_PUBLIC_SOURCE_UNAVAILABLE"})

        def do_POST(self):
            self.reply(405,{"error":"CI_SOURCE_GET_ONLY"})

    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    server.daemon_threads=True
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        address="http://127.0.0.1:"+str(server.server_address[1])
        cmd=["node",str(SCRIPT)]
        env={**os.environ,"MF_G1_D_SOURCE_URL":address+ALLOWED_SECTION}
        process=subprocess.run(
            cmd,env=env,stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            text=True,timeout=80,check=False)
        if process.returncode!=0:
            # Never print source payloads, wallet materials, or HTTP bodies.
            raise AssertionError("G1_D_ORIGINAL_SQL_PUBLIC_PIPELINE_FAILED")
        try:
            evidence=json.loads(process.stdout.strip())
        except Exception:
            raise AssertionError("G1_D_UNREADABLE_EVIDENCE") from None
        expected={
            "status":"G1_D_REAL_SOURCE_TO_SITES_PASS",
            "originalSqlProjection":True,
            "signerPurposeScoped":True,
            "durableOutboxAck":True,
            "separateCacheAndAnchor":True,
            "realPublicHttp":True,
            "sourceReadCount":1,
            "publicReadCount":3,
            "sourceWalletOrVoucherLeak":False,
            "originalCp30RuntimeTouched":False,
            "onchainTransactions":0,
        }
        for key,value in expected.items():
            if evidence.get(key)!=value:
                raise AssertionError("G1_D_INCOMPLETE_EVIDENCE_"+key)
        return evidence
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
