-- Entrega 1.3 / C: trocar de mesa, juntar/separar mesas e código de entrega por rodada.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.reserve_tab_receipt(uuid,uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'PRECHECK: Entrega 1.3 B ausente.';
 END IF;
END $$;

-- O rollback também reconhece uso apenas da configuração, sem pedidos/movimentos.
CREATE TABLE public._entrega1_3_c_code_settings_restore(tenant_id uuid PRIMARY KEY,has_key boolean NOT NULL,setting jsonb);
ALTER TABLE public._entrega1_3_c_code_settings_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_3_c_code_settings_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_3_c_code_settings_restore
 SELECT tenant_id,COALESCE(config ? 'require_delivery_code',false),config->'require_delivery_code'
 FROM public.tenant_modules WHERE module_key='dine_in';

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
 'public.kitchen_set_order_status(uuid,text)'::regprocedure,
 'public.resolve_delivery_dispute(uuid,text)'::regprocedure,
 'public.get_my_tab(uuid)'::regprocedure,
 'public.salon_rounds_for_staff(uuid,uuid)'::regprocedure,
 'public._waiter_serves_tab(uuid,uuid)'::regprocedure,
 'public.enter_table(text,text,text)'::regprocedure,
 'public.staff_open_tab(uuid)'::regprocedure,
 'public.configure_dine_in(uuid,jsonb,boolean,jsonb)'::regprocedure,
 'public._dining_tabs_close_sessions()'::regprocedure,
 'public._orders_protect_columns()'::regprocedure,
 'public._garcom_v3_order_total_guard()'::regprocedure,
 'public.join_with_code(text,text,text,text)'::regprocedure,
 'public.resolve_table_invite(text,text)'::regprocedure,
 'public.get_dine_in_order_table_labels(uuid,uuid[])'::regprocedure,
 'public.kitchen_list_orders(uuid)'::regprocedure,
 'public.submit_round(jsonb,uuid,uuid,uuid)'::regprocedure,
 'public.close_tab(uuid,jsonb)'::regprocedure,
 'public.reserve_tab_pix(uuid,uuid)'::regprocedure,
 'public.confirm_tab_pix(uuid,jsonb)'::regprocedure,
 'public.cancel_tab_pix(uuid,uuid)'::regprocedure,
 'public.fail_tab_pix_charge(uuid)'::regprocedure,
 'public.accept_waiter_call(uuid)'::regprocedure,
 'public.dispatch_waiter_call(uuid,uuid)'::regprocedure,
 'public.handle_waiter_call(uuid)'::regprocedure,
 'public.anonymize_old_tab_sessions(integer)'::regprocedure
);

ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED','ORDER_DELIVERY_DISPUTE','TABLE_MOVED'));

-- A policy chama um único predicado seguro; helpers internos continuam sem EXECUTE no browser.
CREATE FUNCTION public._salon_can_read_tab(p_tenant uuid,p_tab uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public._tab_pix_staff(auth.uid(),p_tenant)
 AND (public._tenant_role_of_caller(p_tenant)<>'WAITER' OR (public._waiter_is_active(p_tenant,auth.uid()) AND public._waiter_serves_tab(p_tab,auth.uid())));
$$;
REVOKE ALL ON FUNCTION public._salon_can_read_tab(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._salon_can_read_tab(uuid,uuid) TO authenticated;

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
 USING(public._salon_can_read_tab(tenant_id,tab_id));

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
 USING(public._salon_can_read_tab(tenant_id,tab_id));

-- A auditoria segue a política LGPD das sessões encerradas (90 dias por padrão).
DO $$ DECLARE d text; n text; BEGIN
 d:=pg_get_functiondef('public.anonymize_old_tab_sessions(integer)'::regprocedure);
 n:=replace(d,'  RETURN v_count;', $patch$
  UPDATE public.tab_table_moves m SET actor_name='Cliente',actor_id=NULL
  WHERE m.actor_kind='CUSTOMER' AND m.created_at<now()-make_interval(days=>p_days)
    AND EXISTS(SELECT 1 FROM public.dining_tabs t WHERE t.id=m.tab_id AND t.tenant_id=m.tenant_id
      AND t.status IN('CLOSED','CANCELLED') AND COALESCE(t.closed_at,t.opened_at)<now()-make_interval(days=>p_days));
  RETURN v_count;$patch$);
 IF n=d THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: anonymize table history'; END IF;
 EXECUTE n;
END $$;

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

CREATE TABLE public._salon_session_seats(
 session_id uuid PRIMARY KEY REFERENCES public.tab_sessions(id) ON DELETE CASCADE,tenant_id uuid NOT NULL,table_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,table_id) REFERENCES public.dining_tables(tenant_id,id)
);
CREATE TABLE public._salon_order_seats(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,tenant_id uuid NOT NULL,table_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,table_id) REFERENCES public.dining_tables(tenant_id,id)
);
-- Não é um GUC: o browser não pode fabricar a autorização transacional de transferência.
CREATE TABLE public._salon_account_transfers(
 transaction_id bigint NOT NULL,tenant_id uuid NOT NULL,from_tab uuid NOT NULL,to_tab uuid NOT NULL,
 PRIMARY KEY(transaction_id,tenant_id,from_tab,to_tab)
);
ALTER TABLE public._salon_session_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._salon_order_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._salon_account_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._salon_session_seats,public._salon_order_seats,public._salon_account_transfers FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._salon_session_seats SELECT s.id,s.tenant_id,t.table_id FROM public.tab_sessions s JOIN public.dining_tabs t ON t.tenant_id=s.tenant_id AND t.id=s.tab_id;
INSERT INTO public._salon_order_seats SELECT o.id,o.tenant_id,t.table_id FROM public.orders o JOIN public.dining_tabs t ON t.tenant_id=o.tenant_id AND t.id=o.tab_id WHERE o.fulfillment_type='DINE_IN';

CREATE FUNCTION public._salon_tab_for_table(p_table uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT x.id FROM (SELECT t.id,t.opened_at FROM public.dining_tabs t WHERE t.table_id=p_table AND t.status IN('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')
 UNION ALL SELECT t.id,t.opened_at FROM public.dining_tab_tables m JOIN public.dining_tabs t ON t.id=m.tab_id AND t.tenant_id=m.tenant_id WHERE m.table_id=p_table AND t.status IN('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')) x ORDER BY x.opened_at LIMIT 1;
$$;
CREATE FUNCTION public._salon_transfer_allowed(p_tenant uuid,p_from uuid,p_to uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public._salon_account_transfers a WHERE a.transaction_id=txid_current() AND a.tenant_id=p_tenant AND a.from_tab=p_from AND a.to_tab=p_to);
$$;
CREATE FUNCTION public._salon_place_session(p_session uuid,p_table uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public._salon_session_seats SET table_id=p_table WHERE session_id=p_session;
 UPDATE public._salon_order_seats os SET table_id=p_table WHERE os.order_id IN(SELECT o.id FROM public.orders o WHERE o.ordered_by_session_id=p_session);
END $$;
CREATE FUNCTION public._salon_record_seat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='tab_sessions' THEN
  INSERT INTO public._salon_session_seats(session_id,tenant_id,table_id) SELECT NEW.id,NEW.tenant_id,t.table_id FROM public.dining_tabs t WHERE t.id=NEW.tab_id AND t.tenant_id=NEW.tenant_id;
 ELSIF NEW.fulfillment_type='DINE_IN' THEN
  INSERT INTO public._salon_order_seats(order_id,tenant_id,table_id)
  SELECT NEW.id,NEW.tenant_id,COALESCE((SELECT s.table_id FROM public._salon_session_seats s WHERE s.session_id=NEW.ordered_by_session_id AND s.tenant_id=NEW.tenant_id),t.table_id)
  FROM public.dining_tabs t WHERE t.id=NEW.tab_id AND t.tenant_id=NEW.tenant_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER salon_session_seat AFTER INSERT ON public.tab_sessions FOR EACH ROW EXECUTE FUNCTION public._salon_record_seat();
CREATE TRIGGER salon_order_seat AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public._salon_record_seat();
CREATE TRIGGER salon_call_transfer_route BEFORE UPDATE OF tab_id ON public.waiter_calls FOR EACH ROW WHEN(NEW.status='OPEN') EXECUTE FUNCTION public._waiter_calls_route();
CREATE FUNCTION public._salon_lock_tenant(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_tenant IS NOT NULL THEN PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('salon-topology:'||p_tenant::text,0)); END IF;
END $$;
-- Todos os escritores de pedidos/sessões/chamados passam pelo mesmo mutex antes dos locks de linha.
DO $$ DECLARE r record; d text; n text; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('public.submit_round(jsonb,uuid,uuid,uuid)','SELECT tenant_id FROM public.dining_tabs WHERE id=COALESCE(p_tab_id,(SELECT tab_id FROM public.tab_sessions WHERE id=p_session_id))'),
 ('public.close_tab(uuid,jsonb)','SELECT tenant_id FROM public.dining_tabs WHERE id=p_tab_id'),
 ('public.reserve_tab_pix(uuid,uuid)','SELECT tenant_id FROM public.dining_tabs WHERE id=p_tab'),
 ('public.confirm_tab_pix(uuid,jsonb)','SELECT tenant_id FROM public.tab_pix_charges WHERE id=p_id'),
 ('public.cancel_tab_pix(uuid,uuid)','SELECT tenant_id FROM public.dining_tabs WHERE id=p_tab'),
 ('public.fail_tab_pix_charge(uuid)','SELECT tenant_id FROM public.tab_pix_charges WHERE id=p_id'),
 ('public.accept_waiter_call(uuid)','SELECT tenant_id FROM public.waiter_calls WHERE id=p_call_id'),
 ('public.dispatch_waiter_call(uuid,uuid)','SELECT tenant_id FROM public.waiter_calls WHERE id=p_call_id'),
 ('public.handle_waiter_call(uuid)','SELECT tenant_id FROM public.waiter_calls WHERE id=p_call_id')) v(sig,tenant_query) LOOP
  d:=pg_get_functiondef(r.sig::regprocedure);
  n:=regexp_replace(d,'\mBEGIN\M','BEGIN'||chr(10)||' PERFORM public._salon_lock_tenant(('||r.tenant_query||'));'||chr(10));
  IF d=n THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: % topology lock',r.sig; END IF;
  EXECUTE n;
 END LOOP;
END $$;
CREATE FUNCTION public._table_active_tab(p_tenant uuid,p_table uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT t.id FROM public.dining_tabs t WHERE t.tenant_id=p_tenant AND t.id=public._salon_tab_for_table(p_table);
$$;
REVOKE ALL ON FUNCTION public._table_active_tab(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Mesmo uma chamada direta a enter_table/join_with_code respeita a conta agrupada.
DO $$ DECLARE d text; n text; sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.enter_table(text,text,text)','public.join_with_code(text,text,text,text)','public.staff_open_tab(uuid)','public.resolve_table_invite(text,text)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);
  n:=replace(d,'tb.table_id = v_table.id','(tb.table_id = v_table.id OR tb.id = public._salon_tab_for_table(v_table.id))');
  IF d=n THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: % table resolution',sig; END IF;
  IF sig IN('public.enter_table(text,text,text)','public.join_with_code(text,text,text,text)') THEN
   -- O QR secundário define o lugar físico da sessão ao entrar/restaurar.
   n:=replace(n,'RETURN public._table_access_payload(v_sid);','PERFORM public._salon_place_session(v_sid,v_table.id); RETURN public._table_access_payload(v_sid);');
  END IF;
  IF sig='public.staff_open_tab(uuid)' THEN
   n:=regexp_replace(n,'\mBEGIN\M','BEGIN'||chr(10)||'  PERFORM public._salon_lock_tenant((SELECT tenant_id FROM public.dining_tables WHERE id=p_table_id));'||chr(10));
  ELSE
   n:=regexp_replace(n,'\mBEGIN\M','BEGIN'||chr(10)||'  PERFORM public._salon_lock_tenant((SELECT tenant_id FROM public.dining_tables WHERE qr_token=p_qr_token));'||chr(10));
  END IF;
  n:=replace(n,$old$tb.status IN ('OPEN','BILL_REQUESTED')$old$,$new$tb.status IN ('OPEN','BILL_REQUESTED','WAITER_AUTHORIZED','AWAITING_PAYMENT')$new$);
  EXECUTE n;
 END LOOP;
 d:=pg_get_functiondef('public._waiter_serves_tab(uuid,uuid)'::regprocedure);
 n:=replace(d,'a.table_id=tb.table_id AND a.waiter_id=p_user','(a.table_id=tb.table_id OR EXISTS(SELECT 1 FROM public.dining_tab_tables m WHERE m.tenant_id=tb.tenant_id AND m.tab_id=tb.id AND m.table_id=a.table_id)) AND a.waiter_id=p_user');
 IF d=n THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: waiter group scope'; END IF; EXECUTE n;
 d:=pg_get_functiondef('public._orders_protect_columns()'::regprocedure);
 n:=replace(d,'FOREACH v_key IN ARRAY v_nullable_refs LOOP',
 'IF NEW.tenant_id=OLD.tenant_id AND NEW.fulfillment_type=OLD.fulfillment_type AND NEW.tab_id IS DISTINCT FROM OLD.tab_id AND public._salon_transfer_allowed(OLD.tenant_id,OLD.tab_id,NEW.tab_id) THEN v_old:=v_old-''tab_id''-''round_no''; v_new:=v_new-''tab_id''-''round_no''; END IF; FOREACH v_key IN ARRAY v_nullable_refs LOOP');
 IF d=n THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: protected order'; END IF; EXECUTE n;
 d:=pg_get_functiondef('public._garcom_v3_order_total_guard()'::regprocedure);
 n:=replace(d,'THEN'||chr(10)||'  RAISE EXCEPTION ''INVALID_INPUT: pedido de mesa não pode trocar de comanda.'';',
 'AND NOT (NEW.tenant_id=OLD.tenant_id AND NEW.fulfillment_type=OLD.fulfillment_type AND public._salon_transfer_allowed(OLD.tenant_id,OLD.tab_id,NEW.tab_id)) THEN'||chr(10)||'  RAISE EXCEPTION ''INVALID_INPUT: pedido de mesa não pode trocar de comanda.'';');
 IF d=n THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: transfer order guard'; END IF; EXECUTE n;
 FOREACH sig IN ARRAY ARRAY['public.get_dine_in_order_table_labels(uuid,uuid[])','public.kitchen_list_orders(uuid)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);
  n:=replace(d,'JOIN public.dining_tables dt ON dt.id = tb.table_id AND dt.tenant_id = tb.tenant_id','JOIN public.dining_tables dt ON dt.id = COALESCE((SELECT z.table_id FROM public._salon_order_seats z WHERE z.order_id=o.id AND z.tenant_id=o.tenant_id),tb.table_id) AND dt.tenant_id = tb.tenant_id');
  IF d=n THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: % destination label',sig; END IF; EXECUTE n;
 END LOOP;
END $$;
CREATE FUNCTION public._salon_assert_changeable(p_tab uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.dining_tabs;
BEGIN
 SELECT * INTO t FROM public.dining_tabs WHERE id=p_tab FOR UPDATE;
 IF NOT FOUND OR t.status<>'OPEN' OR public._dine_in_config(t.tenant_id) IS NULL THEN RAISE EXCEPTION 'TABLE_CHANGE_BLOCKED: somente conta aberta pode mudar de mesa.'; END IF;
 IF t.mode<>'TABLE' OR COALESCE(public._dine_in_config(t.tenant_id)->>'mode','TABLE')='INDIVIDUAL' THEN RAISE EXCEPTION 'TABLE_MODE_REQUIRED: mudanças e grupos exigem conta única por mesa.'; END IF;
 IF EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tab_id=t.id AND c.tenant_id=t.tenant_id AND c.status IN('creating','pending','paid')) OR EXISTS(SELECT 1 FROM public.tab_payments p WHERE p.tab_id=t.id AND p.tenant_id=t.tenant_id) THEN RAISE EXCEPTION 'TAB_PAYMENT_IN_PROGRESS: mudança bloqueada durante pagamento.'; END IF;
END $$;
CREATE FUNCTION public._salon_assert_staff(p_tenant uuid,p_tab uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public._tab_pix_staff(auth.uid(),p_tenant)
 OR (public._tenant_role_of_caller(p_tenant)='WAITER' AND (NOT public._waiter_is_active(p_tenant,auth.uid()) OR (p_tab IS NOT NULL AND NOT public._waiter_serves_tab(p_tab,auth.uid())))) THEN RAISE EXCEPTION 'FORBIDDEN: mesa indisponível.' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public._salon_table_notice(p_tenant uuid,p_tab uuid,p_event text,p_kind text,p_actor uuid,p_from text,p_to text,p_details jsonb DEFAULT '{}') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.tab_table_moves(tenant_id,tab_id,action,from_label,to_label,actor_kind,actor_id,actor_name) VALUES(p_tenant,p_tab,CASE p_event WHEN 'TABLE_MOVED' THEN 'MOVE' WHEN 'TABLES_JOINED' THEN 'JOIN' ELSE 'SEPARATE' END,p_from,p_to,p_kind,p_actor,CASE WHEN p_kind='STAFF' THEN 'Equipe do salão' ELSE 'Cliente' END);
 PERFORM public._tab_access_log(p_tenant,p_tab,p_event,p_kind,p_actor,NULL,COALESCE(p_details,'{}')||jsonb_build_object('from',p_from,'to',p_to));
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title) VALUES(p_tenant,'TABLE_MOVED',p_tab,p_from||' → '||p_to);
 INSERT INTO public.waiter_calls(tenant_id,tab_id,type) VALUES(p_tenant,p_tab,'CALL');
 INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision) VALUES(p_tenant,p_tab,clock_timestamp()) ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
END $$;
CREATE FUNCTION public.list_free_tables_for_session(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.tab_sessions; BEGIN
 SELECT * INTO s FROM public.tab_sessions WHERE id=p_session_id AND auth_user_id=auth.uid() AND approved_at IS NOT NULL AND ended_at IS NULL AND expires_at>now();
 IF auth.uid() IS NULL OR NOT FOUND OR public._dine_in_config(s.tenant_id) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: sessão indisponível.' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'label',d.label) ORDER BY d.label) FROM public.dining_tables d WHERE d.tenant_id=s.tenant_id AND d.active AND public._salon_tab_for_table(d.id) IS NULL),'[]');
END $$;
CREATE FUNCTION public.customer_move_table(p_session_id uuid,p_target_table_id uuid DEFAULT NULL,p_target_qr_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.tab_sessions; t public.dining_tabs; dest public.dining_tables; old_label text; old_table uuid; v_qr_token text;
BEGIN
 SELECT * INTO s FROM public.tab_sessions WHERE id=p_session_id AND auth_user_id=auth.uid() AND approved_at IS NOT NULL AND ended_at IS NULL AND expires_at>now();
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public._customer_identified() THEN RAISE EXCEPTION 'TAB_NOT_FOUND: sessão indisponível.' USING ERRCODE='42501'; END IF;
 v_qr_token:=btrim(p_target_qr_token);
 IF position('mesa=' IN v_qr_token)>0 THEN v_qr_token:=regexp_replace(v_qr_token,'^.*[?&]mesa=([^&#\s]+).*$','\1'); END IF;
 -- Mesma ordem de lock dos RPCs de entrada: mesa antes de conta.
 PERFORM public._salon_lock_tenant(s.tenant_id);
 PERFORM 1 FROM public.dining_tables WHERE tenant_id=s.tenant_id ORDER BY id FOR UPDATE;
 SELECT * INTO t FROM public.dining_tabs WHERE id=s.tab_id AND tenant_id=s.tenant_id FOR UPDATE;
 IF t.responsible_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN: somente o responsável pode mudar a conta.' USING ERRCODE='42501'; END IF;
 IF t.status<>'OPEN' OR EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tenant_id=t.tenant_id AND c.tab_id=t.id AND c.status IN('creating','pending','paid')) OR EXISTS(SELECT 1 FROM public.tab_payments p WHERE p.tenant_id=t.tenant_id AND p.tab_id=t.id) THEN RAISE EXCEPTION 'MOVE_BLOCKED_BILL: não é permitido mudar de mesa com conta pedida ou pagamento em andamento.'; END IF;
 PERFORM public._salon_assert_changeable(t.id);
 SELECT * INTO dest FROM public.dining_tables d WHERE d.tenant_id=s.tenant_id AND d.active
  AND ((p_target_table_id IS NOT NULL AND d.id=p_target_table_id AND (v_qr_token IS NULL OR d.qr_token=v_qr_token)) OR (p_target_table_id IS NULL AND d.qr_token=v_qr_token));
 IF NOT FOUND OR public._qr_paused(s.tenant_id,dest.id) THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa indisponível.'; END IF;
 IF public._salon_tab_for_table(dest.id) IS NOT NULL THEN RAISE EXCEPTION 'TABLE_OCCUPIED: peça à equipe para juntar contas com aceite.'; END IF;
 IF (SELECT count(*) FROM public.tab_access_events e WHERE e.tenant_id=s.tenant_id AND e.tab_id=t.id AND e.event='TABLE_MOVED' AND e.created_at>now()-interval '10 minutes')>=5 THEN RAISE EXCEPTION 'RATE_LIMITED: aguarde para mudar novamente.'; END IF;
 old_table:=t.table_id; SELECT label INTO old_label FROM public.dining_tables WHERE id=old_table;
 DELETE FROM public.dining_tab_tables WHERE tab_id=t.id AND tenant_id=t.tenant_id;
 UPDATE public.dining_tabs SET table_id=dest.id WHERE id=t.id AND tenant_id=t.tenant_id;
 UPDATE public._salon_session_seats ss SET table_id=dest.id WHERE ss.tenant_id=t.tenant_id AND ss.session_id IN(SELECT id FROM public.tab_sessions WHERE tab_id=t.id AND tenant_id=t.tenant_id);
 UPDATE public._salon_order_seats os SET table_id=dest.id WHERE os.tenant_id=t.tenant_id AND os.order_id IN(SELECT id FROM public.orders WHERE tab_id=t.id AND tenant_id=t.tenant_id);
 UPDATE public.dining_tab_invites SET revoked_at=now() WHERE tab_id=t.id AND tenant_id=t.tenant_id AND revoked_at IS NULL;
 UPDATE public.waiter_calls SET tab_id=t.id WHERE tab_id=t.id AND tenant_id=t.tenant_id AND status='OPEN';
 PERFORM public._salon_table_notice(t.tenant_id,t.id,'TABLE_MOVED','CUSTOMER',s.id,old_label,dest.label,jsonb_build_object('from_table',old_table,'to_table',dest.id));
 RETURN jsonb_build_object('tabId',t.id,'tableId',dest.id,'tableLabel',dest.label,'fromTableId',old_table,'fromLabel',old_label,'toTableId',dest.id,'toLabel',dest.label,'notice',old_label||' → '||dest.label,'qrToken',dest.qr_token);
END $$;

CREATE FUNCTION public._salon_transfer_account(p_tenant uuid,p_from uuid,p_to uuid,p_table uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE offset_round integer; BEGIN
 INSERT INTO public._salon_account_transfers VALUES(txid_current(),p_tenant,p_from,p_to);
 -- Sessões mantêm seus IDs e proveniência; os pedidos continuam associados a quem os fez.
 UPDATE public.tab_sessions s SET tab_id=p_to,device_id=CASE WHEN EXISTS(SELECT 1 FROM public.tab_sessions dest WHERE dest.tenant_id=p_tenant AND dest.tab_id=p_to AND dest.auth_user_id=s.auth_user_id AND dest.device_id=s.device_id) THEN left(s.device_id,80)||':'||s.id::text ELSE s.device_id END WHERE s.tenant_id=p_tenant AND s.tab_id=p_from AND (p_table IS NULL OR EXISTS(SELECT 1 FROM public._salon_session_seats z WHERE z.session_id=s.id AND z.table_id=p_table));
 SELECT COALESCE(max(round_no),0) INTO offset_round FROM public.orders WHERE tenant_id=p_tenant AND tab_id=p_to;
 UPDATE public.orders o SET tab_id=p_to,round_no=o.round_no+offset_round WHERE o.tenant_id=p_tenant AND o.tab_id=p_from AND (p_table IS NULL OR EXISTS(SELECT 1 FROM public._salon_order_seats z WHERE z.order_id=o.id AND z.table_id=p_table));
 UPDATE public.waiter_calls wc SET tab_id=p_to WHERE wc.tenant_id=p_tenant AND wc.tab_id=p_from AND wc.status='OPEN' AND (p_table IS NULL OR EXISTS(SELECT 1 FROM public.orders o WHERE o.tenant_id=p_tenant AND o.tab_id=p_to AND o.id=wc.order_id) OR EXISTS(SELECT 1 FROM public.order_delivery_disputes d JOIN public.orders o ON o.id=d.order_id AND o.tenant_id=d.tenant_id WHERE d.call_id=wc.id AND d.tenant_id=p_tenant AND o.tab_id=p_to));
 UPDATE public.salon_order_delivery_codes c SET tab_id=p_to WHERE c.tenant_id=p_tenant AND c.tab_id=p_from AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=c.order_id AND o.tenant_id=p_tenant AND o.tab_id=p_to);
 DELETE FROM public._salon_account_transfers WHERE transaction_id=txid_current() AND tenant_id=p_tenant AND from_tab=p_from AND to_tab=p_to;
END $$;
CREATE FUNCTION public.staff_submit_table_round(p_table_id uuid,p_items jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; tab uuid; result jsonb; BEGIN
 SELECT tenant_id INTO tenant FROM public.dining_tables WHERE id=p_table_id AND active;
 PERFORM public._salon_assert_staff(tenant);
 PERFORM public._salon_lock_tenant(tenant);
 PERFORM 1 FROM public.dining_tables WHERE tenant_id=tenant ORDER BY id FOR UPDATE;
 tab:=public._salon_tab_for_table(p_table_id);
 PERFORM public._salon_assert_staff(tenant,tab); PERFORM public._salon_assert_changeable(tab);
 result:=public.submit_round(p_items,p_idempotency_key,NULL,tab);
 IF COALESCE((result->>'replayed')::boolean,false)=false THEN UPDATE public._salon_order_seats SET table_id=p_table_id WHERE order_id=(result->>'orderId')::uuid AND tenant_id=tenant; END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.staff_join_tables(p_table_ids uuid[],p_accept_occupied boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; primary_tab uuid; other_tab uuid; table_row public.dining_tables; main public.dining_tabs; source public.dining_tabs; chosen uuid[]; old_labels text; new_labels text;
BEGIN
 IF p_table_ids IS NULL OR cardinality(p_table_ids)<2 OR cardinality(p_table_ids)>20 OR array_position(p_table_ids,NULL) IS NOT NULL OR cardinality(ARRAY(SELECT DISTINCT unnest(p_table_ids)))<>cardinality(p_table_ids) THEN RAISE EXCEPTION 'INVALID_TABLES: selecione de duas a vinte mesas diferentes.'; END IF;
 SELECT tenant_id INTO tenant FROM public.dining_tables WHERE id=p_table_ids[1] AND active;
 PERFORM public._salon_assert_staff(tenant);
 PERFORM public._salon_lock_tenant(tenant);
 PERFORM 1 FROM public.dining_tables WHERE tenant_id=tenant ORDER BY id FOR UPDATE;
 IF COALESCE(public._dine_in_config(tenant)->>'mode','TABLE')='INDIVIDUAL' THEN RAISE EXCEPTION 'TABLE_MODE_REQUIRED: mudanças e grupos exigem conta única por mesa.'; END IF;
 IF public._tenant_role_of_caller(tenant)='WAITER' AND EXISTS(SELECT 1 FROM public.waiter_table_assignments a WHERE a.tenant_id=tenant AND a.table_id=ANY(p_table_ids) AND a.waiter_id<>auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN: mesa atribuída a outro garçom.' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.dining_tables WHERE id=ANY(p_table_ids) AND tenant_id=tenant AND active)<>cardinality(p_table_ids) THEN RAISE EXCEPTION 'FORBIDDEN: mesas indisponíveis.' USING ERRCODE='42501'; END IF;
 primary_tab:=public._salon_tab_for_table(p_table_ids[1]);
 -- Bloqueia todas as contas antes de qualquer escrita e exige aceite explícito de contas ocupadas.
 FOR other_tab IN SELECT DISTINCT public._salon_tab_for_table(x) FROM unnest(p_table_ids) x WHERE public._salon_tab_for_table(x) IS NOT NULL ORDER BY 1 LOOP
  PERFORM public._salon_assert_staff(tenant,other_tab); PERFORM public._salon_assert_changeable(other_tab);
  IF other_tab IS DISTINCT FROM primary_tab AND p_accept_occupied IS NOT TRUE THEN RAISE EXCEPTION 'OCCUPIED_ACCEPTANCE_REQUIRED: confirme o aceite para juntar contas ocupadas.'; END IF;
 END LOOP;
 IF primary_tab IS NULL THEN
  INSERT INTO public.dining_tabs(tenant_id,mode,table_id,waiter_id,service_fee_percent,service_fee_removed)
  SELECT tenant,'TABLE',p_table_ids[1],CASE WHEN public._tenant_role_of_caller(tenant)='WAITER' THEN auth.uid() ELSE NULL END,COALESCE((SELECT t.service_fee_percent FROM unnest(p_table_ids) WITH ORDINALITY x(id,ord) JOIN public.dining_tabs t ON t.id=public._salon_tab_for_table(x.id) ORDER BY x.ord LIMIT 1),(SELECT NULLIF(config->>'percent','')::numeric FROM public.tenant_modules WHERE tenant_id=tenant AND module_key='service_fee' AND enabled),0),COALESCE((SELECT t.service_fee_removed FROM unnest(p_table_ids) WITH ORDINALITY x(id,ord) JOIN public.dining_tabs t ON t.id=public._salon_tab_for_table(x.id) ORDER BY x.ord LIMIT 1),false) RETURNING id INTO primary_tab;
 END IF;
 SELECT * INTO main FROM public.dining_tabs WHERE id=primary_tab;
 SELECT label INTO old_labels FROM public.dining_tables WHERE id=main.table_id;
 FOR table_row IN SELECT * FROM public.dining_tables WHERE id=ANY(p_table_ids) AND tenant_id=tenant ORDER BY array_position(p_table_ids,id) LOOP
  other_tab:=public._salon_tab_for_table(table_row.id);
  IF other_tab IS NOT NULL AND other_tab<>primary_tab THEN
   SELECT * INTO source FROM public.dining_tabs WHERE id=other_tab;
   IF (source.service_fee_percent,source.service_fee_removed) IS DISTINCT FROM (main.service_fee_percent,main.service_fee_removed) THEN RAISE EXCEPTION 'SERVICE_FEE_MISMATCH: iguale a taxa de serviço antes de juntar contas.'; END IF;
   IF main.responsible_user_id IS NULL AND source.responsible_user_id IS NOT NULL THEN UPDATE public.dining_tabs SET responsible_user_id=source.responsible_user_id,responsible_since=source.responsible_since WHERE id=primary_tab; main.responsible_user_id:=source.responsible_user_id; END IF;
   PERFORM public._salon_transfer_account(tenant,other_tab,primary_tab);
   UPDATE public.dining_tab_tables SET tab_id=primary_tab WHERE tab_id=other_tab AND tenant_id=tenant;
   INSERT INTO public.dining_tab_tables(tenant_id,tab_id,table_id) VALUES(tenant,primary_tab,source.table_id) ON CONFLICT(tenant_id,table_id) DO UPDATE SET tab_id=EXCLUDED.tab_id;
   UPDATE public.dining_tabs SET status='CANCELLED',closed_at=now(),merged_into_tab_id=primary_tab WHERE id=other_tab AND tenant_id=tenant;
   UPDATE public.dining_tab_invites SET revoked_at=now() WHERE tab_id=other_tab AND tenant_id=tenant AND revoked_at IS NULL;
  ELSIF other_tab IS NULL THEN
   INSERT INTO public.dining_tab_tables(tenant_id,tab_id,table_id) VALUES(tenant,primary_tab,table_row.id);
  END IF;
 END LOOP;
 UPDATE public.dining_tabs SET guests=LEAST(100,GREATEST(1,(SELECT count(*) FROM public.tab_sessions WHERE tab_id=primary_tab AND tenant_id=tenant AND ended_at IS NULL))) WHERE id=primary_tab;
 SELECT array_agg(d.id ORDER BY d.label),string_agg(d.label,' + ' ORDER BY d.label) INTO chosen,new_labels FROM public.dining_tables d WHERE d.id=main.table_id OR EXISTS(SELECT 1 FROM public.dining_tab_tables m WHERE m.table_id=d.id AND m.tab_id=primary_tab AND m.tenant_id=tenant);
 PERFORM public._salon_table_notice(tenant,primary_tab,'TABLES_JOINED','STAFF',auth.uid(),old_labels,new_labels,jsonb_build_object('table_ids',chosen,'accepted_occupied',p_accept_occupied));
 RETURN jsonb_build_object('tabId',primary_tab,'primaryTableId',main.table_id,'tableIds',chosen,'joinedTableIds',COALESCE((SELECT jsonb_agg(table_id ORDER BY joined_at) FROM public.dining_tab_tables WHERE tab_id=primary_tab AND tenant_id=tenant),'[]'::jsonb));
END $$;
CREATE FUNCTION public.staff_separate_table(p_tab_id uuid,p_table_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.dining_tabs; new_tab uuid; next_primary uuid; holder uuid; label_from text; label_to text;
BEGIN
 SELECT * INTO t FROM public.dining_tabs WHERE id=p_tab_id;
 PERFORM public._salon_assert_staff(t.tenant_id,t.id);
 PERFORM public._salon_lock_tenant(t.tenant_id);
 PERFORM 1 FROM public.dining_tables WHERE tenant_id=t.tenant_id ORDER BY id FOR UPDATE;
 PERFORM public._salon_assert_changeable(t.id);
 SELECT * INTO t FROM public.dining_tabs WHERE id=p_tab_id;
 IF public._salon_tab_for_table(p_table_id) IS DISTINCT FROM t.id OR NOT EXISTS(SELECT 1 FROM public.dining_tab_tables WHERE tab_id=t.id AND tenant_id=t.tenant_id) THEN RAISE EXCEPTION 'TABLE_NOT_JOINED: selecione uma mesa desta conta agrupada.'; END IF;
 SELECT string_agg(d.label,' + ' ORDER BY d.label) INTO label_from FROM public.dining_tables d WHERE d.id=t.table_id OR EXISTS(SELECT 1 FROM public.dining_tab_tables m WHERE m.tab_id=t.id AND m.table_id=d.id AND m.tenant_id=t.tenant_id);
 SELECT label INTO label_to FROM public.dining_tables WHERE id=p_table_id;
 IF t.table_id=p_table_id THEN
  SELECT table_id INTO next_primary FROM public.dining_tab_tables WHERE tab_id=t.id AND tenant_id=t.tenant_id ORDER BY table_id LIMIT 1;
  DELETE FROM public.dining_tab_tables WHERE table_id=next_primary;
  UPDATE public.dining_tabs SET table_id=next_primary WHERE id=t.id;
 ELSE DELETE FROM public.dining_tab_tables WHERE table_id=p_table_id AND tab_id=t.id AND tenant_id=t.tenant_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tab_sessions s JOIN public._salon_session_seats z ON z.session_id=s.id WHERE s.tab_id=t.id AND s.tenant_id=t.tenant_id AND z.table_id=p_table_id AND s.ended_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.orders o JOIN public._salon_order_seats z ON z.order_id=o.id WHERE o.tab_id=t.id AND o.tenant_id=t.tenant_id AND z.table_id=p_table_id) THEN
  PERFORM public._salon_table_notice(t.tenant_id,t.id,'TABLE_SPLIT','STAFF',auth.uid(),label_from,label_to,jsonb_build_object('table_id',p_table_id));
  RETURN jsonb_build_object('tabId',t.id,'separatedTableId',p_table_id,'separatedTabId',NULL);
 END IF;
 SELECT s.auth_user_id INTO holder FROM public.tab_sessions s JOIN public._salon_session_seats z ON z.session_id=s.id AND z.tenant_id=s.tenant_id WHERE s.tab_id=t.id AND s.tenant_id=t.tenant_id AND z.table_id=p_table_id AND s.ended_at IS NULL AND s.expires_at>now() AND s.approved_at IS NOT NULL ORDER BY (s.auth_user_id=t.responsible_user_id) DESC,s.created_at LIMIT 1;
 INSERT INTO public.dining_tabs(tenant_id,mode,table_id,waiter_id,service_fee_percent,service_fee_removed,responsible_user_id,responsible_since)
 VALUES(t.tenant_id,'TABLE',p_table_id,t.waiter_id,t.service_fee_percent,t.service_fee_removed,holder,CASE WHEN holder IS NOT NULL THEN now() END) RETURNING id INTO new_tab;
 PERFORM public._salon_transfer_account(t.tenant_id,t.id,new_tab,p_table_id);
 IF t.responsible_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tab_sessions WHERE tab_id=t.id AND tenant_id=t.tenant_id AND auth_user_id=t.responsible_user_id AND ended_at IS NULL) THEN
  UPDATE public.dining_tabs SET responsible_user_id=(SELECT auth_user_id FROM public.tab_sessions WHERE tab_id=t.id AND tenant_id=t.tenant_id AND ended_at IS NULL AND expires_at>now() AND approved_at IS NOT NULL ORDER BY created_at LIMIT 1),responsible_since=now() WHERE id=t.id;
 END IF;
 UPDATE public.dining_tab_invites SET revoked_at=now() WHERE tab_id=t.id AND tenant_id=t.tenant_id AND revoked_at IS NULL;
 PERFORM public._salon_table_notice(t.tenant_id,t.id,'TABLE_SPLIT','STAFF',auth.uid(),label_from,label_to,jsonb_build_object('table_id',p_table_id,'new_tab',new_tab));
 PERFORM public._tab_access_log(t.tenant_id,new_tab,'TABLE_SPLIT','STAFF',auth.uid(),NULL,jsonb_build_object('from',label_from,'to',label_to,'source_tab',t.id));
 RETURN jsonb_build_object('tabId',t.id,'separatedTableId',p_table_id,'separatedTabId',new_tab);
END $$;
CREATE FUNCTION public.staff_join_tables(p_table_ids uuid[]) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.staff_join_tables(p_table_ids,false); $$;
REVOKE ALL ON FUNCTION public._salon_lock_tenant(uuid),public._salon_tab_for_table(uuid),public._salon_transfer_allowed(uuid,uuid,uuid),public._salon_place_session(uuid,uuid),public._salon_record_seat(),public._salon_assert_changeable(uuid),public._salon_assert_staff(uuid,uuid),public._salon_table_notice(uuid,uuid,text,text,uuid,text,text,jsonb),public._salon_transfer_account(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_free_tables_for_session(uuid),public.customer_move_table(uuid,uuid,text),public.staff_join_tables(uuid[]),public.staff_join_tables(uuid[],boolean),public.staff_separate_table(uuid,uuid),public.staff_submit_table_round(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_free_tables_for_session(uuid),public.customer_move_table(uuid,uuid,text),public.staff_join_tables(uuid[]),public.staff_join_tables(uuid[],boolean),public.staff_separate_table(uuid,uuid),public.staff_submit_table_round(uuid,jsonb,uuid) TO authenticated;

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


-- A configuração é exclusiva do dono em qualquer caminho de escrita. O trigger
-- observa OLD após o lock da linha: um formulário antigo do gerente não pode
-- sobrescrever uma mudança concorrente feita pelo proprietário.
CREATE FUNCTION public._salon_delivery_code_setting_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old boolean:=false; v_new boolean;
BEGIN
 IF NEW.module_key<>'dine_in' THEN RETURN NEW; END IF;
 IF NEW.config ? 'require_delivery_code' AND jsonb_typeof(NEW.config->'require_delivery_code') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'INVALID_DINE_IN_CONFIG: exigir código de entrega deve ser booleano.';
 END IF;
 v_new:=COALESCE((NEW.config->>'require_delivery_code')::boolean,false);
 IF TG_OP='UPDATE' THEN v_old:=COALESCE((OLD.config->>'require_delivery_code')::boolean,false); END IF;
 IF v_new IS DISTINCT FROM v_old AND auth.uid() IS NOT NULL
    AND NOT public.has_tenant_scoped_role(NEW.tenant_id,ARRAY['OWNER']) THEN
  RAISE EXCEPTION 'MODULE_OWNER_REQUIRED: apenas o proprietário pode alterar o código de entrega.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._salon_delivery_code_setting_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER salon_delivery_code_setting_guard BEFORE INSERT OR UPDATE OF config ON public.tenant_modules
 FOR EACH ROW EXECUTE FUNCTION public._salon_delivery_code_setting_guard();

CREATE FUNCTION public.set_salon_delivery_code_required(p_tenant uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_cfg jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_tenant_scoped_role(p_tenant,ARRAY['OWNER']) THEN
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
DECLARE v_code text; v_start integer; v_try integer; v_available boolean:=false;
BEGIN
 IF NEW.fulfillment_type<>'DINE_IN' OR NEW.tab_id IS NULL OR NOT public._salon_delivery_code_required(NEW.tenant_id) THEN
  RETURN NEW;
 END IF;
 -- Apenas os geradores de código compartilham este lock. Não cria inversão de
 -- locks de contas/mesas com submit_round e as operações de união/separação.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('salon-delivery-code:'||NEW.tenant_id::text,0));
 v_start:=(('x'||encode(extensions.gen_random_bytes(2),'hex'))::bit(16)::int & 65535)%9000;
 FOR v_try IN 0..8999 LOOP
  v_code:=(1000+(v_start+v_try)%9000)::text;
  IF NOT EXISTS(
   SELECT 1 FROM public.salon_order_delivery_codes c JOIN public.orders o ON o.id=c.order_id AND o.tenant_id=c.tenant_id
   WHERE c.tenant_id=NEW.tenant_id AND c.customer_code=v_code
    AND (c.tab_id=NEW.tab_id OR (c.confirmed_at IS NULL AND o.status NOT IN ('DELIVERED','CANCELLED')))
  ) THEN v_available:=true; EXIT; END IF;
 END LOOP;
 IF NOT v_available THEN RAISE EXCEPTION 'DELIVERY_CODE_CAPACITY: não há código de entrega disponível. Chame o responsável da loja.'; END IF;
 INSERT INTO public.salon_order_delivery_codes(order_id,tenant_id,tab_id,code_hash,customer_code)
 VALUES(NEW.id,NEW.tenant_id,NEW.tab_id,public._sha256_hex(NEW.id::text||':'||v_code),v_code);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._salon_order_create_delivery_code() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER salon_order_create_delivery_code AFTER INSERT ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._salon_order_create_delivery_code();

-- A validação acompanha o dado, inclusive em RPCs alternativas ou atualização
-- privilegiada direta: somente a confirmação da própria rodada libera a entrega.
CREATE FUNCTION public._salon_delivery_code_order_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.fulfillment_type='DINE_IN' AND NEW.status='DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED'
  AND EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=NEW.id AND c.tenant_id=NEW.tenant_id AND c.confirmed_at IS NULL) THEN
  RAISE EXCEPTION 'DELIVERY_CODE_REQUIRED: informe o código de 4 dígitos do cliente para confirmar a entrega.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._salon_delivery_code_order_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER salon_delivery_code_order_guard BEFORE UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._salon_delivery_code_order_guard();

-- Projeção autenticada estrita para o app: informa a exigência por rodada,
-- nunca o código, mesmo depois que o dono altera a configuração global.
CREATE FUNCTION public.salon_delivery_states(p_tenant uuid,p_order_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public._tab_pix_staff(auth.uid(),p_tenant) OR public._dine_in_config(p_tenant) IS NULL THEN
  RAISE EXCEPTION 'FORBIDDEN: sem permissão para consultar as entregas.' USING ERRCODE='42501';
 END IF;
 IF cardinality(p_order_ids)>1000 THEN RAISE EXCEPTION 'INVALID_INPUT: limite de pedidos excedido.'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('order_id',o.id,
  'delivery_code_required',c.order_id IS NOT NULL AND c.confirmed_at IS NULL,
  'delivery_confirmed_with_code',c.confirmed_at IS NOT NULL) ORDER BY o.id)
 FROM public.orders o LEFT JOIN public.salon_order_delivery_codes c ON c.order_id=o.id AND c.tenant_id=o.tenant_id
 WHERE o.tenant_id=p_tenant AND o.id=ANY(COALESCE(p_order_ids,ARRAY[]::uuid[])) AND public._can_manage_delivery_dispute(o.id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.salon_delivery_states(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.salon_delivery_states(uuid,uuid[]) TO authenticated;

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
  RETURN jsonb_build_object('order_id',v_order.id,'status',v_order.status,'delivered_at',v_order.delivered_at,'delivered_by',v_order.delivered_by,'success',true,'confirmed_with_code',EXISTS(SELECT 1 FROM public.salon_order_delivery_codes c WHERE c.order_id=v_order.id AND c.tenant_id=v_order.tenant_id AND c.confirmed_at IS NOT NULL));
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
 $new$'deliveryCode', CASE WHEN v_s.approved_at IS NOT NULL THEN (SELECT c.customer_code FROM public.salon_order_delivery_codes c WHERE c.order_id=o.id AND c.tenant_id=o.tenant_id AND c.confirmed_at IS NULL AND o.status NOT IN ('DELIVERED','CANCELLED')) ELSE NULL END,
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
-- Mesas e pedidos usam a mesma ordem de locks: topologia da loja antes de
-- qualquer lock de linha. Isso evita o ciclo união(conta→pedido) versus
-- entrega/cozinha/contestação(pedido→conta) e permite revalidar a conta atual.
DO $$
DECLARE r record; v_def text; v_new text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.waiter_mark_delivered(uuid,text)', 'SELECT o.tenant_id FROM public.orders o WHERE o.id=p_order AND o.fulfillment_type=''DINE_IN'''),
  ('public.update_order_status(uuid,text,text)', 'SELECT o.tenant_id FROM public.orders o WHERE o.id=p_order_id AND o.fulfillment_type=''DINE_IN'''),
  ('public.kitchen_set_order_status(uuid,text)', 'SELECT o.tenant_id FROM public.orders o WHERE o.id=p_order_id AND o.fulfillment_type=''DINE_IN'''),
  ('public.customer_dispute_delivery(uuid,uuid)', 'SELECT o.tenant_id FROM public.orders o WHERE o.id=p_order AND o.fulfillment_type=''DINE_IN'''),
  ('public.resolve_delivery_dispute(uuid,text)', 'SELECT o.tenant_id FROM public.orders o JOIN public.order_delivery_disputes d ON d.order_id=o.id AND d.tenant_id=o.tenant_id WHERE d.id=p_dispute AND o.fulfillment_type=''DINE_IN''')
 ) AS x(signature,tenant_query) LOOP
  v_def:=pg_catalog.pg_get_functiondef(r.signature::regprocedure);
  v_new:=regexp_replace(v_def,E'\nBEGIN\n',E'\nBEGIN\n  PERFORM public._salon_lock_tenant(('||r.tenant_query||E'));\n');
  IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_3_PATCH_MISMATCH: %/topology_lock',r.signature; END IF;
  EXECUTE v_new;
 END LOOP;
END $$;
COMMIT;
