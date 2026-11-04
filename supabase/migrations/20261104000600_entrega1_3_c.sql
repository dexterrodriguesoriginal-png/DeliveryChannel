-- Entrega 1.3 / C: trocar de mesa, juntar/separar mesas e código de entrega por rodada.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.reserve_tab_receipt(uuid,uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'PRECHECK: Entrega 1.3 B ausente.';
 END IF;
END $$;

CREATE TABLE public._entrega1_3_c_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_3_c_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_3_c_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_3_c_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid IN(
 'public.waiter_mark_delivered(uuid)'::regprocedure,
 'public.update_order_status(uuid,text,text)'::regprocedure,
 'public.customer_dispute_delivery(uuid,uuid)'::regprocedure,
 'public.get_my_tab(uuid)'::regprocedure,
 'public.salon_rounds_for_staff(uuid,uuid)'::regprocedure,
 'public._waiter_serves_tab(uuid,uuid)'::regprocedure,
 'public.enter_table(text,text,text)'::regprocedure,
 'public.staff_open_tab(uuid)'::regprocedure,
 'public.configure_dine_in(uuid,jsonb,boolean,jsonb)'::regprocedure,
 'public._dining_tabs_close_sessions()'::regprocedure
);

ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED','ORDER_DELIVERY_DISPUTE','TABLE_MOVED'));

-- 1. Mesas juntadas numa mesma comanda ativa e histórico auditável de trocas/junções.
CREATE TABLE public.dining_tab_tables(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 tab_id uuid NOT NULL,
 table_id uuid NOT NULL,
 joined_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,table_id),
 FOREIGN KEY(tenant_id,tab_id) REFERENCES public.dining_tabs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,table_id) REFERENCES public.dining_tables(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX dining_tab_tables_tab ON public.dining_tab_tables(tenant_id,tab_id);
ALTER TABLE public.dining_tab_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dining_tab_tables FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.dining_tab_tables TO authenticated;
CREATE POLICY dining_tab_tables_staff_read ON public.dining_tab_tables FOR SELECT TO authenticated
 USING(public._tab_pix_staff(auth.uid(),tenant_id) AND (public._tenant_role_of_caller(tenant_id)<>'WAITER' OR public._waiter_serves_tab(tab_id,auth.uid())));

CREATE TABLE public.tab_table_moves(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 tab_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('MOVE','JOIN','SEPARATE')),
 from_table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL,
 to_table_id uuid REFERENCES public.dining_tables(id) ON DELETE SET NULL,
 from_label text NOT NULL,
 to_label text NOT NULL,
 actor_kind text NOT NULL CHECK(actor_kind IN ('CUSTOMER','STAFF')),
 actor_id uuid,
 actor_name text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,tab_id) REFERENCES public.dining_tabs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX tab_table_moves_tab ON public.tab_table_moves(tenant_id,tab_id,created_at DESC);
ALTER TABLE public.tab_table_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tab_table_moves FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.tab_table_moves TO authenticated;
CREATE POLICY tab_table_moves_staff_read ON public.tab_table_moves FOR SELECT TO authenticated
 USING(public._tab_pix_staff(auth.uid(),tenant_id) AND (public._tenant_role_of_caller(tenant_id)<>'WAITER' OR public._waiter_serves_tab(tab_id,auth.uid())));

CREATE OR REPLACE FUNCTION public._dining_tabs_close_sessions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
 UPDATE public.tab_sessions SET expires_at = LEAST(expires_at, now()), ended_at = now(), ended_reason = 'TAB_CLOSED'
 WHERE tenant_id = NEW.tenant_id AND tab_id = NEW.id AND ended_at IS NULL;
 UPDATE public.dining_tab_invites SET revoked_at = now() WHERE tenant_id = NEW.tenant_id AND tab_id = NEW.id AND revoked_at IS NULL;
 DELETE FROM public.dining_tab_tables WHERE tenant_id = NEW.tenant_id AND tab_id = NEW.id;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._dining_tabs_close_sessions() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._table_active_tab(p_tenant uuid,p_table uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT tb.id FROM public.dining_tabs tb
 WHERE tb.tenant_id=p_tenant AND tb.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')
  AND (tb.table_id=p_table OR EXISTS(
   SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id=tb.tenant_id AND j.tab_id=tb.id AND j.table_id=p_table
  ))
 ORDER BY (tb.table_id=p_table) DESC,tb.opened_at DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._table_active_tab(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Garçom atende a comanda se estiver atribuído à mesa principal ou a qualquer mesa juntada a ela.
DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public._waiter_serves_tab(uuid,uuid)'::regprocedure);
 v_new:=replace(v_def,$old$a.table_id=tb.table_id$old$,
 $new$(a.table_id=tb.table_id OR EXISTS(SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id=tb.tenant_id AND j.tab_id=tb.id AND j.table_id=a.table_id))$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: _waiter_serves_tab/joined'; END IF;
 EXECUTE v_new;
END $$;

-- enter_table e staff_open_tab respeitam mesas juntadas em dining_tab_tables.
DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.enter_table(text,text,text)'::regprocedure);
 v_new:=replace(v_def,$old$AND tb.status IN ('OPEN','BILL_REQUESTED') AND tb.table_id = v_table.id$old$,
 $new$AND tb.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT') AND (tb.table_id = v_table.id OR EXISTS(SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id = tb.tenant_id AND j.tab_id = tb.id AND j.table_id = v_table.id))$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: enter_table/restore_joined'; END IF;
 v_def:=v_new;
 v_new:=replace(v_def,$old$WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN','BILL_REQUESTED')$old$,
 $new$WHERE tb.tenant_id = v_table.tenant_id AND (tb.table_id = v_table.id OR EXISTS(SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id = tb.tenant_id AND j.tab_id = tb.id AND j.table_id = v_table.id)) AND tb.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: enter_table/in_use_joined'; END IF;
 EXECUTE v_new;

 v_def:=pg_catalog.pg_get_functiondef('public.staff_open_tab(uuid)'::regprocedure);
 v_new:=replace(v_def,$old$WHERE tb.tenant_id = v_table.tenant_id AND tb.table_id = v_table.id AND tb.status IN ('OPEN','BILL_REQUESTED')$old$,
 $new$WHERE tb.tenant_id = v_table.tenant_id AND (tb.table_id = v_table.id OR EXISTS(SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id = tb.tenant_id AND j.tab_id = tb.id AND j.table_id = v_table.id)) AND tb.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: staff_open_tab/joined'; END IF;
 EXECUTE v_new;
END $$;

CREATE FUNCTION public.list_free_tables_for_session(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_s public.tab_sessions;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_s FROM public.tab_sessions s
 WHERE s.id=p_session_id AND s.auth_user_id=auth.uid() AND s.ended_at IS NULL AND s.expires_at>now() AND s.approved_at IS NOT NULL;
 IF NOT FOUND OR public._dine_in_config(v_s.tenant_id) IS NULL THEN
  RAISE EXCEPTION 'FORBIDDEN: sessão da mesa indisponível.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',dt.id,'label',dt.label,'area',dt.area,'seats',dt.seats) ORDER BY dt.label)
  FROM public.dining_tables dt
  WHERE dt.tenant_id=v_s.tenant_id AND dt.active AND public._table_active_tab(v_s.tenant_id,dt.id) IS NULL
 ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_free_tables_for_session(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_free_tables_for_session(uuid) TO authenticated;

CREATE FUNCTION public.customer_move_table(p_session_id uuid,p_target_table_id uuid DEFAULT NULL,p_target_qr_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_s public.tab_sessions;
 v_tab public.dining_tabs;
 v_from public.dining_tables;
 v_to public.dining_tables;
 v_token text;
 v_notice text;
BEGIN
 IF auth.uid() IS NULL OR NOT public._customer_identified() THEN
  RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_s FROM public.tab_sessions s
 WHERE s.id=p_session_id AND s.auth_user_id=auth.uid() AND s.ended_at IS NULL AND s.expires_at>now() AND s.approved_at IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: sessão da mesa indisponível.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=v_s.tab_id AND tb.tenant_id=v_s.tenant_id FOR UPDATE;
 IF NOT FOUND OR public._dine_in_config(v_tab.tenant_id) IS NULL THEN
  RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.' USING ERRCODE='42501';
 END IF;
 IF v_tab.responsible_user_id IS NOT NULL AND v_tab.responsible_user_id IS DISTINCT FROM v_s.auth_user_id THEN
  RAISE EXCEPTION 'FORBIDDEN: somente o responsável da mesa pode mudar de mesa.' USING ERRCODE='42501';
 END IF;
 IF v_tab.status<>'OPEN'
  OR EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=v_tab.tenant_id AND c.tab_id=v_tab.id AND c.status IN ('creating','pending','paid'))
  OR EXISTS(SELECT 1 FROM public.tab_payments p WHERE p.tenant_id=v_tab.tenant_id AND p.tab_id=v_tab.id) THEN
  RAISE EXCEPTION 'MOVE_BLOCKED_BILL: não é permitido mudar de mesa com conta pedida ou pagamento em andamento.';
 END IF;
 IF p_target_table_id IS NOT NULL THEN
  SELECT * INTO v_to FROM public.dining_tables dt
  WHERE dt.id=p_target_table_id AND dt.tenant_id=v_tab.tenant_id AND dt.active FOR UPDATE;
 ELSIF p_target_qr_token IS NOT NULL AND btrim(p_target_qr_token)<>'' THEN
  v_token:=btrim(p_target_qr_token);
  IF position('mesa=' IN v_token)>0 THEN
   v_token:=regexp_replace(v_token,'^.*[?&]mesa=([^&#\s]+).*$','\1');
  END IF;
  SELECT * INTO v_to FROM public.dining_tables dt
  WHERE dt.qr_token=v_token AND dt.tenant_id=v_tab.tenant_id AND dt.active FOR UPDATE;
 ELSE
  RAISE EXCEPTION 'INVALID_INPUT: selecione uma mesa livre ou leia o QR da nova mesa.';
 END IF;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa de destino indisponível.' USING ERRCODE='42501';
 END IF;
 IF public._qr_paused(v_tab.tenant_id,v_to.id) THEN
  RAISE EXCEPTION 'QR_PAUSED: o QR desta mesa está pausado. Chame um atendente.';
 END IF;
 IF v_to.id=v_tab.table_id OR EXISTS(SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id=v_tab.tenant_id AND j.tab_id=v_tab.id AND j.table_id=v_to.id) THEN
  RAISE EXCEPTION 'SAME_TABLE: sua conta já está nesta mesa.';
 END IF;
 IF public._table_active_tab(v_tab.tenant_id,v_to.id) IS NOT NULL THEN
  RAISE EXCEPTION 'TABLE_OCCUPIED: esta mesa está ocupada. Peça ao garçom para juntar as mesas.';
 END IF;
 IF NOT public._rate_limit_hit('tab_move_table',v_tab.id::text,v_tab.tenant_id,5,600) THEN
  RAISE EXCEPTION 'RATE_LIMITED: muitas trocas de mesa seguidas. Chame o garçom.' USING ERRCODE='P0429';
 END IF;
 SELECT * INTO v_from FROM public.dining_tables dt WHERE dt.id=v_tab.table_id AND dt.tenant_id=v_tab.tenant_id;
 UPDATE public.dining_tabs SET table_id=v_to.id WHERE id=v_tab.id AND tenant_id=v_tab.tenant_id;
 v_notice:=v_from.label||' → '||v_to.label;
 INSERT INTO public.tab_table_moves(tenant_id,tab_id,action,from_table_id,to_table_id,from_label,to_label,actor_kind,actor_id,actor_name)
 VALUES(v_tab.tenant_id,v_tab.id,'MOVE',v_from.id,v_to.id,v_from.label,v_to.label,'CUSTOMER',v_s.id,COALESCE(NULLIF(btrim(v_s.display_name),''),'Cliente'));
 PERFORM public._tab_access_log(v_tab.tenant_id,v_tab.id,'TABLE_MOVED','CUSTOMER',v_s.id,v_s.id,
  jsonb_build_object('from_table_id',v_from.id,'to_table_id',v_to.id,'from_label',v_from.label,'to_label',v_to.label));
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title)
 VALUES(v_tab.tenant_id,'TABLE_MOVED',v_tab.id,v_notice);
 INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision)
 VALUES(v_tab.tenant_id,v_tab.id,clock_timestamp())
 ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 RETURN jsonb_build_object('tabId',v_tab.id,'fromTableId',v_from.id,'fromLabel',v_from.label,'toTableId',v_to.id,'toLabel',v_to.label,'notice',v_notice);
END $$;
REVOKE ALL ON FUNCTION public.customer_move_table(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.customer_move_table(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.staff_join_tables(p_table_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_user uuid:=auth.uid();
 v_ids uuid[];
 v_tenant uuid;
 v_primary_table public.dining_tables;
 v_primary_tab public.dining_tabs;
 v_tbl public.dining_tables;
 v_other_tab_id uuid;
 v_other_tab public.dining_tabs;
 v_max_round integer;
 v_ord record;
 v_config jsonb;
 v_fee numeric:=0;
 v_tid uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE='42501'; END IF;
 SELECT array_agg(x.id ORDER BY x.ord) INTO v_ids
 FROM (SELECT DISTINCT ON (u.id) u.id,u.ord FROM unnest(COALESCE(p_table_ids,ARRAY[]::uuid[])) WITH ORDINALITY AS u(id,ord) WHERE u.id IS NOT NULL ORDER BY u.id,u.ord) x;
 IF v_ids IS NULL OR array_length(v_ids,1)<2 THEN
  RAISE EXCEPTION 'INVALID_INPUT: selecione pelo menos 2 mesas para juntar.';
 END IF;
 SELECT dt.* INTO v_primary_table FROM public.dining_tables dt WHERE dt.id=v_ids[1] AND dt.active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa principal indisponível.' USING ERRCODE='42501'; END IF;
 v_tenant:=v_primary_table.tenant_id;
 IF NOT public._tab_pix_staff(v_user,v_tenant) THEN
  RAISE EXCEPTION 'FORBIDDEN: sem permissão para juntar mesas.' USING ERRCODE='42501';
 END IF;
 v_config:=public._dine_in_config(v_tenant);
 IF v_config IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.dining_tables dt WHERE dt.tenant_id=v_tenant AND dt.active AND dt.id=ANY(v_ids))<>array_length(v_ids,1) THEN
  RAISE EXCEPTION 'TABLE_UNAVAILABLE: todas as mesas devem pertencer à mesma loja e estar ativas.' USING ERRCODE='42501';
 END IF;
 -- Localiza comanda ativa na primeira mesa ou na primeira mesa ocupada da seleção.
 v_other_tab_id:=public._table_active_tab(v_tenant,v_ids[1]);
 IF v_other_tab_id IS NULL THEN
  FOREACH v_tid IN ARRAY v_ids LOOP
   v_other_tab_id:=public._table_active_tab(v_tenant,v_tid);
   EXIT WHEN v_other_tab_id IS NOT NULL;
  END LOOP;
 END IF;
 IF v_other_tab_id IS NOT NULL THEN
  SELECT * INTO v_primary_tab FROM public.dining_tabs tb WHERE tb.id=v_other_tab_id AND tb.tenant_id=v_tenant FOR UPDATE;
  SELECT * INTO v_primary_table FROM public.dining_tables dt WHERE dt.id=v_primary_tab.table_id AND dt.tenant_id=v_tenant;
 ELSE
  IF EXISTS(SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id=v_tenant AND tm.module_key='service_fee' AND tm.enabled) THEN
   v_fee:=COALESCE((SELECT NULLIF(tm.config->>'percent','')::numeric FROM public.tenant_modules tm WHERE tm.tenant_id=v_tenant AND tm.module_key='service_fee'),10);
  END IF;
  INSERT INTO public.dining_tabs(tenant_id,mode,table_id,service_fee_percent,waiter_id)
  VALUES(v_tenant,CASE WHEN v_config->>'mode'='INDIVIDUAL' THEN 'INDIVIDUAL' ELSE 'TABLE' END,v_primary_table.id,v_fee,
   (SELECT u.id FROM public.users u WHERE u.id=v_user))
  RETURNING * INTO v_primary_tab;
 END IF;
 IF EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=v_tenant AND c.tab_id=v_primary_tab.id AND c.status IN ('creating','pending','paid'))
  OR EXISTS(SELECT 1 FROM public.tab_payments p WHERE p.tenant_id=v_tenant AND p.tab_id=v_primary_tab.id) THEN
  RAISE EXCEPTION 'JOIN_BLOCKED_PAYMENT: não é permitido juntar mesas com pagamento ou PIX em andamento.';
 END IF;
 FOREACH v_tid IN ARRAY v_ids LOOP
  SELECT * INTO v_tbl FROM public.dining_tables dt WHERE dt.id=v_tid AND dt.tenant_id=v_tenant FOR UPDATE;
  v_other_tab_id:=public._table_active_tab(v_tenant,v_tid);
  IF v_other_tab_id IS NOT NULL AND v_other_tab_id<>v_primary_tab.id THEN
   SELECT * INTO v_other_tab FROM public.dining_tabs tb WHERE tb.id=v_other_tab_id AND tb.tenant_id=v_tenant FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=v_tenant AND c.tab_id=v_other_tab.id AND c.status IN ('creating','pending','paid'))
    OR EXISTS(SELECT 1 FROM public.tab_payments p WHERE p.tenant_id=v_tenant AND p.tab_id=v_other_tab.id) THEN
    RAISE EXCEPTION 'JOIN_BLOCKED_PAYMENT: uma das mesas possui pagamento ou PIX em andamento.';
   END IF;
   SELECT COALESCE(max(o.round_no),0) INTO v_max_round FROM public.orders o WHERE o.tenant_id=v_tenant AND o.tab_id=v_primary_tab.id AND o.fulfillment_type='DINE_IN';
   FOR v_ord IN SELECT o.id FROM public.orders o WHERE o.tenant_id=v_tenant AND o.tab_id=v_other_tab.id AND o.fulfillment_type='DINE_IN' ORDER BY o.round_no,o.created_at,o.id LOOP
    v_max_round:=v_max_round+1;
    UPDATE public.orders SET tab_id=v_primary_tab.id,round_no=v_max_round WHERE id=v_ord.id AND tenant_id=v_tenant;
   END LOOP;
   UPDATE public.salon_order_delivery_codes SET tab_id=v_primary_tab.id WHERE tenant_id=v_tenant AND tab_id=v_other_tab.id;
   UPDATE public.tab_sessions SET tab_id=v_primary_tab.id
   WHERE tenant_id=v_tenant AND tab_id=v_other_tab.id
    AND NOT EXISTS(SELECT 1 FROM public.tab_sessions x WHERE x.tenant_id=v_tenant AND x.tab_id=v_primary_tab.id AND x.auth_user_id=public.tab_sessions.auth_user_id AND x.device_id=public.tab_sessions.device_id);
   UPDATE public.waiter_calls SET tab_id=v_primary_tab.id WHERE tenant_id=v_tenant AND tab_id=v_other_tab.id AND status='OPEN';
   UPDATE public.dining_tab_tables SET tab_id=v_primary_tab.id WHERE tenant_id=v_tenant AND tab_id=v_other_tab.id;
   IF v_primary_tab.responsible_user_id IS NULL AND v_other_tab.responsible_user_id IS NOT NULL THEN
    UPDATE public.dining_tabs SET responsible_user_id=v_other_tab.responsible_user_id,responsible_since=v_other_tab.responsible_since
    WHERE id=v_primary_tab.id AND tenant_id=v_tenant RETURNING * INTO v_primary_tab;
   END IF;
   UPDATE public.dining_tabs SET status='CANCELLED',closed_at=now(),merged_into_tab_id=v_primary_tab.id,holder_claimable=false
   WHERE id=v_other_tab.id AND tenant_id=v_tenant;
  END IF;
  IF v_tid<>v_primary_tab.table_id AND NOT EXISTS(SELECT 1 FROM public.dining_tab_tables j WHERE j.tenant_id=v_tenant AND j.tab_id=v_primary_tab.id AND j.table_id=v_tid) THEN
   INSERT INTO public.dining_tab_tables(tenant_id,tab_id,table_id,joined_by)
   VALUES(v_tenant,v_primary_tab.id,v_tid,(SELECT u.id FROM public.users u WHERE u.id=v_user))
   ON CONFLICT(tenant_id,table_id) DO UPDATE SET tab_id=EXCLUDED.tab_id,joined_by=EXCLUDED.joined_by,joined_at=now();
   INSERT INTO public.tab_table_moves(tenant_id,tab_id,action,from_table_id,to_table_id,from_label,to_label,actor_kind,actor_id,actor_name)
   VALUES(v_tenant,v_primary_tab.id,'JOIN',v_primary_table.id,v_tbl.id,v_primary_table.label,v_tbl.label,'STAFF',v_user,'Equipe do salão');
   PERFORM public._tab_access_log(v_tenant,v_primary_tab.id,'TABLE_JOINED','STAFF',v_user,NULL,
    jsonb_build_object('primary_table_id',v_primary_table.id,'joined_table_id',v_tbl.id,'primary_label',v_primary_table.label,'joined_label',v_tbl.label));
  END IF;
 END LOOP;
 INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision)
 VALUES(v_tenant,v_primary_tab.id,clock_timestamp())
 ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 RETURN jsonb_build_object(
  'tabId',v_primary_tab.id,
  'primaryTableId',v_primary_tab.table_id,
  'joinedTableIds',COALESCE((SELECT jsonb_agg(j.table_id ORDER BY j.joined_at) FROM public.dining_tab_tables j WHERE j.tenant_id=v_tenant AND j.tab_id=v_primary_tab.id),'[]'::jsonb)
 );
END $$;
REVOKE ALL ON FUNCTION public.staff_join_tables(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_join_tables(uuid[]) TO authenticated;

CREATE FUNCTION public.staff_separate_table(p_tab_id uuid,p_table_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_user uuid:=auth.uid();
 v_tab public.dining_tabs;
 v_primary_table public.dining_tables;
 v_target_table public.dining_tables;
 v_promote_id uuid;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: autenticação necessária.' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab_id FOR UPDATE;
 IF NOT FOUND OR NOT public._tab_pix_staff(v_user,v_tab.tenant_id) THEN
  RAISE EXCEPTION 'FORBIDDEN: sem permissão para separar mesas.' USING ERRCODE='42501';
 END IF;
 IF v_tab.status NOT IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT') THEN
  RAISE EXCEPTION 'TAB_CLOSED: comanda já encerrada.';
 END IF;
 SELECT * INTO v_primary_table FROM public.dining_tables dt WHERE dt.id=v_tab.table_id AND dt.tenant_id=v_tab.tenant_id;
 SELECT * INTO v_target_table FROM public.dining_tables dt WHERE dt.id=p_table_id AND dt.tenant_id=v_tab.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa não encontrada.' USING ERRCODE='42501'; END IF;
 IF p_table_id=v_tab.table_id THEN
  SELECT j.table_id INTO v_promote_id FROM public.dining_tab_tables j
  WHERE j.tenant_id=v_tab.tenant_id AND j.tab_id=v_tab.id ORDER BY j.joined_at LIMIT 1;
  IF v_promote_id IS NULL THEN
   RAISE EXCEPTION 'NOT_JOINED: esta comanda possui apenas uma mesa.';
  END IF;
  DELETE FROM public.dining_tab_tables WHERE tenant_id=v_tab.tenant_id AND tab_id=v_tab.id AND table_id=v_promote_id;
  UPDATE public.dining_tabs SET table_id=v_promote_id WHERE id=v_tab.id AND tenant_id=v_tab.tenant_id;
 ELSE
  DELETE FROM public.dining_tab_tables WHERE tenant_id=v_tab.tenant_id AND tab_id=v_tab.id AND table_id=p_table_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_JOINED: esta mesa não está juntada nesta comanda.'; END IF;
 END IF;
 INSERT INTO public.tab_table_moves(tenant_id,tab_id,action,from_table_id,to_table_id,from_label,to_label,actor_kind,actor_id,actor_name)
 VALUES(v_tab.tenant_id,v_tab.id,'SEPARATE',v_primary_table.id,v_target_table.id,v_primary_table.label,v_target_table.label,'STAFF',v_user,'Equipe do salão');
 PERFORM public._tab_access_log(v_tab.tenant_id,v_tab.id,'TABLE_SEPARATED','STAFF',v_user,NULL,
  jsonb_build_object('separated_table_id',v_target_table.id,'separated_label',v_target_table.label));
 INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision)
 VALUES(v_tab.tenant_id,v_tab.id,clock_timestamp())
 ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 RETURN jsonb_build_object('tabId',v_tab.id,'separatedTableId',p_table_id);
END $$;
REVOKE ALL ON FUNCTION public.staff_separate_table(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_separate_table(uuid,uuid) TO authenticated;

-- 3. Código de entrega por rodada (opcional, padrão DESLIGADO).
CREATE TABLE public.salon_order_delivery_codes(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 tab_id uuid NOT NULL,
 code_hash text NOT NULL,
 customer_code text NOT NULL CHECK(customer_code ~ '^[0-9]{4}$'),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 confirmed_at timestamptz,
 confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 last_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,tab_id) REFERENCES public.dining_tabs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX salon_order_delivery_codes_tab ON public.salon_order_delivery_codes(tenant_id,tab_id);
ALTER TABLE public.salon_order_delivery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_order_delivery_codes FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._salon_delivery_code_required(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((public._dine_in_config(p_tenant)->>'require_delivery_code')::boolean,false);
$$;
REVOKE ALL ON FUNCTION public._salon_delivery_code_required(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.set_salon_delivery_code_required(p_tenant uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_cfg jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant,ARRAY['OWNER','MANAGER']) THEN
  RAISE EXCEPTION 'FORBIDDEN: sem permissão para configurar o salão.' USING ERRCODE='42501';
 END IF;
 IF public._dine_in_config(p_tenant) IS NULL THEN
  RAISE EXCEPTION 'MODULE_DISABLED: ative Mesa/Comanda antes de configurar o salão.';
 END IF;
 UPDATE public.tenant_modules
 SET config=COALESCE(config,'{}'::jsonb)||jsonb_build_object('require_delivery_code',COALESCE(p_enabled,false)),
     updated_by=auth.uid(),updated_at=now()
 WHERE tenant_id=p_tenant AND module_key='dine_in' AND enabled
 RETURNING config INTO v_cfg;
 RETURN jsonb_build_object('require_delivery_code',COALESCE((v_cfg->>'require_delivery_code')::boolean,false));
END $$;
REVOKE ALL ON FUNCTION public.set_salon_delivery_code_required(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_salon_delivery_code_required(uuid,boolean) TO authenticated;

DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.configure_dine_in(uuid,jsonb,boolean,jsonb)'::regprocedure);
 v_new:=replace(v_def,$old$SET config = p_config, updated_by = auth.uid(), updated_at = now()$old$,
 $new$SET config = jsonb_build_object('require_delivery_code', COALESCE((p_config ->> 'require_delivery_code')::boolean, (config ->> 'require_delivery_code')::boolean, false)) || p_config, updated_by = auth.uid(), updated_at = now()$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: configure_dine_in/require_delivery_code'; END IF;
 EXECUTE v_new;
END $$;

CREATE FUNCTION public._salon_order_create_delivery_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_code text; v_try integer:=0;
BEGIN
 IF NEW.fulfillment_type<>'DINE_IN' OR NEW.tab_id IS NULL OR NOT public._salon_delivery_code_required(NEW.tenant_id) THEN
  RETURN NEW;
 END IF;
 LOOP
  v_code:=lpad(((1000+((('x'||encode(extensions.gen_random_bytes(2),'hex'))::bit(16)::int & 65535)%9000)))::text,4,'0');
  EXIT WHEN NOT EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.tenant_id=NEW.tenant_id AND c.tab_id=NEW.tab_id AND c.customer_code=v_code) OR v_try>=25;
  v_try:=v_try+1;
 END LOOP;
 INSERT INTO public.salon_order_delivery_codes(order_id,tenant_id,tab_id,code_hash,customer_code)
 VALUES(NEW.id,NEW.tenant_id,NEW.tab_id,public._sha256_hex(NEW.id::text||':'||v_code),v_code)
 ON CONFLICT(order_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._salon_order_create_delivery_code() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER salon_order_create_delivery_code AFTER INSERT ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._salon_order_create_delivery_code();

CREATE FUNCTION public.waiter_mark_delivered(p_order uuid,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_order public.orders;
 v_code_row public.salon_order_delivery_codes;
 v_clean text:=btrim(COALESCE(p_code,''));
BEGIN
 SELECT * INTO v_order FROM public.orders o WHERE o.id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT public._can_manage_delivery_dispute(p_order) THEN
  RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido indisponível.' USING ERRCODE='42501';
 END IF;
 IF v_order.status='DELIVERED' THEN
  RETURN jsonb_build_object('order_id',v_order.id,'status',v_order.status,'delivered_at',v_order.delivered_at,'delivered_by',v_order.delivered_by,'success',true);
 END IF;
 IF v_order.status<>'OUT_FOR_DELIVERY' THEN
  RAISE EXCEPTION 'INVALID_STATE: Aguardando balcão. O pedido precisa ser servido antes da entrega.';
 END IF;
 SELECT * INTO v_code_row FROM public.salon_order_delivery_codes c
 WHERE c.order_id=v_order.id AND c.tenant_id=v_order.tenant_id FOR UPDATE;
 IF FOUND AND v_code_row.confirmed_at IS NULL THEN
  IF v_code_row.attempts>=5 THEN
   RAISE EXCEPTION 'DELIVERY_CODE_LOCKED: limite de 5 tentativas excedido para este pedido.';
  END IF;
  IF v_clean='' THEN
   RAISE EXCEPTION 'DELIVERY_CODE_REQUIRED: informe o código de 4 dígitos do cliente para confirmar a entrega.';
  END IF;
  IF v_clean !~ '^[0-9]{4}$' OR public._sha256_hex(v_order.id::text||':'||v_clean)<>v_code_row.code_hash THEN
   UPDATE public.salon_order_delivery_codes
   SET attempts=attempts+1,last_attempt_at=now()
   WHERE order_id=v_order.id AND tenant_id=v_order.tenant_id;
   PERFORM public._tab_access_log(v_order.tenant_id,v_order.tab_id,'DELIVERY_CODE_INVALID','STAFF',auth.uid(),NULL,
    jsonb_build_object('order_id',v_order.id,'attempts',v_code_row.attempts+1));
   RETURN jsonb_build_object('order_id',v_order.id,'status',v_order.status,'success',false,'error','DELIVERY_CODE_INVALID','attempts_left',GREATEST(0,4-v_code_row.attempts));
  END IF;
  UPDATE public.salon_order_delivery_codes
  SET confirmed_at=now(),confirmed_by=auth.uid(),last_attempt_at=now()
  WHERE order_id=v_order.id AND tenant_id=v_order.tenant_id;
  PERFORM public._tab_access_log(v_order.tenant_id,v_order.tab_id,'DELIVERY_CODE_CONFIRMED','STAFF',auth.uid(),NULL,
   jsonb_build_object('order_id',v_order.id));
 END IF;
 PERFORM public._assert_online_payment_ready(p_order);
 UPDATE public.orders SET status='DELIVERED',delivered_at=now(),delivered_by=auth.uid(),updated_at=now()
 WHERE id=v_order.id AND tenant_id=v_order.tenant_id RETURNING * INTO v_order;
 INSERT INTO public.order_status_history(order_id,status,note,changed_by)
 VALUES(v_order.id,'DELIVERED',CASE WHEN v_code_row.order_id IS NOT NULL THEN 'Pedido entregue à mesa (confirmado com código)' ELSE 'Pedido entregue à mesa' END,'Equipe do salão');
 RETURN jsonb_build_object('order_id',v_order.id,'status',v_order.status,'delivered_at',v_order.delivered_at,'delivered_by',v_order.delivered_by,'success',true,'confirmed_with_code',v_code_row.order_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.waiter_mark_delivered(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.waiter_mark_delivered(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.waiter_mark_delivered(p_order uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.waiter_mark_delivered(p_order,NULL);
$$;
REVOKE ALL ON FUNCTION public.waiter_mark_delivered(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.waiter_mark_delivered(uuid) TO authenticated;

DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.update_order_status(uuid,text,text)'::regprocedure);
 v_new:=replace(v_def,$old$IF v_order.fulfillment_type='DINE_IN' AND v_new='DELIVERED' AND v_order.status<>'OUT_FOR_DELIVERY' THEN
        RAISE EXCEPTION 'INVALID_STATE: Aguardando balcão. O pedido precisa ser servido antes da entrega.';
    END IF;$old$,
 $new$IF v_order.fulfillment_type='DINE_IN' AND v_new='DELIVERED' AND v_order.status<>'OUT_FOR_DELIVERY' THEN
        RAISE EXCEPTION 'INVALID_STATE: Aguardando balcão. O pedido precisa ser servido antes da entrega.';
    END IF;
    IF v_order.fulfillment_type='DINE_IN' AND v_new='DELIVERED' AND EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=v_order.id AND c.confirmed_at IS NULL) THEN
        RAISE EXCEPTION 'DELIVERY_CODE_REQUIRED: informe o código de 4 dígitos do cliente para confirmar a entrega.';
    END IF;$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: update_order_status/delivery_code'; END IF;
 EXECUTE v_new;

 v_def:=pg_catalog.pg_get_functiondef('public.customer_dispute_delivery(uuid,uuid)'::regprocedure);
 v_new:=replace(v_def,$old$SELECT * INTO v_dispute FROM public.order_delivery_disputes d WHERE d.order_id=v_order.id AND d.tenant_id=v_order.tenant_id;$old$,
 $new$IF EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=v_order.id AND c.tenant_id=v_order.tenant_id AND c.confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'DELIVERY_CONFIRMED_WITH_CODE: entrega confirmada com código.';
 END IF;
 SELECT * INTO v_dispute FROM public.order_delivery_disputes d WHERE d.order_id=v_order.id AND d.tenant_id=v_order.tenant_id;$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: customer_dispute_delivery/code'; END IF;
 EXECUTE v_new;

 v_def:=pg_catalog.pg_get_functiondef('public.get_my_tab(uuid)'::regprocedure);
 v_new:=replace(v_def,$old$'tableLabel', dt.label,$old$,
 $new$'tableId', tb.table_id, 'tableLabel', dt.label,
      'joinedTables', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',jt.id,'label',jt.label) ORDER BY jt.label)
        FROM public.dining_tab_tables j JOIN public.dining_tables jt ON jt.id=j.table_id AND jt.tenant_id=j.tenant_id
        WHERE j.tenant_id=tb.tenant_id AND j.tab_id=tb.id),'[]'::jsonb),
      'tableMoves', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'action',m.action,'fromLabel',m.from_label,'toLabel',m.to_label,'actorKind',m.actor_kind,'actorName',m.actor_name,'createdAt',m.created_at) ORDER BY m.created_at DESC,m.id)
        FROM public.tab_table_moves m WHERE m.tenant_id=tb.tenant_id AND m.tab_id=tb.id),'[]'::jsonb),$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: get_my_tab/tables'; END IF;
 v_def:=v_new;
 v_new:=replace(v_def,$old$'canDisputeDelivery', o.status='DELIVERED' AND o.delivered_at>=now()-interval '5 minutes' AND o.delivered_at<=now()
            AND NOT EXISTS(SELECT 1 FROM public.order_delivery_disputes d WHERE d.order_id=o.id AND d.tenant_id=o.tenant_id),$old$,
 $new$'deliveryCode', (SELECT c.customer_code FROM public.salon_order_delivery_codes c WHERE c.order_id=o.id AND c.tenant_id=o.tenant_id AND c.confirmed_at IS NULL AND o.status NOT IN ('DELIVERED','CANCELLED')),
          'deliveryConfirmedWithCode', EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=o.id AND c.tenant_id=o.tenant_id AND c.confirmed_at IS NOT NULL),
          'canDisputeDelivery', o.status='DELIVERED' AND o.delivered_at>=now()-interval '5 minutes' AND o.delivered_at<=now()
            AND NOT EXISTS(SELECT 1 FROM public.order_delivery_disputes d WHERE d.order_id=o.id AND d.tenant_id=o.tenant_id)
            AND NOT EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=o.id AND c.tenant_id=o.tenant_id AND c.confirmed_at IS NOT NULL),$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: get_my_tab/delivery_code'; END IF;
 EXECUTE v_new;

 v_def:=pg_catalog.pg_get_functiondef('public.salon_rounds_for_staff(uuid,uuid)'::regprocedure);
 v_new:=replace(v_def,$old$'delivered_by',o.delivered_by,$old$,
 $new$'delivered_by',o.delivered_by,
  'delivery_code_required',EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=o.id AND c.tenant_id=o.tenant_id AND c.confirmed_at IS NULL),
  'delivery_confirmed_with_code',EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=o.id AND c.tenant_id=o.tenant_id AND c.confirmed_at IS NOT NULL),$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: salon_rounds_for_staff/delivery_code'; END IF;
 EXECUTE v_new;
END $$;
COMMIT;
