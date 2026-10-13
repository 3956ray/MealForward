-- Forward function-only correction for 026 SQLSTATE 42702.
-- Original installed 026 and all retained operations remain unchanged.
-- CREATE OR REPLACE preserves the existing owner and ACL.
CREATE OR REPLACE FUNCTION c1_api.security_apply(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_private,pg_temp AS $$
DECLARE d deployment;m security_mutations;p jsonb;pre pre_sessions;c wallet_login_challenges;i identities;w wallet_principals;x wallet_login_installation;v_result jsonb;f jsonb;BEGIN
 SELECT * INTO m FROM security_mutations WHERE ns=n AND id=(q->>'mutation_id')::uuid;
 IF m.kind NOT IN('wallet_login_challenge','wallet_login') THEN
  v_result=c1_api.security_apply_dynamic_email(n,q);
  IF m.kind='external_login' THEN UPDATE identities SET recipient_key=email_key WHERE ns=n AND subject=m.command->>'subject_hash' AND auth_kind='dynamic_email';END IF;
  RETURN v_result;
 END IF;
 d=guard(n,false,(q->>'mutation_id')::uuid);SELECT * INTO m FROM security_mutations WHERE ns=n AND id=(q->>'mutation_id')::uuid FOR UPDATE;
 IF m.state<>'PREPARED' OR m.sequence<>(q->>'sequence')::bigint OR m.digest<>q->>'digest'
 OR (SELECT security_pending FROM transaction_guard WHERE ns=n) IS DISTINCT FROM m.id THEN PERFORM fail('STALE_PREPARE');END IF;
 p=m.command;SELECT * INTO x FROM wallet_login_installation WHERE ns=n;IF NOT coalesce(x.enabled,false) OR x.activation_expires_at<=d.now THEN PERFORM fail('WALLET_LOGIN_DISABLED');END IF;
 SELECT * INTO pre FROM pre_sessions WHERE ns=n AND hash=h(p->>'pre_hash') FOR UPDATE;
 IF pre.hash IS NULL OR pre.used OR pre.expires<=d.now OR pre.csrf IS DISTINCT FROM h(p->>'csrf_hash') THEN PERFORM fail('CSRF');END IF;
 IF m.kind='wallet_login_challenge' THEN
  INSERT INTO wallet_login_challenges(ns,id,pre_hash,payload,nonce,expires_at) VALUES(n,(p->'challenge'->>'challengeId')::uuid,pre.hash,p->'challenge',p->'challenge'->>'nonce',(p->'challenge'->>'expiresAt')::bigint);
  v_result=jsonb_build_object('challenge',p->'challenge');f=jsonb_build_object('wallet_challenge:'||(p->'challenge'->>'challengeId'),1);
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
  v_result=jsonb_build_object('authenticated',true,'authKind','wallet','walletAddress',p->>'wallet_address','walletBound',true,'expiresAt',(p->>'expires_at')::bigint);
  f=jsonb_build_object('identity:'||i.subject,i.revision,'session:'||(p->>'new_session_hash'),1,'wallet_challenge:'||c.id,2,'owner:'||i.subject,1);
 END IF;
 INSERT INTO security_commits VALUES(n,m.id,m.sequence,m.digest,v_result,f);UPDATE security_mutations SET state='APPLIED',result=v_result WHERE ns=n AND id=m.id;RETURN v_result;END $$;
