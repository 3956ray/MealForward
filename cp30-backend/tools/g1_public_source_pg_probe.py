"""Execute candidate public-only CP30 source facade against a disposable PG17.

This is NOT an upgrade tool and cannot connect to the old Mac, a funded wallet,
Render Auth PG or a cloud database. The G2 CI runner owns one fresh ephemeral DB.
All registration, ledger, store, menu, voucher-looking rows and new role grants
are synthetic and rolled back. A client role is deliberately NOLOGIN.
"""
from copy import deepcopy
import json
import os
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT=Path(__file__).resolve().parents[1]
SCHEMA=ROOT/"g1-export/disposable-public-facade.sql"
DB="mf_g2_disposable_ci_20261017"
NS="g1_public_fixture"
STORE="a"*64
OLD="b"*64
NEW="c"*64
REGISTRATION="0x"+"9"*64
ESCROW="0x"+"3"*40
FACTORY="0x"+"f"*40
SUBJECT="d"*64
EVIDENCE={"source":"synthetic-confirmed"}
SENSITIVE=("private-voucher-should-never-export",
           "recipient@private.example",
           "a-private-CSRF-or-access-key")

def security_probe(db):
    if (os.environ.get("GITHUB_ACTIONS")!="true"
        or os.environ.get("MF_G2_DISPOSABLE_ONLY")!="ack-fresh-gha-postgres-17"
        or os.environ.get("PGHOST")!="127.0.0.1"
        or db.execute("SELECT current_database()").fetchone()[0]!=DB
        or db.execute("SELECT count(*) FROM c1_private.deployment").fetchone()[0]):
        raise ValueError("DISPOSABLE_PUBLIC_SOURCE_ONLY")

    result={}

    def as_reader(sql="SELECT c1_g1_export.public_snapshot()",params=None):
        state={}
        # Roll back the SET LOCAL ROLE at the same savepoint boundary, even on
        # error, rather than risking privileges leaking to the admin fixture.
        with db.transaction():
            db.execute("SET LOCAL ROLE c1_g1_export_client")
            try:
                state["value"]=db.execute(sql,params or ()).fetchone()
            except psycopg.Error as exc:
                state["sqlstate"]=exc.sqlstate
                state["error"]=exc.diag.message_primary
            raise psycopg.Rollback()
        return state

    def deny(label,sql=None,params=None,code="P0001"):
        value=as_reader(sql or "SELECT c1_g1_export.public_snapshot()",params)
        if value.get("sqlstate")!=code:
            raise AssertionError("EXPECTED_DENIAL_"+label+"_"+str(value.get("sqlstate")))
        return value.get("error")

    def temporary(sql,args,label,error):
        with db.transaction():
            db.execute(sql,args)
            observed=deny(label)
            if observed!=error:
                raise AssertionError("INCORRECT_G1_FAIL_CLOSED_"+label)
            raise psycopg.Rollback()

    with db.transaction():
        db.execute(SCHEMA.read_text(encoding="utf-8"))
        # Verify privilege isolation BEFORE writing any synthetic original row.
        for role in ("c1_g1_export_owner","c1_g1_export_client"):
            perms=db.execute("SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole "
                "FROM pg_roles WHERE rolname=%s",(role,)).fetchone()
            if perms!=(False,False,False,False):
                raise AssertionError("G1_ROLE_PRIVILEGED")
        member=db.execute(
            "SELECT count(*) FROM pg_auth_members WHERE member='c1_g1_export_client'::regrole"
        ).fetchone()[0]
        if member:
            raise AssertionError("READONLY_CLIENT_INHERITS_ROLE")
        for table in ("c1_live_private.stores","c1_live_private.catalog_versions",
                      "c1_private.sessions","c1_private.store_registrations",
                      "c1_private.confirmed_store_registrations",
                      "c1_live_private.claims","c1_live_private.intents",
                      "c1_runtime_private.state","c1_g1_export.binding"):
            if db.execute(
                "SELECT has_table_privilege('c1_g1_export_client',%s,'SELECT')",
                (table,)).fetchone()[0]:
                raise AssertionError("G1_EXPORT_DIRECT_TABLE_ACCESS")
        for function in ("c1_runtime_internal.live_api(text,jsonb)",
                         "c1_private.auth(text,jsonb,boolean)",
                         "c1_runtime_internal.ledger_reserve(text,jsonb)"):
            if db.execute("SELECT has_function_privilege('c1_g1_export_client',%s,'EXECUTE')",
                          (function,)).fetchone()[0]:
                raise AssertionError("G1_EXPORT_MIXED_FUNCTION_ACCESS")
        if not db.execute("SELECT has_function_privilege('c1_g1_export_client',"
               "'c1_g1_export.public_snapshot()','EXECUTE')").fetchone()[0]:
            raise AssertionError("G1_PUBLIC_FUNCTION_UNAVAILABLE")
        fn=db.execute("SELECT provolatile,prosecdef FROM pg_proc "
            "WHERE oid='c1_g1_export.public_snapshot()'::regprocedure").fetchone()
        if fn!=("s",True):
            raise AssertionError("G1_NOT_STABLE_SECURITY_DEFINER")

        db.execute("INSERT INTO c1_g1_export.binding(singleton,ns,enabled,max_age_seconds) "
                   "VALUES(true,%s,false,120)",(NS,))
        if deny("disabled")!="G1_SOURCE_NOT_AUTHORIZED":
            raise AssertionError("DISABLED_BINDING_NOT_FENCED")

        now=db.execute("SELECT extract(epoch FROM statement_timestamp())::bigint").fetchone()[0]
        db.execute("INSERT INTO c1_private.deployment "
          "(ns,manifest,now,clock_floor,heartbeat,halt) "
          "VALUES (%s,'{}'::jsonb,%s,%s,%s,false)",(NS,now,now,now))
        db.execute("INSERT INTO c1_private.transaction_guard(ns) VALUES (%s)",(NS,))
        db.execute("INSERT INTO c1_runtime_private.state("
          "ns,revision,head,material_hash,source_epoch,credential_epoch,"
          "restore_generation,journal_sequence,journal_digest) "
          "VALUES(%s,0,%s,%s,1,1,1,1,%s)",
          (NS,"1"*64,"2"*64,"3"*64))
        db.execute("INSERT INTO c1_private.identities(ns,subject,revision,auth_kind,recipient_key)"
          " VALUES(%s,%s,1,'wallet',%s)",(NS,SUBJECT,bytes.fromhex("ab"*32)))
        reg={"verifiedEvidence":EVIDENCE,"escrow":ESCROW,"private":SENSITIVE[1]}
        db.execute("INSERT INTO c1_private.store_registrations("
          "ns,subject,id,store_id,chain_id,factory,idem,request_digest,state,record)"
          " VALUES(%s,%s,%s,%s,'10143',%s,'fixture-store','fixture-digest','CONFIRMED',%s)",
          (NS,SUBJECT,REGISTRATION,"0x"+STORE,FACTORY,Jsonb(reg)))
        db.execute("INSERT INTO c1_private.confirmed_store_registrations("
          "ns,store,id,escrow,evidence,catalog) VALUES(%s,%s,%s,%s,%s,%s)",
          (NS,"0x"+STORE,REGISTRATION,ESCROW,Jsonb(EVIDENCE),
           Jsonb([{"terms":{"mealId":"0x"+OLD}}])))
        profile={
          "request":{"name":"Community Kitchen","email":SENSITIVE[1]},
          "binding":{"chainId":10143,"escrow":ESCROW,"owner":"0x"+"7"*40},
          "registrationEvidence":EVIDENCE,
          "firstMeal":{"name":"Rice bowl","description":"A warm meal",
              "version":"1","unitPrice":"7000000","windows":[[690,810]],
              "privateCode":SENSITIVE[0]},
        }
        menu={
          "0x"+OLD:{"listed":True,"currentVersion":"1","terms":{"unitPrice":"7000000"}},
          "0x"+NEW:{"listed":True,"currentVersion":"2","terms":{"unitPrice":"500000"}},
        }
        units=[
          {"bucket":"A","price":"7000000","meal_id":"0x"+OLD,"version":"1",
           "voucher_id":SENSITIVE[0]},
          {"bucket":"R","price":"7000000","meal_id":"0x"+OLD,"version":"1",
           "email":SENSITIVE[1]},
          {"bucket":"A","price":"500000","meal_id":"0x"+NEW,"version":"2",
           "display_secret":SENSITIVE[2]},
        ]
        totals={"F":"14500000","A":"7500000","R":"7000000","H":"0","S":"0","X":"0",
            "counts":{"F":"3","A":"2","R":"1","H":"0","S":"0","X":"0"}}
        snapshot={"timestamp":str(now),"menu":menu}
        rows={"units":units,"accounting":{"totals":totals},"private":{"recipient":SENSITIVE[1]}}
        db.execute("INSERT INTO c1_live_private.stores("
          "ns,store,registration_id,meal,profile,snapshot,rows)"
          " VALUES(%s,%s,%s,%s,%s,%s,%s)",
          (NS,STORE,REGISTRATION,OLD,Jsonb(profile),Jsonb(snapshot),Jsonb(rows)))
        newbody={"name":"Tofu bowl","description":"Another warm meal",
                 "windows":[[690,810]],"recipientEmail":SENSITIVE[1]}
        term={"unitPrice":"500000","mealId":"0x"+NEW,"version":"2"}
        db.execute("INSERT INTO c1_live_private.catalog_versions("
          "ns,store,meal,version,draft_id,draft_revision,body,image,image_digest,"
          "terms,terms_hash,needs_listing,target_listed,publish_intent,state)"
          " VALUES(%s,%s,%s,'2',%s,1,%s,%s,%s,%s,%s,true,true,%s,'LIVE')",
          (NS,STORE,NEW,'11111111-1111-4111-8111-111111111111',
           Jsonb(newbody),b'SYNTHETIC','c'*64,Jsonb(term),'0x'+'c'*64,
           '22222222-2222-4222-8222-222222222222'))

        db.execute("UPDATE c1_g1_export.binding SET enabled=true")
        original=as_reader()
        if original.get("sqlstate") or original.get("value") is None:
            raise AssertionError("G1_READER_DENIED_VALID_SOURCE_"+str(original.get("error")))
        projection=original["value"][0]
        if projection["mode"]!="G1_PUBLIC_SOURCE_PROJECTION_ONLY":
            raise AssertionError("WRONG_READ_SOURCE")
        if projection["businessTransactionsAllowed"] is not False:
            raise AssertionError("FUND_OPERATIONS_EXPOSED")
        assert projection["stores"]["items"]==[
            {"id":STORE,"store":STORE,"name":"Community Kitchen","escrow":ESCROW}]
        ledger=projection["ledger"]["items"][0]
        assert ledger["funded"]=="3"
        assert ledger["financial"]["F"]=="14500000"
        assert ledger["financial"]["counts"]["R"]=="1"
        byid={meal["id"]:meal for meal in projection["meals"]["items"]}
        assert set(byid)=={OLD,NEW}
        assert byid[OLD]["name"]=="Rice bowl" and byid[OLD]["unitPrice"]=="7000000"
        assert byid[OLD]["financial"]["counts"]["R"]=="1"
        assert byid[NEW]["name"]=="Tofu bowl" and byid[NEW]["version"]=="2"
        assert byid[NEW]["unitPrice"]=="500000" and byid[NEW]["eligible"]=="1"
        assert byid[NEW]["windows"]==[[690,810]]
        if any(x in json.dumps(projection,ensure_ascii=False) for x in SENSITIVE):
            raise AssertionError("PRIVATE_SOURCE_FIELDS_EXPORTED")

        for label,stmt in (
           ("private_session","SELECT * FROM c1_private.sessions"),
           ("original_orders","SELECT * FROM c1_live_private.intents"),
           ("private_voucher","SELECT * FROM c1_live_private.claims"),
           ("profile","SELECT * FROM c1_live_private.stores"),
           ("binding","SELECT * FROM c1_g1_export.binding"),
           ("write","UPDATE c1_g1_export.binding SET enabled=false"),
           ("mixed_api","SELECT c1_runtime_internal.live_api('inert','{}'::jsonb)"),
        ):
           if not as_reader(stmt).get("sqlstate")=="42501":
              raise AssertionError("G1_READER_PERMISSION_ESCALATION_"+label)

        temporary("UPDATE c1_runtime_private.state SET pending=%s,pending_xid=123,"
                  "pending_sequence=2,pending_digest=%s WHERE ns=%s",
                  ("33333333-3333-4333-8333-333333333333","4"*64,NS),
                  "pending","G1_SOURCE_NOT_READY")
        temporary("UPDATE c1_private.transaction_guard SET execution_pending='synthetic' WHERE ns=%s",
                  (NS,),"execution","G1_SOURCE_NOT_READY")
        temporary("UPDATE c1_private.deployment SET halt=true WHERE ns=%s",(NS,),
                  "halted","G1_SOURCE_NOT_READY")
        temporary("UPDATE c1_private.deployment SET now=now-10000 WHERE ns=%s",(NS,),
                  "staleclock","G1_SOURCE_NOT_READY")
        temporary("UPDATE c1_private.store_registrations SET state='DRAFT' WHERE ns=%s",
                  (NS,),"unconfirmed","G1_UNVERIFIED_REGISTRATION")
        temporary("UPDATE c1_live_private.catalog_versions SET state='PUBLISHED' WHERE ns=%s",
                  (NS,),"pendingversion","G1_CATALOG_VERSION_NOT_FINAL")
        corrupted=deepcopy(rows)
        corrupted["accounting"]["totals"]["A"]="7500001"
        temporary("UPDATE c1_live_private.stores SET rows=%s WHERE ns=%s",
                  (Jsonb(corrupted),NS),"badamount","G1_LEDGER_ACCOUNTING_MISMATCH")
        bad=deepcopy(profile);bad["firstMeal"]["windows"]=[[800,700]]
        temporary("UPDATE c1_live_private.stores SET profile=%s WHERE ns=%s",
                  (Jsonb(bad),NS),"invalidwindow","G1_INVALID_SERVICE_WINDOW")
        temporary("UPDATE c1_g1_export.binding SET enabled=false",
                  (),"disabledagain","G1_SOURCE_NOT_AUTHORIZED")

        result={
            "publicExportFacade":"PASS",
            "sourceRoleNoLogin":True,
            "mixedReadWriteDispatcherExecute":False,
            "clientDirectPrivateTableSelect":False,
            "syntheticStores":1,
            "syntheticMealVersions":2,
            "bucketConservation":"PASS",
            "privateDataRedaction":"PASS",
            "stalePendingAndUnverifiedSourceRejections":"PASS",
            "originalRuntimeTouched":False,
            "syntheticRowsCommitted":False,
        }
        raise psycopg.Rollback()

    if db.execute("SELECT count(*) FROM c1_private.deployment").fetchone()[0]!=0:
        raise AssertionError("G1_PUBLIC_SYNTHETIC_SOURCE_PERSISTED")
    if db.execute("SELECT to_regprocedure('c1_g1_export.public_snapshot()')").fetchone()[0] is not None:
        raise AssertionError("G1_PUBLIC_FACADE_SHOULD_BE_DISPOSABLE")
    return result
