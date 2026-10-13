"""Owned forward wallet-login extension; never initializes or resets a run.

Root is the sole real operator. Main owns migration/loader DTOs and shares the
WALLET-FORWARD.lock with start/stop. This tool exposes only fixed safe errors and
public SHA/status; passwords, config contents, keys and journal contents stay
internal. No applications/PG are stopped, started or adopted by this tool.
"""

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import secrets
import time
import uuid
import struct
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
_spec = importlib.util.spec_from_file_location("wallet_extension_setup", ROOT / "tools/connection-bootstrap.py")
setup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(setup)
PROTOCOL = "CP30_WALLET_LOGIN_EXTENSION_V1"
MIGRATION = "connection-migrations/026-wallet-principal.sql"
MIGRATION_SHA256 = "2636058c20a4515b58562e3cbc58e7820006dbf9ddefc0e0e4edb9081669677e"
SOURCE_PATHS = (
    "src/c1/wallet_identity.py", "src/c1/identity_runtime.py", "src/c1/identity_adapter.py",
    "src/c1/identity_security_controller.py", "src/c1/controller.py", "src/c1/db.py",
    "src/c1/application.py", "integrations/identity/wallet_login.py",
    "integrations/identity/wallet-login-codec.mjs",
)
CRYPTO_PINS = {
    "integrations/identity/wallet_login.py": "3636092d4951b3f1f6f50659c36ad43f4faf4793cc72db5300a2af583bc92ec6",
    "integrations/identity/wallet-login-codec.mjs": "254d99a5d97c8178de0d882f920e73374cbacba229abbb5aed5f338cca7cd1e3",
}
APPROVED_SOURCE_PINS = {
    "src/c1/wallet_identity.py": "f1f3131ff0c964c4e82a14e4e58abd888d5c5b65237fd1e7a1720e6827128c59",
    "src/c1/identity_runtime.py": "e28976623094121e8b994196d828b795d0dfd22abdf52b9f180b4d2105bc4af6",
    "src/c1/identity_adapter.py": "89ef7dc3b472f08792d49aca5ffb20f4d51a0d54d19c67724fac85f6198362f2",
    "src/c1/identity_security_controller.py": "bccb44fb366cf37ea44f3dd9f0fecb98b66b35d136a9d44dd5f8988b7834ba9a",
    "src/c1/controller.py": "2c313988147d73edfd42c6cfdaef11afb95cdc9980dfb335ea30f04b248fc54f",
    "src/c1/db.py": "94682e7027d2783adc2649838177bf53c7762a158a5eead12025950b872501f5",
    "src/c1/application.py": "d97093cb83fa72bd9e01095ad0df5849e4859ae8de211cd3299032d9d7b3d8a7",
    **CRYPTO_PINS,
}
CONFIG_KEYS = {"protocol", "installId", "namespace", "origin", "port", "chainId",
               "challengeTtlSeconds", "sessionTtlSeconds", "principalHmacKey", "activationExpiresAt"}


class ExtensionClosed(ValueError):
    def __init__(self):
        super().__init__("WALLET_EXTENSION_CLOSED")


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ExtensionClosed()
        result[key] = value
    return result


def _private_bytes(path, limit=262144, *, allowed_links=1):
    """Read approved owned private file; never expose bytes in CLI diagnostics."""
    path = Path(path)
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
            or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != allowed_links or before.st_size > limit):
        raise ExtensionClosed()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as reader:
        actual = os.fstat(reader.fileno())
        if (actual.st_dev, actual.st_ino, actual.st_size, actual.st_mtime_ns,
                actual.st_mode, actual.st_uid, actual.st_nlink) != (
                before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                before.st_mode, before.st_uid, before.st_nlink):
            raise ExtensionClosed()
        value = reader.read(limit + 1)
        if len(value) > limit or os.fstat(reader.fileno()).st_mtime_ns != before.st_mtime_ns:
            raise ExtensionClosed()
        return value


def _private_json(path):
    value = json.loads(_private_bytes(path).decode("utf-8"), object_pairs_hook=_pairs)
    if type(value) is not dict:
        raise ExtensionClosed()
    return value


def _origin(origin, port):
    if type(port) is not int or port != 16443 or type(origin) is not str:
        raise ExtensionClosed()
    if not re.fullmatch(r"https://(?:localhost|127\.0\.0\.1):16443", origin):
        raise ExtensionClosed()
    return origin


def _assert_equal(before, after):
    if _canonical(before) != _canonical(after):
        raise ExtensionClosed()


@contextmanager
def _owned_lock(run):
    """Same persistent lock inode used by Main bootstrap.start/stop; never unlink."""
    fd = os.open(run / "WALLET-FORWARD.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise ExtensionClosed()
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def _stopped(run, marker):
    """Call only while shared start/stop lock is held; no kill/adopt action."""
    for path in sorted(run.glob("HOSTS-*.json")):
        hosts = _private_json(path)
        if hosts.get("id") != marker["id"] or type(hosts.get("processes")) is not list:
            raise ExtensionClosed()
        for entry in hosts["processes"]:
            if type(entry) is not dict or type(entry.get("pid")) is not int or not 0 < entry["pid"] < 2**31:
                raise ExtensionClosed()
            probe = subprocess.run(["/bin/ps", "-p", str(entry["pid"]), "-o", "lstart="],
                                   env={}, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2, check=False)
            # Even a reused PID closes this bounded installer; it is never adopted.
            if probe.stdout.strip() or probe.returncode not in (0, 1):
                raise ExtensionClosed()


def _tables(conn):
    rows = conn.execute("SELECT n.nspname,c.relname FROM pg_catalog.pg_class c "
                        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
                        "WHERE n.nspname IN ('c1_private','c1_live_private','c1_runtime_private') "
                        "AND c.relkind IN ('r','p') ORDER BY n.nspname,c.relname").fetchall()
    if not rows or {row[0] for row in rows} != {"c1_private", "c1_live_private", "c1_runtime_private"}:
        raise ExtensionClosed()
    return tuple(rows)


def _lock_tables(conn, tables):
    from psycopg import sql
    for schema, table in tables:
        conn.execute(sql.SQL("LOCK TABLE {}.{} IN ACCESS EXCLUSIVE MODE").format(
            sql.Identifier(schema), sql.Identifier(table)))


def _no_pending(conn):
    pending = conn.execute("SELECT EXISTS(SELECT 1 FROM c1_private.transaction_guard "
                           "WHERE security_pending IS NOT NULL OR execution_pending IS NOT NULL) "
                           "OR EXISTS(SELECT 1 FROM c1_runtime_private.state WHERE pending IS NOT NULL) "
                           "OR EXISTS(SELECT 1 FROM c1_runtime_private.checkpoints WHERE NOT finished)").fetchone()[0]
    if pending is not False:
        raise ExtensionClosed()


def _fresh_business(conn, tables):
    """First DDL only. Later disable retains all identity/business records."""
    from psycopg import sql
    required = {("c1_private", name) for name in ("identities", "stores", "store_registrations")}
    if not required.issubset(set(tables)):
        raise ExtensionClosed()
    checked = required | {name for name in tables
                          if name[0] == "c1_live_private" and name[1] != "binding_templates"}
    for schema, table in sorted(checked):
        if conn.execute(sql.SQL("SELECT EXISTS(SELECT 1 FROM {}.{})").format(
                sql.Identifier(schema), sql.Identifier(table))).fetchone()[0] is not False:
            raise ExtensionClosed()


def _db_snapshot(conn, tables):
    """Hash complete original rows/material/floors; no private contents returned.

    Compare the same original table list after DDL. The sole mutable installation
    marker is excluded on subsequent enabled-flag operations; wallet records and
    every other table remain in the snapshot. All namespaces/global floors count.
    """
    from psycopg import sql
    result = {"tables": {}, "runtime": {}}
    for schema, table in tables:
        if (schema, table) == ("c1_private", "wallet_login_installation"):
            continue
        count, digest = conn.execute(sql.SQL(
            "SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) "
            "ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM {}.{} t"
        ).format(sql.Identifier(schema), sql.Identifier(table))).fetchone()
        result["tables"][schema + "." + table] = {"count": count, "sha256": digest}
    for namespace, material, floors in conn.execute(
            "SELECT ns,encode(sha256(convert_to(c1_runtime_private.material(ns)::text,'UTF8')),'hex'),"
            "encode(sha256(convert_to(c1_runtime_private.floors(ns)::text,'UTF8')),'hex') "
            "FROM c1_private.deployment ORDER BY ns").fetchall():
        result["runtime"][namespace] = {"materialSha256": material, "floorsSha256": floors}
    result["globalFloorsSha256"] = conn.execute(
        "SELECT encode(sha256(convert_to(c1_runtime_private.global_floors()::text,'UTF8')),'hex')"
    ).fetchone()[0]
    return result


def _parse_security(raw, run_id, cluster_id):
    """Pure replay using only Journal._apply, never its constructor or fd methods."""
    from c1.journal import Journal, MAX_FRAME
    state = SimpleNamespace(records=[], floors={}, pending={}, epochs={}, restores={})
    offset, sequence, digest = 0, 0, "0" * 64
    while offset < len(raw):
        if offset + 4 > len(raw):
            raise ExtensionClosed()
        size = struct.unpack("!I", raw[offset:offset + 4])[0]
        if not 2 <= size <= MAX_FRAME or offset + 4 + size + 32 > len(raw):
            raise ExtensionClosed()
        body = raw[offset + 4:offset + 4 + size]
        checksum = raw[offset + 4 + size:offset + 4 + size + 32]
        record = json.loads(body, object_pairs_hook=_pairs)
        if (_sha(body) != checksum.hex() or _canonical(record) != body or type(record) is not dict
                or set(record) != {"run_id", "cluster_id", "sequence", "previous_digest", "event", "namespace", "data"}
                or record["run_id"] != run_id or record["cluster_id"] != cluster_id
                or type(record["sequence"]) is not int or record["sequence"] != sequence + 1
                or record["previous_digest"] != digest or type(record["event"]) is not str
                or type(record["namespace"]) is not str or type(record["data"]) is not dict):
            raise ExtensionClosed()
        record["digest"] = checksum.hex()
        Journal._apply(state, record)
        state.records.append(record)
        sequence, digest = record["sequence"], record["digest"]
        offset += 4 + size + 32
    if not sequence or state.pending or state.restores:
        raise ExtensionClosed()
    return {"sequence": sequence, "digest": digest, "floors": state.floors,
            "epochs": state.epochs, "namespaces": sorted({record["namespace"] for record in state.records if record["namespace"]})}


def _parse_runtime(raw, namespace):
    """Pure RuntimeLedgerJournal._apply on data carrier; no writer is constructed."""
    from c1.runtime_ledger_controller import RuntimeLedgerJournal
    state = SimpleNamespace(namespace=namespace, sequence=0, head="0" * 64,
                            checkpoint=None, pending=None, terminal=None)
    if not raw or len(raw) > 16777216:
        raise ExtensionClosed()
    for line in raw.splitlines(keepends=True):
        if not line.endswith(b"\n") or len(line) > 1048576:
            raise ExtensionClosed()
        row = json.loads(line, object_pairs_hook=_pairs)
        if type(row) is not dict or set(row) != {"sequence", "parent", "namespace", "kind", "data", "digest"}:
            raise ExtensionClosed()
        payload = {key: row[key] for key in ("sequence", "parent", "namespace", "kind", "data")}
        if (type(row["sequence"]) is not int or row["sequence"] != state.sequence + 1
                or row["parent"] != state.head or row["namespace"] != namespace
                or type(row["kind"]) is not str or type(row["data"]) is not dict
                or row["digest"] != _sha(_canonical(payload)) or _canonical(row) + b"\n" != line):
            raise ExtensionClosed()
        RuntimeLedgerJournal._apply(state, row)
        state.sequence, state.head = row["sequence"], row["digest"]
    if state.checkpoint is None:
        raise ExtensionClosed()
    return state


def _match_runtime(state, status, global_floors, ack):
    if (state.pending is not None or status.get("configured") is not True
            or status.get("materialMatches") is not True or status.get("pending") is not None):
        raise ExtensionClosed()
    for field in ("ledgerRevision", "ledgerHead", "materialHash", "epochs", "floors", "journalSequence", "journalDigest"):
        _assert_equal(state.checkpoint[field], status.get(field))
    _assert_equal(status.get("globalFloors"), global_floors)
    if state.terminal is not None:
        terminal = state.terminal
        mutation = terminal["ticket"]["mutation"]
        if (type(ack) is not dict or ack.get("finished") is not True
                or ack.get("prepared_sequence") != mutation["sequence"]
                or ack.get("prepared_digest") != mutation["digest"]):
            raise ExtensionClosed()
        _assert_equal(ack.get("ticket"), terminal["ticket"])
        _assert_equal(ack.get("proof"), terminal["proof"])


def _check_security_floors(conn, namespace, floors, credential_epoch, restore_generation):
    # Keys are retained server subject hashes / UUID challenge IDs, never wallet
    # addresses or client-selected table names. Every query is a static SELECT.
    lookups = {
        "identity": "SELECT revision FROM c1_private.identities WHERE ns=%s AND subject=%s",
        "session": "SELECT revision FROM c1_private.sessions WHERE ns=%s AND hash=decode(%s,'hex')",
        "access": "SELECT access_epoch FROM c1_private.vouchers WHERE ns=%s AND id=%s",
        "display": "SELECT display_epoch FROM c1_private.vouchers WHERE ns=%s AND id=%s",
        "payer": "SELECT revision FROM c1_private.payer_bindings WHERE ns=%s AND subject=%s",
        "owner": "SELECT revision FROM c1_private.verified_owner_bindings WHERE ns=%s AND subject=%s",
        "wallet_challenge": "SELECT revision FROM c1_private.wallet_login_challenges WHERE ns=%s AND id=%s::uuid",
        "grant": "SELECT max(revision) FROM c1_private.grants WHERE ns=%s AND subject=split_part(%s,':',1) AND store=split_part(%s,':',2)",
    }
    for domain, objects in floors.items():
        for key, floor in objects.items():
            if type(floor) is not int or floor < 0:
                raise ExtensionClosed()
            if domain == "credential":
                actual = credential_epoch
            elif domain == "restore":
                actual = restore_generation
            elif domain in lookups:
                parameters = (namespace, key, key) if domain == "grant" else (namespace, key)
                found = conn.execute(lookups[domain], parameters).fetchone()
                actual = found[0] if found else None
            else:
                raise ExtensionClosed()
            if domain in {"credential", "restore"}:
                _assert_equal(actual, floor)
            elif type(actual) is not int or actual < floor:
                # Existing security_startup objects are monotone lower bounds.
                # Login may bump a prior session without rewriting its old floor.
                raise ExtensionClosed()


def _journals_guard(conn, run, marker, ctx):
    """Existing bytes + SELECT only; never begin/abort/finish/ack/append/seed."""
    security = _private_json(run / "security.json")
    if (security.get("namespace") != ctx["namespace"] or security.get("run_id") != marker["id"]
            or security.get("journal_path") != str(run / "security/security.journal")):
        raise ExtensionClosed()
    parsed = _parse_security(_private_bytes(run / "security/security.journal", 16777216),
                             security["run_id"], security["cluster_id"])
    # Original full-app has one identity/security namespace. Unknown namespace
    # journals are never adopted; the controller roster must cover every runtime.
    deployments = conn.execute("SELECT ns,source_epoch,credential_epoch,restore_generation,halt "
                               "FROM c1_private.deployment ORDER BY ns").fetchall()
    if {row[0] for row in deployments} != {ctx["namespace"]} or not set(parsed["namespaces"]).issubset({ctx["namespace"]}):
        raise ExtensionClosed()
    namespace, source_epoch, credential_epoch, restore_generation, halted = deployments[0]
    anchor = conn.execute("SELECT sequence,digest FROM c1_private.journal_anchors WHERE ns=%s", (namespace,)).fetchone()
    if halted is not False or anchor != (parsed["sequence"], parsed["digest"]):
        raise ExtensionClosed()
    epochs = parsed["epochs"].get(namespace, {})
    if not epochs:
        if (source_epoch, credential_epoch, restore_generation) != (1, 1, 1):
            raise ExtensionClosed()
    else:
        for name, actual in (("source_epoch", source_epoch), ("credential_epoch", credential_epoch),
                             ("restore_generation", restore_generation)):
            _assert_equal(epochs.get(name), actual)
    _check_security_floors(conn, namespace, parsed["floors"].get(namespace, {}),
                           credential_epoch, restore_generation)
    controller = _private_json(run / "controller.json")
    roster = controller.get("journals")
    runtime_names = {row[0] for row in conn.execute("SELECT ns FROM c1_runtime_private.state").fetchall()}
    if type(roster) is not dict or set(roster) != runtime_names:
        raise ExtensionClosed()
    states, union = {}, {}
    for namespace, directory in roster.items():
        directory = setup.owned_directory(Path(directory))
        if directory.resolve() != directory or run not in directory.parents:
            raise ExtensionClosed()
        state = _parse_runtime(_private_bytes(directory / "runtime-ledger.jsonl", 16777216), namespace)
        states[namespace] = state
        for values in (state.checkpoint["globalFloors"]["runtime_nonce"], state.checkpoint["floors"]["runtime_nonce"]):
            for key, revision in values.items():
                union[key] = max(union.get(key, 0), revision)
    for namespace, state in states.items():
        status = conn.execute("SELECT c1_runtime_internal.ledger_status(%s,'{}'::jsonb)", (namespace,)).fetchone()[0]
        ack = None
        if state.terminal is not None:
            mutation = state.terminal["ticket"]["mutation"]["id"]
            ack = conn.execute("SELECT to_jsonb(c) FROM c1_runtime_private.checkpoints c "
                               "WHERE ns=%s AND mutation=%s", (namespace, mutation)).fetchone()
            ack = ack[0] if ack else None
        _match_runtime(state, status, {"runtime_nonce": union}, ack)
    return {"securitySha256": _sha(_canonical(parsed)),
            "runtimeSha256": _sha(_canonical({name: state.checkpoint for name, state in states.items()}))}


def _source_pins():
    from c1.wallet_identity import SOURCE_PIN_PATHS
    if set(SOURCE_PIN_PATHS) != set(SOURCE_PATHS) or not re.fullmatch(r"[0-9a-f]{64}", str(MIGRATION_SHA256)):
        raise ExtensionClosed()
    migration = (ROOT / MIGRATION).read_bytes()
    if _sha(migration) != MIGRATION_SHA256:
        raise ExtensionClosed()
    pins = {name: _sha((ROOT / name).read_bytes()) for name in SOURCE_PATHS}
    if pins != APPROVED_SOURCE_PINS:
        raise ExtensionClosed()
    return pins, migration


def _context(run, marker):
    installed = _private_json(run / "INSTALLED.json")
    if installed.get("id") != marker["id"] or type(installed.get("configs")) is not dict:
        raise ExtensionClosed()
    for name, digest in installed["configs"].items():
        if (type(name) is not str or Path(name).name != name or not name.endswith(".json")
                or not re.fullmatch(r"[0-9a-f]{64}", str(digest))
                or _sha(_private_bytes(run / name)) != digest):
            raise ExtensionClosed()
    for name, digest in installed.get("sqlPins", {}).items():
        if (type(name) is not str or not re.fullmatch(r"(?:connection-migrations|migrations)/[0-9]+-[a-z0-9-]+\.sql", name)
                or name == MIGRATION or _sha((ROOT / name).read_bytes()) != digest):
            raise ExtensionClosed()
    if not installed.get("sqlPins") or Path(sys.executable).resolve() != Path(installed["pythonExecutable"]).resolve():
        raise ExtensionClosed()
    application = _private_json(run / "application.json")
    identity = _private_json(run / "identity.json")
    registrar = _private_json(run / "registrar.json")
    namespace = application.get("namespace")
    expiry = identity.get("activation", {}).get("expiresAt")
    if (type(namespace) is not str or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", namespace)
            or identity.get("namespace") != namespace or registrar.get("namespace") != namespace
            or identity.get("origin") != application.get("origin")
            or type(expiry) is not int or expiry <= 0
            or application.get("connection", {}).get("activation", {}).get("expiresAt") != expiry
            or application.get("connection", {}).get("profile", {}).get("chainId") != "10143"
            or registrar.get("profile", {}).get("chainId") != "10143"):
        raise ExtensionClosed()
    origin = _origin(application.get("origin"), application.get("httpPort"))
    pg_marker = _private_json(run / "PG-OWNED.json")
    pid_lines = _private_bytes(run / "pg/postmaster.pid", 4096).decode("ascii").splitlines()
    if (pg_marker.get("id") != marker["id"] or type(pg_marker.get("pid")) is not int
            or pg_marker["pid"] != installed.get("pgPid") or len(pid_lines) < 8
            or pid_lines[0] != str(pg_marker["pid"]) or pid_lines[1] != str(run / "pg")
            or pid_lines[3] != "5432" or pid_lines[4] != str(run / "socket")
            or pid_lines[5] != "" or pid_lines[7].strip() != "ready"):
        raise ExtensionClosed()
    source_pins, migration = _source_pins()
    return {"installed": installed, "namespace": namespace, "origin": origin,
            "expiry": expiry, "sourcePins": source_pins, "migration": migration}


def _file_snapshot(run, installed):
    files = {name: _sha(_private_bytes(run / name)) for name in
             ("INSTALLED.json", "CONNECTION-OWNED.json", "PG-OWNED.json", *installed["configs"])}
    # Read only journal bytes for SHA preservation, not their credentials/payloads.
    for name in ("security", "ledger", "registrar", "tls", "quoteAuthority", "issuerAuthority", "operatorAuthority"):
        directory = setup.owned_directory(run / name)
        for path in sorted(directory.iterdir()):
            if path.suffix in {".jsonl", ".journal"}:
                files[str(path.relative_to(run))] = _sha(_private_bytes(path, 16777216))
            elif path.suffix == ".key":
                info = path.lstat()
                if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                        or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
                    raise ExtensionClosed()
                # Key bytes are never opened/read. Preserve inode/mode/size/mtime.
                files[str(path.relative_to(run))] = _sha(_canonical([
                    info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_nlink, info.st_size, info.st_mtime_ns]))
    for name in ("security/security.journal", "ledger/runtime-ledger.jsonl", "registrar/registrar-originals.jsonl"):
        if name not in files:
            raise ExtensionClosed()
    return files


def _connect(run):
    import psycopg
    password = _private_bytes(run / "bootstrap-password", 128).decode("ascii").strip()
    if not re.fullmatch(r"[0-9a-f]{64}", password):
        raise ExtensionClosed()
    conn = psycopg.connect(host=str(run / "socket"), port=5432, dbname="c1_connection",
                           user="c1_connection_bootstrap", password=password,
                           connect_timeout=2, sslmode="disable", autocommit=True)
    row = conn.execute("SELECT current_user,current_database(),current_setting('server_version_num'),"
                       "current_setting('data_directory'),current_setting('listen_addresses'),"
                       "current_setting('unix_socket_directories'),inet_server_addr(),"
                       "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())").fetchone()
    if row != ("c1_connection_bootstrap", "c1_connection", "170011", str(run / "pg"), "", str(run / "socket"), None, "c1_table_owner"):
        conn.close()
        raise ExtensionClosed()
    return conn


def _validate_config(config, ctx):
    try:
        canonical_id = type(config.get("installId")) is str and str(uuid.UUID(config["installId"])) == config["installId"]
    except Exception:
        raise ExtensionClosed() from None
    if (set(config) != CONFIG_KEYS or config.get("protocol") != PROTOCOL
            or config.get("namespace") != ctx["namespace"] or config.get("origin") != ctx["origin"]
            or type(config.get("port")) is not int or config["port"] != 16443
            or type(config.get("chainId")) is not int or config["chainId"] != 10143
            or type(config.get("challengeTtlSeconds")) is not int or config["challengeTtlSeconds"] != 180
            or type(config.get("sessionTtlSeconds")) is not int or config["sessionTtlSeconds"] != 3600
            or type(config.get("activationExpiresAt")) is not int or config["activationExpiresAt"] != ctx["expiry"]
            or type(config.get("principalHmacKey")) is not str
            or not re.fullmatch(r"[0-9a-f]{64}", config["principalHmacKey"])
            or not canonical_id):
        raise ExtensionClosed()


def _manifest(marker, ctx, config, raw):
    return {"protocol": PROTOCOL, "runId": marker["id"], "installId": config["installId"],
            "namespace": ctx["namespace"], "configSha256": _sha(raw),
            "originalConfigs": ctx["installed"]["configs"], "migrationSha256": MIGRATION_SHA256,
            "sourcePins": ctx["sourcePins"]}


def _row(conn, namespace):
    exists = conn.execute("SELECT to_regclass('c1_private.wallet_login_installation') IS NOT NULL").fetchone()[0]
    if not exists:
        # An incomplete unrelated schema may not be adopted as an installation.
        if conn.execute("SELECT to_regclass('c1_private.wallet_login_challenges') IS NOT NULL "
                        "OR to_regclass('c1_private.wallet_principals') IS NOT NULL").fetchone()[0]:
            raise ExtensionClosed()
        return None
    rows = conn.execute("SELECT ns,install_id::text,config_digest,origin,chain_id,enabled,activation_expires_at "
                        "FROM c1_private.wallet_login_installation").fetchall()
    if len(rows) != 1 or rows[0][0] != namespace:
        raise ExtensionClosed()
    return rows[0]


def _match_row(row, config, manifest):
    if row is None or row[:5] != (config["namespace"], config["installId"], manifest["configSha256"], config["origin"], 10143) or row[6] != config["activationExpiresAt"] or type(row[5]) is not bool:
        raise ExtensionClosed()


def _transaction(conn):
    conn.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
    conn.execute("SET LOCAL statement_timeout='5s'")
    conn.execute("SET LOCAL lock_timeout='1s'")
    conn.execute("SET LOCAL idle_in_transaction_session_timeout='15s'")


def _result(config, manifest, row, *, complete):
    enabled = row[5] is True and int(time.time()) < config["activationExpiresAt"]
    return {"status": "WALLET_EXTENSION_INSTALLED" if complete else "WALLET_EXTENSION_FINALIZATION_REQUIRED",
            "enabled": enabled if complete else False, "configSha256": manifest["configSha256"],
            "migrationSha256": manifest["migrationSha256"], "sourcePinsSha256": _sha(_canonical(manifest["sourcePins"]))}


def _recover_table_list(tables, preparation):
    names = preparation.get("originalDatabase", {}).get("tables")
    if type(names) is not dict or not names:
        raise ExtensionClosed()
    original = []
    for name in names:
        if type(name) is not str or not re.fullmatch(r"(?:c1_private|c1_live_private|c1_runtime_private)\.[a-z0-9_]+", name):
            raise ExtensionClosed()
        original.append(tuple(name.split(".")))
    if not set(original).issubset(set(tables)):
        raise ExtensionClosed()
    # Exactly the three newly created wallet tables may be outside the original
    # snapshot during committed-DDL/manifest recovery, never another schema change.
    additions = set(tables) - set(original)
    if additions != {("c1_private", name) for name in
                     ("wallet_login_installation", "wallet_login_challenges", "wallet_principals")}:
        raise ExtensionClosed()
    return tuple(sorted(original))


def _publish_manifest(path, value):
    """Publish immutable manifest without a partial target or overwrite.

    Staged public metadata is not an original journal/config. Exact-prefix partial
    staging can be completed after the DB original marker has been matched; the
    final path is linked only after complete fsync. Recovery removes only this new
    staging link, never the final marker or any original state.
    """
    staged = path.with_name(path.name + ".STAGED")
    expected = _canonical(value) + b"\n"
    if path.exists():
        info = path.lstat()
        if staged.exists():
            other = staged.lstat()
            if ((info.st_dev, info.st_ino) != (other.st_dev, other.st_ino)
                    or info.st_nlink != 2 or info.st_uid != os.getuid()
                    or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600):
                raise ExtensionClosed()
            # Both names are the same fully fsynced immutable staged object.
            if _private_bytes(path, allowed_links=2) != expected:
                raise ExtensionClosed()
            staged.unlink()
        if _private_bytes(path) != expected:
            raise ExtensionClosed()
    else:
        if staged.exists():
            raw = _private_bytes(staged)
            if raw != expected:
                if not expected.startswith(raw):
                    raise ExtensionClosed()
                staged.unlink()  # only incomplete new public metadata; no key
                setup.write(staged, value)
        else:
            setup.write(staged, value)
        os.link(staged, path, follow_symlinks=False)
        staged.unlink()
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_CLOEXEC)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def run_action(action, directory):
    if action not in {"enable", "disable", "status"}:
        raise ExtensionClosed()
    run, marker = setup.marker(directory)
    if run.resolve() != run:
        raise ExtensionClosed()
    with _owned_lock(run):
        ctx = _context(run, marker)
        _stopped(run, marker)
        config_path = run / "wallet-login.json"
        installed_path = run / "WALLET-LOGIN-INSTALLED.json"
        staged_path = installed_path.with_name(installed_path.name + ".STAGED")
        prepared_path = run / "WALLET-LOGIN-PREPARED.json"
        files_before = _file_snapshot(run, ctx["installed"])
        with _connect(run) as conn:
            # Read-only preflight, outside the one DDL transaction. No repeated DDL
            # after an uncertain commit: only the original marker may resolve it.
            with conn.transaction():
                conn.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY")
                _no_pending(conn)
                journals_before = _journals_guard(conn, run, marker, ctx)
                tables = _tables(conn)
                row = _row(conn, ctx["namespace"])
                if row is not None and (not installed_path.exists() or staged_path.exists()):
                    if not prepared_path.exists():
                        raise ExtensionClosed()
                    tables = _recover_table_list(tables, _private_json(prepared_path))
                before = _db_snapshot(conn, tables)
                if row is None:
                    _fresh_business(conn, tables)
            if not config_path.exists():
                if row is not None or installed_path.exists() or prepared_path.exists() or action == "disable":
                    raise ExtensionClosed()
                if action == "status":
                    return {"status": "WALLET_EXTENSION_NOT_INSTALLED", "enabled": False}
                if int(time.time()) >= ctx["expiry"]:
                    raise ExtensionClosed()
                config = {"protocol": PROTOCOL, "installId": str(uuid.uuid4()), "namespace": ctx["namespace"],
                          "origin": ctx["origin"], "port": 16443, "chainId": 10143,
                          "challengeTtlSeconds": 180, "sessionTtlSeconds": 3600,
                          "activationExpiresAt": ctx["expiry"], "principalHmacKey": secrets.token_hex(32)}
                setup.write(config_path, config)
            config = _private_json(config_path)
            _validate_config(config, ctx)
            manifest = _manifest(marker, ctx, config, _private_bytes(config_path))
            complete = installed_path.exists() and not staged_path.exists()
            if installed_path.exists():
                if staged_path.exists():
                    one, two = installed_path.lstat(), staged_path.lstat()
                    if (one.st_dev, one.st_ino) != (two.st_dev, two.st_ino):
                        raise ExtensionClosed()
                    if _private_bytes(installed_path, allowed_links=2) != _canonical(manifest) + b"\n":
                        raise ExtensionClosed()
                else:
                    _assert_equal(_private_json(installed_path), manifest)
                if row is None:
                    raise ExtensionClosed()
            if prepared_path.exists():
                preparation = _private_json(prepared_path)
                if (set(preparation) != {"protocol", "manifest", "originalFiles", "originalDatabase"}
                        or preparation["protocol"] != "CP30_WALLET_LOGIN_PREPARATION_V1"):
                    raise ExtensionClosed()
                _assert_equal(preparation["manifest"], manifest)
            else:
                if row is not None or complete:
                    raise ExtensionClosed()
                if action == "status":
                    return {"status": "WALLET_EXTENSION_PREPARATION_REQUIRED", "enabled": False}
                preparation = {"protocol": "CP30_WALLET_LOGIN_PREPARATION_V1", "manifest": manifest,
                               "originalFiles": files_before, "originalDatabase": before}
                setup.write(prepared_path, preparation)
            if row is not None:
                _match_row(row, config, manifest)
            if not complete:
                # Original preflight proof survives the commit -> manifest-write
                # window. Any protected change closes recovery; no new key/nonce.
                _assert_equal(preparation["originalFiles"], files_before)
                _assert_equal(preparation["originalDatabase"], before)
            if action == "status":
                if row is None:
                    return {"status": "WALLET_EXTENSION_PREPARED", "enabled": False,
                            "configSha256": manifest["configSha256"]}
                return _result(config, manifest, row, complete=complete)
            if action == "disable" and (row is None or not complete):
                raise ExtensionClosed()
            desired = action == "enable"
            if desired and int(time.time()) >= config["activationExpiresAt"]:
                raise ExtensionClosed()
            with conn.transaction():
                _transaction(conn)
                current_tables = _tables(conn)
                _lock_tables(conn, current_tables)
                _no_pending(conn)
                _assert_equal(journals_before, _journals_guard(conn, run, marker, ctx))
                current = _row(conn, ctx["namespace"])
                # First DDL uses the original table list. A marker appearing since
                # preflight is a concurrency conflict, never a second migration.
                if (current is None) != (row is None):
                    raise ExtensionClosed()
                _assert_equal(before, _db_snapshot(conn, tables))
                if current is None:
                    _fresh_business(conn, current_tables)
                    conn.execute(ctx["migration"].decode("utf-8"), prepare=False)
                    if conn.execute("SELECT current_user").fetchone()[0] != "c1_connection_bootstrap":
                        raise ExtensionClosed()
                    conn.execute("INSERT INTO c1_private.wallet_login_installation "
                                 "(ns,install_id,config_digest,origin,chain_id,enabled,activation_expires_at) "
                                 "VALUES(%s,%s,%s,%s,10143,true,%s)",
                                 (config["namespace"], config["installId"], manifest["configSha256"],
                                  config["origin"], config["activationExpiresAt"]))
                else:
                    _match_row(current, config, manifest)
                    if current[5] != row[5]:
                        raise ExtensionClosed()
                    if current[5] is not desired:
                        changed = conn.execute("UPDATE c1_private.wallet_login_installation SET enabled=%s "
                                               "WHERE ns=%s AND install_id=%s AND config_digest=%s AND enabled=%s",
                                               (desired, config["namespace"], config["installId"],
                                                manifest["configSha256"], current[5])).rowcount
                        if changed != 1:
                            raise ExtensionClosed()
                final_row = _row(conn, ctx["namespace"])
                _match_row(final_row, config, manifest)
                if final_row[5] is not desired:
                    raise ExtensionClosed()
                _assert_equal(before, _db_snapshot(conn, tables))
                _assert_equal(journals_before, _journals_guard(conn, run, marker, ctx))
                _assert_equal(files_before, _file_snapshot(run, ctx["installed"]))
                _assert_equal(ctx["sourcePins"], _source_pins()[0])
                _stopped(run, marker)
                if desired and int(time.time()) >= config["activationExpiresAt"]:
                    raise ExtensionClosed()
            # This is deliberately after commit, O_EXCL only. On uncertain write
            # repeat the same enable; marker+prepared pins forbid DDL/key replay.
            if not complete:
                _publish_manifest(installed_path, manifest)
            return _result(config, manifest, final_row, complete=True)


def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode or os.environ:
        raise SystemExit("WALLET_EXTENSION_ISOLATED_ENV_REQUIRED")
    parser = argparse.ArgumentParser(description="Owned wallet-login extension; no run initialization")
    parser.add_argument("action", choices=("enable", "disable", "status"))
    parser.add_argument("run")
    args = parser.parse_args()
    try:
        result = run_action(args.action, args.run)
    except Exception:
        raise SystemExit("WALLET_EXTENSION_CLOSED") from None
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
