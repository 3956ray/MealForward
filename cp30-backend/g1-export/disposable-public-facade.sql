-- CP31 G1 PUBLIC-ONLY, SOURCE-ONLY CANDIDATE. NOT A CP30 MIGRATION.
-- Install ONLY in a disposable, verified PG17 regression fixture.
-- Explicit review + a separate upgrade gate are required for an original
-- initialized CP30 system; never run this on the user's Mac runtime.
--
-- c1_g1_export_client has NOLOGIN, NO DML, no private-table SELECT, and
-- cannot EXECUTE the original mixed read/write live_api function.
-- c1_g1_export_owner has SELECT (not INSERT/UPDATE/DELETE) on the exact
-- original tables required to verify confirmed/finalized PUBLIC projections.
-- There is NO wallet, voucher, order, recipient or private QR endpoint here.

CREATE ROLE c1_g1_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE c1_g1_export_client NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA c1_g1_export AUTHORIZATION c1_g1_export_owner;
REVOKE ALL ON SCHEMA c1_g1_export FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c1_g1_export FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_private,c1_live_private,c1_runtime_private TO c1_g1_export_owner;
GRANT SELECT ON c1_private.deployment,c1_private.transaction_guard,
  c1_private.store_registrations,c1_private.confirmed_store_registrations TO c1_g1_export_owner;
GRANT SELECT ON c1_runtime_private.state TO c1_g1_export_owner;
GRANT SELECT ON c1_live_private.stores,c1_live_private.catalog_versions
  TO c1_g1_export_owner;

SET ROLE c1_g1_export_owner;
CREATE TABLE c1_g1_export.binding(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  ns text NOT NULL CHECK(ns~'^[a-z][a-z0-9_-]{0,63}$'),
  enabled boolean NOT NULL DEFAULT false,
  max_age_seconds integer NOT NULL CHECK(max_age_seconds BETWEEN 1 AND 120)
);
-- No grants for binding: only the schema owner (and reviewed bootstrap admin)
-- can bind an original namespace, and binding is disabled by default.

CREATE FUNCTION c1_g1_export.public_snapshot()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
SET statement_timeout='2000ms'
AS $g1$
DECLARE
  cfg c1_g1_export.binding%ROWTYPE;
  d record; guardrow record; runtime record;
  clock_now bigint=extract(epoch FROM statement_timestamp())::bigint;
  s record;r record;confirmed record;
  store_count integer;
  stime bigint;
  k text;j jsonb;
  body jsonb;terms jsonb;
  meal text; v text; pname text; description text; unitprice text;
  window_data jsonb;
  u jsonb;
  storecounts jsonb;storeamounts jsonb;mealcounts jsonb;mealamounts jsonb;
  counts jsonb;amounts jsonb;
  unit_bucket text;unit_price numeric;
  n bigint;total numeric;
  bucket_name text;
  financed jsonb; meal_financed jsonb;
  kitchens jsonb='[]'::jsonb;
  ledgers jsonb='[]'::jsonb;
  meals jsonb='[]'::jsonb;
  first_meal text;
  snap_menu jsonb;
  menu_size integer;
  service_window jsonb;
  start_min integer;end_min integer;previous_end integer;
BEGIN
 SELECT * INTO cfg FROM c1_g1_export.binding WHERE singleton=true AND enabled=true;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='G1_SOURCE_NOT_AUTHORIZED';END IF;
 SELECT now,halt INTO d FROM c1_private.deployment WHERE ns=cfg.ns;
 SELECT ns,security_pending,execution_pending INTO guardrow
 FROM c1_private.transaction_guard WHERE ns=cfg.ns;
 SELECT ns,pending,revision INTO runtime FROM c1_runtime_private.state WHERE ns=cfg.ns;
 IF d.now IS NULL OR guardrow IS NULL OR runtime IS NULL
 OR d.halt IS DISTINCT FROM false
 OR guardrow.security_pending IS NOT NULL OR guardrow.execution_pending IS NOT NULL
 OR runtime.pending IS NOT NULL
 OR d.now>clock_now+5 OR clock_now-d.now>cfg.max_age_seconds THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_SOURCE_NOT_READY';
 END IF;

 SELECT count(*) INTO store_count FROM c1_live_private.stores WHERE ns=cfg.ns;
 IF store_count>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_MVP_STORE_CAPACITY';
 END IF;

 FOR s IN SELECT * FROM c1_live_private.stores WHERE ns=cfg.ns ORDER BY store LOOP
   IF s.store !~ '^[0-9a-f]{64}$' OR s.meal !~ '^[0-9a-f]{64}$'
   OR s.profile->'binding'->>'chainId' <> '10143'
   OR s.profile->'binding'->>'escrow' !~ '^0x[0-9a-f]{40}$'
   OR s.snapshot IS NULL OR s.rows IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_ORIGINAL_STORE';
   END IF;
   SELECT state,record INTO r FROM c1_private.store_registrations
     WHERE ns=cfg.ns AND id=s.registration_id;
   SELECT id,escrow,evidence INTO confirmed
     FROM c1_private.confirmed_store_registrations
     WHERE ns=cfg.ns AND public_store=s.store;
   IF r IS NULL OR confirmed IS NULL OR r.state<>'CONFIRMED'
   OR confirmed.id IS DISTINCT FROM s.registration_id
   OR confirmed.escrow IS DISTINCT FROM s.profile->'binding'->>'escrow'
   OR r.record->'verifiedEvidence' IS DISTINCT FROM s.profile->'registrationEvidence'
   OR r.record->>'escrow' IS DISTINCT FROM s.profile->'binding'->>'escrow'
   THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_UNVERIFIED_REGISTRATION';END IF;
   pname=s.profile->'request'->>'name';
   IF pname IS NULL OR length(btrim(pname))=0 OR length(pname)>120 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_PUBLIC_STORE';
   END IF;
   IF s.snapshot->>'timestamp' !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_BAD_SOURCE_TIMESTAMP';
   END IF;
   stime=(s.snapshot->>'timestamp')::bigint;
   IF stime>d.now OR stime>clock_now+5 OR clock_now-stime>cfg.max_age_seconds THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_STALE_FINALIZED_PROJECTION';
   END IF;
   snap_menu=s.snapshot->'menu';
   IF jsonb_typeof(snap_menu)<>'object'
      OR jsonb_typeof(s.rows->'units')<>'array'
      OR jsonb_typeof(s.rows->'accounting'->'totals')<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_PROJECTION';
   END IF;
   SELECT count(*) INTO menu_size FROM jsonb_object_keys(snap_menu);
   IF menu_size>3 OR jsonb_array_length(s.rows->'units')>10000 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_MVP_CAPACITY';
   END IF;

   -- Reject malformed financial rows before numeric conversion, and never
   -- disclose voucher IDs, session hashes or wallet/private status fields.
   FOR u IN SELECT value FROM jsonb_array_elements(s.rows->'units') LOOP
     IF u->>'bucket' NOT IN ('A','R','H','S','X')
     OR u->>'price' !~ '^(0|[1-9][0-9]{0,77})$'
     OR u->>'meal_id' !~ '^0x[0-9a-f]{64}$'
     OR u->>'version' !~ '^[1-9][0-9]{0,77}$'
     THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_UNIT_PROJECTION';END IF;
   END LOOP;

   storecounts='{}'::jsonb;storeamounts='{}'::jsonb;
   FOR bucket_name IN SELECT unnest(ARRAY['A','R','H','S','X']) LOOP
     SELECT count(*)::bigint,coalesce(sum((value->>'price')::numeric),0)
       INTO n,total FROM jsonb_array_elements(s.rows->'units')
       WHERE value->>'bucket'=bucket_name;
     storecounts=storecounts||jsonb_build_object(bucket_name,n::text);
     storeamounts=storeamounts||jsonb_build_object(bucket_name,total::text);
   END LOOP;
   SELECT count(*)::bigint,coalesce(sum((value->>'price')::numeric),0)
     INTO n,total FROM jsonb_array_elements(s.rows->'units');
   storecounts=storecounts||jsonb_build_object('F',n::text);
   storeamounts=storeamounts||jsonb_build_object('F',total::text);
   FOR bucket_name IN SELECT unnest(ARRAY['F','A','R','H','S','X']) LOOP
     IF s.rows->'accounting'->'totals'->'counts'->>bucket_name IS DISTINCT FROM storecounts->>bucket_name
       OR s.rows->'accounting'->'totals'->>bucket_name IS DISTINCT FROM storeamounts->>bucket_name
     THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_LEDGER_ACCOUNTING_MISMATCH';END IF;
   END LOOP;
   financed=storeamounts||jsonb_build_object('counts',storecounts,
     'liability',((storeamounts->>'A')::numeric+
                  (storeamounts->>'R')::numeric+
                  (storeamounts->>'H')::numeric)::text);
   kitchens=kitchens||jsonb_build_array(jsonb_build_object(
     'id',s.store,'store',s.store,'name',pname,
     'escrow',s.profile->'binding'->>'escrow'));
   ledgers=ledgers||jsonb_build_array(jsonb_build_object(
     'store',s.store,'funded',storecounts->>'F','financial',financed));
   FOR k,j IN SELECT item.key,item.value FROM jsonb_each(snap_menu) AS item LOOP
     IF k !~ '^0x[0-9a-f]{64}$' OR j->>'currentVersion' !~ '^[1-9][0-9]{0,77}$'
       OR jsonb_typeof(j->'listed')<>'boolean'
     THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_PUBLISHED_MENU';END IF;
     meal=substring(k FROM 3);
     v=j->>'currentVersion';
     SELECT c.body,c.terms INTO body,terms
       FROM c1_live_private.catalog_versions AS c
       WHERE c.ns=cfg.ns AND c.store=s.store AND c.meal=meal
         AND c.version=v AND c.state='LIVE';
     IF NOT FOUND THEN
       IF meal=s.meal AND v=coalesce(s.profile->'firstMeal'->>'version','1') THEN
         body=s.profile->'firstMeal';
         terms=j->'terms';
       ELSE
         RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_CATALOG_VERSION_NOT_FINAL';
       END IF;
     END IF;
     unitprice=terms->>'unitPrice';
     pname=body->>'name';description=body->>'description';window_data=body->'windows';
     IF unitprice !~ '^[1-9][0-9]{0,77}$'
       OR j->'terms'->>'unitPrice' IS DISTINCT FROM unitprice
       OR pname IS NULL OR length(btrim(pname))=0 OR length(pname)>120
       OR description IS NULL OR length(description)>1200
       OR jsonb_typeof(window_data)<>'array'
       OR jsonb_array_length(window_data) NOT BETWEEN 1 AND 2 THEN
       RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_CATALOG_TERMS_INCONSISTENT';
     END IF;
     previous_end=0;
     FOR service_window IN SELECT value FROM jsonb_array_elements(window_data) LOOP
       IF jsonb_typeof(service_window)<>'array' OR jsonb_array_length(service_window)<>2
       OR jsonb_typeof(service_window->0)<>'number'
       OR jsonb_typeof(service_window->1)<>'number'
       OR (service_window->>0) !~ '^[0-9]{1,4}$'
       OR (service_window->>1) !~ '^[0-9]{1,4}$' THEN
         RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_SERVICE_WINDOW';
       END IF;
       start_min=(service_window->>0)::integer;end_min=(service_window->>1)::integer;
       IF start_min<previous_end OR end_min>1440 OR start_min>=end_min THEN
         RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='G1_INVALID_SERVICE_WINDOW';
       END IF;
       previous_end=end_min;
     END LOOP;
     -- No arbitrary body keys survive; only a fixed public allowlist.
     mealcounts='{}'::jsonb;mealamounts='{}'::jsonb;
     FOR bucket_name IN SELECT unnest(ARRAY['A','R','H','S','X']) LOOP
       SELECT count(*)::bigint,coalesce(sum((value->>'price')::numeric),0)
         INTO n,total FROM jsonb_array_elements(s.rows->'units')
         WHERE value->>'bucket'=bucket_name AND value->>'meal_id'=k;
       mealcounts=mealcounts||jsonb_build_object(bucket_name,n::text);
       mealamounts=mealamounts||jsonb_build_object(bucket_name,total::text);
     END LOOP;
     SELECT count(*)::bigint,coalesce(sum((value->>'price')::numeric),0)
       INTO n,total FROM jsonb_array_elements(s.rows->'units')
       WHERE value->>'meal_id'=k;
     mealcounts=mealcounts||jsonb_build_object('F',n::text);
     mealamounts=mealamounts||jsonb_build_object('F',total::text);
     meal_financed=mealamounts||jsonb_build_object('counts',mealcounts,
       'liability',((mealamounts->>'A')::numeric+(mealamounts->>'R')::numeric+
                    (mealamounts->>'H')::numeric)::text);
     meals=meals||jsonb_build_array(jsonb_build_object(
       'id',meal,'meal',meal,'mealId',k,'store',s.store,'version',v,
       'name',pname,'description',description,'windows',window_data,
       'listed',(j->>'listed')::boolean,'published',true,
       'eligible',mealcounts->>'A','supported',mealcounts->>'F',
       'unitPrice',unitprice,'assetDecimals',6,'assetSymbol','USDC',
       'financial',meal_financed,'collectionTimeZone','Asia/Shanghai'));
   END LOOP;
 END LOOP;
 RETURN jsonb_build_object(
   'mode','G1_PUBLIC_SOURCE_PROJECTION_ONLY',
   'source','CP30_ORIGINAL_POSTGRES',
   'businessTransactionsAllowed',false,
   'asOf',clock_now,
   'stores',jsonb_build_object('items',kitchens),
   'ledger',jsonb_build_object('items',ledgers),
   'meals',jsonb_build_object('items',meals));
END
$g1$;
RESET ROLE;
REVOKE ALL ON FUNCTION c1_g1_export.public_snapshot() FROM PUBLIC;
GRANT USAGE ON SCHEMA c1_g1_export TO c1_g1_export_client;
GRANT EXECUTE ON FUNCTION c1_g1_export.public_snapshot() TO c1_g1_export_client;
-- NO LOGIN role is created, no SQL original runtime upgrade or network access.
