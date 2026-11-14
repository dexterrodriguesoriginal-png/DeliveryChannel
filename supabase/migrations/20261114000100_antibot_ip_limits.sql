-- Limites por IP compartilhado; identificadores mantêm os limites individuais.
-- Constantes alteráveis somente por quem pode redefinir a função (owner).
BEGIN;
CREATE OR REPLACE FUNCTION private.antibot_guard(operation text, identifier text, checkout boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
 ip_checkout_limit CONSTANT integer := 300;
 ip_coupon_limit CONSTANT integer := 600;
 identity_checkout_limit CONSTANT integer := 20;
 identity_coupon_limit CONSTANT integer := 60;
 headers jsonb := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 config private.antibot_config; secret text; ip text; ip_hash text; subject text; n integer;
 allowed boolean := true; reason text; response jsonb; token text;
BEGIN
 SELECT * INTO STRICT config FROM private.antibot_config WHERE singleton;
 IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
   EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1 LIMIT 1' INTO secret USING 'delivery_turnstile_secret';
 END IF;
 -- Last forwarded hop is ingress-added. Never trust the first, client-supplied hop.
 ip := coalesce(nullif(trim(headers->>'cf-connecting-ip'),''),nullif(trim(headers->>'x-real-ip'),''),
   nullif(trim(reverse(split_part(reverse(headers->>'x-forwarded-for'),',',1))),''),'unknown');
 ip_hash := public._sha256_hex(config.hash_secret || ':ip:' || ip);
 PERFORM private.antibot_cleanup();
 -- All identities are salted hashes; e-mail/phone/IP never enter persisted records.
 -- Gate the IP first: blocked clients cannot grow counters by rotating phones.
 FOR subject IN SELECT x FROM (SELECT DISTINCT x FROM unnest(ARRAY[ip_hash,
   CASE WHEN nullif(trim(identifier),'') IS NOT NULL THEN public._sha256_hex(config.hash_secret || ':id:' || lower(trim(identifier))) END,
   CASE WHEN auth.uid() IS NOT NULL THEN public._sha256_hex(config.hash_secret || ':user:' || auth.uid()::text) END]) x WHERE x IS NOT NULL) subjects ORDER BY (x<>ip_hash),x
 LOOP
   INSERT INTO public.antibot_counters AS c(scope,subject_hash,attempts,reset_at)
   VALUES(CASE WHEN checkout THEN 'checkout' ELSE 'coupon' END,subject,1,clock_timestamp()+interval '10 minutes')
   ON CONFLICT(scope,subject_hash) DO UPDATE SET
     attempts=CASE WHEN c.reset_at<=clock_timestamp() THEN 1 ELSE least(c.attempts+1,1000000) END,
     reset_at=CASE WHEN c.reset_at<=clock_timestamp() THEN clock_timestamp()+interval '10 minutes' ELSE c.reset_at END
   RETURNING attempts INTO n;
   IF n > (CASE WHEN subject=ip_hash THEN
     CASE WHEN checkout THEN ip_checkout_limit ELSE ip_coupon_limit END
     ELSE CASE WHEN checkout THEN identity_checkout_limit ELSE identity_coupon_limit END END) THEN allowed:=false; EXIT; END IF;
 END LOOP;
 IF NOT allowed THEN reason:='RATE_LIMITED';
 ELSIF checkout AND nullif(secret,'') IS NOT NULL THEN
   token:=headers->>'x-turnstile-token';
   IF token IS NULL OR token !~ '^[a-zA-Z0-9_.-]+$' OR length(token)>2048 OR cardinality(config.allowed_hostnames)=0 THEN reason:='CAPTCHA_REQUIRED';
   ELSE
     BEGIN
       PERFORM set_config('http.curlopt_timeout_msec','5000',true);
       -- http extension is enabled only when activating Turnstile; no outbound call when disabled.
       EXECUTE 'SELECT content::jsonb FROM extensions.http_post($1,$2,$3)'
       INTO response USING 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
         'secret=' || secret || '&response=' || token, 'application/x-www-form-urlencoded';
       IF coalesce(response->>'success','false')<>'true' OR response->>'action' IS DISTINCT FROM 'checkout'
          OR NOT coalesce((response->>'hostname')=ANY(config.allowed_hostnames),false) THEN reason:='CAPTCHA_INVALID'; END IF;
     EXCEPTION WHEN OTHERS THEN reason:='CAPTCHA_UNAVAILABLE'; END;
   END IF;
 END IF;
 IF reason IS NOT NULL THEN
   INSERT INTO public.antibot_audit AS a(operation,reason,ip_hash) VALUES(operation,reason,ip_hash)
   ON CONFLICT ON CONSTRAINT antibot_audit_operation_reason_ip_hash_window_start_key DO UPDATE
     SET blocked_attempts=least(a.blocked_attempts+1,1000000);
 END IF;
 RETURN reason;
END $$;
REVOKE ALL ON FUNCTION private.antibot_guard(text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
