-- Owned forward extension only; never initialize/reset or fabricate an email.
SET ROLE c1_table_owner;
ALTER TABLE c1_private.identities ALTER COLUMN canonical_email DROP NOT NULL;
ALTER TABLE c1_private.identities ALTER COLUMN email_key DROP NOT NULL;
ALTER TABLE c1_private.identities ADD COLUMN auth_kind text NOT NULL DEFAULT 'dynamic_email';
ALTER TABLE c1_private.identities ADD COLUMN recipient_key c1_private.digest32;
UPDATE c1_private.identities SET recipient_key=email_key;
ALTER TABLE c1_private.identities ADD CONSTRAINT typed_identity CHECK(
 (auth_kind='dynamic_email' AND email_key IS NOT NULL) OR
 (auth_kind='wallet' AND email_key IS NULL AND canonical_email IS NULL AND recipient_key IS NOT NULL));
ALTER TABLE c1_private.verified_owner_bindings DROP CONSTRAINT verified_owner_bindings_identity_source_check;
ALTER TABLE c1_private.verified_owner_bindings ADD CONSTRAINT verified_owner_bindings_identity_source_check CHECK(identity_source IN('VERIFIED_EXTERNAL','VERIFIED_WALLET'));
CREATE TABLE c1_private.wallet_login_installation(
 ns text PRIMARY KEY REFERENCES c1_private.deployment(ns),install_id uuid NOT NULL,config_digest text NOT NULL CHECK(config_digest~'^[0-9a-f]{64}$'),
 origin text NOT NULL,chain_id bigint NOT NULL CHECK(chain_id=10143),enabled boolean NOT NULL,activation_expires_at bigint NOT NULL);
CREATE TABLE c1_private.wallet_login_challenges(
 ns text REFERENCES c1_private.deployment(ns),id uuid,pre_hash c1_private.digest32 NOT NULL,
 payload jsonb NOT NULL,nonce text NOT NULL CHECK(nonce~'^[0-9a-f]{64}$'),expires_at bigint NOT NULL,
 consumed boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT 1 CHECK(revision IN(1,2)),PRIMARY KEY(ns,id),UNIQUE(ns,nonce));
CREATE TABLE c1_private.wallet_principals(
 ns text,subject text,wallet_address text NOT NULL CHECK(wallet_address~'^0x[0-9a-f]{40}$'),chain_id bigint NOT NULL CHECK(chain_id=10143),
 recipient_key c1_private.digest32 NOT NULL,identity_revision bigint NOT NULL,expires_at bigint NOT NULL,evidence_digest c1_private.digest32 NOT NULL,
 PRIMARY KEY(ns,subject),UNIQUE(ns,chain_id,wallet_address),UNIQUE(ns,recipient_key),FOREIGN KEY(ns,subject) REFERENCES c1_private.identities(ns,subject));
CREATE FUNCTION c1_private.wallet_challenge_monotone() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW)-'consumed'-'revision') IS DISTINCT FROM (to_jsonb(OLD)-'consumed'-'revision')
 OR (OLD.consumed AND NOT NEW.consumed) OR NEW.revision<OLD.revision
 OR (NEW.consumed IS DISTINCT FROM OLD.consumed AND NEW.revision<>OLD.revision+1) THEN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='WALLET_CHALLENGE_IMMUTABLE';END IF;RETURN NEW;END $$;
CREATE TRIGGER wallet_challenge_monotone BEFORE UPDATE ON c1_private.wallet_login_challenges FOR EACH ROW EXECUTE FUNCTION c1_private.wallet_challenge_monotone();
RESET ROLE;
GRANT SELECT,INSERT,UPDATE ON c1_private.wallet_login_challenges,c1_private.wallet_principals TO c1_auth_code_owner;
GRANT SELECT ON c1_private.wallet_login_installation TO c1_auth_code_owner,c1_api_code_owner;
GRANT SELECT ON c1_private.wallet_login_challenges TO c1_api_code_owner;

ALTER FUNCTION c1_private.auth(text,jsonb,boolean) RENAME TO auth_dynamic_email;
CREATE FUNCTION c1_private.auth(n text,q jsonb,mutation boolean DEFAULT false) RETURNS c1_private.sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE s sessions;i identities;d deployment;w wallet_principals;expiry bigint;BEGIN
 SELECT * INTO s FROM sessions WHERE ns=n AND hash=h(q->>'session_hash');SELECT * INTO i FROM identities WHERE ns=n AND subject=s.subject;
 IF i.auth_kind IS DISTINCT FROM 'wallet' THEN RETURN auth_dynamic_email(n,q,mutation);END IF;
 SELECT * INTO d FROM deployment WHERE ns=n;SELECT * INTO w FROM wallet_principals WHERE ns=n AND subject=s.subject;
 SELECT expires_at INTO expiry FROM external_session_expiry WHERE ns=n AND hash=s.hash;
 IF s.hash IS NULL OR w.subject IS NULL OR expiry IS NULL OR s.revoked OR s.epoch<>d.credential_epoch
 OR s.identity_revision<>i.revision OR w.identity_revision<>i.revision OR w.recipient_key IS DISTINCT FROM i.recipient_key
 OR d.now>=expiry OR d.now>=w.expires_at OR d.now>=s.created+86400 OR d.now>=s.activity+1800 THEN PERFORM fail('UNAUTHENTICATED');END IF;
 IF mutation AND (q->>'csrf_hash' IS NULL OR s.csrf IS DISTINCT FROM h(q->>'csrf_hash')) THEN PERFORM fail('CSRF');END IF;RETURN s;END $$;
ALTER FUNCTION c1_private.auth(text,jsonb,boolean) OWNER TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_private.auth(text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_private.auth(text,jsonb,boolean) TO c1_api_code_owner,c1_live_code_owner;

CREATE FUNCTION c1_onboarding_internal.wallet_login_status(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE x wallet_login_installation;BEGIN PERFORM guard(n);SELECT * INTO x FROM wallet_login_installation WHERE ns=n;
 RETURN jsonb_build_object('enabled',coalesce(x.enabled,false) AND x.activation_expires_at>(SELECT now FROM deployment WHERE ns=n),'configDigest',x.config_digest,'origin',x.origin,'chainId',x.chain_id);END $$;
CREATE FUNCTION c1_onboarding_internal.wallet_login_material(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d deployment;pre pre_sessions;c wallet_login_challenges;BEGIN d=guard(n);
 SELECT * INTO pre FROM pre_sessions WHERE ns=n AND hash=h(q->>'pre_hash');
 IF pre.hash IS NULL OR pre.used OR pre.expires<=d.now OR pre.csrf IS DISTINCT FROM h(q->>'csrf_hash') THEN PERFORM fail('CSRF');END IF;
 SELECT * INTO c FROM wallet_login_challenges WHERE ns=n AND id=(q->>'id')::uuid AND pre_hash=pre.hash;
 IF c.id IS NULL OR c.consumed OR c.expires_at<=d.now THEN PERFORM fail('WALLET_LOGIN_CHALLENGE_UNAVAILABLE');END IF;
 RETURN jsonb_build_object('challenge',c.payload,'revision',c.revision);END $$;
ALTER FUNCTION c1_onboarding_internal.wallet_login_status(text,jsonb) OWNER TO c1_auth_code_owner;
ALTER FUNCTION c1_onboarding_internal.wallet_login_material(text,jsonb) OWNER TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_onboarding_internal.wallet_login_status(text,jsonb),c1_onboarding_internal.wallet_login_material(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_onboarding_internal.wallet_login_status(text,jsonb),c1_onboarding_internal.wallet_login_material(text,jsonb) TO c1_identity_authority;

ALTER FUNCTION c1_api.security_reserve(text,jsonb) RENAME TO security_reserve_dynamic_email;
CREATE FUNCTION c1_api.security_reserve(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d deployment;pre pre_sessions;c wallet_login_challenges;i identities;x wallet_login_installation;k text=q->>'kind';p jsonb=q->'command';m uuid=(q->>'mutation_id')::uuid;ex jsonb;dg text;ob text;b jsonb;ch jsonb;BEGIN
 IF k NOT IN('wallet_login_challenge','wallet_login') THEN RETURN c1_api.security_reserve_dynamic_email(n,q);END IF;
 d=guard(n);IF (SELECT security_pending FROM transaction_guard WHERE ns=n) IS NOT NULL THEN PERFORM fail('FENCE_PENDING');END IF;
 IF NOT coalesce((q->>'private_identity')::boolean,false) THEN PERFORM fail('FORBIDDEN');END IF;
 SELECT * INTO x FROM wallet_login_installation WHERE ns=n;IF NOT coalesce(x.enabled,false) OR x.activation_expires_at<=d.now THEN PERFORM fail('WALLET_LOGIN_DISABLED');END IF;
 SELECT * INTO pre FROM pre_sessions WHERE ns=n AND hash=h(p->>'pre_hash');
 IF pre.hash IS NULL OR pre.used OR pre.expires<=d.now OR pre.csrf IS DISTINCT FROM h(p->>'csrf_hash') THEN PERFORM fail('CSRF');END IF;
 IF k='wallet_login_challenge' THEN
  ch=p->'challenge';
  IF NOT coalesce(jsonb_typeof(ch)='object' AND (SELECT count(*) FROM jsonb_object_keys(ch))=9
   AND ch->>'nonce'~'^[0-9a-f]{64}$' AND ch->>'address'~'^0x[0-9a-f]{40}$'
   AND (ch->>'chainId')::bigint=x.chain_id AND ch->>'uri'=x.origin AND ch->>'domain'=split_part(x.origin,'//',2)
   AND (ch->>'issuedAt')::bigint BETWEEN d.now-30 AND d.now+30
   AND (ch->>'expiresAt')::bigint>d.now AND (ch->>'expiresAt')::bigint<=(ch->>'issuedAt')::bigint+300
   AND length(ch->>'message') BETWEEN 1 AND 4096,false) THEN PERFORM fail('WALLET_LOGIN_REJECTED');END IF;
  IF EXISTS(SELECT 1 FROM wallet_login_challenges WHERE ns=n AND (id=(ch->>'challengeId')::uuid OR nonce=ch->>'nonce')) THEN PERFORM fail('WALLET_LOGIN_CHALLENGE_CONFLICT');END IF;
  IF (SELECT count(*) FROM wallet_login_challenges WHERE ns=n AND pre_hash=pre.hash AND NOT consumed AND expires_at>d.now)>=5 THEN PERFORM fail('QUEUE_FULL');END IF;
  ex=jsonb_build_object('challenge_revision',0);ob='wallet_challenge:'||(ch->>'challengeId');
 ELSE
  SELECT * INTO c FROM wallet_login_challenges WHERE ns=n AND id=(p->>'challenge_id')::uuid AND pre_hash=pre.hash;
  IF c.id IS NULL OR c.consumed OR c.expires_at<=d.now OR c.payload IS DISTINCT FROM p->'expected_challenge'
   OR c.payload->>'address' IS DISTINCT FROM p->>'wallet_address' OR (c.payload->>'chainId')::bigint IS DISTINCT FROM (p->>'chain_id')::bigint
   OR NOT coalesce(p->>'subject_hash'~'^[0-9a-f]{64}$' AND p->>'recipient_key'~'^[0-9a-f]{64}$'
     AND p->>'evidence_digest'~'^[0-9a-f]{64}$' AND (p->>'expires_at')::bigint>d.now
     AND (p->>'expires_at')::bigint<=least(d.now+3630,x.activation_expires_at),false) THEN PERFORM fail('WALLET_LOGIN_REJECTED');END IF;
  SELECT * INTO i FROM identities WHERE ns=n AND subject=p->>'subject_hash';
  IF i.subject IS NOT NULL AND (i.auth_kind<>'wallet' OR i.recipient_key IS DISTINCT FROM h(p->>'recipient_key')) THEN PERFORM fail('IDENTITY_PROFILE_CONFLICT');END IF;
  ex=jsonb_build_object('identity_revision',coalesce(i.revision,0),'challenge_revision',c.revision);ob='identity:'||(p->>'subject_hash');
 END IF;
 dg=encode(sha256(convert_to(jsonb_build_object('kind',k,'command',p,'expected',ex)::text,'UTF8')),'hex');
 INSERT INTO security_mutations(ns,id,kind,command,expected,command_digest,state) VALUES(n,m,k,p,ex,dg,'RESERVED');UPDATE transaction_guard SET security_pending=m WHERE ns=n;
 b=jsonb_build_object('mutation_id',m,'kind',k,'object_id',ob,'expected_revision',ex,'command_digest',dg,'restore_generation',d.restore_generation,
 'source_epoch',d.source_epoch,'deployment_generation',1,'credential_epoch',d.credential_epoch,'authority_checkpoint',coalesce(q->'authority_evidence'->>'parent',d.parent),
 'authority_highwater',coalesce((q->'authority_evidence'->>'height')::bigint,d.height),'floors',coalesce(q->'retained_floors','{}'::jsonb),'command',jsonb_build_object('kind',k,'digest',dg));
 UPDATE security_mutations SET binding=b WHERE ns=n AND id=m;RETURN b;END $$;
ALTER FUNCTION c1_api.security_reserve(text,jsonb) OWNER TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_api.security_reserve(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_api.security_reserve(text,jsonb) TO c1_identity_security;

ALTER FUNCTION c1_api.security_apply(text,jsonb) RENAME TO security_apply_dynamic_email;
CREATE FUNCTION c1_api.security_apply(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d deployment;m security_mutations;p jsonb;pre pre_sessions;c wallet_login_challenges;i identities;w wallet_principals;x wallet_login_installation;result jsonb;f jsonb;BEGIN
 SELECT * INTO m FROM security_mutations WHERE ns=n AND id=(q->>'mutation_id')::uuid;
 IF m.kind NOT IN('wallet_login_challenge','wallet_login') THEN
  result=c1_api.security_apply_dynamic_email(n,q);
  IF m.kind='external_login' THEN UPDATE identities SET recipient_key=email_key WHERE ns=n AND subject=m.command->>'subject_hash' AND auth_kind='dynamic_email';END IF;
  RETURN result;
 END IF;
 d=guard(n,false,(q->>'mutation_id')::uuid);SELECT * INTO m FROM security_mutations WHERE ns=n AND id=(q->>'mutation_id')::uuid FOR UPDATE;
 IF m.state<>'PREPARED' OR m.sequence<>(q->>'sequence')::bigint OR m.digest<>q->>'digest'
 OR (SELECT security_pending FROM transaction_guard WHERE ns=n) IS DISTINCT FROM m.id THEN PERFORM fail('STALE_PREPARE');END IF;
 p=m.command;SELECT * INTO x FROM wallet_login_installation WHERE ns=n;IF NOT coalesce(x.enabled,false) OR x.activation_expires_at<=d.now THEN PERFORM fail('WALLET_LOGIN_DISABLED');END IF;
 SELECT * INTO pre FROM pre_sessions WHERE ns=n AND hash=h(p->>'pre_hash') FOR UPDATE;
 IF pre.hash IS NULL OR pre.used OR pre.expires<=d.now OR pre.csrf IS DISTINCT FROM h(p->>'csrf_hash') THEN PERFORM fail('CSRF');END IF;
 IF m.kind='wallet_login_challenge' THEN
  INSERT INTO wallet_login_challenges(ns,id,pre_hash,payload,nonce,expires_at) VALUES(n,(p->'challenge'->>'challengeId')::uuid,pre.hash,p->'challenge',p->'challenge'->>'nonce',(p->'challenge'->>'expiresAt')::bigint);
  result=jsonb_build_object('challenge',p->'challenge');f=jsonb_build_object('wallet_challenge:'||(p->'challenge'->>'challengeId'),1);
 ELSE
  SELECT * INTO c FROM wallet_login_challenges WHERE ns=n AND id=(p->>'challenge_id')::uuid FOR UPDATE;
  SELECT * INTO i FROM identities WHERE ns=n AND subject=p->>'subject_hash' FOR UPDATE;
  IF c.pre_hash IS DISTINCT FROM pre.hash OR c.consumed OR c.expires_at<=d.now OR c.payload IS DISTINCT FROM p->'expected_challenge'
   OR c.revision<>(m.expected->>'challenge_revision')::bigint OR coalesce(i.revision,0)<>(m.expected->>'identity_revision')::bigint
   OR (p->>'expires_at')::bigint<=d.now THEN PERFORM fail('STALE_PREPARE');END IF;
  INSERT INTO identities(ns,subject,canonical_email,email_key,auth_kind,recipient_key) VALUES(n,p->>'subject_hash',NULL,NULL,'wallet',h(p->>'recipient_key'))
   ON CONFLICT(ns,subject) DO UPDATE SET recipient_key=EXCLUDED.recipient_key WHERE identities.auth_kind='wallet' AND identities.recipient_key=EXCLUDED.recipient_key RETURNING * INTO i;
  IF NOT FOUND THEN PERFORM fail('IDENTITY_PROFILE_CONFLICT');END IF;
  INSERT INTO wallet_principals VALUES(n,i.subject,p->>'wallet_address',(p->>'chain_id')::bigint,i.recipient_key,i.revision,(p->>'expires_at')::bigint,h(p->>'evidence_digest'))
   ON CONFLICT(ns,subject) DO UPDATE SET expires_at=EXCLUDED.expires_at,evidence_digest=EXCLUDED.evidence_digest
   WHERE wallet_principals.wallet_address=EXCLUDED.wallet_address AND wallet_principals.chain_id=EXCLUDED.chain_id AND wallet_principals.recipient_key=EXCLUDED.recipient_key;
  IF NOT FOUND THEN PERFORM fail('IDENTITY_PROFILE_CONFLICT');END IF;
  UPDATE wallet_login_challenges SET consumed=true,revision=revision+1 WHERE ns=n AND id=c.id AND NOT consumed;
  IF NOT FOUND THEN PERFORM fail('WALLET_LOGIN_CHALLENGE_UNAVAILABLE');END IF;
  UPDATE pre_sessions SET used=true WHERE ns=n AND hash=pre.hash AND NOT used;IF NOT FOUND THEN PERFORM fail('CSRF');END IF;
  UPDATE sessions SET revoked=true,revision=revision+1 WHERE ns=n AND subject=i.subject AND NOT revoked;
  UPDATE access_credentials SET active=false WHERE ns=n AND session_hash IN(SELECT hash FROM sessions WHERE ns=n AND subject=i.subject);
  UPDATE display_credentials SET active=false WHERE ns=n AND session_hash IN(SELECT hash FROM sessions WHERE ns=n AND subject=i.subject);
  INSERT INTO sessions(ns,hash,csrf,subject,identity_revision,epoch,created,activity,authenticated) VALUES(n,h(p->>'new_session_hash'),h(p->>'new_csrf_hash'),i.subject,i.revision,d.credential_epoch,d.now,d.now,d.now);
  INSERT INTO external_session_expiry VALUES(n,h(p->>'new_session_hash'),(p->>'expires_at')::bigint);
  INSERT INTO verified_owner_bindings VALUES(n,i.subject,p->>'wallet_address',1,true,'VERIFIED_WALLET','EOA',h(p->>'evidence_digest'),h(p->>'evidence_digest'),i.revision,d.credential_epoch,(p->>'expires_at')::bigint)
   ON CONFLICT(ns,subject) DO UPDATE SET verified_until=EXCLUDED.verified_until,identity_evidence=EXCLUDED.identity_evidence,wallet_evidence=EXCLUDED.wallet_evidence
   WHERE verified_owner_bindings.owner=EXCLUDED.owner AND verified_owner_bindings.identity_source='VERIFIED_WALLET'
   AND verified_owner_bindings.identity_revision=EXCLUDED.identity_revision AND verified_owner_bindings.credential_epoch=EXCLUDED.credential_epoch;
  IF NOT FOUND THEN PERFORM fail('OWNER_BINDING_CHANGED');END IF;
  result=jsonb_build_object('authenticated',true,'authKind','wallet','walletAddress',p->>'wallet_address','walletBound',true,'expiresAt',(p->>'expires_at')::bigint);
  f=jsonb_build_object('identity:'||i.subject,i.revision,'session:'||(p->>'new_session_hash'),1,'wallet_challenge:'||c.id,2,'owner:'||i.subject,1);
 END IF;
 INSERT INTO security_commits VALUES(n,m.id,m.sequence,m.digest,result,f);UPDATE security_mutations SET state='APPLIED',result=result WHERE ns=n AND id=m.id;RETURN result;END $$;
ALTER FUNCTION c1_api.security_apply(text,jsonb) OWNER TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_api.security_apply(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_api.security_apply(text,jsonb) TO c1_identity_security,c1_app_api;

ALTER FUNCTION c1_api.security_startup(text,jsonb) RENAME TO security_startup_dynamic_email;
CREATE FUNCTION c1_api.security_startup(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE result jsonb;k text;v jsonb;actual bigint;BEGIN
 result=c1_api.security_startup_dynamic_email(n,q||jsonb_build_object('floors',coalesce(q->'floors','{}')-'wallet_challenge'));
 IF result->>'matched' IS DISTINCT FROM 'true' THEN RETURN result;END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(coalesce(q->'floors'->'wallet_challenge','{}')) LOOP
  SELECT revision INTO actual FROM wallet_login_challenges WHERE ns=n AND id=k::uuid;
  IF actual IS NULL OR actual<(v::text)::bigint THEN UPDATE deployment SET halt=true,reason='JOURNAL_FLOOR' WHERE ns=n;RETURN jsonb_build_object('matched',false,'reason','FLOOR');END IF;
 END LOOP;RETURN result;END $$;
ALTER FUNCTION c1_api.security_startup(text,jsonb) OWNER TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_api.security_startup(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION c1_api.security_startup(text,jsonb) TO c1_identity_security;

GRANT SELECT,INSERT,UPDATE ON c1_private.identities,c1_private.sessions,c1_private.external_session_expiry,c1_private.pre_sessions,c1_private.security_mutations,c1_private.security_commits,c1_private.verified_owner_bindings,c1_private.access_credentials,c1_private.display_credentials TO c1_auth_code_owner;
GRANT EXECUTE ON FUNCTION c1_api.security_reserve_dynamic_email(text,jsonb),c1_api.security_apply_dynamic_email(text,jsonb),c1_api.security_startup_dynamic_email(text,jsonb) TO c1_auth_code_owner;
REVOKE ALL ON FUNCTION c1_private.wallet_challenge_monotone() FROM PUBLIC;

-- Business row extensions are installed only while these tables are empty.
SET ROLE c1_runtime_table_owner;
ALTER TABLE c1_live_private.intents ADD COLUMN recipient_key bytea;
ALTER TABLE c1_live_private.claims ADD COLUMN recipient_key bytea;
UPDATE c1_live_private.intents SET recipient_key=email_key;
UPDATE c1_live_private.claims SET recipient_key=email_key;
ALTER TABLE c1_live_private.intents ALTER COLUMN recipient_key SET NOT NULL;
ALTER TABLE c1_live_private.claims ALTER COLUMN recipient_key SET NOT NULL;
ALTER TABLE c1_live_private.intents ADD CONSTRAINT intent_recipient_key CHECK(octet_length(recipient_key)=32);
ALTER TABLE c1_live_private.claims ADD CONSTRAINT claim_recipient_key CHECK(octet_length(recipient_key)=32);
CREATE INDEX wallet_claim_recipient ON c1_live_private.claims(ns,recipient_key);
RESET ROLE;

CREATE OR REPLACE FUNCTION c1_runtime_internal.live_api(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE op text=q->>'op';s c1_private.sessions;d c1_private.deployment;t stores;i intents;r reviews;c claims;cred credentials;ident c1_private.identities;b c1_private.verified_owner_bindings;v jsonb;u jsonb;p jsonb;j jsonb;result jsonb;store_key text;route_store text=q->>'store';now bigint;is_read boolean=op IN('public_stores','public_meals','public_meal','public_ledger','my_orders','order_get','intent_get','my_vouchers','voucher_get','workbench','case_get','payouts','wallet_material','auth_me');BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);SELECT * INTO d FROM c1_private.deployment WHERE ns=n;now=d.now;
 IF NOT is_read AND NOT EXISTS(SELECT 1 FROM c1_live_private.first_binding WHERE ns=n AND state='BOUND') THEN PERFORM c1_private.fail('BUSINESS_BINDING_PENDING');END IF;
 IF op NOT IN('public_stores','public_meals','public_meal','public_ledger') THEN s=c1_live_private.context(n,q,NOT is_read);SELECT * INTO ident FROM c1_private.identities WHERE ns=n AND subject=s.subject;END IF;
 IF op='auth_me' THEN RETURN jsonb_build_object('displayName',(CASE WHEN ident.auth_kind='wallet' THEN '钱包 '||(SELECT wallet_address FROM c1_private.wallet_principals WHERE ns=n AND subject=s.subject) ELSE 'Signed in' END),'authKind',ident.auth_kind,'walletAddress',(SELECT wallet_address FROM c1_private.wallet_principals WHERE ns=n AND subject=s.subject),'walletBound',EXISTS(SELECT 1 FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject AND enabled),'realIdentity',true);END IF;
 IF op='public_stores' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',store,'store',store,'name',profile->'request'->>'name','controlRevision',rows->'controls'->>'control_revision')) FROM stores WHERE ns=n),'[]'));END IF;
 IF op='public_ledger' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('store',store,'financial',rows->'accounting'->'totals','funded',rows->'accounting'->'totals'->'counts'->>'F')) FROM stores WHERE ns=n),'[]'));END IF;
 IF op IN('my_orders','order_get','intent_get') THEN
  IF op='my_orders' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.intent_dto(z)||jsonb_build_object('quantity',z.parameters->>'quantity','amount',z.parameters->>'amount')) FROM intents z WHERE ns=n AND subject=s.subject AND action='fund'),'[]'));END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject;IF NOT FOUND THEN PERFORM fail('NOT_FOUND');END IF;RETURN c1_live_private.intent_dto(i);END IF;
 IF op='my_vouchers' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.voucher_dto(n,z,c1_live_private.store(n,z.store))) FROM claims z WHERE ns=n AND recipient_key=ident.recipient_key),'[]'));END IF;
 IF op='voucher_get' THEN SELECT * INTO c FROM claims WHERE ns=n AND id=q->>'id' AND recipient_key=ident.recipient_key;IF NOT FOUND THEN PERFORM fail('NOT_FOUND');END IF;t=c1_live_private.store(n,c.store);RETURN c1_live_private.voucher_dto(n,c,t);END IF;
 IF op IN('wallet_material','wallet_attempt','wallet_hash') THEN
  IF is_read THEN SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject;ELSE SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject FOR UPDATE;END IF;
  IF NOT FOUND OR i.action NOT IN('fund','settle') THEN PERFORM fail('NOT_FOUND');END IF;t=c1_live_private.store(n,i.store,NOT is_read);
  IF i.action='settle' THEN PERFORM c1_live_private.owner(n,t,s);ELSE
   SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;
   IF NOT coalesce(b.enabled,false) OR b.owner IS DISTINCT FROM i.parameters->>'payer' OR b.identity_revision<>s.identity_revision OR b.credential_epoch<>s.epoch OR b.verified_until<=now THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;END IF;
  IF op='wallet_material' THEN RETURN jsonb_build_object('intent',to_jsonb(i),'store',to_jsonb(t),'attempts',coalesce((SELECT jsonb_object_agg(kind,to_jsonb(a)) FROM wallet_attempts a WHERE ns=n AND intent=i.id),'{}'),'now',now);END IF;
  IF i.stage='FINAL_SUCCEEDED' OR q->>'kind' NOT IN('approve','fund','settle') OR (i.action='settle') IS DISTINCT FROM (q->>'kind'='settle') THEN PERFORM fail('ORIGINAL_WALLET_KIND_REQUIRED');END IF;
  IF op='wallet_attempt' THEN
   IF EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind=q->>'kind') THEN PERFORM fail('ORIGINAL_WALLET_ATTEMPT_UNKNOWN');END IF;
   IF q->>'kind'='fund' AND NOT EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind='approve' AND confirmed) THEN PERFORM fail('ORIGINAL_APPROVAL_NOT_CONFIRMED');END IF;
   IF q->'deployment'->>'from' IS DISTINCT FROM (CASE WHEN i.action='fund' THEN i.parameters->>'payer' ELSE t.profile->'binding'->>'owner' END) OR (q->'deployment'->>'chainId')::int IS DISTINCT FROM (t.profile->'binding'->>'chainId')::int OR q->'deployment'->>'to' IS DISTINCT FROM (CASE WHEN q->>'kind'='approve' THEN t.profile->'binding'->>'asset' ELSE t.profile->'binding'->>'escrow' END) OR q->'deployment'->>'value' IS DISTINCT FROM '0' THEN PERFORM fail('ORIGINAL_WALLET_BINDING_REQUIRED');END IF;
   INSERT INTO wallet_attempts(ns,intent,kind,deployment) VALUES(n,i.id,q->>'kind',q->'deployment');
   UPDATE intents SET stage='UNKNOWN',observer_record=CASE WHEN q->>'kind' IN('fund','settle') THEN q->'observerRecord' ELSE observer_record END,revision=revision+1 WHERE ns=n AND id=i.id;
  ELSE
   IF q->>'hash' !~'^0x[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind=q->>'kind' AND (hash IS NULL OR hash=q->>'hash')) THEN PERFORM fail('ORIGINAL_WALLET_LOCATOR_CONFLICT');END IF;
   UPDATE wallet_attempts SET hash=q->>'hash',revision=revision+1 WHERE ns=n AND intent=i.id AND kind=q->>'kind' AND hash IS NULL;
   IF q->>'kind'<>'approve' THEN UPDATE intents SET transaction_hash=q->>'hash',revision=revision+1 WHERE ns=n AND id=i.id AND transaction_hash IS NULL;END IF;
  END IF;RETURN jsonb_build_object('id',i.id,'kind',q->>'kind','stage','UNKNOWN','locatorOnly',true);END IF;
 IF op IN('support_confirm','claim_confirm','settle_confirm') THEN SELECT store INTO store_key FROM reviews WHERE ns=n AND id=(q->'client'->>'reviewId')::uuid AND subject=s.subject;IF route_store IS NOT NULL AND route_store IS DISTINCT FROM store_key THEN PERFORM fail('ORIGINAL_STORE_ROUTE_REQUIRED');END IF;q=q||jsonb_build_object('store',store_key);END IF;
 IF op IN('recover','display') THEN SELECT store INTO store_key FROM claims WHERE ns=n AND id=q->>'voucher' AND recipient_key=ident.recipient_key;q=q||jsonb_build_object('store',store_key);END IF;
 t=c1_live_private.store(n,q->>'store',op NOT IN('public_meals','public_meal','workbench','payouts','case_get'));
 IF op IN('public_meals','public_meal') THEN RETURN jsonb_build_object('items',jsonb_build_array(t.profile->'firstMeal'||jsonb_build_object('id',t.meal,'meal',t.meal,'store',t.store,'listed',t.snapshot->'menu'->('0x'||t.meal)->'listed','eligible',t.rows->'accounting'->'totals'->'counts'->>'A','financial',t.rows->'accounting'->'totals')));END IF;
 IF op IN('workbench','payouts','case_get','code_check','lock_confirm','handover_confirm','settle_review','settle_confirm') THEN PERFORM c1_live_private.owner(n,t,s);END IF;
 IF op='workbench' THEN RETURN jsonb_build_object('store',t.store,'financial',t.rows->'accounting'->'totals','items',jsonb_build_array(t.profile->'firstMeal'||jsonb_build_object('id',t.meal)));END IF;
 IF op='payouts' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(value||jsonb_build_object('id',value->>'voucher_id','amount',value->>'price','state',value->>'bucket','settled',value->>'bucket'='S')) FROM jsonb_array_elements(t.rows->'units') WHERE value->>'bucket' IN('H','S')),'[]'));END IF;
 IF op='case_get' THEN
  SELECT value INTO v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'lock_id'=q->>'id';IF v IS NULL THEN PERFORM fail('NOT_FOUND');END IF;
  SELECT * INTO c FROM claims WHERE ns=n AND id=v->>'id';RETURN c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('id',q->>'id','voucher',c.id);END IF;
 IF op IN('support_review','claim_review','settle_review') THEN
  IF (SELECT count(*) FROM reviews WHERE ns=n AND subject=s.subject AND expires>now AND NOT used)>=20 THEN PERFORM fail('QUEUE_FULL');END IF;
  IF op='settle_review' THEN
   SELECT value INTO u FROM jsonb_array_elements(t.rows->'units') WHERE value->>'voucher_id'=q->>'voucher' AND value->>'bucket'='H';IF u IS NULL THEN PERFORM fail('NOT_SETTLEABLE');END IF;p=jsonb_build_object('voucherId',q->>'voucher','generation',u->>'generation','amount',u->>'price','deadline',(now+600)::text);
  ELSE
   IF q->>'meal' IS DISTINCT FROM t.meal OR NOT coalesce((t.snapshot->'menu'->('0x'||t.meal)->>'listed')::boolean,false) OR (t.rows->'controls'->>'paused')::boolean OR (t.rows->'controls'->>'closed')::boolean THEN PERFORM fail('UNAVAILABLE');END IF;
   j=t.snapshot->'menu'->('0x'||t.meal);p=jsonb_build_object('mealId','0x'||t.meal,'currentVersion',j->>'currentVersion','termsHash',j->'candidate'->>'termsHash','unitPrice',j->'terms'->>'unitPrice','deadline',(now+600)::text);
   IF op='support_review' THEN
    SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;
    IF NOT coalesce(b.enabled,false) OR b.identity_revision<>s.identity_revision OR b.credential_epoch<>s.epoch OR b.verified_until<=now THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;
    IF (q->>'quantity')::int NOT BETWEEN 1 AND 10 OR (t.rows->'controls'->>'lifetime')::int+(q->>'quantity')::int+coalesce((SELECT sum((parameters->>'quantity')::int) FROM intents WHERE ns=n AND store=t.store AND action='fund' AND stage<>'FINAL_SUCCEEDED'),0)>10 THEN PERFORM fail('CAPACITY');END IF;
    -- Funding terms hash comes from trusted current terms, not candidate availability.
    p=p||jsonb_build_object('payer',b.owner,'termsHash',j->'terms'->>'termsHash','quantity',(q->>'quantity'),'amount',(((q->>'quantity')::numeric)*(j->'terms'->>'unitPrice')::numeric)::text);
   ELSE
    IF NOT coalesce((j->'candidate'->>'available')::boolean,false) OR EXISTS(SELECT 1 FROM claims cc JOIN stores ct ON ct.ns=cc.ns AND ct.store=cc.store WHERE cc.ns=n AND cc.recipient_key=ident.recipient_key AND c1_live_private.voucher_dto(n,cc,ct)->>'state'='R' AND NOT coalesce((c1_live_private.voucher_dto(n,cc,ct)->>'marked')::boolean,false) AND (c1_live_private.voucher_dto(n,cc,ct)->>'expiresAt')::bigint>now) OR EXISTS(SELECT 1 FROM intents WHERE ns=n AND recipient_key=ident.recipient_key AND action='issue' AND stage<>'FINAL_SUCCEEDED') THEN PERFORM fail('CLAIM_UNAVAILABLE');END IF;
    p=jsonb_build_object('mealId','0x'||t.meal,'expectedUnitSeq',j->'candidate'->>'unitSeq','expectedNextGeneration',j->'candidate'->>'nextGeneration','expectedTermsHash',j->'candidate'->>'termsHash','deadline',(now+600)::text);
   END IF;
  END IF;
  INSERT INTO reviews VALUES(n,(q->>'review_id')::uuid,s.subject,t.store,replace(op,'_review',''),p,t.revision,s.identity_revision,CASE WHEN op='support_review' THEN b.revision ELSE NULL END,now+300,false,1);
  RETURN jsonb_build_object('reviewId',q->>'review_id','store',t.store,'review',p||t.profile->'firstMeal'||jsonb_build_object('reviewId',q->>'review_id','expiresAt',now+300,'collectionTimeZone','UTC'));END IF;
 IF op IN('support_confirm','claim_confirm','settle_confirm') THEN
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND action=CASE op WHEN 'support_confirm' THEN 'fund' WHEN 'claim_confirm' THEN 'issue' ELSE 'settle' END AND idem=q->>'key';
  IF FOUND THEN IF i.client IS DISTINCT FROM q->'client' THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;
  IF (SELECT count(*) FROM intents WHERE ns=n AND stage<>'FINAL_SUCCEEDED')>=24 THEN PERFORM fail('QUEUE_FULL');END IF;
  SELECT * INTO r FROM reviews WHERE ns=n AND id=(q->'client'->>'reviewId')::uuid AND subject=s.subject FOR UPDATE;
  IF r.id IS NULL OR r.store<>t.store OR r.used OR r.expires<=now OR r.store_revision<>t.revision OR r.identity_revision<>s.identity_revision OR r.kind<>replace(op,'_confirm','') THEN PERFORM fail('STALE_REVIEW');END IF;
  IF r.kind='support' THEN SELECT * INTO b FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject;IF b.revision IS DISTINCT FROM r.wallet_revision OR b.owner IS DISTINCT FROM r.payload->>'payer' OR NOT b.enabled OR b.verified_until<=now THEN PERFORM fail('PAYER_BINDING_CHANGED');END IF;END IF;
  INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) VALUES(n,(q->>'new_id')::uuid,s.subject,ident.recipient_key,t.store,CASE r.kind WHEN 'support' THEN 'fund' WHEN 'claim' THEN 'issue' ELSE 'settle' END,q->>'key',q->'client',r.payload||jsonb_build_object('opId',q->>'op_id'),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
  IF r.kind='claim' THEN INSERT INTO leases VALUES(n,t.store,r.payload->>'expectedUnitSeq',r.payload->>'expectedNextGeneration','issue',i.id);ELSIF r.kind='settle' THEN SELECT value INTO u FROM jsonb_array_elements(t.rows->'units') WHERE value->>'voucher_id'=r.payload->>'voucherId';INSERT INTO leases VALUES(n,t.store,u->>'seq',r.payload->>'generation','settle',i.id);END IF;
  UPDATE reviews SET used=true,revision=revision+1 WHERE ns=n AND id=r.id;RETURN c1_live_private.intent_dto(i);END IF;
 IF op IN('code_check','lock_confirm') THEN
  IF op='lock_confirm' THEN SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND store=t.store AND action='lock' AND idem=q->>'key';IF FOUND THEN IF i.client IS DISTINCT FROM jsonb_build_object('display_hash',q->>'display_hash') THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;END IF;
  SELECT * INTO cred FROM credentials WHERE ns=n AND hash=q->>'display_hash' AND kind='display' AND active AND valid_until>now;
  SELECT * INTO c FROM claims WHERE ns=n AND id=cred.voucher AND store=t.store;
  IF c.id IS NULL OR cred.access_epoch<>c.access_epoch OR cred.display_epoch<>c.display_epoch OR cred.credential_epoch<>d.credential_epoch OR NOT EXISTS(SELECT 1 FROM c1_private.sessions ss JOIN c1_private.identities ii ON ii.ns=ss.ns AND ii.subject=ss.subject JOIN c1_private.external_session_expiry ee ON ee.ns=ss.ns AND ee.hash=ss.hash WHERE ss.ns=n AND ss.hash=c1_private.h(cred.session_hash) AND NOT ss.revoked AND ss.identity_revision=ii.revision AND ss.epoch=d.credential_epoch AND ee.expires_at>now) OR NOT c1_live_private.redeemable(n,c,t,now) THEN PERFORM fail('INVALID_CODE');END IF;
  IF op='code_check' THEN RETURN c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('valid',true);END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND action='lock' AND idem=q->>'key';IF FOUND THEN RETURN c1_live_private.intent_dto(i);END IF;
  UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=c.id AND active;
  UPDATE claims SET access_epoch=access_epoch+1,display_epoch=display_epoch+1,revision=revision+1 WHERE ns=n AND id=c.id;
  INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) VALUES(n,(q->>'new_id')::uuid,s.subject,ident.recipient_key,t.store,'lock',q->>'key',jsonb_build_object('display_hash',q->>'display_hash'),jsonb_build_object('opId',q->>'op_id','voucherId',c.id,'generation',c.generation,'deadline',(now+120)::text),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
  INSERT INTO leases VALUES(n,t.store,c.seq,c.generation,'lock',i.id);RETURN c1_live_private.intent_dto(i);END IF;
 IF op='handover_confirm' THEN
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND store=t.store AND action='markHandover' AND idem=q->>'key';IF FOUND THEN IF i.client IS DISTINCT FROM jsonb_build_object('caseId',q->>'case_id') THEN PERFORM fail('IDEMPOTENCY_CONFLICT');END IF;RETURN c1_live_private.intent_dto(i);END IF;
  SELECT value INTO v FROM jsonb_array_elements(t.rows->'vouchers') WHERE value->>'lock_id'=q->>'case_id' AND value->>'marker_id' IS NULL;
  SELECT * INTO i FROM intents WHERE ns=n AND store=t.store AND action='lock' AND op_id=q->>'case_id' AND subject=s.subject AND stage='FINAL_SUCCEEDED';
  IF v IS NULL OR i.id IS NULL THEN PERFORM fail('ORIGINAL_LOCK_OWNER_REQUIRED');END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND subject=s.subject AND action='markHandover' AND idem=q->>'key';IF FOUND THEN RETURN c1_live_private.intent_dto(i);END IF;
  INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage) VALUES(n,(q->>'new_id')::uuid,s.subject,ident.recipient_key,t.store,'markHandover',q->>'key',jsonb_build_object('caseId',q->>'case_id'),jsonb_build_object('opId',q->>'op_id','voucherId',v->>'id','generation',v->>'generation','lockId',q->>'case_id','deadline',(now+120)::text),q->>'session_hash',q->>'csrf_hash',s.identity_revision,s.epoch,q->>'op_id','ACCEPTED') RETURNING * INTO i;
  INSERT INTO leases VALUES(n,t.store,v->>'seq',v->>'generation','markHandover',i.id);
  UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=v->>'id' AND active;RETURN c1_live_private.intent_dto(i);END IF;
 IF op IN('recover','display') THEN
  SELECT * INTO c FROM claims WHERE ns=n AND id=q->>'voucher' AND recipient_key=ident.recipient_key FOR UPDATE;IF NOT FOUND OR c.store<>t.store THEN PERFORM fail('NOT_FOUND');END IF;
  SELECT z.result INTO result FROM token_ops z WHERE ns=n AND subject=s.subject AND kind=op AND idem=q->>'key';IF FOUND THEN RETURN result||jsonb_build_object('replay',true);END IF;
  IF op='recover' THEN
   UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=c.id AND active;
   UPDATE claims SET access_epoch=access_epoch+1,display_epoch=display_epoch+1,revision=revision+1 WHERE ns=n AND id=c.id RETURNING * INTO c;
   INSERT INTO c1_private.sessions(ns,hash,csrf,subject,identity_revision,epoch,created,activity,authenticated) VALUES(n,c1_private.h(q->>'new_session_hash'),c1_private.h(q->>'new_csrf_hash'),s.subject,s.identity_revision,s.epoch,now,now,s.authenticated);
   INSERT INTO c1_private.external_session_expiry SELECT ns,c1_private.h(q->>'new_session_hash'),expires_at FROM c1_private.external_session_expiry WHERE ns=n AND hash=s.hash;
   UPDATE c1_private.sessions SET revoked=true,revision=revision+1 WHERE ns=n AND hash=s.hash;
   IF c1_live_private.redeemable(n,c,t,now) THEN INSERT INTO credentials VALUES(n,q->>'new_access_hash','access',c.id,q->>'new_session_hash',s.identity_revision,s.epoch,c.access_epoch,c.display_epoch,now+86400,true,1);END IF;
   result=c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('redeemable',c1_live_private.redeemable(n,c,t,now));
  ELSE
   IF NOT EXISTS(SELECT 1 FROM credentials WHERE ns=n AND hash=q->>'access_hash' AND kind='access' AND voucher=c.id AND session_hash=q->>'session_hash' AND active AND valid_until>now AND credential_epoch=s.epoch AND identity_revision=s.identity_revision AND access_epoch=c.access_epoch) OR NOT c1_live_private.redeemable(n,c,t,now) THEN PERFORM fail('INVALID_CODE');END IF;
   UPDATE credentials SET active=false,revision=revision+1 WHERE ns=n AND voucher=c.id AND kind='display' AND active;
   UPDATE claims SET display_epoch=display_epoch+1,revision=revision+1 WHERE ns=n AND id=c.id RETURNING * INTO c;
   INSERT INTO credentials VALUES(n,q->>'new_display_hash','display',c.id,q->>'session_hash',s.identity_revision,s.epoch,c.access_epoch,c.display_epoch,least(now+120,(c1_live_private.voucher_dto(n,c,t)->>'expiresAt')::bigint,c1_live_private.utc_window_end(t,c.id,now),(SELECT ee.expires_at FROM c1_private.external_session_expiry ee WHERE ee.ns=n AND ee.hash=s.hash)),true,1);
   result=c1_live_private.voucher_dto(n,c,t)||jsonb_build_object('validUntil',least(now+120,(c1_live_private.voucher_dto(n,c,t)->>'expiresAt')::bigint,c1_live_private.utc_window_end(t,c.id,now),(SELECT ee.expires_at FROM c1_private.external_session_expiry ee WHERE ee.ns=n AND ee.hash=s.hash)));
  END IF;
  INSERT INTO token_ops VALUES(n,s.subject,op,q->>'key',c.id,result);RETURN result;END IF;
 PERFORM fail('LIVE_OPERATION_NOT_IMPLEMENTED');RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION c1_runtime_internal.live_projection(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE t stores;r c1_private.store_registrations;i intents;old receipts;rows jsonb=q->'rows';snap jsonb=q->'snapshot';receipt jsonb=rows->'receipt';v jsonb;j jsonb;b numeric;report_id uuid;BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);
 SELECT * INTO t FROM stores WHERE ns=n AND store=q->>'store' FOR UPDATE;
 IF t.store IS NULL THEN
  SELECT * INTO r FROM c1_private.store_registrations WHERE ns=n AND id=q->>'registrationId' AND state='CONFIRMED';
  IF r.id IS NULL OR r.record IS DISTINCT FROM q->'registrationRecord' OR q->>'store' IS DISTINCT FROM substring(r.store_id FROM 3) OR q->'profile'->'registrationEvidence' IS DISTINCT FROM r.record->'verifiedEvidence'
  OR q->'profile'->'binding' IS DISTINCT FROM (SELECT jsonb_object_agg(k,CASE WHEN k='chainId' THEN to_jsonb((r.record->'verifiedEvidence'->>k)::bigint) ELSE r.record->'verifiedEvidence'->k END) FROM unnest(ARRAY['chainId','escrow','asset','storeId','owner','receiver','quoteAuthority','catalogAuthority','issuerAuthority','operatorAuthority']) AS x(k)) THEN PERFORM fail('VERIFIED_REGISTRATION_REQUIRED');END IF;
  INSERT INTO stores(ns,store,registration_id,meal,profile) VALUES(n,q->>'store',r.id,substring(r.record->'original'->'catalog'->0->'terms'->>'mealId' FROM 3),q->'profile') RETURNING * INTO t;
 ELSE
  IF t.revision IS DISTINCT FROM (q->>'expectedRevision')::bigint OR t.profile IS DISTINCT FROM q->'profile' THEN PERFORM fail('PROJECTION_CAS_CONFLICT');END IF;
 END IF;
 IF rows->>'schema' IS DISTINCT FROM 'CP30_CHAIN_PROJECTION_V1' OR rows->'snapshot'->>'blockHash' IS DISTINCT FROM snap->>'blockHash' OR rows->'snapshot'->>'blockNumber' IS DISTINCT FROM snap->>'blockNumber' OR snap->>'authority' IS DISTINCT FROM 'CANONICAL_FINALIZED_CHAIN_FACTS'
 OR (snap->>'chainId')::int IS DISTINCT FROM (t.profile->'binding'->>'chainId')::int OR snap->>'escrow' IS DISTINCT FROM t.profile->'binding'->>'escrow' THEN PERFORM fail('VERIFIED_PROJECTION_REQUIRED');END IF;
 b=(snap->>'blockNumber')::numeric;
 IF t.snapshot IS NOT NULL AND b=(t.snapshot->>'blockNumber')::numeric AND snap->>'blockHash' IS DISTINCT FROM t.snapshot->>'blockHash' THEN PERFORM fail('CANONICAL_WATERMARK_CONFLICT');END IF;
 IF receipt IS NOT NULL THEN
  SELECT * INTO i FROM intents WHERE ns=n AND id=(receipt->>'intentId')::uuid FOR UPDATE;
  SELECT * INTO old FROM receipts WHERE ns=n AND intent=i.id;
  IF old.intent IS NOT NULL THEN IF old.proof IS DISTINCT FROM receipt->'proof' THEN PERFORM fail('ORIGINAL_RECEIPT_CONFLICT');END IF;RETURN jsonb_build_object('replay',true);END IF;
  IF i.id IS NULL OR i.store<>t.store OR i.revision IS DISTINCT FROM (q->>'intentRevision')::bigint OR i.observer_record IS DISTINCT FROM receipt->'original' OR i.transaction_hash IS DISTINCT FROM receipt->>'transactionHash'
  OR receipt->>'functionName' IS DISTINCT FROM i.action OR receipt->>'store' IS DISTINCT FROM t.store OR receipt->'proof'->>'authority' IS DISTINCT FROM 'VERIFIED_ORIGINAL_CHAIN_OPERATION' OR receipt->'proof'->'original' IS DISTINCT FROM i.observer_record THEN PERFORM fail('ORIGINAL_RECEIPT_REQUIRED');END IF;
  IF i.action IN('fund','settle') AND NOT EXISTS(SELECT 1 FROM wallet_attempts WHERE ns=n AND intent=i.id AND kind=i.action AND hash=i.transaction_hash AND deployment=i.observer_record->'deployment') THEN PERFORM fail('ORIGINAL_WALLET_ATTEMPT_REQUIRED');END IF;
  INSERT INTO receipts VALUES(n,i.id,receipt->>'transactionHash',(receipt->>'blockNumber')::numeric,receipt->>'blockHash',(receipt->>'logIndex')::numeric,receipt->'proof',1);
  IF i.action='issue' THEN
   v=receipt->'event'->'args';
   IF v->>'unitSeq' IS DISTINCT FROM i.parameters->>'expectedUnitSeq' OR v->>'generation' IS DISTINCT FROM i.parameters->>'expectedNextGeneration' OR v->>'termsHash' IS DISTINCT FROM i.parameters->>'expectedTermsHash' THEN PERFORM fail('ORIGINAL_ISSUE_CANDIDATE_REQUIRED');END IF;
   INSERT INTO claims(ns,id,intent,store,subject,recipient_key,seq,generation) VALUES(n,v->>'voucherId',i.id,t.store,i.subject,i.recipient_key,v->>'unitSeq',v->>'generation');
  END IF;
  UPDATE intents SET stage='FINAL_SUCCEEDED',result=jsonb_build_object('result',CASE WHEN i.action='fund' THEN receipt->'event'->'args'->>'batchId' ELSE receipt->'operation'->>'result' END,'transactionHash',receipt->>'transactionHash','blockHash',receipt->>'blockHash'),revision=revision+1 WHERE ns=n AND id=i.id;
  IF i.action='markHandover' THEN
   report_id=(q->>'reportIntentId')::uuid;
   INSERT INTO intents(ns,id,subject,recipient_key,store,action,idem,client,parameters,session_hash,csrf_hash,identity_revision,credential_epoch,op_id,stage,parent) VALUES(n,report_id,i.subject,i.recipient_key,t.store,'report','report:'||i.id,jsonb_build_object('parent',i.id),jsonb_build_object('opId',q->>'reportOpId','voucherId',i.parameters->>'voucherId','generation',i.parameters->>'generation','lockId',i.parameters->>'lockId','markerId',receipt->'operation'->>'result'),i.session_hash,i.csrf_hash,i.identity_revision,i.credential_epoch,q->>'reportOpId','ACCEPTED',i.id);
  END IF;
 END IF;
 -- Older original receipts are retained without rolling back newer actual facts.
 IF t.snapshot IS NULL OR b>=(t.snapshot->>'blockNumber')::numeric THEN
  IF t.snapshot IS NOT NULL AND b=(t.snapshot->>'blockNumber')::numeric THEN
   IF (t.snapshot-'operations'-'vouchers') IS DISTINCT FROM (snap-'operations'-'vouchers') OR EXISTS(SELECT 1 FROM jsonb_each(t.snapshot->'operations') z WHERE snap->'operations' ? z.key AND snap->'operations'->z.key IS DISTINCT FROM z.value) OR EXISTS(SELECT 1 FROM jsonb_each(t.snapshot->'vouchers') z WHERE snap->'vouchers' ? z.key AND snap->'vouchers'->z.key IS DISTINCT FROM z.value) THEN PERFORM fail('SAME_BLOCK_FACT_CONFLICT');END IF;
   snap=snap||jsonb_build_object('operations',(t.snapshot->'operations')||(snap->'operations'),'vouchers',(t.snapshot->'vouchers')||(snap->'vouchers'));
  END IF;
  UPDATE stores SET snapshot=snap,rows=rows-'receipt',revision=revision+1 WHERE ns=n AND store=t.store;
 END IF;
 UPDATE credentials cr SET active=false,revision=cr.revision+1 WHERE cr.ns=n AND cr.active AND cr.voucher IN(SELECT value->>'id' FROM jsonb_array_elements(rows->'vouchers') WHERE value->>'lock_id' IS NOT NULL OR value->>'marker_id' IS NOT NULL OR value->>'report_id' IS NOT NULL OR value->>'settle_id' IS NOT NULL OR (value->>'expired')::boolean);
 RETURN jsonb_build_object('projected',true,'originalConfirmed',receipt IS NOT NULL);END $$;
GRANT SELECT ON c1_private.wallet_principals TO c1_live_code_owner;
