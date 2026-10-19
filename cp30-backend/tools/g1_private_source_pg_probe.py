"""CP31 G1-B proof: ORIGINAL CP30 wallet A/B -> strict private GET source DTOs.

Real PostgreSQL 17.11, 44 unchanged CP30 migrations, *synthetic rolled-back*
wallets, original-session digests, fund/issue intents and two original-format
vouchers. No Render Auth Pilot session accepted as original principal; no
Mac PG, funded 7 USDC, signer, Journal, RPC, or public server involved.
"""
import json
import os
import time
import uuid
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
DDL = ROOT / "g1-export" / "disposable-private-read-facade.sql"
NS = "g1_private_source_fixture"
STORE = "f" * 64
MEAL = "e" * 64
A, B = "a" * 64, "b" * 64
TOKENS = (("1" * 64), ("2" * 64))
CSRF = (("3" * 64), ("4" * 64))
KEYS = (bytes.fromhex("aa" * 32), bytes.fromhex("bb" * 32))
VOUCHERS = ("0x" + "a" * 64, "0x" + "b" * 64)


def prove_private_wallet_ab(db):
    if (os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("MF_G2_DISPOSABLE_ONLY") != "ack-fresh-gha-postgres-17"
        or os.environ.get("PGHOST") != "127.0.0.1"
        or db.execute("SELECT current_database()").fetchone()[0] != "mf_g2_disposable_ci_20261017"):
        raise ValueError("ORIGINAL_CP30_DISPOSABLE_G1_B_ONLY")
    if db.execute("SELECT count(*) FROM c1_private.deployment").fetchone()[0]:
        raise ValueError("G1_B_REQUIRES_FRESH_SOURCE")

    def as_client(section, token):
        observed = {}
        with db.transaction():
            db.execute("SET LOCAL ROLE c1_g1_private_read_client")
            try:
                observed["body"] = db.execute(
                    "SELECT c1_g1_private_read.my_items(%s,%s)",
                    (section, token),
                ).fetchone()[0]
            except psycopg.Error as e:
                observed["sqlstate"] = e.sqlstate
                observed["reason"] = e.diag.message_primary
            raise psycopg.Rollback()
        return observed

    def denied(section, token, error):
        x = as_client(section, token)
        if x.get("reason") != error:
            raise AssertionError(
                "WRONG_G1_B_DENIAL_" + str(x.get("reason")) + "_EXPECTED_" + error
            )

    def temporary_deny(sql, params, expected):
        with db.transaction():
            db.execute(sql, params)
            denied("orders", TOKENS[0], expected)
            raise psycopg.Rollback()

    now = int(time.time())
    result = {}

    with db.transaction():
        # Source-only candidate DDL including two NOLOGIN roles. Must remain
        # transactional and vanish alongside all synthetic rows.
        db.execute(DDL.read_text(encoding="utf-8"))

        for role in ("c1_g1_private_read_owner", "c1_g1_private_read_client"):
            no_login = db.execute(
                "SELECT NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole "
                "AND NOT rolbypassrls FROM pg_roles WHERE rolname=%s", (role,)
            ).fetchone()[0]
            if no_login is not True:
                raise AssertionError("CLOUD_READER_ROLE_UNSAFE_" + role)

        for table in (
            "c1_private.sessions", "c1_private.wallet_principals",
            "c1_private.identities", "c1_live_private.intents",
            "c1_live_private.claims", "c1_runtime_private.state",
            "c1_g1_private_read.binding",
        ):
            if db.execute(
                "SELECT has_table_privilege('c1_g1_private_read_client',%s,'SELECT')",
                (table,),
            ).fetchone()[0]:
                raise AssertionError("PRIVATE_CLIENT_DIRECT_TABLE_READ_" + table)
        for fn in (
            "c1_private.auth(text,jsonb,boolean)",
            "c1_runtime_internal.live_api(text,jsonb)",
        ):
            if db.execute(
                "SELECT has_function_privilege('c1_g1_private_read_client',%s,'EXECUTE')",
                (fn,),
            ).fetchone()[0]:
                raise AssertionError("PRIVATE_CLIENT_UNSAFE_EXECUTE_" + fn)

        if db.execute(
            "SELECT has_function_privilege('c1_g1_private_read_client',"
            "'c1_g1_private_read.my_items(text,text)','EXECUTE')"
        ).fetchone()[0] is not True:
            raise AssertionError("PRIVATE_CLIENT_FUNCTION_MISSING")
        if db.execute(
            "SELECT count(*) FROM pg_auth_members "
            "WHERE member='c1_g1_private_read_client'::regrole"
        ).fetchone()[0]:
            raise AssertionError("PRIVATE_CLIENT_ROLE_MEMBERSHIP_UNEXPECTED")
        func = db.execute(
            "SELECT provolatile,prosecdef FROM pg_proc "
            "WHERE oid='c1_g1_private_read.my_items(text,text)'::regprocedure"
        ).fetchone()
        if func != ("s", True):
            raise AssertionError("PRIVATE_READ_NOT_STABLE_DEFENDER")

        denied("orders", TOKENS[0], "G1_PRIVATE_SOURCE_NOT_AUTHORIZED")
        db.execute(
            "INSERT INTO c1_g1_private_read.binding(singleton,ns,enabled,max_age_seconds) "
            "VALUES(true,%s,true,120)", (NS,)
        )
        db.execute(
            "INSERT INTO c1_private.deployment (ns,manifest,now,clock_floor,heartbeat,halt) "
            "VALUES (%s,'{}'::jsonb,%s,%s,%s,false)", (NS, now, now, now)
        )
        db.execute("INSERT INTO c1_private.transaction_guard(ns) VALUES(%s)", (NS,))
        db.execute(
            "INSERT INTO c1_runtime_private.state("
            "ns,revision,head,material_hash,source_epoch,credential_epoch,"
            "restore_generation,journal_sequence,journal_digest) "
            "VALUES (%s,0,%s,%s,1,1,1,1,%s)",
            (NS, "1" * 64, "2" * 64, "3" * 64),
        )
        for i, (subject, token, csrf, key) in enumerate(
            zip((A, B), TOKENS, CSRF, KEYS)
        ):
            db.execute(
                "INSERT INTO c1_private.identities"
                "(ns,subject,revision,auth_kind,recipient_key) "
                "VALUES (%s,%s,1,'wallet',%s)", (NS, subject, key)
            )
            db.execute(
                "INSERT INTO c1_private.sessions"
                "(ns,hash,csrf,subject,identity_revision,epoch,created,activity,authenticated)"
                "VALUES (%s,%s,%s,%s,1,1,%s,%s,%s)",
                (NS, bytes.fromhex(token), bytes.fromhex(csrf),
                 subject, now-20, now-10, now-10)
            )
            db.execute(
                "INSERT INTO c1_private.wallet_principals"
                "(ns,subject,wallet_address,chain_id,recipient_key,"
                "identity_revision,expires_at,evidence_digest)"
                "VALUES (%s,%s,%s,10143,%s,1,%s,%s)",
                (NS, subject, "0x" + ("a" if i == 0 else "b") * 40,
                 key, now + 3600, bytes.fromhex(("ca" if i == 0 else "cb") * 32))
            )
            db.execute(
                "INSERT INTO c1_private.external_session_expiry"
                "(ns,hash,expires_at) VALUES (%s,%s,%s)",
                (NS, bytes.fromhex(token), now + 3600)
            )

        profile = {"firstMeal": {
            "name": "Warm meal", "description": "Synthetic original CP30 fixture",
            "version": "1", "unitPrice": "7000000",
            "windows": [[600, 900]]
        }, "binding": {"chainId": 10143, "escrow": "0x" + "3"*40}}
        units = [
            {"voucher_id": v, "bucket": "R", "price": "7000000",
             "meal_id": "0x"+MEAL, "version": "1", "generation": "1"}
            for v in VOUCHERS
        ]
        rows = {
            "units": units, "vouchers": [
                {"id": v, "expires_at": str(now+1800)} for v in VOUCHERS
            ],
            "accounting": {"totals": {
                "F":"14000000", "A":"0", "R":"14000000",
                "H":"0", "S":"0", "X":"0", "liability":"14000000",
                "counts": {"F":"2","A":"0","R":"2","H":"0","S":"0","X":"0"}
            }}
        }
        db.execute(
            "INSERT INTO c1_live_private.stores "
            "(ns,store,meal,profile,snapshot,rows) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (NS,STORE,MEAL,Jsonb(profile),Jsonb({"timestamp":str(now),"menu":{}}),Jsonb(rows))
        )
        intent_ids = []
        for i, (subject, token, csrf, recipient) in enumerate(
            zip((A,B), TOKENS, CSRF, KEYS)
        ):
            for kind in ("fund", "issue"):
                uid = str(uuid.uuid5(uuid.NAMESPACE_URL,"mf-g1-b-fixture-"+subject+"-"+kind))
                intent_ids.append(uid)
                params = ({"quantity":"2","amount":"14000000"}
                          if kind=="fund" else {"voucherId":VOUCHERS[i]})
                db.execute(
                    "INSERT INTO c1_live_private.intents("
                    "ns,id,subject,recipient_key,store,action,idem,client,parameters,"
                    "session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) "
                    "VALUES (%s,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,1,%s,'FINAL_SUCCEEDED')",
                    (NS,uid,subject,recipient,STORE,kind,
                     "only-"+kind+"-"+subject[:8],Jsonb({}),Jsonb(params),
                     token,csrf,str(uuid.uuid5(uuid.NAMESPACE_URL,uid)))
                )
                if kind=="issue":
                    db.execute(
                        "INSERT INTO c1_live_private.claims("
                        "ns,id,intent,store,subject,recipient_key,seq,generation)"
                        "VALUES (%s,%s,%s::uuid,%s,%s,%s,%s,'1')",
                        (NS,VOUCHERS[i],uid,STORE,subject,recipient,str(i))
                    )

        # Genuine CP30 original authenticator + independently privileged
        # private-source function, under the client NOLOGIN role.
        records = {}
        for side, token, own, other in [
            ("a",TOKENS[0],VOUCHERS[0],VOUCHERS[1]),
            ("b",TOKENS[1],VOUCHERS[1],VOUCHERS[0]),
        ]:
            records[side] = {}
            for section, expected_action in [
                ("orders","fund"), ("claims","issue"), ("vouchers",None)
            ]:
                value = as_client(section, token)
                if "body" not in value:
                    raise AssertionError("G1_B_SOURCE_READ_FAILED_"+str(value))
                items = value["body"]["items"]
                if len(items) != 1:
                    raise AssertionError("G1_B_CROSS_WALLET_LEAK_"+side+"_"+section)
                if expected_action and items[0]["action"] != expected_action:
                    raise AssertionError("G1_B_WRONG_ACTION")
                if section=="vouchers":
                    if items[0]["voucherId"] != own or other in json.dumps(items):
                        raise AssertionError("G1_B_FOREIGN_VOUCHER_LEAK")
                    if items[0]["state"]!="R" or items[0]["terms"]["name"]!="Warm meal":
                        raise AssertionError("G1_B_WRONG_ORIGINAL_VOUCHER_DTO")
                records[side][section]=items[0].get("id")

        if records["a"] == records["b"]:
            raise AssertionError("G1_B_A_B_NOT_SEPARATED")
        for unsafe in ("my_orders", "", "vouchers;DELETE FROM c1_private.sessions"):
            denied(unsafe,TOKENS[0],"G1_PRIVATE_REQUEST_NOT_ALLOWED")
        denied("orders","5"*64,"UNAUTHENTICATED")
        denied("orders",TOKENS[0][:16],"G1_PRIVATE_REQUEST_NOT_ALLOWED")

        temporary_deny(
            "UPDATE c1_private.sessions SET revoked=true WHERE ns=%s AND subject=%s",
            (NS,A),"UNAUTHENTICATED")
        temporary_deny(
            "UPDATE c1_private.wallet_principals SET recipient_key=%s "
            "WHERE ns=%s AND subject=%s",
            (bytes.fromhex("cc"*32),NS,A),"UNAUTHENTICATED")
        temporary_deny(
            "UPDATE c1_private.transaction_guard SET execution_pending=%s WHERE ns=%s",
            ("synthetic",NS),"G1_PRIVATE_SOURCE_NOT_READY")
        temporary_deny(
            "UPDATE c1_private.deployment SET halt=true WHERE ns=%s",
            (NS,),"G1_PRIVATE_SOURCE_NOT_READY")
        temporary_deny(
            "UPDATE c1_live_private.stores SET snapshot=%s WHERE ns=%s",
            (Jsonb({"timestamp": str(now-10000), "menu": {}}),NS),
            "G1_PRIVATE_SOURCE_NOT_READY")
        temporary_deny(
            "UPDATE c1_private.deployment SET now=now-10000 WHERE ns=%s",
            (NS,),"G1_PRIVATE_SOURCE_NOT_READY")
        temporary_deny(
            "UPDATE c1_g1_private_read.binding SET enabled=false WHERE ns=%s",
            (NS,),"G1_PRIVATE_SOURCE_NOT_AUTHORIZED")

        result = {
            "originalCp30WalletScope": True,
            "distinctWallets": 2,
            "scopedOriginalOrders": True,
            "scopedOriginalClaimIntents": True,
            "scopedOriginalVouchers": True,
            "unknownOrRevokedSessionRejected": True,
            "requestHasNoWalletOrRecipientOverride": True,
            "noDirectPrivateTableSelect": True,
            "noMixedLiveApiExecute": True,
            "sourcePendingAndHaltFailClosed": True,
            "sourceRoleLoginAllowed": False,
            "syntheticRowsPersisted": False,
        }
        raise psycopg.Rollback()

    if db.execute("SELECT count(*) FROM c1_private.deployment").fetchone()[0]:
        raise AssertionError("G1_B_SOURCE_FIXTURE_PERSISTED")
    if db.execute(
        "SELECT to_regprocedure('c1_g1_private_read.my_items(text,text)')"
    ).fetchone()[0] is not None:
        raise AssertionError("G1_B_FUNCTION_SHOULD_BE_EPHEMERAL")
    return result
