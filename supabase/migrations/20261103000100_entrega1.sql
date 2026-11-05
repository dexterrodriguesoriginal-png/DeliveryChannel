-- Entrega 1: recuperação de cadastro, convites verificados e acesso por papel.
-- Aplicar somente em ambiente autorizado. Sem chamadas remotas ou dados fixos de loja.
BEGIN;

-- Patches de definições falham fechados se o baseline divergir. Helpers temporários
-- não criam API pública e os diagnósticos mostram somente função/etapa.
CREATE FUNCTION pg_temp.entrega1_checked_replace(p_source text,p_old text,p_new text,p_stage text DEFAULT 'body') RETURNS text
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_result text; v_function text:=COALESCE(substring(p_source FROM '^CREATE OR REPLACE FUNCTION ([a-zA-Z0-9_.]+)'),'unknown_function');
BEGIN
 v_result:=pg_catalog.replace(p_source,p_old,p_new);
 IF p_old IS NULL OR p_old='' OR v_result IS NOT DISTINCT FROM p_source THEN
  RAISE EXCEPTION 'ENTREGA1_PATCH_MISMATCH: %/%',v_function,p_stage USING ERRCODE='22023';
 END IF;
 RETURN v_result;
END; $$;
CREATE FUNCTION pg_temp.entrega1_checked_regexp_replace(p_source text,p_pattern text,p_new text,p_stage text DEFAULT 'body') RETURNS text
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_result text; v_function text:=COALESCE(substring(p_source FROM '^CREATE OR REPLACE FUNCTION ([a-zA-Z0-9_.]+)'),'unknown_function');
BEGIN
 v_result:=pg_catalog.regexp_replace(p_source,p_pattern,p_new);
 IF p_pattern IS NULL OR p_pattern='' OR v_result IS NOT DISTINCT FROM p_source THEN
  RAISE EXCEPTION 'ENTREGA1_PATCH_MISMATCH: %/%',v_function,p_stage USING ERRCODE='22023';
 END IF;
 RETURN v_result;
END; $$;
CREATE FUNCTION pg_temp.entrega1_empty_search_path(p_source text) RETURNS text
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_header text:=pg_catalog.split_part(p_source,E'\nAS ',1);
 v_path text:=btrim(substring(v_header FROM '(?n)^ SET search_path TO .*$'));
BEGIN
 IF v_path='SET search_path TO ''public'', ''pg_temp''' THEN
  RETURN pg_temp.entrega1_checked_replace(p_source,'SET search_path TO ''public'', ''pg_temp''','SET search_path TO ''''','search_path');
 END IF;
 IF v_path='SET search_path TO ''''' THEN RETURN p_source; END IF;
 RAISE EXCEPTION 'ENTREGA1_PATCH_MISMATCH: %/search_path',COALESCE(substring(p_source FROM '^CREATE OR REPLACE FUNCTION ([a-zA-Z0-9_.]+)'),'unknown_function') USING ERRCODE='22023';
END; $$;
REVOKE ALL ON FUNCTION pg_temp.entrega1_checked_replace(text,text,text,text),pg_temp.entrega1_checked_regexp_replace(text,text,text,text),pg_temp.entrega1_empty_search_path(text) FROM PUBLIC,anon,authenticated,service_role;

-- A cópia não contém dados de pessoas; preserva definições/ACL reais para rollback exato.
CREATE TABLE public._entrega1_restore (signature text PRIMARY KEY, definition text NOT NULL, acl jsonb NOT NULL);
ALTER TABLE public._entrega1_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_restore FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public._entrega1_restore
SELECT p.oid::regprocedure::text, pg_catalog.pg_get_functiondef(p.oid),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee', CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
    'privilege', a.privilege_type, 'grantable', a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY[
 'has_tenant_permission','waiter_username_state','waiter_provision','_legal_signup_check','_legal_signup_record',
 'create_team_invite','accept_team_invite','list_team_invites','list_team_directory','_is_staff_role',
 '_kitchen_can_read_tenant','_kitchen_resolve_tenant','kitchen_get_context','kitchen_list_orders','kitchen_set_order_status',
 'update_order_status','get_tenant_financial_summary','upsert_tenant_payment_settings','get_tenant_reports_summary',
 'adjust_inventory','assign_order_to_driver','revoke_team_invite','remove_team_member','set_kitchen_settings',
 'set_waiter_service_settings','waiter_performance_report','staff_open_tab','staff_request_bill','close_tab',
 'approve_session','reject_session','authorize_waiter_to_close','staff_create_holder_code','staff_reset_tab_holder',
 'release_empty_tab','submit_round','waiter_set_active','waiter_assert_member','waiter_update_profile','configure_store_payment','complete_store_payment_connection',
 '_waiter_is_active','_waiter_serves_tab','_tab_can_collect','_tab_pix_staff','waiter_login_check',
 '_waiter_require_manager','assign_waiter_tables','pass_waiter_tables',
 'reserve_order_payment','confirm_order_payment',
 '_stock_staff','_stock_manager','archive_orders','offer_order_to_driver','get_dispatch_queue',
 'set_product_option_group_links','change_product_option_price','change_product_options_price','upsert_product_option_group','delete_product_option_group','reorder_product_option_groups'
]);

INSERT INTO public._entrega1_restore SELECT 'constraint:team_invites_role',pg_catalog.pg_get_constraintdef(oid),'[]'::jsonb FROM pg_catalog.pg_constraint WHERE conrelid='public.team_invites'::regclass AND conname='chk_team_invites_role';

INSERT INTO public.roles(id,name,description,level) VALUES('KITCHEN','Cozinha','Preparo de pedidos, sem dados pessoais de clientes',30);
ALTER TABLE public.team_invites DROP CONSTRAINT chk_team_invites_role;
ALTER TABLE public.team_invites ADD CONSTRAINT chk_team_invites_role CHECK(role_id IN('MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER','WAITER','KITCHEN')) NOT VALID;

CREATE TABLE public.store_tools (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 tool text NOT NULL CHECK(tool IN('waiter','kitchen')), enabled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,tool)
);
CREATE TABLE public.store_role_permissions (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 role text NOT NULL REFERENCES public.roles(id), permission text NOT NULL,
 enabled boolean NOT NULL, PRIMARY KEY(tenant_id,role,permission),
 CHECK(role IN('OWNER','MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER','WAITER','KITCHEN')),
 CHECK(permission IN('view_dashboard','view_orders','manage_orders','manage_catalog','manage_team','view_reports','view_finances','manage_subscription','manage_cashier','manage_tables','manage_kitchen','manage_inventory','dispatch_orders','view_assigned_orders','deliver_orders','waiter')),
 CHECK(role <> 'OWNER' OR enabled)
);
CREATE TABLE public.store_access_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK(kind IN('TOOL','PERMISSION')), role text, permission text, tool text, enabled boolean NOT NULL
);
ALTER TABLE public.store_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_tools,public.store_role_permissions,public.store_access_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.store_tools,public.store_role_permissions,public.store_access_audit TO authenticated;
GRANT ALL ON public.store_tools,public.store_role_permissions,public.store_access_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.store_access_audit_id_seq TO service_role;
INSERT INTO public.store_tools(tenant_id,tool,enabled)
SELECT t.id,'waiter',EXISTS(SELECT 1 FROM public.waiter_profiles wp WHERE wp.tenant_id=t.id)
 OR EXISTS(SELECT 1 FROM public.dining_tables dt WHERE dt.tenant_id=t.id) FROM public.tenants t
UNION ALL SELECT t.id,'kitchen',EXISTS(SELECT 1 FROM public.kitchen_settings ks WHERE ks.tenant_id=t.id AND ks.enabled) FROM public.tenants t;

CREATE FUNCTION public._store_role_defaults(p_role text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE p_role
 WHEN 'OWNER' THEN ARRAY['view_dashboard','view_orders','manage_orders','manage_catalog','manage_team','view_reports','view_finances','manage_subscription','manage_cashier','manage_tables','manage_kitchen','manage_inventory','dispatch_orders','view_assigned_orders','deliver_orders','waiter']
 WHEN 'MANAGER' THEN ARRAY['view_dashboard','view_orders','manage_orders','manage_catalog','manage_team','view_reports','manage_tables','manage_kitchen','manage_inventory','dispatch_orders']
 WHEN 'CASHIER' THEN ARRAY['view_orders','manage_orders','manage_cashier','manage_tables']
 WHEN 'KITCHEN' THEN ARRAY['manage_kitchen']
 WHEN 'WAITER' THEN ARRAY['waiter','manage_tables']
 WHEN 'OPERATOR' THEN ARRAY['manage_catalog','manage_inventory']
 WHEN 'DELIVERY_MANAGER' THEN ARRAY['view_orders','dispatch_orders']
 WHEN 'DRIVER' THEN ARRAY['view_assigned_orders','deliver_orders'] ELSE ARRAY[]::text[] END;
$$;
CREATE FUNCTION public._store_tool_enabled(p_tenant uuid,p_tool text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT s.enabled FROM public.store_tools s WHERE s.tenant_id=p_tenant AND s.tool=p_tool),false);
$$;
CREATE FUNCTION public._store_user_permission(p_user uuid,p_tenant uuid,p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_users tu JOIN public.tenants t ON t.id=tu.tenant_id
 WHERE tu.user_id=p_user AND tu.tenant_id=p_tenant AND tu.status='ACTIVE' AND t.status='ACTIVE'
 AND p_perm=ANY(public._store_role_defaults('OWNER'))
 AND (tu.role_id='OWNER' OR (p_perm NOT IN('view_finances','manage_subscription')
 AND (tu.role_id<>'KITCHEN' OR (p_perm='manage_kitchen' AND public._store_tool_enabled(p_tenant,'kitchen')))
 AND (tu.role_id<>'WAITER' OR p_perm IN('waiter','manage_tables'))
 AND (tu.role_id<>'DRIVER' OR p_perm IN('view_assigned_orders','deliver_orders'))
 AND (tu.role_id<>'WAITER' OR public._store_tool_enabled(p_tenant,'waiter'))
 AND (p_perm<>'manage_kitchen' OR public._store_tool_enabled(p_tenant,'kitchen'))
 AND (p_perm<>'waiter' OR public._store_tool_enabled(p_tenant,'waiter'))
 AND COALESCE((SELECT rp.enabled FROM public.store_role_permissions rp WHERE rp.tenant_id=p_tenant AND rp.role=tu.role_id AND rp.permission=p_perm),p_perm=ANY(public._store_role_defaults(tu.role_id))))));
$$;
CREATE FUNCTION public.has_store_permission(p_tenant uuid,p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public._store_user_permission(auth.uid(),p_tenant,p_perm); $$;
CREATE OR REPLACE FUNCTION public.has_tenant_permission(p_user_id uuid,p_tenant_id uuid,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (COALESCE(p_user_id=auth.uid(),false) OR auth.role()='service_role')
 AND public._store_user_permission(p_user_id,p_tenant_id,p_permission);
$$;
-- Chamadas internas com ator explícito continuam sujeitas às permissões desse ator.
-- O papel vem do JWT do PostgREST, nunca de um parâmetro recebido do navegador.
GRANT EXECUTE ON FUNCTION public.has_tenant_permission(uuid,uuid,text) TO service_role;
CREATE FUNCTION public._store_caller_role(p_tenant uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public._tenant_role_of_caller(p_tenant); $$;
CREATE POLICY entrega1_tools_read ON public.store_tools FOR SELECT TO authenticated USING(public._store_caller_role(tenant_id) IS NOT NULL);
CREATE POLICY entrega1_permissions_read ON public.store_role_permissions FOR SELECT TO authenticated USING(public.has_store_permission(tenant_id,'manage_team'));
CREATE POLICY entrega1_audit_read ON public.store_access_audit FOR SELECT TO authenticated USING(public.has_tenant_scoped_role(tenant_id,ARRAY['OWNER']));

CREATE FUNCTION public.list_store_tools(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public._tenant_role_of_caller(p_tenant) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: loja indisponível.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('waiter',public._store_tool_enabled(p_tenant,'waiter'),'kitchen',public._store_tool_enabled(p_tenant,'kitchen'));
END; $$;
CREATE FUNCTION public.get_store_access(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text:=public._tenant_role_of_caller(p_tenant); v_permissions jsonb;
BEGIN
 IF v_role IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: loja indisponível.' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_permissions FROM unnest(public._store_role_defaults('OWNER')) x WHERE public.has_store_permission(p_tenant,x);
 RETURN jsonb_build_object('role',v_role,'permissions',v_permissions,'tools',public.list_store_tools(p_tenant));
END; $$;
CREATE FUNCTION public.list_store_role_permissions(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.has_store_permission(p_tenant,'manage_team') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso à equipe.' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_agg(jsonb_build_object('role',r,'permission',p,'enabled',r='OWNER' OR (p NOT IN('view_finances','manage_subscription') AND (r<>'KITCHEN' OR p='manage_kitchen') AND (r<>'WAITER' OR p IN('waiter','manage_tables')) AND (r<>'DRIVER' OR p IN('view_assigned_orders','deliver_orders')) AND COALESCE(s.enabled,p=ANY(public._store_role_defaults(r))))) ORDER BY r,p)
 FROM unnest(ARRAY['OWNER','MANAGER','CASHIER','KITCHEN','WAITER','OPERATOR','DELIVERY_MANAGER','DRIVER']) r
 CROSS JOIN unnest(public._store_role_defaults('OWNER')) p
 LEFT JOIN public.store_role_permissions s ON s.tenant_id=p_tenant AND s.role=r AND s.permission=p);
END; $$;
CREATE FUNCTION public.set_store_tool(p_tenant uuid,p_tool text,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.has_tenant_scoped_role(p_tenant,ARRAY['OWNER']) THEN RAISE EXCEPTION 'FORBIDDEN: somente o dono altera ferramentas.' USING ERRCODE='42501'; END IF;
 IF p_tool NOT IN('waiter','kitchen') OR p_enabled IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT: ferramenta inválida.' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant::text||'|tool|'||p_tool,0));
 INSERT INTO public.store_tools VALUES(p_tenant,p_tool,p_enabled) ON CONFLICT(tenant_id,tool) DO UPDATE SET enabled=EXCLUDED.enabled;
 IF p_tool='kitchen' THEN
  INSERT INTO public.kitchen_settings(tenant_id,enabled,updated_by) VALUES(p_tenant,p_enabled,auth.uid())
  ON CONFLICT(tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now(),updated_by=auth.uid();
 END IF;
 INSERT INTO public.store_access_audit(tenant_id,actor_id,kind,tool,enabled) VALUES(p_tenant,auth.uid(),'TOOL',p_tool,p_enabled);
END; $$;
CREATE FUNCTION public.set_store_role_permission(p_tenant uuid,p_role text,p_permission text,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.has_tenant_scoped_role(p_tenant,ARRAY['OWNER']) THEN RAISE EXCEPTION 'FORBIDDEN: somente o dono altera permissões.' USING ERRCODE='42501'; END IF;
 IF p_role NOT IN('MANAGER','CASHIER','KITCHEN','WAITER','OPERATOR','DELIVERY_MANAGER','DRIVER') OR p_enabled IS NULL OR NOT(p_permission=ANY(public._store_role_defaults('OWNER')))
 OR (p_enabled AND (p_permission IN('view_finances','manage_subscription') OR (p_role='KITCHEN' AND p_permission<>'manage_kitchen') OR (p_role='WAITER' AND p_permission NOT IN('waiter','manage_tables')) OR (p_role='DRIVER' AND p_permission NOT IN('view_assigned_orders','deliver_orders')))) THEN RAISE EXCEPTION 'INVALID_INPUT: permissão reservada ou papel inválido.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.store_role_permissions VALUES(p_tenant,p_role,p_permission,p_enabled) ON CONFLICT(tenant_id,role,permission) DO UPDATE SET enabled=EXCLUDED.enabled;
 INSERT INTO public.store_access_audit(tenant_id,actor_id,kind,role,permission,enabled) VALUES(p_tenant,auth.uid(),'PERMISSION',p_role,p_permission,p_enabled);
END; $$;

-- Pré-checagem pública: só booleanos. Sem IP, a cota é compartilhada pela loja,
-- impedindo que a troca do e-mail consultado reinicie o limite de enumeração.
CREATE FUNCTION public.team_invite_check(p_slug text,p_email text,p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tenant uuid; v_slug text:=lower(btrim(COALESCE(p_slug,''))); v_email text:=lower(btrim(COALESCE(p_email,''))); v_role text:=upper(btrim(COALESCE(p_role,''))); v_subject text; v_scope text;
BEGIN
 SELECT id INTO v_tenant FROM public.tenants WHERE slug=v_slug AND status='ACTIVE';
 v_subject:=public._sha256_hex(v_slug||'|'||COALESCE(NULLIF(public._request_ip_hash(),''),'no-ip'));
 v_scope:=CASE WHEN v_role='WAITER' THEN 'waiter_invite_check' ELSE 'team_invite_check' END;
 IF NOT public._rate_limit_hit(v_scope,v_subject,v_tenant,10,600) THEN RETURN jsonb_build_object('invited',false,'rate_limited',true); END IF;
 RETURN jsonb_build_object('invited',v_tenant IS NOT NULL AND length(v_email)<=254 AND v_role IN('MANAGER','CASHIER','OPERATOR','DELIVERY_MANAGER','DRIVER','WAITER','KITCHEN')
 AND (v_role<>'WAITER' OR public._store_tool_enabled(v_tenant,'waiter')) AND (v_role<>'KITCHEN' OR public._store_tool_enabled(v_tenant,'kitchen'))
 AND EXISTS(SELECT 1 FROM public.team_invites i WHERE i.tenant_id=v_tenant AND lower(i.email)=v_email AND i.role_id=v_role AND i.status='PENDING' AND i.expires_at>now()));
END; $$;
CREATE FUNCTION public.waiter_invite_check(p_slug text,p_email text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.team_invite_check(p_slug,p_email,'WAITER'); $$;
CREATE FUNCTION public._team_signup_invited(p_slug text,p_email text,p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.team_invites i JOIN public.tenants t ON t.id=i.tenant_id
 WHERE t.slug=lower(btrim(p_slug)) AND t.status='ACTIVE' AND lower(i.email)=lower(btrim(p_email)) AND i.role_id=p_role AND i.status='PENDING' AND i.expires_at>now()
 AND (p_role<>'WAITER' OR public._store_tool_enabled(t.id,'waiter')) AND (p_role<>'KITCHEN' OR public._store_tool_enabled(t.id,'kitchen')));
$$;

-- Reutilização estritamente vinculada ao e-mail sintético da loja; nunca recupera contas pessoais/privilegiadas.
CREATE FUNCTION public.waiter_reusable_identity(p_tenant uuid,p_username text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid; v_email text;
BEGIN
 IF lower(btrim(p_username)) !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN RETURN NULL; END IF;
 SELECT lower(btrim(p_username))||'.'||t.slug||'@garcom.deliverychannel.local' INTO v_email FROM public.tenants t WHERE t.id=p_tenant AND t.status='ACTIVE';
 SELECT a.id INTO v_user FROM auth.users a WHERE lower(a.email)=v_email
 AND (a.raw_app_meta_data->>'waiter_tenant_id'=p_tenant::text OR EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=a.id AND tu.tenant_id=p_tenant AND tu.role_id='WAITER'))
 AND NOT EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=a.id AND (tu.tenant_id IS DISTINCT FROM p_tenant OR tu.role_id<>'WAITER'))
 AND NOT EXISTS(SELECT 1 FROM public.waiter_profiles wp WHERE wp.user_id=a.id);
 RETURN v_user;
END; $$;
CREATE OR REPLACE FUNCTION public.waiter_provision(p_tenant uuid,p_user uuid,p_name text,p_phone text,p_username text,p_synthetic_email text,p_contact_email text,p_photo_url text,p_created_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant::text||'|tool|waiter',0));
 IF NOT public._store_tool_enabled(p_tenant,'waiter') THEN RAISE EXCEPTION 'TOOL_DISABLED: ative a ferramenta Garçom antes de cadastrar.' USING ERRCODE='42501'; END IF;
 IF NOT public._store_user_permission(p_created_by,p_tenant,'manage_team') THEN RAISE EXCEPTION 'FORBIDDEN: sem permissão para cadastrar.' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 120 OR lower(btrim(p_username)) !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN RAISE EXCEPTION 'INVALID_INPUT: confira nome e usuário.' USING ERRCODE='22023'; END IF;
 SELECT lower(btrim(p_username))||'.'||t.slug||'@garcom.deliverychannel.local' INTO v_email FROM public.tenants t WHERE t.id=p_tenant;
 IF v_email IS DISTINCT FROM lower(p_synthetic_email) OR NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id=p_user AND lower(a.email)=v_email AND a.raw_app_meta_data->>'waiter_tenant_id'=p_tenant::text)
 OR EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=p_user AND (tu.tenant_id IS DISTINCT FROM p_tenant OR tu.role_id<>'WAITER')) THEN RAISE EXCEPTION 'IDENTITY_CONFLICT: identidade não pode ser reutilizada.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.users(id,name,email,phone) VALUES(p_user,btrim(p_name),p_synthetic_email,btrim(p_phone)) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone;
 INSERT INTO public.tenant_users(user_id,tenant_id,role_id,status) VALUES(p_user,p_tenant,'WAITER','ACTIVE') ON CONFLICT(user_id,tenant_id) DO UPDATE SET status='ACTIVE',role_id='WAITER',updated_at=now();
 INSERT INTO public.waiter_profiles(user_id,tenant_id,username,phone,contact_email,photo_url,created_by) VALUES(p_user,p_tenant,lower(btrim(p_username)),btrim(p_phone),NULLIF(btrim(COALESCE(p_contact_email,'')),''),p_photo_url,p_created_by);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'WAITER_USERNAME_TAKEN: este usuário já faz parte da equipe.' USING ERRCODE='P0412';
END; $$;

-- Um perfil antigo não autoriza mutações globais de Auth. Contas pessoais,
-- promovidas ou compartilhadas com outra loja nunca são geridas por este fluxo.
CREATE OR REPLACE FUNCTION public.waiter_assert_member(p_tenant uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.waiter_profiles wp
  JOIN public.tenant_users tu ON tu.tenant_id=wp.tenant_id AND tu.user_id=wp.user_id AND tu.role_id='WAITER'
  JOIN public.tenants t ON t.id=wp.tenant_id AND t.status='ACTIVE'
  JOIN auth.users a ON a.id=wp.user_id
  WHERE wp.tenant_id=p_tenant AND wp.user_id=p_user
  AND lower(a.email)=wp.username||'.'||t.slug||'@garcom.deliverychannel.local'
  AND a.raw_app_meta_data->>'waiter_tenant_id'=p_tenant::text
  AND NOT EXISTS(SELECT 1 FROM public.tenant_users other_membership
    WHERE other_membership.user_id=p_user
    AND (other_membership.tenant_id IS DISTINCT FROM p_tenant OR other_membership.role_id<>'WAITER'))
 );
$$;

-- O endpoint HTTP de salão usa service_role, mas autoriza o ator real antes da consulta.
-- Wrapper próprio da sessão para RLS: não expõe consultas de identidade de outro garçom.
CREATE FUNCTION public._store_waiter_tab_visible(p_tab uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public._waiter_serves_tab(p_tab,auth.uid()); $$;
DO $waiter_gates$
DECLARE v_def text; v_sig text;
BEGIN
 FOREACH v_sig IN ARRAY ARRAY['public._waiter_is_active(uuid,uuid)','public._waiter_serves_tab(uuid,uuid)','public._tab_can_collect(uuid,uuid)','public._tab_pix_staff(uuid,uuid)'] LOOP
  v_def:=pg_catalog.pg_get_functiondef(v_sig::regprocedure);
  IF v_sig LIKE '%_waiter_is_active%' THEN
   v_def:=pg_temp.entrega1_checked_replace(v_def,'SELECT EXISTS','SELECT public._store_user_permission(p_user,p_tenant,''waiter'') AND EXISTS','actor_permission');
  ELSIF v_sig LIKE '%_waiter_serves_tab%' THEN
   v_def:=pg_temp.entrega1_checked_replace(v_def,'SELECT EXISTS','SELECT public._store_user_permission(p_user,(SELECT tenant_id FROM public.dining_tabs WHERE id=p_tab),''waiter'') AND EXISTS','actor_permission');
  ELSIF v_sig LIKE '%_tab_can_collect%' THEN
   v_def:=pg_temp.entrega1_checked_replace(v_def,'SELECT EXISTS','SELECT public._store_user_permission(p_user,(SELECT tenant_id FROM public.dining_tabs WHERE id=p_tab),''manage_tables'') AND EXISTS','actor_permission');
  ELSE
   v_def:=pg_temp.entrega1_checked_replace(v_def,'SELECT EXISTS','SELECT public._store_user_permission(p_user,p_tenant,''manage_tables'') AND EXISTS','actor_permission');
  END IF;
  EXECUTE v_def;
 END LOOP;
 v_def:=pg_catalog.pg_get_functiondef('public.waiter_login_check(text,text,text)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$'allowed', v_tenant IS NOT NULL$s$,$s$'allowed', v_tenant IS NOT NULL AND public._store_tool_enabled(v_tenant,'waiter')$s$,'login_tool');
 EXECUTE v_def;
 v_def:=pg_catalog.pg_get_functiondef('public.waiter_set_active(uuid,uuid,boolean)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN IF p_active AND NOT public._store_tool_enabled(p_tenant,'waiter') THEN RAISE EXCEPTION 'TOOL_DISABLED: ative a ferramenta Garçom.' USING ERRCODE='42501'; END IF; IF NOT public.waiter_assert_member(p_tenant,p_user) THEN RAISE EXCEPTION 'IDENTITY_NOT_MANAGED: conta não é gerenciada exclusivamente como garçom desta loja.' USING ERRCODE='42501'; END IF;$r$,'entry_guard');
 v_def:=pg_catalog.pg_get_functiondef('public.waiter_update_profile(uuid,uuid,text,text,text,boolean)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN IF NOT public.waiter_assert_member(p_tenant,p_user) THEN RAISE EXCEPTION 'IDENTITY_NOT_MANAGED: conta não é gerenciada exclusivamente como garçom desta loja.' USING ERRCODE='42501'; END IF;$r$,'identity_guard');
END $waiter_gates$;

CREATE FUNCTION public.salon_rounds_for_staff(p_user uuid,p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;
BEGIN
 IF NOT public._store_user_permission(p_user,p_tenant,'manage_tables') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso às mesas desta loja.' USING ERRCODE='42501'; END IF;
 SELECT tu.role_id INTO v_role FROM public.tenant_users tu WHERE tu.user_id=p_user AND tu.tenant_id=p_tenant AND tu.status='ACTIVE';
 IF v_role='WAITER' AND NOT public._store_tool_enabled(p_tenant,'waiter') THEN RAISE EXCEPTION 'TOOL_DISABLED: ferramenta indisponível.' USING ERRCODE='42501'; END IF;
 IF public._dine_in_config(p_tenant) IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'tab_id',o.tab_id,'order_number',o.order_number,'customer_name',o.customer_name,'status',o.status,'subtotal',o.subtotal,'created_at',o.created_at,'round_no',o.round_no,'waiter_id',o.waiter_id) ORDER BY o.round_no,o.created_at,o.id)
 FROM public.orders o JOIN public.dining_tabs tb ON tb.id=o.tab_id AND tb.tenant_id=o.tenant_id
 WHERE o.tenant_id=p_tenant AND o.fulfillment_type='DINE_IN' AND o.status<>'CANCELLED'
 AND tb.status IN('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')
 AND (v_role<>'WAITER' OR public._waiter_serves_tab(tb.id,p_user))),'[]'::jsonb);
END; $$;

-- Guardas também no INSERT do Auth: metadados públicos nunca concedem papel/aceite de lojista.
DO $patch$
DECLARE v_def text; v_guard text := $guard$
  IF NEW.raw_user_meta_data ? 'waiter_signup_slug' OR NEW.raw_user_meta_data ? 'team_signup_slug' THEN
    IF NOT public._team_signup_invited(
      COALESCE(NEW.raw_user_meta_data->>'waiter_signup_slug',NEW.raw_user_meta_data->>'team_signup_slug'),
      NEW.email, CASE WHEN NEW.raw_user_meta_data ? 'waiter_signup_slug' THEN 'WAITER' ELSE upper(NEW.raw_user_meta_data->>'team_signup_role') END)
    THEN RAISE EXCEPTION 'INVITE_REQUIRED: Este e-mail não foi convidado. Fale com o estabelecimento.' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END IF;
$guard$;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public._legal_signup_check()'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M','BEGIN '||v_guard,'entry_guard');
 v_def:=pg_catalog.pg_get_functiondef('public._legal_signup_record()'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN
  IF NEW.raw_user_meta_data ? 'waiter_signup_slug' OR NEW.raw_user_meta_data ? 'team_signup_slug' THEN RETURN NEW; END IF;
$r$,'entry_guard');
END $patch$;

-- Convites: mantém locks e defesas de conflitos existentes, adiciona escopo/permissões/ferramentas.
DO $patch$
DECLARE v_def text; v_sig text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public._is_staff_role(text)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_replace(v_def,$s$'WAITER'$s$,$s$'WAITER','KITCHEN'$s$,'staff_roles');
 FOREACH v_sig IN ARRAY ARRAY['public.create_team_invite(uuid,character varying,character varying)','public.accept_team_invite(uuid)'] LOOP
  v_def:=pg_catalog.pg_get_functiondef(v_sig::regprocedure);
  IF position($s$'DRIVER','WAITER')$s$ IN v_def)>0 THEN
   v_def:=pg_temp.entrega1_checked_replace(v_def,$s$'DRIVER','WAITER')$s$,$s$'DRIVER','WAITER','KITCHEN')$s$,'invite_roles');
  ELSE
   v_def:=pg_temp.entrega1_checked_replace(v_def,$s$'DRIVER', 'WAITER')$s$,$s$'DRIVER', 'WAITER', 'KITCHEN')$s$,'invite_roles');
  END IF;
  IF v_sig LIKE '%create_team_invite%' THEN
   v_def:=pg_temp.entrega1_checked_replace(v_def,'public.has_tenant_role(v_operator_id, p_tenant_id, ARRAY[''OWNER'',''MANAGER''])','public.has_store_permission(p_tenant_id, ''manage_team'')','permission_guard');
   v_def:=pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN
    IF NOT public.has_store_permission(p_tenant_id,'manage_team') THEN RAISE EXCEPTION 'FORBIDDEN: sem permissão para convidar.' USING ERRCODE='42501'; END IF;
    IF v_clean_role IN('WAITER','KITCHEN') THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant_id::text||'|tool|'||CASE WHEN v_clean_role='WAITER' THEN 'waiter' ELSE 'kitchen' END,0));
      IF NOT public._store_tool_enabled(p_tenant_id,CASE WHEN v_clean_role='WAITER' THEN 'waiter' ELSE 'kitchen' END) THEN RAISE EXCEPTION 'TOOL_DISABLED: ative a ferramenta antes de convidar.' USING ERRCODE='42501'; END IF;
    END IF;
$r$,'entry_guard');
  ELSE
   -- O e-mail do perfil é editável pelo usuário; convite exige o e-mail autoritativo do Auth.
   v_def:=pg_temp.entrega1_checked_replace(v_def,$s$SELECT email, name, phone INTO v_user_email, v_user_name, v_user_phone
    FROM public.users WHERE id = v_user_id;$s$,$r$SELECT a.email, u.name, u.phone INTO v_user_email, v_user_name, v_user_phone
    FROM auth.users a LEFT JOIN public.users u ON u.id=a.id WHERE a.id=v_user_id;$r$,'invite_auth_email');
   v_def:=pg_temp.entrega1_checked_replace(v_def,'-- Lock 2: (usuário, loja)',$r$
    IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=v_invite.tenant_id AND t.status='ACTIVE') THEN RAISE EXCEPTION 'INVITE_REQUIRED: convite indisponível.' USING ERRCODE='42501'; END IF;
    IF v_invite.role_id IN('WAITER','KITCHEN') THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_invite.tenant_id::text||'|tool|'||CASE WHEN v_invite.role_id='WAITER' THEN 'waiter' ELSE 'kitchen' END,0));
      IF NOT public._store_tool_enabled(v_invite.tenant_id,CASE WHEN v_invite.role_id='WAITER' THEN 'waiter' ELSE 'kitchen' END) THEN RAISE EXCEPTION 'TOOL_DISABLED: ferramenta indisponível.' USING ERRCODE='42501'; END IF;
    END IF;
    -- Lock 2: (usuário, loja)
$r$,'invite_tool');
  END IF;
  EXECUTE v_def;
 END LOOP;
 v_def:=pg_catalog.pg_get_functiondef('public.list_team_invites(uuid)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_replace(v_def,'public.has_tenant_role(v_uid, p_tenant_id, ARRAY[''OWNER''])','public.has_store_permission(p_tenant_id,''manage_team'')','permission_guard');
 v_def:=pg_catalog.pg_get_functiondef('public.list_team_directory(uuid)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_replace(v_def,'public.has_tenant_scoped_role(p_tenant, ARRAY[''OWNER'', ''MANAGER''])','public.has_store_permission(p_tenant,''manage_team'')','permission_guard');
 v_def:=pg_catalog.pg_get_functiondef('public.revoke_team_invite(uuid)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN IF NOT public.has_store_permission((SELECT tenant_id FROM public.team_invites WHERE id=p_invite_id),'manage_team') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso à equipe.' USING ERRCODE='42501'; END IF;$r$,'entry_guard');
 v_def:=pg_catalog.pg_get_functiondef('public.remove_team_member(uuid)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN IF NOT public.has_store_permission((SELECT tenant_id FROM public.tenant_users WHERE id=p_tenant_user_id),'manage_team') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso à equipe.' USING ERRCODE='42501'; END IF;$r$,'entry_guard');
END $patch$;
CREATE FUNCTION public.team_accept_invite(p_slug text,p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_invite uuid; v_tenant uuid; v_role text:=upper(btrim(p_role)); v_email text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta.' USING ERRCODE='42501'; END IF;
 SELECT lower(a.email) INTO v_email FROM auth.users a WHERE a.id=auth.uid();
 SELECT i.id,i.tenant_id INTO v_invite,v_tenant FROM public.team_invites i JOIN public.tenants t ON t.id=i.tenant_id
 WHERE t.slug=lower(btrim(p_slug)) AND t.status='ACTIVE' AND lower(i.email)=v_email AND i.role_id=v_role AND i.status='PENDING' AND i.expires_at>now()
 ORDER BY i.created_at DESC LIMIT 1;
 IF v_invite IS NULL THEN
   SELECT t.id INTO v_tenant FROM public.tenants t JOIN public.tenant_users tu ON tu.tenant_id=t.id
   WHERE t.slug=lower(btrim(p_slug)) AND t.status='ACTIVE' AND tu.user_id=auth.uid() AND tu.role_id=v_role AND tu.status='ACTIVE';
   IF v_tenant IS NULL OR (v_role='WAITER' AND NOT public._store_tool_enabled(v_tenant,'waiter')) OR (v_role='KITCHEN' AND NOT public._store_tool_enabled(v_tenant,'kitchen')) THEN
    RAISE EXCEPTION 'INVITE_REQUIRED: Este e-mail não foi convidado. Fale com o estabelecimento.' USING ERRCODE='42501';
   END IF;
 ELSE PERFORM public.accept_team_invite(v_invite); END IF;
 RETURN jsonb_build_object('tenant_id',v_tenant,'role',v_role);
END; $$;

-- KDS continua usando os sinais mínimos; o papel Cozinha não recebe SELECT nas tabelas de clientes/pedidos.
CREATE OR REPLACE FUNCTION public._kitchen_can_read_tenant(p_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public._store_tool_enabled(p_tenant_id,'kitchen') AND (
 public.has_store_permission(p_tenant_id,'manage_kitchen') OR EXISTS(
 SELECT 1 FROM public.kitchen_devices d JOIN public.tenants t ON t.id=d.tenant_id AND t.status='ACTIVE'
 JOIN public.kitchen_settings s ON s.tenant_id=d.tenant_id AND s.enabled
 WHERE d.user_id=auth.uid() AND d.revoked_at IS NULL AND d.tenant_id=p_tenant_id AND (s.pin_hash IS NULL OR d.unlocked_until>now())));
$$;
DO $patch$
DECLARE v_def text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public._kitchen_resolve_tenant(uuid)'::regprocedure);
 EXECUTE pg_temp.entrega1_empty_search_path(v_def);
 v_def:=pg_catalog.pg_get_functiondef('public.kitchen_get_context(uuid)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$COALESCE(public._tenant_role_of_caller(p_tenant_id), '') NOT IN ('OWNER','MANAGER','OPERATOR','CASHIER')$s$,$s$NOT public.has_store_permission(p_tenant_id,'manage_kitchen')$s$,'permission_guard');
 v_def:=pg_temp.entrega1_empty_search_path(v_def);
 EXECUTE v_def;
 -- Remove também nome e código de retirada do papel Cozinha (só preparo/mesa/produtos).
 v_def:=pg_catalog.pg_get_functiondef('public.kitchen_list_orders(uuid)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$'customer_first_name', CASE WHEN$s$,$s$'customer_first_name', CASE WHEN public._tenant_role_of_caller(v_tenant)<>'KITCHEN' AND$s$,'kitchen_minimize_name');
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$'pickup_code', CASE WHEN$s$,$s$'pickup_code', CASE WHEN public._tenant_role_of_caller(v_tenant)<>'KITCHEN' AND$s$,'kitchen_minimize_code');
 EXECUTE v_def;
 v_def:=pg_catalog.pg_get_functiondef('public.kitchen_set_order_status(uuid,text)'::regprocedure);
 v_def:=pg_temp.entrega1_empty_search_path(v_def);
 EXECUTE v_def;
 v_def:=pg_catalog.pg_get_functiondef('public.update_order_status(uuid,text,text)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$v_role := public._tenant_role_of_caller(v_order.tenant_id);$s$,$r$v_role := public._tenant_role_of_caller(v_order.tenant_id);
    IF v_role='KITCHEN' THEN RETURN public.kitchen_set_order_status(p_order_id,v_new); END IF;
    IF NOT public.has_store_permission(v_order.tenant_id,CASE WHEN v_role='WAITER' THEN 'waiter' WHEN v_role='DELIVERY_MANAGER' THEN 'dispatch_orders' ELSE 'manage_orders' END) THEN
      RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado.' USING ERRCODE='42501';
    END IF;
$r$,'order_permissions');
 EXECUTE v_def;
 -- A habilitação antiga da cozinha respeita o mesmo interruptor e só o dono o altera.
 v_def:=pg_catalog.pg_get_functiondef('public.set_kitchen_settings(uuid,boolean,text,boolean)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN
    IF NOT public.has_store_permission(p_tenant_id,'manage_kitchen') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso à cozinha.' USING ERRCODE='42501'; END IF;
    IF p_enabled IS DISTINCT FROM (SELECT enabled FROM public.kitchen_settings WHERE tenant_id=p_tenant_id) THEN
      PERFORM public.set_store_tool(p_tenant_id,'kitchen',COALESCE(p_enabled,false));
    END IF;
$r$,'entry_guard');
 v_def:=pg_temp.entrega1_empty_search_path(v_def);
 EXECUTE v_def;
END $patch$;

-- Fechamento de conta mantém a autorização do garçom v3; desligar a ferramenta revoga operações novas.
DO $patch$
DECLARE r record; v_def text; v_guard text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('get_tenant_financial_summary','p_tenant_id','view_finances'),
 ('upsert_tenant_payment_settings','p_tenant_id','view_finances'),
 ('get_tenant_reports_summary','p_tenant_id','view_reports'),
 ('list_team_directory','p_tenant','manage_team'),
 ('list_team_invites','p_tenant_id','manage_team'),
 ('set_waiter_service_settings','p_tenant','manage_team'),
 ('set_product_option_group_links','p_tenant_id','manage_catalog'),
 ('change_product_option_price','p_tenant_id','manage_catalog'),
 ('change_product_options_price','p_tenant_id','manage_catalog')
 ) x(fn,arg,perm) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=r.fn) THEN
   RAISE EXCEPTION 'ENTREGA1_PATCH_MISMATCH: %/required_function',r.fn USING ERRCODE='22023';
  END IF;
  FOR v_def IN SELECT pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=r.fn LOOP
   v_guard:=format('BEGIN IF NOT public.has_store_permission(%I,%L) THEN RAISE EXCEPTION ''FORBIDDEN: sem permissão para esta operação.'' USING ERRCODE=''42501''; END IF;',r.arg,r.perm);
   v_def:=pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',v_guard,'entry_guard');
   v_def:=pg_temp.entrega1_empty_search_path(v_def);
   EXECUTE v_def;
  END LOOP;
 END LOOP;
 -- Essas RPCs já resolvem tenant antes de validar o papel. Acrescentamos a permissão ajustável.
 v_def:=pg_catalog.pg_get_functiondef('public.adjust_inventory(uuid,integer,character varying,text,character varying)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,'IF NOT public.has_tenant_permission(v_user_id, v_tenant_id, ''manage_inventory'') THEN','IF NOT public.has_store_permission(v_tenant_id,''manage_inventory'') THEN','permission_guard');
 v_def:=pg_temp.entrega1_empty_search_path(v_def);
 EXECUTE v_def;
END $patch$;

-- Estoque e despacho têm APIs antigas com checagens por papel: o helper central
-- também deve respeitar overrides, antes de executar qualquer leitura/movimentação.
CREATE OR REPLACE FUNCTION public._stock_staff(p_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.has_store_permission(p_tenant_id,'manage_inventory'); $$;
CREATE OR REPLACE FUNCTION public._stock_manager(p_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.has_store_permission(p_tenant_id,'manage_inventory') AND public.has_tenant_scoped_role(p_tenant_id,ARRAY['OWNER','MANAGER']); $$;
DO $patch$
DECLARE v_def text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.archive_orders(uuid[],boolean)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$COALESCE(public._tenant_role_of_caller(v_order.tenant_id), '') NOT IN ('OWNER','MANAGER')$s$,$s$NOT public.has_store_permission(v_order.tenant_id,'manage_orders')$s$,'permission_guard');
 EXECUTE v_def;
 IF pg_catalog.to_regprocedure('public.offer_order_to_driver(uuid,uuid)') IS NOT NULL THEN
  v_def:=pg_catalog.pg_get_functiondef('public.offer_order_to_driver(uuid,uuid)'::regprocedure);
  v_def:=pg_temp.entrega1_checked_replace(v_def,$s$public._pr_b_staff(o.tenant_id,ARRAY['OWNER','MANAGER','DELIVERY_MANAGER'])$s$,$s$public.has_store_permission(o.tenant_id,'dispatch_orders')$s$,'permission_guard');
  EXECUTE v_def;
 END IF;
 v_def:=pg_catalog.pg_get_functiondef('public.get_dispatch_queue(uuid)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN IF NOT public.has_store_permission(p_tenant_id,'dispatch_orders') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso ao despacho.' USING ERRCODE='42501'; END IF;$r$,'entry_guard');
 EXECUTE v_def;
END $patch$;

-- Permissões de mesas também valem nas RPCs SECURITY DEFINER legadas.
DO $table_guards$
DECLARE r record; v_def text; v_guard text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.staff_open_tab(uuid)','public.dining_tables','p_table_id'),
 ('public.staff_request_bill(uuid)','public.dining_tabs','p_tab_id'),
 ('public.authorize_waiter_to_close(uuid)','public.dining_tabs','p_tab_id'),
 ('public.close_tab(uuid,jsonb)','public.dining_tabs','p_tab_id'),
 ('public.approve_session(uuid)','public.tab_sessions','p_session_id'),
 ('public.reject_session(uuid)','public.tab_sessions','p_session_id'),
 ('public.staff_reset_tab_holder(uuid)','public.dining_tabs','p_tab_id'),
 ('public.staff_create_holder_code(uuid)','public.dining_tabs','p_tab_id'),
 ('public.release_empty_tab(uuid,text)','public.dining_tabs','p_tab_id')
 ) x(sig,tbl,arg) LOOP
  v_def:=pg_catalog.pg_get_functiondef(r.sig::regprocedure);
  v_guard:=format('BEGIN IF NOT public.has_store_permission((SELECT tenant_id FROM %s WHERE id=%I),''manage_tables'') THEN RAISE EXCEPTION ''FORBIDDEN: sem acesso às mesas.'' USING ERRCODE=''42501''; END IF;',r.tbl,r.arg);
  EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',v_guard,'entry_guard');
 END LOOP;
 v_def:=pg_catalog.pg_get_functiondef('public._waiter_require_manager(uuid)'::regprocedure);
 EXECUTE pg_temp.entrega1_checked_regexp_replace(v_def,'\mBEGIN\M',$r$BEGIN IF NOT public.has_store_permission(p_tenant,'manage_team') THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso à equipe.' USING ERRCODE='42501'; END IF;$r$,'entry_guard');
END $table_guards$;

-- RLS adicional é RESTRICTIVE: nenhuma policy antiga amplia o papel Cozinha ou ignora um toggle.
CREATE POLICY entrega1_waiter_calls_read ON public.waiter_calls AS RESTRICTIVE FOR SELECT TO authenticated USING(public._store_caller_role(tenant_id) IS DISTINCT FROM 'WAITER' OR public.has_store_permission(tenant_id,'waiter'));
CREATE POLICY entrega1_orders_minimize ON public.orders AS RESTRICTIVE FOR SELECT TO authenticated USING(
 public._store_caller_role(tenant_id) IS NULL OR (
 public._store_caller_role(tenant_id)<>'KITCHEN' AND (
 public.has_store_permission(tenant_id,'view_orders') OR public.has_store_permission(tenant_id,'manage_orders')
 OR (public.has_store_permission(tenant_id,'waiter') AND fulfillment_type='DINE_IN' AND public._store_waiter_tab_visible(tab_id))
 OR (driver_id=auth.uid() AND public.has_store_permission(tenant_id,'view_assigned_orders')))));
CREATE POLICY entrega1_tables_read ON public.dining_tables AS RESTRICTIVE FOR SELECT TO authenticated USING(public._store_caller_role(tenant_id) IS NULL OR public.has_store_permission(tenant_id,'manage_tables'));
CREATE POLICY entrega1_tabs_read ON public.dining_tabs AS RESTRICTIVE FOR SELECT TO authenticated USING(public._store_caller_role(tenant_id) IS NULL OR public.has_store_permission(tenant_id,'manage_tables'));
CREATE POLICY entrega1_customers_minimize ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated USING(public._store_caller_role(tenant_id) IS DISTINCT FROM 'KITCHEN');
CREATE POLICY entrega1_payment_settings_owner ON public.tenant_payment_settings AS RESTRICTIVE FOR ALL TO authenticated USING(public.has_store_permission(tenant_id,'view_finances')) WITH CHECK(public.has_store_permission(tenant_id,'view_finances'));
CREATE POLICY entrega1_payment_accounts_owner ON public.store_payment_accounts AS RESTRICTIVE FOR ALL TO authenticated USING(public.has_store_permission(tenant_id,'view_finances')) WITH CHECK(public.has_store_permission(tenant_id,'view_finances'));
CREATE POLICY entrega1_products_permission ON public.products AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.has_store_permission(tenant_id,'manage_catalog') OR public.has_store_permission(tenant_id,'manage_inventory')) WITH CHECK(public.has_store_permission(tenant_id,'manage_catalog') OR public.has_store_permission(tenant_id,'manage_inventory'));
-- Intencionalmente PERMISSIVE: um override autorizado precisa poder conceder UPDATE
-- mesmo sem uma policy permissiva antiga para o papel. A policy RESTRICTIVE acima
-- continua obrigatória (inclusive isolamento por tenant) e nunca é contornada por OR.
-- A proteção de colunas/estoque permanece nos triggers existentes.
CREATE POLICY entrega1_products_write ON public.products FOR UPDATE TO authenticated USING(public.has_store_permission(tenant_id,'manage_catalog') OR public.has_store_permission(tenant_id,'manage_inventory')) WITH CHECK(public.has_store_permission(tenant_id,'manage_catalog') OR public.has_store_permission(tenant_id,'manage_inventory'));
CREATE POLICY entrega1_catalog_insert ON public.products AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.has_store_permission(tenant_id,'manage_catalog'));
CREATE POLICY entrega1_catalog_delete ON public.products AS RESTRICTIVE FOR DELETE TO authenticated USING(public.has_store_permission(tenant_id,'manage_catalog'));
CREATE POLICY entrega1_categories_permission ON public.categories AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.has_store_permission(tenant_id,'manage_catalog')) WITH CHECK(public.has_store_permission(tenant_id,'manage_catalog'));
CREATE POLICY entrega1_categories_insert ON public.categories AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.has_store_permission(tenant_id,'manage_catalog'));
CREATE POLICY entrega1_categories_delete ON public.categories AS RESTRICTIVE FOR DELETE TO authenticated USING(public.has_store_permission(tenant_id,'manage_catalog'));
CREATE POLICY entrega1_members_read ON public.tenant_users AS RESTRICTIVE FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_store_permission(tenant_id,'manage_team'));
CREATE POLICY entrega1_orders_write ON public.orders AS RESTRICTIVE FOR UPDATE TO authenticated USING(public._store_caller_role(tenant_id)<>'KITCHEN' AND public.has_store_permission(tenant_id,'manage_orders')) WITH CHECK(public._store_caller_role(tenant_id)<>'KITCHEN' AND public.has_store_permission(tenant_id,'manage_orders'));

-- A API HTTP usa service_role com identidade explícita: a reserva financeira continua só do dono.
DO $patch$
DECLARE v_def text; v_sig text;
BEGIN
 FOREACH v_sig IN ARRAY ARRAY['public.configure_store_payment(uuid,uuid,text,jsonb)','public.complete_store_payment_connection(uuid,uuid,text,text,bigint)'] LOOP
  v_def:=pg_catalog.pg_get_functiondef(v_sig::regprocedure);
  EXECUTE pg_temp.entrega1_checked_replace(v_def,$s$tu.role_id IN ('OWNER','MANAGER')$s$,$s$tu.role_id='OWNER'$s$,'financial_owner');
 END LOOP;
END $patch$;
-- Recebimento operacional é distinto da configuração financeira; identidade real
-- e overrides são conferidos mesmo quando a API usa a chave de serviço.
DO $receipt_guards$
DECLARE v_def text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.reserve_order_payment(uuid,uuid,text,text)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.tenant_id=v_order.tenant_id AND tu.user_id=p_user AND tu.status='ACTIVE' AND tu.role_id IN ('OWNER','MANAGER','CASHIER'))$s$,
 $r$(public._store_user_permission(p_user,v_order.tenant_id,'manage_orders') OR public._store_user_permission(p_user,v_order.tenant_id,'manage_cashier'))$r$,'financial_owner');
 EXECUTE v_def;
 v_def:=pg_catalog.pg_get_functiondef('public.confirm_order_payment(uuid,jsonb,uuid)'::regprocedure);
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$IF v_payment.status='paid' THEN RETURN; END IF;$s$,$r$IF p_manual_user IS NOT NULL AND NOT (public._store_user_permission(p_manual_user,v_payment.tenant_id,'manage_orders') OR public._store_user_permission(p_manual_user,v_payment.tenant_id,'manage_cashier')) THEN RAISE EXCEPTION 'FORBIDDEN: sem permissão para receber pagamentos.' USING ERRCODE='42501'; END IF;
 IF v_payment.status='paid' THEN RETURN; END IF;$r$,'receipt_actor');
 v_def:=pg_temp.entrega1_checked_replace(v_def,$s$tu.role_id IN ('OWNER','MANAGER')$s$,$s$tu.role_id IN ('OWNER','MANAGER','CASHIER')$s$,'receipt_roles');
 EXECUTE v_def;
END $receipt_guards$;

-- Catálogo: as tabelas de adicionais também respeitam o mesmo toggle de catálogo.
DO $policies$
DECLARE v_table text;
BEGIN
 FOREACH v_table IN ARRAY ARRAY['product_option_groups','product_options','product_option_group_links'] LOOP
  IF pg_catalog.to_regclass('public.'||v_table) IS NULL THEN CONTINUE; END IF;
  EXECUTE format('CREATE POLICY entrega1_catalog_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.has_store_permission(tenant_id,''manage_catalog'')) WITH CHECK(public.has_store_permission(tenant_id,''manage_catalog''))',v_table);
  EXECUTE format('CREATE POLICY entrega1_catalog_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.has_store_permission(tenant_id,''manage_catalog''))',v_table);
  EXECUTE format('CREATE POLICY entrega1_catalog_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING(public.has_store_permission(tenant_id,''manage_catalog''))',v_table);
 END LOOP;
END $policies$;

-- SECURITY DEFINER sempre com search_path vazio; somente rotas públicas mínimas para anon.
DO $acl$
DECLARE r record; v_def text; v_new text[]:=ARRAY['_store_caller_role','_store_waiter_tab_visible','salon_rounds_for_staff','_store_user_permission','_store_role_defaults','_store_tool_enabled','has_store_permission','list_store_tools','get_store_access','list_store_role_permissions','set_store_tool','set_store_role_permission','team_invite_check','waiter_invite_check','_team_signup_invited','waiter_reusable_identity','team_accept_invite'];
BEGIN
 FOR r IN SELECT p.oid::regprocedure::text sig,p.proname FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(v_new) LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.sig||' FROM PUBLIC,anon,authenticated,service_role';
  IF r.proname IN('team_invite_check','waiter_invite_check') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.sig||' TO anon,authenticated';
  ELSIF r.proname IN('waiter_reusable_identity','salon_rounds_for_staff','_store_user_permission') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.sig||' TO service_role';
  ELSIF r.proname NOT IN('_store_role_defaults','_store_tool_enabled','_team_signup_invited') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.sig||' TO authenticated'; END IF;
 END LOOP;
 -- Altered legacy functions keep their existing non-PUBLIC caller grants.
 FOR r IN SELECT p.oid::regprocedure::text sig FROM pg_catalog.pg_proc p JOIN public._entrega1_restore b ON b.signature=p.oid::regprocedure::text
 WHERE p.pronamespace='public'::regnamespace LOOP
  v_def:=pg_catalog.pg_get_functiondef(r.sig::regprocedure);
  v_def:=pg_temp.entrega1_empty_search_path(v_def);
  EXECUTE v_def;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.sig||' FROM PUBLIC';
 END LOOP;
END $acl$;
DROP FUNCTION pg_temp.entrega1_empty_search_path(text);
DROP FUNCTION pg_temp.entrega1_checked_regexp_replace(text,text,text,text);
DROP FUNCTION pg_temp.entrega1_checked_replace(text,text,text,text);
COMMIT;

