-- MealForward G1-B: narrowly authorized ORIGINAL-CP30 private read facade.
-- SOURCE ONLY, NOT migration 046. CI disposable PG17 only.
-- Do NOT apply to original Mac, Render Auth Pilot DB or public cache.
-- Requires ORIGINAL CP30 session digest issued/verified by original
-- principal system. A Render SIWE Auth Pilot cookie is NOT that principal.
-- Never expose the credential parameter as a public HTTP query string.
CREATE ROLE c1_g1_private_read_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c1_g1_private_read_client NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA c1_g1_private_read AUTHORIZATION c1_g1_private_read_owner;
REVOKE ALL ON SCHEMA c1_g1_private_read FROM PUBLIC;

-- No EXECUTE on the mixed read/write live_api dispatcher and no DML.
-- Original session authentication runs through the existing audited
-- SECURITY DEFINER auth function, not ad-hoc wallet equality or Pilot cookie.
GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private TO c1_g1_private_read_owner;
GRANT SELECT ON c1_private.deployment,c1_private.transaction_guard,c1_private.identities
 TO c1_g1_private_read_owner;
GRANT SELECT ON c1_runtime_private.state TO c1_g1_private_read_owner;
GRANT SELECT ON c1_live_private.intents,c1_live_private.claims,
 c1_live_private.stores,c1_live_private.catalog_versions TO c1_g1_private_read_owner;
GRANT EXECUTE ON FUNCTION c1_private.auth(text,jsonb,boolean) TO c1_g1_private_read_owner;
GRANT EXECUTE ON FUNCTION c1_live_private.intent_dto(c1_live_private.intents) TO c1_g1_private_read_owner;
GRANT EXECUTE ON FUNCTION c1_live_private.voucher_dto(text,c1_live_private.claims,c1_live_private.stores) TO c1_g1_private_read_owner;
GRANT EXECUTE ON FUNCTION c1_live_private.unit(c1_live_private.stores,text) TO c1_g1_private_read_owner;
GRANT EXECUTE ON FUNCTION c1_live_private.meal_content(text,c1_live_private.stores,text,text) TO c1_g1_private_read_owner;

SET ROLE c1_g1_private_read_owner;
CREATE TABLE c1_g1_private_read.binding (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 ns text NOT NULL CHECK(ns~'^[a-z][a-z0-9_-]{0,63}$'),
 enabled boolean NOT NULL DEFAULT false,
 max_age_seconds integer NOT NULL CHECK(max_age_seconds BETWEEN 1 AND 120)
);

CREATE FUNCTION c1_g1_private_read.my_items(
 section text, original_server_session_hash text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
SET statement_timeout='2000ms'
AS $g1$
DECLARE
 cfg c1_g1_private_read.binding%ROWTYPE;
 d record; guardrow record; rt record;
 principal c1_private.sessions; ident c1_private.identities;
 actual_now bigint=extract(epoch FROM statement_timestamp())::bigint;
BEGIN
 IF section NOT IN ('orders','claims','vouchers')
 OR original_server_session_hash IS NULL
 OR original_server_session_hash !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_PRIVATE_REQUEST_NOT_ALLOWED';
 END IF;
 SELECT * INTO cfg FROM c1_g1_private_read.binding
  WHERE singleton=true AND enabled=true;
 IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_PRIVATE_SOURCE_NOT_AUTHORIZED';
 END IF;
 SELECT now,halt INTO d FROM c1_private.deployment WHERE ns=cfg.ns;
 SELECT ns,security_pending,execution_pending INTO guardrow
  FROM c1_private.transaction_guard WHERE ns=cfg.ns;
 SELECT ns,pending INTO rt FROM c1_runtime_private.state WHERE ns=cfg.ns;
 IF d.now IS NULL OR guardrow.ns IS NULL OR rt.ns IS NULL
 OR d.halt IS DISTINCT FROM false
 OR guardrow.security_pending IS NOT NULL
 OR guardrow.execution_pending IS NOT NULL
 OR rt.pending IS NOT NULL
 OR d.now>actual_now+5 OR actual_now-d.now>cfg.max_age_seconds
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_PRIVATE_SOURCE_NOT_READY';
 END IF;
 -- Historical chain-linked voucher state must not be displayed when the
 -- store snapshot lags the verified original runtime clock.
 IF EXISTS(
   SELECT 1 FROM c1_live_private.stores st
   WHERE st.ns=cfg.ns AND (
    st.snapshot IS NULL OR st.rows IS NULL OR
    CASE WHEN st.snapshot->>'timestamp' ~ '^[1-9][0-9]{0,15}$'
      THEN (st.snapshot->>'timestamp')::bigint>actual_now+5
        OR (st.snapshot->>'timestamp')::bigint>d.now
        OR actual_now-(st.snapshot->>'timestamp')::bigint>cfg.max_age_seconds
      ELSE true END
   )
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_PRIVATE_SOURCE_NOT_READY';
 END IF;
 -- SECURITY DEFINER original source is the only principal authority.
 -- The caller never supplies wallet address, subject or recipient_key.
 principal=c1_private.auth(cfg.ns,
  jsonb_build_object('session_hash',original_server_session_hash),false);
 SELECT * INTO ident FROM c1_private.identities
  WHERE ns=cfg.ns AND subject=principal.subject;
 IF principal.subject IS NULL OR ident.subject IS NULL
 OR ident.auth_kind IS DISTINCT FROM 'wallet'
 OR ident.recipient_key IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_PRIVATE_PRINCIPAL_NOT_VERIFIED';
 END IF;
 IF section='orders' THEN
   RETURN jsonb_build_object('items',coalesce((
    SELECT jsonb_agg(c1_live_private.intent_dto(i)||
      jsonb_build_object('quantity',i.parameters->>'quantity',
                         'amount',i.parameters->>'amount') ORDER BY i.id)
     FROM c1_live_private.intents i
     WHERE i.ns=cfg.ns AND i.subject=principal.subject AND i.action='fund'
   ),'[]'::jsonb));
 ELSIF section='claims' THEN
   RETURN jsonb_build_object('items',coalesce((
    SELECT jsonb_agg(c1_live_private.intent_dto(i) ORDER BY i.id)
    FROM c1_live_private.intents i
    WHERE i.ns=cfg.ns AND i.subject=principal.subject
      AND i.recipient_key=ident.recipient_key AND i.action='issue'
   ),'[]'::jsonb));
 ELSE
   RETURN jsonb_build_object('items',coalesce((
    SELECT jsonb_agg(c1_live_private.voucher_dto(cfg.ns,c,t) ORDER BY c.id)
    FROM c1_live_private.claims c
    JOIN c1_live_private.stores t ON t.ns=c.ns AND t.store=c.store
    WHERE c.ns=cfg.ns AND c.subject=principal.subject
      AND c.recipient_key=ident.recipient_key
   ),'[]'::jsonb));
 END IF;
END $g1$;
RESET ROLE;

REVOKE ALL ON TABLE c1_g1_private_read.binding FROM PUBLIC;
REVOKE ALL ON FUNCTION c1_g1_private_read.my_items(text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_g1_private_read TO c1_g1_private_read_client;
GRANT EXECUTE ON FUNCTION c1_g1_private_read.my_items(text,text) TO c1_g1_private_read_client;
-- No LOGIN role, no secrets, no key, no table SELECT grant to the client.
