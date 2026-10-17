"""G1 wallet-A/B *source authenticator* on disposable original CP30 PostgreSQL 17.

Never invoke old CP30 controller, SQL live_api write methods, signer, RPC, or
production PG. The caller provides a freshly migrated, disposable G2 database.
All fake wallets, sessions and principal rows roll back in one transaction.
"""
import os
import psycopg
from psycopg.types.json import Jsonb

NAMESPACE = "g1_wallet_ab_probe"
A, B = "wallet-a", "wallet-b"
TOKEN_A = "11" * 32
TOKEN_B = "22" * 32
CSRF_A = "33" * 32
CSRF_B = "44" * 32
RECIPIENT_A = bytes.fromhex("aa" * 32)
RECIPIENT_B = bytes.fromhex("bb" * 32)


def check_source_wallet_scope(db):
    if (os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("MF_G2_DISPOSABLE_ONLY") != "ack-fresh-gha-postgres-17"
        or os.environ.get("PGHOST") != "127.0.0.1"
        or db.execute("SELECT current_database()").fetchone()[0] != "mf_g2_disposable_ci_20261017"):
        raise ValueError("FRESH_CI_WALLET_AB_ONLY")
    if db.execute("SELECT count(*) FROM c1_private.deployment").fetchone()[0] != 0:
        raise ValueError("WALLET_AB_NOT_EMPTY_SOURCE")

    def auth(token, mutation=False, csrf=None, claimed_wallet=None):
        q = {"session_hash": token}
        if csrf is not None:
            q["csrf_hash"] = csrf
        if claimed_wallet:
            # Untrusted client fields cannot select a different server subject.
            q["walletAddress"] = claimed_wallet
        return db.execute(
            "SELECT (c1_private.auth(%s,%s,%s)).subject",
            (NAMESPACE, Jsonb(q), mutation)
        ).fetchone()[0]

    def reject(code, run):
        try:
            with db.transaction():
                run()
        except psycopg.Error as exc:
            if exc.diag.message_primary != code:
                raise AssertionError("WRONG_WALLET_AUTH_DENIAL") from None
        else:
            raise AssertionError("WALLET_AUTH_SHOULD_HAVE_REJECTED")

    def change_and_reject(sql, args, token=TOKEN_A, expected="UNAUTHENTICATED", mutation=False, csrf=None):
        try:
            with db.transaction():
                db.execute(sql, args)
                reject(expected, lambda: auth(token, mutation=mutation, csrf=csrf))
                raise psycopg.Rollback()
        except psycopg.Rollback:
            pass

    result = {}
    with db.transaction():
        db.execute(
            "INSERT INTO c1_private.deployment (ns,manifest,now,clock_floor,heartbeat) "
            "VALUES (%s,'{}'::jsonb,1000,1000,1000)",
            (NAMESPACE,))
        for subject,recipient,token,csrf,wallet,proof in [
            (A,RECIPIENT_A,TOKEN_A,CSRF_A,"0x"+"a"*40,bytes.fromhex("ca"*32)),
            (B,RECIPIENT_B,TOKEN_B,CSRF_B,"0x"+"b"*40,bytes.fromhex("cb"*32)),
        ]:
            db.execute(
                "INSERT INTO c1_private.identities "
                "(ns,subject,revision,auth_kind,recipient_key) VALUES (%s,%s,1,'wallet',%s)",
                (NAMESPACE,subject,recipient))
            db.execute(
                "INSERT INTO c1_private.sessions "
                "(ns,hash,csrf,subject,identity_revision,epoch,created,activity,authenticated) "
                "VALUES (%s,%s,%s,%s,1,1,900,900,900)",
                (NAMESPACE,bytes.fromhex(token),bytes.fromhex(csrf),subject))
            db.execute(
                "INSERT INTO c1_private.wallet_principals "
                "(ns,subject,wallet_address,chain_id,recipient_key,identity_revision,expires_at,evidence_digest) "
                "VALUES (%s,%s,%s,10143,%s,1,10000,%s)",
                (NAMESPACE,subject,wallet,recipient,proof))
            db.execute(
                "INSERT INTO c1_private.external_session_expiry (ns,hash,expires_at) "
                "VALUES (%s,%s,10000)",
                (NAMESPACE,bytes.fromhex(token)))
        if auth(TOKEN_A) != A or auth(TOKEN_B) != B:
            raise AssertionError("WALLET_AB_PRINCIPAL_CROSSED")
        if auth(TOKEN_A,claimed_wallet="0x"+"b"*40) != A:
            raise AssertionError("CLIENT_WALLET_PARAMETER_SPOOFED_SUBJECT")
        if auth(TOKEN_B,claimed_wallet="0x"+"a"*40) != B:
            raise AssertionError("CLIENT_WALLET_PARAMETER_SPOOFED_SUBJECT")
        if auth(TOKEN_A,mutation=True,csrf=CSRF_A) != A:
            raise AssertionError("CSRF_BOUND_AUTH_FAILED")
        if auth(TOKEN_B,mutation=True,csrf=CSRF_B) != B:
            raise AssertionError("CSRF_B_BOUND_AUTH_FAILED")
        reject("CSRF", lambda: auth(TOKEN_A,mutation=True,csrf=CSRF_B))
        reject("CSRF", lambda: auth(TOKEN_B,mutation=True,csrf=CSRF_A))
        reject("CSRF", lambda: auth(TOKEN_A,mutation=True))
        reject("UNAUTHENTICATED",lambda: auth("55"*32))

        change_and_reject(
            "UPDATE c1_private.sessions SET revoked=true WHERE ns=%s AND subject=%s",
            (NAMESPACE,A))
        change_and_reject(
            "UPDATE c1_private.sessions SET identity_revision=2 WHERE ns=%s AND subject=%s",
            (NAMESPACE,A))
        change_and_reject(
            "UPDATE c1_private.identities SET revision=2 WHERE ns=%s AND subject=%s",
            (NAMESPACE,A))
        change_and_reject(
            "UPDATE c1_private.wallet_principals SET recipient_key=%s WHERE ns=%s AND subject=%s",
            (bytes.fromhex("cc"*32),NAMESPACE,A))
        change_and_reject(
            "UPDATE c1_private.wallet_principals SET identity_revision=2 WHERE ns=%s AND subject=%s",
            (NAMESPACE,A))
        change_and_reject(
            "UPDATE c1_private.wallet_principals SET expires_at=1000 WHERE ns=%s AND subject=%s",
            (NAMESPACE,A))
        change_and_reject(
            "UPDATE c1_private.external_session_expiry SET expires_at=1000 WHERE ns=%s AND hash=%s",
            (NAMESPACE,bytes.fromhex(TOKEN_A)))
        change_and_reject(
            "UPDATE c1_private.deployment SET credential_epoch=2 WHERE ns=%s",
            (NAMESPACE,))
        change_and_reject(
            "UPDATE c1_private.deployment SET now=2700 WHERE ns=%s",
            (NAMESPACE,))
        if auth(TOKEN_A) != A or auth(TOKEN_B) != B:
            raise AssertionError("ROLLBACK_DID_NOT_PRESERVE_WALLET_SCOPE")
        # SECDEF can authenticate A/B, but the HTTP API login group cannot
        # bypass policy to read raw session, wallet-principal or private claim tables.
        for table in (
            "c1_private.sessions",
            "c1_private.wallet_principals",
            "c1_live_private.claims",
        ):
            allowed=db.execute(
                "SELECT has_table_privilege('c1_live_api',%s,'SELECT')",(table,)
            ).fetchone()[0]
            if allowed:
                raise AssertionError("DIRECT_API_PRIVATE_SELECT")
        result = {
            "g1SourceWalletAb": True,
            "clientWalletOverrideIgnored": True,
            "csrfMutationBoundToCurrentSession": True,
            "revocationRevisionEpochExpiryRejected": True,
            "directApiPrivateSelect": False,
            "syntheticRowsPersisted": False,
        }
        raise psycopg.Rollback()

    if db.execute("SELECT count(*) FROM c1_private.deployment").fetchone()[0] != 0:
        raise AssertionError("G1_SYNTHETIC_IDENTITY_ROLLBACK_FAILED")
    return result
