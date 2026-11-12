-- TV somente leitura. Tokens nunca são armazenados em claro.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public._totem_require_manager(uuid)') IS NULL
 OR to_regprocedure('public._totem_new_token()') IS NULL
 OR to_regprocedure('public._totem_token_hash(text)') IS NULL
 OR to_regprocedure('public._sha256_hex(text)') IS NULL
 OR to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
  RAISE EXCEPTION 'TV_ACCESS_PRECHECK: aplique o acesso do totem e habilite realtime.send antes desta migração.';
 END IF;
END $$;
CREATE TABLE public.tv_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz, revoked_at timestamptz
);
CREATE INDEX tv_devices_tenant ON public.tv_devices(tenant_id,revoked_at);
CREATE TABLE public.tv_pairing_codes (
 code_hash text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', used_at timestamptz
);
CREATE TABLE public.tv_pairing_attempts (
 subject_hash text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, reset_at timestamptz NOT NULL
);
CREATE TABLE public.tv_access_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id),
 device_id uuid, actor_id uuid DEFAULT auth.uid(), event text NOT NULL CHECK (event IN ('CODE_CREATED','ACTIVATED','REVOKED','PAIRING_FAILED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tv_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_pairing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tv_devices,public.tv_pairing_codes,public.tv_pairing_attempts,public.tv_access_audit FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tv_devices,public.tv_pairing_codes,public.tv_pairing_attempts,public.tv_access_audit TO service_role;

CREATE FUNCTION public.admin_create_tv_code(p_tenant uuid,p_label text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c text; b bytea; expiry timestamptz; tries integer:=0;
BEGIN
 PERFORM public._totem_require_manager(p_tenant);
 IF p_label IS NULL OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'INVALID_LABEL'; END IF;
 -- Serializa a emissão para impedir colisões entre lojas.
 PERFORM pg_advisory_xact_lock(20261110,4);
 LOOP
  tries:=tries+1;
  IF tries>20 THEN RAISE EXCEPTION 'TV_CODES_BUSY'; END IF;
  b:=extensions.gen_random_bytes(4);
  c:=lpad(((get_byte(b,0)::bigint*16777216+get_byte(b,1)*65536+get_byte(b,2)*256+get_byte(b,3)) % 1000000)::text,6,'0');
  EXIT WHEN NOT EXISTS(SELECT 1 FROM public.tv_pairing_codes WHERE code_hash=public._sha256_hex(c));
 END LOOP;
 INSERT INTO public.tv_pairing_codes(code_hash,tenant_id,label) VALUES(public._sha256_hex(c),p_tenant,btrim(p_label)) RETURNING expires_at INTO expiry;
 INSERT INTO public.tv_access_audit(tenant_id,event) VALUES(p_tenant,'CODE_CREATED');
 RETURN jsonb_build_object('code',c,'expiresAt',expiry);
END $$;

CREATE FUNCTION public.tv_pair(p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE global_subject text:=public._sha256_hex('tv-pair-global'); global_attempt public.tv_pairing_attempts%ROWTYPE; h jsonb; forwarded text[]; subject text; a public.tv_pairing_attempts%ROWTYPE; c public.tv_pairing_codes%ROWTYPE; token text; device uuid;
BEGIN
 -- Limite global independente de cabeçalhos fornecidos pelo cliente. O lock
 -- serializa as tentativas e impede bypass por rotação/spoofing de origem.
 INSERT INTO public.tv_pairing_attempts(subject_hash,reset_at)
 VALUES(global_subject,now()+interval '10 minutes') ON CONFLICT DO NOTHING;
 SELECT * INTO global_attempt FROM public.tv_pairing_attempts WHERE subject_hash=global_subject FOR UPDATE;
 IF global_attempt.reset_at<=now() THEN
  UPDATE public.tv_pairing_attempts SET failures=0,reset_at=now()+interval '10 minutes' WHERE subject_hash=global_subject;
  global_attempt.failures:=0;
 END IF;
 IF global_attempt.failures>=30 THEN
  RETURN jsonb_build_object('ok',false,'reason','RATE_LIMITED');
 END IF;
 h:=COALESCE(NULLIF(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 -- O gateway deve sobrescrever os cabeçalhos de origem. No fallback XFF usamos
 -- o último salto, impedindo contornar o limite ao prefixar endereços arbitrários.
 forwarded:=string_to_array(h->>'x-forwarded-for',',');
 subject:=public._sha256_hex(COALESCE(NULLIF(h->>'cf-connecting-ip',''),
  NULLIF(btrim(forwarded[array_length(forwarded,1)]),''),'gateway-sem-ip'));
 INSERT INTO public.tv_pairing_attempts(subject_hash,reset_at) VALUES(subject,now()+interval '10 minutes') ON CONFLICT DO NOTHING;
 SELECT * INTO a FROM public.tv_pairing_attempts WHERE subject_hash=subject FOR UPDATE;
 IF a.reset_at<=now() THEN
  UPDATE public.tv_pairing_attempts SET failures=0,reset_at=now()+interval '10 minutes' WHERE subject_hash=subject;
  a.failures:=0;
 END IF;
 IF a.failures>=5 THEN
  RETURN jsonb_build_object('ok',false,'reason','RATE_LIMITED');
 END IF;
 SELECT * INTO c FROM public.tv_pairing_codes WHERE code_hash=public._sha256_hex(p_code) FOR UPDATE;
 IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' OR c.tenant_id IS NULL OR c.used_at IS NOT NULL OR c.expires_at<=now()
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=c.tenant_id AND status='ACTIVE') THEN
  UPDATE public.tv_pairing_attempts SET failures=failures+1 WHERE subject_hash IN (subject,global_subject);
  INSERT INTO public.tv_access_audit(tenant_id,event) VALUES(c.tenant_id,'PAIRING_FAILED');
  RETURN jsonb_build_object('ok',false,'reason','INVALID_CODE');
 END IF;
 token:=public._totem_new_token();
 INSERT INTO public.tv_devices(tenant_id,label,token_hash) VALUES(c.tenant_id,c.label,public._sha256_hex(token)) RETURNING id INTO device;
 UPDATE public.tv_pairing_codes SET used_at=now() WHERE code_hash=c.code_hash;
 INSERT INTO public.tv_access_audit(tenant_id,device_id,event) VALUES(c.tenant_id,device,'ACTIVATED');
 RETURN jsonb_build_object('ok',true,'token',token);
END $$;

CREATE FUNCTION public.tv_activate_as_staff(p_slug text,p_label text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; token text; device uuid;
BEGIN
 SELECT id INTO tenant FROM public.tenants WHERE slug=lower(btrim(p_slug)) AND status='ACTIVE';
 PERFORM public._totem_require_manager(tenant);
 IF tenant IS NULL OR p_label IS NULL OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'INVALID_LABEL'; END IF;
 token:=public._totem_new_token();
 INSERT INTO public.tv_devices(tenant_id,label,token_hash) VALUES(tenant,btrim(p_label),public._sha256_hex(token)) RETURNING id INTO device;
 INSERT INTO public.tv_access_audit(tenant_id,device_id,event) VALUES(tenant,device,'ACTIVATED');
 RETURN jsonb_build_object('ok',true,'token',token);
END $$;

CREATE FUNCTION public.admin_list_tvs(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._totem_require_manager(p_tenant);
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'lastSeenAt',last_seen_at) ORDER BY created_at DESC)
 FROM public.tv_devices WHERE tenant_id=p_tenant AND revoked_at IS NULL),'[]'::jsonb);
END $$;
CREATE FUNCTION public.admin_revoke_tv(p_tenant uuid,p_device uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._totem_require_manager(p_tenant);
 UPDATE public.tv_devices SET revoked_at=now() WHERE tenant_id=p_tenant AND id=p_device AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'TV_NOT_FOUND'; END IF;
 INSERT INTO public.tv_access_audit(tenant_id,device_id,event) VALUES(p_tenant,p_device,'REVOKED');
END $$;

CREATE FUNCTION public.tv_read(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tv_devices%ROWTYPE; th jsonb; store text; names boolean;
BEGIN
 SELECT v.* INTO d FROM public.tv_devices v JOIN public.tenants t ON t.id=v.tenant_id
 WHERE v.token_hash=public._totem_token_hash(p_token) AND v.revoked_at IS NULL AND t.status='ACTIVE' FOR UPDATE OF v;
 IF d.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','DEVICE_INVALID'); END IF;
 UPDATE public.tv_devices SET last_seen_at=now() WHERE id=d.id;
 SELECT to_jsonb(t) INTO th FROM public.tenant_themes t WHERE tenant_id=d.tenant_id;
 SELECT COALESCE(th->>'store_name',name) INTO store FROM public.tenants WHERE id=d.tenant_id;
 SELECT show_name_on_tv INTO names FROM public.store_arrival_qr WHERE tenant_id=d.tenant_id;
 RETURN jsonb_build_object('ok',true,'storeName',store,
  -- Lista explícita: nunca retornar a linha de configuração inteira.
  'theme',jsonb_build_object('primaryColor',th->>'primary_color','secondaryColor',th->>'secondary_color',
   'backgroundColor',th->>'background_color','cardColor',th->>'card_color','buttonColor',th->>'button_color',
   'textColor',th->>'text_color','tokens',jsonb_build_object('version',1,'palette',CASE WHEN th->'theme_tokens'->'palette' IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
    'bgGeneral',th->'theme_tokens'->'palette'->'bgGeneral','bgHeader',th->'theme_tokens'->'palette'->'bgHeader',
    'bgCard',th->'theme_tokens'->'palette'->'bgCard','textMain',th->'theme_tokens'->'palette'->'textMain',
    'textTitle',th->'theme_tokens'->'palette'->'textTitle','buttonBg',th->'theme_tokens'->'palette'->'buttonBg',
    'buttonText',th->'theme_tokens'->'palette'->'buttonText','border',th->'theme_tokens'->'palette'->'border')) END)),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',a.pickup_code,
   'name',CASE WHEN names THEN split_part(regexp_replace(btrim(o.customer_name),'\s+',' ','g'),' ',1) END,
   'kind',CASE WHEN o.totem_device_id IS NOT NULL AND o.status='READY' AND o.payment_status='PAID' THEN 'ready' ELSE 'called' END)
   ORDER BY a.called_at DESC NULLS LAST,a.pickup_code)
   FROM public.pickup_arrivals a JOIN public.orders o ON o.id=a.order_id AND o.tenant_id=a.tenant_id
   WHERE a.tenant_id=d.tenant_id AND a.closed_at IS NULL
   AND ((o.totem_device_id IS NOT NULL AND o.status='READY' AND o.payment_status='PAID')
     OR (a.called_at>=now()-interval '30 minutes' AND o.status NOT IN ('CANCELLED','DELIVERED')))), '[]'::jsonb));
END $$;

-- Canal opaco por dispositivo: SHA-256 não permite recuperar o token.
-- Só invalidação vazia; a leitura sempre revalida o token pela RPC.
CREATE FUNCTION public._tv_notify_refresh() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; device record; revoked_device uuid;
BEGIN
 tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 IF TG_TABLE_NAME='tv_devices' THEN revoked_device:=NEW.id; END IF;
 FOR device IN SELECT token_hash FROM public.tv_devices WHERE tenant_id=tenant AND (revoked_at IS NULL OR id=revoked_device) LOOP
  PERFORM realtime.send('{}'::jsonb,'refresh','tv-'||device.token_hash,false);
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._tv_notify_refresh() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER tv_refresh_arrivals AFTER INSERT OR UPDATE OR DELETE ON public.pickup_arrivals
 FOR EACH ROW EXECUTE FUNCTION public._tv_notify_refresh();
CREATE TRIGGER tv_refresh_orders AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._tv_notify_refresh();
CREATE TRIGGER tv_refresh_devices AFTER UPDATE OF revoked_at ON public.tv_devices
 FOR EACH ROW EXECUTE FUNCTION public._tv_notify_refresh();
CREATE TRIGGER tv_refresh_theme AFTER INSERT OR UPDATE ON public.tenant_themes
 FOR EACH ROW EXECUTE FUNCTION public._tv_notify_refresh();
CREATE TRIGGER tv_refresh_names AFTER INSERT OR UPDATE ON public.store_arrival_qr
 FOR EACH ROW EXECUTE FUNCTION public._tv_notify_refresh();

REVOKE ALL ON FUNCTION public.tv_activate_as_staff(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tv_activate_as_staff(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_create_tv_code(uuid,text),public.tv_pair(text),public.admin_list_tvs(uuid),public.admin_revoke_tv(uuid,uuid),public.tv_read(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_tv_code(uuid,text),public.admin_list_tvs(uuid),public.admin_revoke_tv(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_pair(text),public.tv_read(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
