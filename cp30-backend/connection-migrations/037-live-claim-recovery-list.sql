-- Read only: recover original issue intents for the authenticated recipient.
-- Future support quotes get 30 minutes; existing originals and review expiry are unchanged.
-- Preserve authoritative review payload; display content cannot override it.
CREATE OR REPLACE FUNCTION c1_runtime_internal.live_api(n text,q jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,c1_live_private,c1_private,pg_temp AS $$
DECLARE op text=q->>'op';s c1_private.sessions;d c1_private.deployment;t stores;i intents;r reviews;c claims;cred credentials;ident c1_private.identities;b c1_private.verified_owner_bindings;v jsonb;u jsonb;p jsonb;j jsonb;result jsonb;store_key text;route_store text=q->>'store';now bigint;is_read boolean=op IN('public_stores','public_meals','public_meal','public_ledger','my_orders','order_get','intent_get','my_claims','my_vouchers','voucher_get','workbench','case_get','payouts','wallet_material','auth_me');BEGIN
 PERFORM c1_runtime_private.check_open(n,q->'ticket');PERFORM c1_runtime_private.base_guard(n,true,NULL);SELECT * INTO d FROM c1_private.deployment WHERE ns=n;now=d.now;
 IF NOT is_read AND NOT EXISTS(SELECT 1 FROM c1_live_private.first_binding WHERE ns=n AND state='BOUND') THEN PERFORM c1_private.fail('BUSINESS_BINDING_PENDING');END IF;
 IF op NOT IN('public_stores','public_meals','public_meal','public_ledger') THEN s=c1_live_private.context(n,q,NOT is_read);SELECT * INTO ident FROM c1_private.identities WHERE ns=n AND subject=s.subject;END IF;
 IF op='auth_me' THEN RETURN jsonb_build_object('displayName',(CASE WHEN ident.auth_kind='wallet' THEN '钱包 '||(SELECT wallet_address FROM c1_private.wallet_principals WHERE ns=n AND subject=s.subject) ELSE 'Signed in' END),'authKind',ident.auth_kind,'walletAddress',(SELECT wallet_address FROM c1_private.wallet_principals WHERE ns=n AND subject=s.subject),'walletBound',EXISTS(SELECT 1 FROM c1_private.verified_owner_bindings WHERE ns=n AND subject=s.subject AND enabled),'realIdentity',true);END IF;
 IF op='public_stores' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',store,'store',store,'name',profile->'request'->>'name','controlRevision',rows->'controls'->>'control_revision')) FROM stores WHERE ns=n),'[]'));END IF;
 IF op='public_ledger' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('store',store,'financial',rows->'accounting'->'totals','funded',rows->'accounting'->'totals'->'counts'->>'F')) FROM stores WHERE ns=n),'[]'));END IF;
 IF op IN('my_orders','order_get','intent_get') THEN
  IF op='my_orders' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.intent_dto(z)||jsonb_build_object('quantity',z.parameters->>'quantity','amount',z.parameters->>'amount')) FROM intents z WHERE ns=n AND subject=s.subject AND action='fund'),'[]'));END IF;
  SELECT * INTO i FROM intents WHERE ns=n AND id=(q->>'id')::uuid AND subject=s.subject;IF NOT FOUND THEN PERFORM fail('NOT_FOUND');END IF;RETURN c1_live_private.intent_dto(i);END IF;
 IF op='my_claims' THEN RETURN jsonb_build_object('items',coalesce((SELECT jsonb_agg(c1_live_private.intent_dto(z) ORDER BY z.id) FROM intents z WHERE ns=n AND subject=s.subject AND recipient_key=ident.recipient_key AND action='issue'),'[]'));END IF;
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
    p=p||jsonb_build_object('deadline',(now+1800)::text);
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
  RETURN jsonb_build_object('reviewId',q->>'review_id','store',t.store,'review',(t.profile->'firstMeal')||p||jsonb_build_object('reviewId',q->>'review_id','expiresAt',now+300,'collectionTimeZone','UTC'));END IF;
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
