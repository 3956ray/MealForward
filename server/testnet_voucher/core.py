"""CP23 private online voucher delivery downstream of verified CP22 issuance evidence.

This module performs no RPC and has no signer. The canonical recipient credential is a
private bearer link; QR/manual codes are short-lived presentation credentials only.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import tempfile
import time


CHAIN_ID = 10143
PRICE_WEI = "1000000000000000"
TOTAL_FUNDED_WEI = "2000000000000000"
INVITE_TTL = 72 * 60 * 60
SESSION_TTL = 8 * 60 * 60
DISPLAY_TTL = 2 * 60
LABEL = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
SECRET = re.compile(r"[A-Za-z0-9_-]{43}")
DISPLAY_SECRET = re.compile(r"[A-Za-z0-9_-]{32}")


class VoucherError(Exception):
    def __init__(self, code: str, status: int = 422):
        super().__init__(code)
        self.code, self.status = code, status


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def random_token(n: int) -> str:
    return secrets.token_urlsafe(n)


def _private_regular(path: Path, max_size: int = 16 * 1024 * 1024) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > max_size:
        raise ValueError()


def _atomic(path: Path, value) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".cp23-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(canonical(value)); out.flush(); os.fsync(out.fileno())
        os.replace(tmp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def _read_private_json(path: Path):
    try:
        _private_regular(path, 1024 * 1024)
        return json.loads(path.read_text())
    except Exception:
        raise VoucherError("RESTORE_QUARANTINE", 503) from None


def read_cp22_issuance(directory: str | Path) -> dict:
    """Reuse CP22's own store validation, then require its stable verified accounting."""
    try:
        from server.testnet_issuance.store import IssuanceStore
        record = IssuanceStore(directory).load()
    except Exception as error:
        code = getattr(error, "code", "ISSUANCE_EVIDENCE_INVALID")
        if code == "RESTORE_QUARANTINE":
            raise VoucherError("ISSUANCE_EVIDENCE_INVALID", 503) from None
        raise VoucherError("ISSUANCE_EVIDENCE_INVALID", 503) from None
    config = record.get("config")
    accounting = record.get("accounting")
    if record.get("status") != "ACCOUNTING_VERIFIED" or not isinstance(config, dict) or not isinstance(accounting, dict):
        raise VoucherError("ISSUANCE_NOT_READY", 409)
    expected = {
        "F": PRICE_WEI, "A": "0", "R": PRICE_WEI, "H": "0", "S": "0",
        "liabilityWei": PRICE_WEI, "contractBalanceWei": PRICE_WEI,
        "totalFundedWei": TOTAL_FUNDED_WEI,
    }
    if any(accounting.get(key) != value for key, value in expected.items()):
        raise VoucherError("ISSUANCE_EVIDENCE_INVALID", 503)
    if not LABEL.fullmatch(str(config.get("partnerLabel", ""))) or not LABEL.fullmatch(str(config.get("recipientRef", ""))):
        raise VoucherError("ISSUANCE_EVIDENCE_INVALID", 503)
    return {
        "planHash": record["planHash"],
        "operationId": record["operationId"].lower(),
        "voucherId": record["voucherId"].lower(),
        "batchId": record["batchId"].lower(),
        "partnerLabel": config["partnerLabel"],
        "recipientRef": config["recipientRef"],
    }


class VoucherStore:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)
        self.path = self.directory / "voucher.sqlite3"
        self.anchor = self.directory.parent / (self.directory.name + ".anchor.json")
        self.lock_path = self.directory.parent / (self.directory.name + ".lock")

    @contextmanager
    def lock(self):
        parent = self.directory.parent
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if parent.is_symlink() or parent.stat().st_mode & 0o077:
            raise VoucherError("PRIVATE_DIRECTORY_INVALID", 503)
        fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    @contextmanager
    def connection(self, readonly=False):
        mode = "ro" if readonly else "rw"
        db = sqlite3.connect(f"file:{self.path}?mode={mode}", uri=True)
        try:
            yield db
            if not readonly: db.commit()
        except Exception:
            if not readonly: db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def anchor_value(binding: dict, generation: int, invite_digest: str | None, opened: bool) -> dict:
        return {"bindingHash": digest(canonical(binding)), "generation": generation,
                "inviteDigest": invite_digest, "opened": opened}

    def configured(self) -> bool:
        return self.path.exists() or self.anchor.exists()

    def initialize(self, binding: dict) -> dict:
        with self.lock():
            if self.configured() or self.directory.exists():
                state = self.load()
                if state["binding"] != binding: raise VoucherError("BINDING_CONFLICT", 409)
                return state
            self.directory.mkdir(mode=0o700)
            _atomic(self.anchor, self.anchor_value(binding, 0, None, False))
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600); os.close(fd)
            db = sqlite3.connect(self.path)
            try:
                db.execute("PRAGMA synchronous=FULL")
                db.executescript("""
                CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, generation INTEGER NOT NULL);
                CREATE TABLE invite(id INTEGER PRIMARY KEY CHECK(id=1), digest TEXT NOT NULL, version INTEGER NOT NULL,
                  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, first_opened_at INTEGER);
                CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, invite_version INTEGER NOT NULL, csrf_hash TEXT NOT NULL,
                  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE display(id INTEGER PRIMARY KEY CHECK(id=1), session_hash TEXT NOT NULL, nonce INTEGER NOT NULL,
                  token_hash TEXT NOT NULL, code_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
                """)
                db.execute("INSERT INTO state VALUES(1,?,0)", (canonical(binding),)); db.commit()
            finally: db.close()
            return {"binding": binding, "generation": 0, "invite": None}

    def load(self) -> dict:
        if not self.path.exists() or not self.anchor.exists(): raise VoucherError("RESTORE_QUARANTINE", 503)
        try:
            if self.directory.is_symlink() or self.directory.stat().st_mode & 0o077: raise ValueError()
            _private_regular(self.path)
            with self.connection(readonly=True) as db:
                db.row_factory = sqlite3.Row
                states = db.execute("SELECT * FROM state").fetchall()
                invites = db.execute("SELECT * FROM invite").fetchall()
            if len(states) != 1 or len(invites) > 1: raise ValueError()
            state = states[0]; binding = json.loads(state["binding"])
            invite = dict(invites[0]) if invites else None
            expected = self.anchor_value(binding, state["generation"], invite["digest"] if invite else None,
                                         bool(invite and invite["first_opened_at"] is not None))
            if _read_private_json(self.anchor) != expected: raise ValueError()
            return {"binding": binding, "generation": state["generation"], "invite": invite}
        except VoucherError: raise
        except Exception: raise VoucherError("RESTORE_QUARANTINE", 503) from None

    def replace_invite(self, *, invite_digest: str, now: int, expires_at: int) -> int:
        with self.connection() as db:
            db.row_factory = sqlite3.Row; db.execute("BEGIN IMMEDIATE")
            state = db.execute("SELECT * FROM state WHERE id=1").fetchone(); binding = json.loads(state["binding"])
            current = db.execute("SELECT * FROM invite WHERE id=1").fetchone()
            if current and current["first_opened_at"] is not None: raise VoucherError("INVITE_ALREADY_OPENED", 409)
            generation = state["generation"] + 1
            _atomic(self.anchor, self.anchor_value(binding, generation, invite_digest, False))
            db.execute("UPDATE state SET generation=? WHERE id=1", (generation,)); db.execute("DELETE FROM invite")
            db.execute("UPDATE sessions SET revoked=1"); db.execute("DELETE FROM display")
            db.execute("INSERT INTO invite VALUES(1,?,?,?,?,NULL)", (invite_digest, generation, now, expires_at))
            return generation

    def open_session(self, *, invite_digest: str, token_hash: str, csrf_hash: str, now: int, expires_at: int) -> dict:
        with self.connection() as db:
            db.row_factory = sqlite3.Row; db.execute("BEGIN IMMEDIATE")
            state = db.execute("SELECT * FROM state WHERE id=1").fetchone(); binding = json.loads(state["binding"])
            invite = db.execute("SELECT * FROM invite WHERE id=1").fetchone()
            if not invite or not hmac.compare_digest(invite["digest"], invite_digest): raise VoucherError("INVITE_REJECTED", 401)
            if invite["expires_at"] <= now: raise VoucherError("INVITE_EXPIRED", 401)
            if invite["first_opened_at"] is None:
                _atomic(self.anchor, self.anchor_value(binding, state["generation"], invite["digest"], True))
                db.execute("UPDATE invite SET first_opened_at=? WHERE id=1", (now,))
            db.execute("UPDATE sessions SET revoked=1"); db.execute("DELETE FROM display")
            db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,0)", (token_hash, invite["version"], csrf_hash, now, expires_at))
            return {"binding": binding, "invite": dict(invite)}

    def session(self, token_hash: str, now: int) -> dict:
        with self.connection(readonly=True) as db:
            db.row_factory = sqlite3.Row
            session = db.execute("SELECT * FROM sessions WHERE token_hash=?", (token_hash,)).fetchone()
            invite = db.execute("SELECT * FROM invite WHERE id=1").fetchone()
            state = db.execute("SELECT * FROM state WHERE id=1").fetchone()
        if not session or not invite or session["revoked"] or session["expires_at"] <= now or session["invite_version"] != invite["version"]:
            raise VoucherError("VOUCHER_SESSION_REQUIRED", 401)
        return {"session": dict(session), "invite": dict(invite), "binding": json.loads(state["binding"])}

    def revoke(self, token_hash: str) -> None:
        with self.connection() as db:
            db.execute("UPDATE sessions SET revoked=1 WHERE token_hash=?", (token_hash,))
            active = db.execute("SELECT session_hash FROM display WHERE id=1").fetchone()
            if active and hmac.compare_digest(active[0], token_hash): db.execute("DELETE FROM display")

    def replace_display(self, *, session_hash: str, token_hash: str, code_hash: str, now: int, expires_at: int) -> int:
        with self.connection() as db:
            db.row_factory = sqlite3.Row; db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT nonce FROM display WHERE id=1").fetchone(); nonce = (old["nonce"] if old else 0) + 1
            db.execute("DELETE FROM display")
            db.execute("INSERT INTO display VALUES(1,?,?,?,?,?,?)", (session_hash, nonce, token_hash, code_hash, now, expires_at))
            return nonce

    def display_matches(self, value: str, now: int) -> bool:
        with self.connection(readonly=True) as db:
            db.row_factory = sqlite3.Row; row = db.execute("SELECT * FROM display WHERE id=1").fetchone()
        if not row or row["expires_at"] <= now: return False
        value = value.strip()
        if value.startswith("mealforward:testnet:v1:"):
            raw = value.split(":", 3)[3]
            return bool(DISPLAY_SECRET.fullmatch(raw)) and hmac.compare_digest(row["token_hash"], digest(raw))
        return bool(re.fullmatch(r"[0-9]{6}", value)) and hmac.compare_digest(row["code_hash"], digest(value))


class VoucherService:
    def __init__(self, store: VoucherStore, issuance_directory: str | Path, *, clock=time.time, issuance_reader=read_cp22_issuance):
        self.store, self.issuance_directory, self.clock, self.issuance_reader = store, Path(issuance_directory), clock, issuance_reader

    def evidence(self) -> dict: return self.issuance_reader(self.issuance_directory)
    def now(self) -> int: return int(self.clock())

    def initialize(self) -> dict: return self.store.initialize(self.evidence())

    def state(self) -> dict:
        state = self.store.load(); current = self.evidence()
        if state["binding"] != current: raise VoucherError("ISSUANCE_BINDING_CONFLICT", 503)
        return state

    def partner_view(self, partner_id: str | None) -> dict:
        state = self.state(); binding, invite = state["binding"], state["invite"]
        if partner_id != binding["partnerLabel"]: raise VoucherError("TESTNET_SCOPE_DENIED", 403)
        status = "READY" if not invite else ("LINK_CREATED" if invite["first_opened_at"] is None else "OPENED")
        return {"chainId": CHAIN_ID, "testOnly": True, "distribution": "PRIVATE_LINK", "status": status,
                "voucherId": binding["voucherId"], "batchId": binding["batchId"], "operationId": binding["operationId"],
                "partnerLabel": binding["partnerLabel"], "recipientRef": binding["recipientRef"], "linkRecoverable": False,
                "invite": None if not invite else {"version": invite["version"], "createdAt": invite["created_at"],
                  "expiresAt": invite["expires_at"], "openedAt": invite["first_opened_at"]}}

    def create_invite(self, partner_id: str | None, origin: str, *, rotate=False, guard=None) -> dict:
        with self.store.lock():
            state = self.state(); binding, invite = state["binding"], state["invite"]
            if partner_id != binding["partnerLabel"]: raise VoucherError("TESTNET_SCOPE_DENIED", 403)
            if guard is not None and getattr(guard(), "partner_id", None) != partner_id: raise VoucherError("TESTNET_SCOPE_DENIED", 403)
            if invite and invite["first_opened_at"] is not None: raise VoucherError("INVITE_ALREADY_OPENED", 409)
            if invite and not rotate: raise VoucherError("INVITE_EXISTS", 409)
            secret = random_token(32)
            if not SECRET.fullmatch(secret): raise VoucherError("TOKEN_GENERATION_FAILED", 503)
            now = self.now(); expires = now + INVITE_TTL
            self.store.replace_invite(invite_digest=digest(secret), now=now, expires_at=expires)
            return {"url": origin.rstrip("/") + "/#/recipient/" + secret, "expiresAt": expires,
                    "replacesPrevious": bool(invite), "warning": "PRIVATE_BEARER_LINK"}

    @staticmethod
    def csrf(token: str) -> str: return hashlib.sha256(("mealforward-cp23-csrf:" + token).encode()).hexdigest()

    @staticmethod
    def recipient_payload(binding: dict, invite: dict, csrf: str, session_expires: int) -> dict:
        return {"voucher": {"chainId": CHAIN_ID, "testOnly": True, "state": "ISSUED", "mealLabel": "1份标准餐",
                "valueWei": PRICE_WEI, "voucherId": binding["voucherId"], "batchId": binding["batchId"],
                "operationId": binding["operationId"], "partnerLabel": binding["partnerLabel"],
                "inviteExpiresAt": invite["expires_at"], "sessionExpiresAt": session_expires}, "csrfToken": csrf}

    def exchange(self, secret: str) -> tuple[str, dict]:
        if not isinstance(secret, str) or not SECRET.fullmatch(secret): raise VoucherError("INVITE_REJECTED", 401)
        token = random_token(32); csrf = self.csrf(token); now = self.now(); expires = now + SESSION_TTL
        with self.store.lock():
            self.state()
            opened = self.store.open_session(invite_digest=digest(secret), token_hash=digest(token), csrf_hash=digest(csrf), now=now, expires_at=expires)
        return token, self.recipient_payload(opened["binding"], opened["invite"], csrf, expires)

    def session(self, token: str) -> dict:
        if not token or len(token) > 256: raise VoucherError("VOUCHER_SESSION_REQUIRED", 401)
        self.state(); row = self.store.session(digest(token), self.now()); csrf = self.csrf(token)
        if not hmac.compare_digest(row["session"]["csrf_hash"], digest(csrf)): raise VoucherError("RESTORE_QUARANTINE", 503)
        return self.recipient_payload(row["binding"], row["invite"], csrf, row["session"]["expires_at"])

    def create_display(self, token: str, csrf: str) -> dict:
        if not token or not csrf: raise VoucherError("VOUCHER_SESSION_REQUIRED", 401)
        now = self.now(); session_hash = digest(token)
        with self.store.lock():
            self.state(); row = self.store.session(session_hash, now)
            if not hmac.compare_digest(row["session"]["csrf_hash"], digest(csrf)): raise VoucherError("CSRF_DENIED", 403)
            display = random_token(24); code = f"{secrets.randbelow(1_000_000):06d}"
            if not DISPLAY_SECRET.fullmatch(display): raise VoucherError("TOKEN_GENERATION_FAILED", 503)
            expires = now + DISPLAY_TTL
            nonce = self.store.replace_display(session_hash=session_hash, token_hash=digest(display), code_hash=digest(code), now=now, expires_at=expires)
        return {"display": {"qrPayload": "mealforward:testnet:v1:" + display, "code": code, "expiresAt": expires, "nonce": nonce}}

    def logout(self, token: str, csrf: str) -> None:
        if not token or len(token) > 256 or not csrf:
            raise VoucherError("VOUCHER_SESSION_REQUIRED", 401)
        token_hash = digest(token)
        with self.store.lock():
            self.state()
            row = self.store.session(token_hash, self.now())
            if not hmac.compare_digest(row["session"]["csrf_hash"], digest(csrf)):
                raise VoucherError("CSRF_DENIED", 403)
            self.store.revoke(token_hash)
