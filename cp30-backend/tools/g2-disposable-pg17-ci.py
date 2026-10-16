#!/usr/bin/env python3
"""Apply untouched CP30 SQL 001-045 to ONE disposable PostgreSQL 17 CI database.

NO original CP30 runtime, signer journal, wallet, webhook, RPC or Render database
is opened. Caller must provide CI-only explicit opt-in and an unmodified fresh
postgres:17.11 service on localhost. This creates a throwaway database and
removes it after success or failure. Never use this on a user database.
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
DATABASE = "mf_g2_disposable_ci_20261017"
ALLOWED_PINS = {
    "migrations/019-private-original-ledger.sql":
        "63d49ac17054446e51c7474db2c45f54bd20a7fe4d4adcc4658b92554cd3331c",
    "connection-migrations/043-live-catalog-execution.sql":
        "c79e1e5d7b5c7164486f44069afa4229645d005538ae2de8bb06faf5cd4a6c4b",
    "connection-migrations/044-live-multi-meal.sql":
        "cf82137dd1ca66c4a850912d9bea0f5bf42986fbab728eaff7ce6541a423b8bf",
}
ADDITIONAL_LOGINS = (
    "c1_app_api_login", "c1_identity_security_login",
    "c1_identity_authority_login", "c1_registration_worker_login",
    "c1_auto_binding_login", "c1_business_quote_login",
    "c1_business_issuer_login", "c1_business_operator_login",
    "c1_live_gateway_login", "c1_live_observer_login",
)


def fail(reason):
    raise ValueError(reason)


def require_disposable_server():
    if os.environ.get("GITHUB_ACTIONS") != "true":
        fail("GITHUB_ACTIONS_REQUIRED")
    if os.environ.get("MF_G2_DISPOSABLE_ONLY") != "ack-fresh-gha-postgres-17":
        fail("EXPLICIT_EPHEMERAL_PG_APPROVAL_REQUIRED")
    if os.environ.get("PGHOST") != "127.0.0.1":
        fail("LOOPBACK_PG_ONLY")
    if os.environ.get("PGPORT") != "5432":
        fail("FIXED_EPHEMERAL_PORT_REQUIRED")
    if os.environ.get("PGUSER") != "postgres":
        fail("FRESH_PG_SUPERUSER_REQUIRED")
    if os.environ.get("PGDATABASE") != "postgres":
        fail("FRESH_DEFAULT_DB_REQUIRED")
    if not os.environ.get("PGPASSWORD"):
        fail("EPHEMERAL_TEST_PASSWORD_REQUIRED")


def pin_and_order():
    for path, expected in ALLOWED_PINS.items():
        if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected:
            fail("MIGRATION_SOURCE_PIN_MISMATCH_" + Path(path).name)
    sql_paths = [
        *sorted((ROOT / "migrations").glob("[0-9]*.sql")),
        *sorted((ROOT / "connection-migrations").glob("[0-9]*.sql")),
    ]
    expected = [
        *(f"{n:03d}" for n in range(1, 20)),
        *(f"{n:03d}" for n in range(21, 46)),
    ]
    actual = [path.name[:3] for path in sql_paths]
    if actual != expected:
        fail("UNEXPECTED_SQL_MIGRATION_SET")
    if len(sql_paths) != 44 or sql_paths[-1].name != "045-live-runtime-hotfix-parity.sql":
        fail("G2_HOTFIX_PARITY_MISSING")
    return sql_paths


def bootstrap_roles():
    # Use the source-owned role declarations without importing the local
    # Mac-specific bootstrap (which can also start the dangerous runtime).
    source = (ROOT / "tools" / "connection-bootstrap.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in (
                    "BASE_OWNERS", "RUNTIME_GROUPS", "COMPAT_GROUPS", "LOGINS"
                ):
                    constants[target.id] = ast.literal_eval(node.value)
    if set(constants) != {"BASE_OWNERS", "RUNTIME_GROUPS", "COMPAT_GROUPS", "LOGINS"}:
        fail("BOOTSTRAP_ROLE_SOURCE_CHANGED")
    owner_groups = (*constants["BASE_OWNERS"], *constants["RUNTIME_GROUPS"],
                    *constants["COMPAT_GROUPS"], "c1_connection_bootstrap")
    login_roles = (*constants["LOGINS"], *ADDITIONAL_LOGINS)
    names = (*owner_groups, *login_roles)
    if len(names) != len(set(names)) or any(
        not re.fullmatch(r"c1_[a-z][a-z0-9_]{2,63}", x) for x in names
    ):
        fail("ROLE_SET_NOT_FRESH")
    return owner_groups, login_roles


def verify_source_schema(connection):
    row = connection.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'c1_live_private'"
    ).fetchone()
    if row[0] < 5:
        fail("EXPECTED_LIVE_TABLES_MISSING")
    state_rows = connection.execute("SELECT count(*) FROM c1_runtime_private.state").fetchone()[0]
    if state_rows:
        fail("MIGRATION_UNEXPECTEDLY_CREATED_RUNTIME_CHECKPOINT")
    functions = (
        "c1_runtime_internal.ledger_reserve(text,jsonb)",
        "c1_runtime_internal.live_api(text,jsonb)",
        "c1_runtime_internal.first_binding_material(text,jsonb)",
    )
    for fn in functions:
        if connection.execute("SELECT to_regprocedure(%s)", (fn,)).fetchone()[0] is None:
            fail("MISSING_REVIEWED_FUNCTION")
    if not connection.execute(
        "SELECT has_function_privilege('c1_auto_binding', "
        "'c1_runtime_internal.first_binding_material(text,jsonb)', 'EXECUTE')"
    ).fetchone()[0]:
        fail("G2_CATALOG_BINDING_GRANT_MISSING")
    if connection.execute(
        "SELECT count(*) FROM pg_roles WHERE rolname IN ("
        "'c1_live_code_owner','c1_runtime_policy_owner','c1_auto_binding') "
        "AND (rolsuper OR rolcanlogin OR rolbypassrls)"
    ).fetchone()[0]:
        fail("PRIVILEGED_RUNTIME_ROLE")
    fn_source = connection.execute(
        "SELECT prosrc FROM pg_proc "
        "WHERE oid='c1_runtime_internal.ledger_reserve(text,jsonb)'::regprocedure"
    ).fetchone()[0]
    if "catalogAuthority" not in fn_source or "ORIGINAL_NONCE_ALREADY_RESERVED" not in fn_source:
        fail("CATALOG_NONCE_GUARDS_NOT_APPLIED")
    api_source = connection.execute(
        "SELECT prosrc FROM pg_proc "
        "WHERE oid='c1_runtime_internal.live_api(text,jsonb)'::regprocedure"
    ).fetchone()[0]
    if "signed_quote IS NULL" not in api_source or "CAPACITY" not in api_source:
        fail("EXPIRED_QUOTE_CAPACITY_HOTFIX_MISSING")
    return {"stateRows": 0, "reviewedFunctions": len(functions),
            "catalogRoleExecute": True, "sqlSourcePins": len(ALLOWED_PINS)}


def run():
    require_disposable_server()
    paths = pin_and_order()
    owner_groups, login_roles = bootstrap_roles()
    # Only one fresh Postgres service from GHA. Absence of c1_* roles and
    # schemas is required BEFORE making any change.
    ctl = psycopg.connect(autocommit=True, connect_timeout=5)
    created = False
    try:
        version = int(ctl.execute("SHOW server_version_num").fetchone()[0])
        if not 170000 <= version < 180000:
            fail("POSTGRES_17_REQUIRED")
        if ctl.execute("SELECT pg_is_in_recovery()").fetchone()[0]:
            fail("PRIMARY_POSTGRES_REQUIRED")
        if ctl.execute(
            "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'c1_%'"
        ).fetchone()[0]:
            fail("NOT_AN_EMPTY_POSTGRES_CLUSTER")
        if ctl.execute(
            "SELECT count(*) FROM pg_database WHERE datname = %s", (DATABASE,)
        ).fetchone()[0]:
            fail("G2_TEST_DB_ALREADY_EXISTS")
        for owner in owner_groups:
            ctl.execute(
                sql.SQL("CREATE ROLE {} NOLOGIN NOSUPERUSER NOCREATEDB "
                        "NOCREATEROLE NOREPLICATION NOBYPASSRLS").format(
                    sql.Identifier(owner))
            )
        for login in login_roles:
            ctl.execute(
                sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB "
                        "NOCREATEROLE NOREPLICATION NOBYPASSRLS").format(
                    sql.Identifier(login))
            )
        ctl.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(DATABASE), sql.Identifier("c1_table_owner"))
        )
        created = True
        ctl.execute(
            sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(
                sql.Identifier(DATABASE))
        )
        with psycopg.connect(dbname=DATABASE, autocommit=False, connect_timeout=5) as db:
            db.execute(
                sql.SQL("GRANT CREATE ON DATABASE {} TO {}").format(
                    sql.Identifier(DATABASE), sql.Identifier("c1_runtime_table_owner"))
            )
            for path in paths:
                # All DDL is original checked-in source; none is generated or
                # rewritten. Error will roll back this disposable database.
                try:
                    db.execute(path.read_text(encoding="utf-8"))
                except psycopg.Error as exc:
                    error = ValueError("MIGRATION_FAILED_" + path.name)
                    error.sqlstate = exc.sqlstate
                    raise error from None
            result = verify_source_schema(db)
            db.commit()
        print(json.dumps({
            "status": "G2_FRESH_PG17_MIGRATIONS_PASS",
            "pgMajor": 17,
            "sqlFilesApplied": len(paths),
            "sourcePinned": True,
            "roleGroupsCreated": len(owner_groups) + len(login_roles),
            "originalMacOrRenderDbTouched": False,
            "sourceDbInitializedOrSignerStarted": False,
            **result,
        }, sort_keys=True))
    finally:
        try:
            if created:
                ctl.execute(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname=%s AND pid<>pg_backend_pid()", (DATABASE,))
                ctl.execute(
                    sql.SQL("DROP DATABASE {}").format(sql.Identifier(DATABASE)))
        finally:
            ctl.close()


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        print(json.dumps({
            "status": "G2_FRESH_PG17_MIGRATIONS_BLOCKED",
            "reason": str(exc)[:100] if isinstance(exc, ValueError) else type(exc).__name__,
            "sqlstate": getattr(exc, "sqlstate", None),
            "originalRuntimeTouched": False,
        }), file=sys.stderr)
        sys.exit(1)
