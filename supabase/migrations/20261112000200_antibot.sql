-- Proposta: não aplicar automaticamente em produção.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
-- Do not change ACLs of a pre-existing shared private schema.
CREATE TABLE private.antibot_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 allowed_hostnames text[] NOT NULL DEFAULT '{}',
 hash_secret text NOT NULL DEFAULT gen_random_uuid()::text || gen_random_uuid()::text
);
INSERT INTO private.antibot_config(singleton) VALUES(true);
CREATE TABLE public.antibot_counters (
 scope text NOT NULL, subject_hash text NOT NULL, attempts integer NOT NULL,
 reset_at timestamptz NOT NULL, PRIMARY KEY(scope,subject_hash)
);
CREATE TABLE public.antibot_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, operation text NOT NULL,
 reason text NOT NULL, ip_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 window_start timestamptz NOT NULL DEFAULT to_timestamp(floor(extract(epoch FROM clock_timestamp())/600)*600),
 blocked_attempts integer NOT NULL DEFAULT 1, UNIQUE(operation,reason,ip_hash,window_start)
);
CREATE INDEX antibot_counters_expiry ON public.antibot_counters(reset_at);
CREATE INDEX antibot_audit_created ON public.antibot_audit(created_at);
ALTER TABLE private.antibot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.antibot_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.antibot_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.antibot_config,public.antibot_counters,public.antibot_audit FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.antibot_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.antibot_audit TO authenticated;
CREATE POLICY antibot_platform_read ON public.antibot_audit FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=auth.uid() AND tu.status='ACTIVE' AND tu.role_id IN ('CEO','SUPER_ADMIN'))
);

CREATE FUNCTION private.antibot_cleanup() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM public.antibot_counters WHERE reset_at < clock_timestamp() - interval '1 day';
 DELETE FROM public.antibot_audit WHERE created_at < clock_timestamp() - interval '30 days';
$$;
REVOKE ALL ON FUNCTION private.antibot_cleanup() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.antibot_guard(operation text, identifier text, checkout boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
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
   IF n > (CASE WHEN checkout THEN 20 ELSE 60 END) THEN allowed:=false; EXIT; END IF;
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

-- Keep the exact public signatures, defaults and ACLs. Save full definitions for rollback.
-- Private copies retain all existing business validations; wrappers count even failed business calls.
CREATE TABLE private.antibot_originals(signature text PRIMARY KEY, definition text NOT NULL, private_signature text NOT NULL);
ALTER TABLE private.antibot_originals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.antibot_originals FROM PUBLIC,anon,authenticated,service_role;
DO $install$
DECLARE f record; args text; identifier text; result_expr text; body text; copied text;
BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,pg_get_function_identity_arguments(p.oid) identity_args,
   pg_get_function_arguments(p.oid) full_args,pg_get_function_result(p.oid) result_type,pg_get_functiondef(p.oid) definition
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('process_checkout_atomic','process_checkout_atomic_v2','process_checkout_atomic_v3','process_promotional_checkout_atomic','validate_coupon')
 LOOP
   IF f.result_type NOT IN ('jsonb','uuid') THEN RAISE EXCEPTION 'ANTIBOT_UNEXPECTED_RETURN_TYPE'; END IF;
   SELECT string_agg(format('%I',a),', ' ORDER BY i) INTO args FROM unnest(f.proargnames) WITH ORDINALITY t(a,i);
   identifier := CASE WHEN 'p_customer_phone'=ANY(f.proargnames) THEN 'regexp_replace(p_customer_phone,''[^0-9]'','''',''g'')'
     ELSE 'coalesce(nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''email'',auth.uid()::text)' END;
   copied := replace(f.definition,'FUNCTION public.' || f.proname || '(', 'FUNCTION private.antibot_' || f.proname || '(');
   EXECUTE copied;
   EXECUTE format('ALTER FUNCTION private.antibot_%I(%s) SET search_path TO ''''',f.proname,f.identity_args);
   EXECUTE format('REVOKE ALL ON FUNCTION private.antibot_%I(%s) FROM PUBLIC,anon,authenticated,service_role',f.proname,f.identity_args);
   INSERT INTO private.antibot_originals VALUES(format('public.%I(%s)',f.proname,f.identity_args),f.definition,format('private.antibot_%I(%s)',f.proname,f.identity_args));
   result_expr:=CASE WHEN f.result_type='jsonb' THEN 'jsonb_build_object(''code'',reason,''message'',message)' ELSE 'NULL' END;
   body:=format($body$
DECLARE reason text; message text; result %s; nested boolean:=coalesce(current_setting('dc.antibot_nested',true),'')='yes';
BEGIN
 IF NOT nested THEN
   reason:=private.antibot_guard(%L,%s,%L);
   IF reason IS NOT NULL THEN
     message:=CASE WHEN reason='RATE_LIMITED' THEN 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.' ELSE 'Não foi possível verificar a segurança. Tente novamente.' END;
     PERFORM set_config('response.status',CASE WHEN reason='RATE_LIMITED' THEN '429' ELSE '403' END,true);
     PERFORM set_config('response.headers',jsonb_build_array(jsonb_build_object('x-antibot-error-base64',translate(encode(convert_to(jsonb_build_object('code',reason,'message',message)::text,'UTF8'),'base64'),E'\n\r','')),jsonb_build_object('Access-Control-Expose-Headers','x-antibot-error-base64'))::text,true);
     RETURN %s;
   END IF;
 END IF;
 BEGIN
   PERFORM set_config('dc.antibot_nested','yes',true);
   result:=private.antibot_%I(%s);
   PERFORM set_config('dc.antibot_nested',CASE WHEN nested THEN 'yes' ELSE '' END,true);
   RETURN result;
 EXCEPTION WHEN OTHERS THEN
   IF nested THEN RAISE; END IF;
   reason:=SQLSTATE; message:=SQLERRM;
   PERFORM set_config('response.status','400',true);
   PERFORM set_config('response.headers',jsonb_build_array(jsonb_build_object('x-antibot-error-base64',translate(encode(convert_to(jsonb_build_object('code',reason,'message',message)::text,'UTF8'),'base64'),E'\n\r','')),jsonb_build_object('Access-Control-Expose-Headers','x-antibot-error-base64'))::text,true);
   RETURN %s;
 END;
END
$body$,f.result_type,f.proname,identifier,f.proname<>'validate_coupon',result_expr,f.proname,args,result_expr);
   EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path='''' AS %L',f.proname,f.full_args,f.result_type,body);
 END LOOP;
END $install$;
-- Opportunistic cleanup above always runs; cron also cleans idle systems when available.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   PERFORM cron.schedule('antibot-cleanup','17 * * * *','SELECT private.antibot_cleanup()');
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
