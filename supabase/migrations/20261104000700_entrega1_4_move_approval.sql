-- Entrega 1.4 / 1: a solicitação do cliente nunca muda a mesa sem aprovação.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.customer_move_table(uuid,uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'PRECHECK: Entrega 1.3 C ausente.';
 END IF;
END $$;

CREATE TABLE public._entrega1_4_move_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_4_move_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_4_move_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_4_move_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid IN('public.customer_move_table(uuid,uuid,text)'::regprocedure,'public._waiter_settings(uuid)'::regprocedure);

ALTER TABLE public.waiter_service_settings ADD COLUMN allow_waiter_table_move_approval boolean NOT NULL DEFAULT false;
-- O tipo composto ganha uma coluna; o fallback deve continuar válido sem linha persistida.
CREATE OR REPLACE FUNCTION public._waiter_settings(p_tenant uuid) RETURNS public.waiter_service_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT s FROM public.waiter_service_settings s WHERE s.tenant_id=p_tenant),
  ROW(p_tenant,'FREE',false,60,60,NULL,now(),false)::public.waiter_service_settings);
$$;
CREATE FUNCTION public._salon_move_setting_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.allow_waiter_table_move_approval) OR
    (TG_OP='UPDATE' AND NEW.allow_waiter_table_move_approval IS DISTINCT FROM OLD.allow_waiter_table_move_approval) THEN
  IF auth.uid() IS NOT NULL AND COALESCE(public._tenant_role_of_caller(NEW.tenant_id),'')<>'OWNER' THEN
   RAISE EXCEPTION 'FORBIDDEN: somente o dono altera a autorização de mudança de mesa.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER salon_move_setting_guard BEFORE INSERT OR UPDATE ON public.waiter_service_settings
 FOR EACH ROW EXECUTE FUNCTION public._salon_move_setting_guard();
CREATE FUNCTION public.set_waiter_table_move_approval(p_tenant uuid,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._salon_lock_tenant(p_tenant);
 IF auth.uid() IS NULL OR COALESCE(public._tenant_role_of_caller(p_tenant),'')<>'OWNER' THEN
  RAISE EXCEPTION 'FORBIDDEN: somente o dono altera a autorização de mudança de mesa.' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.waiter_service_settings(tenant_id,allow_waiter_table_move_approval,updated_by)
 VALUES(p_tenant,COALESCE(p_enabled,false),auth.uid()) ON CONFLICT(tenant_id) DO UPDATE
 SET allow_waiter_table_move_approval=EXCLUDED.allow_waiter_table_move_approval,updated_by=auth.uid(),updated_at=now();
END $$;

CREATE FUNCTION public._salon_can_approve_table_move(p_tenant uuid,p_tab uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.dining_tabs t WHERE t.id=p_tab AND t.tenant_id=p_tenant)
 AND (COALESCE(public._tenant_role_of_caller(p_tenant),'')='OWNER'
  OR (COALESCE(public._tenant_role_of_caller(p_tenant),'')='WAITER'
   AND COALESCE((SELECT s.allow_waiter_table_move_approval FROM public.waiter_service_settings s WHERE s.tenant_id=p_tenant),false)
   AND public._waiter_is_active(p_tenant,auth.uid()) AND public._waiter_serves_tab(p_tab,auth.uid())));
$$;
CREATE FUNCTION public._salon_owns_move_session(p_tenant uuid,p_tab uuid,p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.tab_sessions s
 WHERE s.id=p_session AND s.tenant_id=p_tenant AND s.tab_id=p_tab AND s.auth_user_id=auth.uid()
 AND s.approved_at IS NOT NULL AND s.ended_at IS NULL AND s.expires_at>now());
$$;

CREATE TABLE public.table_move_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 tab_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES public.tab_sessions(id) ON DELETE CASCADE,
 from_table_id uuid NOT NULL,
 to_table_id uuid NOT NULL,
 from_label text NOT NULL,
 to_label text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
 FOREIGN KEY(tenant_id,tab_id) REFERENCES public.dining_tabs(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,from_table_id) REFERENCES public.dining_tables(tenant_id,id),
 FOREIGN KEY(tenant_id,to_table_id) REFERENCES public.dining_tables(tenant_id,id),
 CHECK(from_table_id<>to_table_id),
 CHECK((status='PENDING' AND resolved_at IS NULL) OR (status<>'PENDING' AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX table_move_requests_pending_tab ON public.table_move_requests(tenant_id,tab_id) WHERE status='PENDING';
CREATE INDEX table_move_requests_tenant_status ON public.table_move_requests(tenant_id,status,requested_at);
ALTER TABLE public.table_move_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_move_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.table_move_requests TO authenticated;
CREATE POLICY table_move_requests_read ON public.table_move_requests FOR SELECT TO authenticated USING(
 public._salon_can_approve_table_move(tenant_id,tab_id) OR public._salon_owns_move_session(tenant_id,tab_id,session_id));

CREATE OR REPLACE FUNCTION public.customer_move_table(p_session_id uuid,p_target_table_id uuid DEFAULT NULL,p_target_qr_token text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.tab_sessions; t public.dining_tabs; dest public.dining_tables; req public.table_move_requests; old_label text; v_qr_token text;
BEGIN
 SELECT * INTO s FROM public.tab_sessions WHERE id=p_session_id AND auth_user_id=auth.uid() AND approved_at IS NOT NULL AND ended_at IS NULL AND expires_at>now();
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public._customer_identified() THEN RAISE EXCEPTION 'TAB_NOT_FOUND: sessão indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM public._salon_lock_tenant(s.tenant_id);
 PERFORM 1 FROM public.dining_tables WHERE tenant_id=s.tenant_id ORDER BY id FOR UPDATE;
 SELECT * INTO s FROM public.tab_sessions WHERE id=p_session_id AND auth_user_id=auth.uid() AND approved_at IS NOT NULL AND ended_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: sessão indisponível.' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.dining_tabs WHERE id=s.tab_id AND tenant_id=s.tenant_id FOR UPDATE;
 IF t.responsible_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN: somente o responsável pode solicitar a mudança.' USING ERRCODE='42501'; END IF;
 IF t.status<>'OPEN' THEN RAISE EXCEPTION 'MOVE_BLOCKED_BILL: não é permitido mudar de mesa com conta pedida ou pagamento em andamento.'; END IF;
 PERFORM public._salon_assert_changeable(t.id);
 v_qr_token:=NULLIF(btrim(p_target_qr_token),'');
 IF position('mesa=' IN v_qr_token)>0 THEN v_qr_token:=regexp_replace(v_qr_token,'^.*[?&]mesa=([^&#\s]+).*$','\1'); END IF;
 SELECT * INTO dest FROM public.dining_tables d WHERE d.tenant_id=s.tenant_id AND d.active
 AND ((p_target_table_id IS NOT NULL AND d.id=p_target_table_id AND (v_qr_token IS NULL OR d.qr_token=v_qr_token)) OR (p_target_table_id IS NULL AND d.qr_token=v_qr_token));
 IF NOT FOUND OR public._qr_paused(s.tenant_id,dest.id) THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa indisponível.'; END IF;
 IF public._salon_tab_for_table(dest.id) IS NOT NULL THEN RAISE EXCEPTION 'TABLE_OCCUPIED: peça à equipe para juntar contas com aceite.'; END IF;
 SELECT * INTO req FROM public.table_move_requests WHERE tenant_id=t.tenant_id AND tab_id=t.id AND status='PENDING' FOR UPDATE;
 IF req.id IS NULL OR req.to_table_id<>dest.id OR req.from_table_id<>t.table_id OR req.session_id<>s.id THEN
  IF (SELECT count(*) FROM public.table_move_requests WHERE tenant_id=t.tenant_id AND tab_id=t.id AND requested_at>now()-interval '10 minutes')>=5 THEN
   RAISE EXCEPTION 'RATE_LIMITED: aguarde para solicitar outra mudança.';
  END IF;
  UPDATE public.table_move_requests SET status='CANCELLED',resolved_at=now() WHERE tenant_id=t.tenant_id AND tab_id=t.id AND status='PENDING';
  SELECT label INTO old_label FROM public.dining_tables WHERE id=t.table_id;
  INSERT INTO public.table_move_requests(tenant_id,tab_id,session_id,from_table_id,to_table_id,from_label,to_label)
  VALUES(t.tenant_id,t.id,s.id,t.table_id,dest.id,old_label,dest.label) RETURNING * INTO req;
  PERFORM public._tab_access_log(t.tenant_id,t.id,'TABLE_MOVE_REQUESTED','CUSTOMER',s.id,NULL,jsonb_build_object('request_id',req.id,'from_table',t.table_id,'to_table',dest.id));
  INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision) VALUES(t.tenant_id,t.id,clock_timestamp()) ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 END IF;
 RETURN jsonb_build_object('requestId',req.id,'status',req.status,'tabId',t.id,'fromTableId',req.from_table_id,'fromLabel',req.from_label,
  'toTableId',req.to_table_id,'toLabel',req.to_label,'notice','Solicitação enviada. Aguarde a autorização da equipe.');
END $$;

CREATE FUNCTION public.list_table_move_requests(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (COALESCE(public._tenant_role_of_caller(p_tenant),'')='OWNER' OR
  (public._tenant_role_of_caller(p_tenant)='WAITER' AND public._waiter_is_active(p_tenant,auth.uid()) AND
   COALESCE((SELECT allow_waiter_table_move_approval FROM public.waiter_service_settings WHERE tenant_id=p_tenant),false))) THEN
  RAISE EXCEPTION 'FORBIDDEN: aprovação de mudança indisponível.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'tabId',r.tab_id,'fromTableId',r.from_table_id,'fromLabel',r.from_label,
  'toTableId',r.to_table_id,'toLabel',r.to_label,'status',r.status,'requestedAt',r.requested_at) ORDER BY r.requested_at)
 FROM public.table_move_requests r WHERE r.tenant_id=p_tenant AND r.status='PENDING' AND public._salon_can_approve_table_move(r.tenant_id,r.tab_id)),'[]'::jsonb);
END $$;
CREATE FUNCTION public.list_my_table_move_requests(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.tab_sessions;
BEGIN
 SELECT * INTO s FROM public.tab_sessions WHERE id=p_session_id;
 IF NOT FOUND OR NOT public._salon_owns_move_session(s.tenant_id,s.tab_id,s.id) THEN
  RAISE EXCEPTION 'FORBIDDEN: sessão indisponível.' USING ERRCODE='42501';
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'tabId',r.tab_id,'fromTableId',r.from_table_id,'fromLabel',r.from_label,
  'toTableId',r.to_table_id,'toLabel',r.to_label,'status',r.status,'requestedAt',r.requested_at,'resolvedAt',r.resolved_at) ORDER BY r.requested_at DESC)
 FROM (SELECT * FROM public.table_move_requests WHERE tenant_id=s.tenant_id AND tab_id=s.tab_id AND session_id=s.id ORDER BY requested_at DESC LIMIT 10) r),'[]'::jsonb);
END $$;
CREATE FUNCTION public.resolve_table_move_request(p_request_id uuid,p_approve boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req public.table_move_requests; s public.tab_sessions; t public.dining_tabs; dest public.dining_tables;
BEGIN
 SELECT * INTO req FROM public.table_move_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN: solicitação indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM public._salon_lock_tenant(req.tenant_id);
 IF NOT public._salon_can_approve_table_move(req.tenant_id,req.tab_id) THEN
  RAISE EXCEPTION 'FORBIDDEN: aprovação de mudança indisponível.' USING ERRCODE='42501';
 END IF;
 -- Mesmo mutex e ordem de locks de entrada/junção/PIX: nenhuma conta perde a dívida.
 PERFORM 1 FROM public.dining_tables WHERE tenant_id=req.tenant_id ORDER BY id FOR UPDATE;
 SELECT * INTO req FROM public.table_move_requests WHERE id=p_request_id FOR UPDATE;
 IF req.status<>'PENDING' THEN RAISE EXCEPTION 'REQUEST_ALREADY_RESOLVED: solicitação já respondida.'; END IF;
 SELECT * INTO t FROM public.dining_tabs WHERE id=req.tab_id AND tenant_id=req.tenant_id FOR UPDATE;
 IF NOT public._salon_can_approve_table_move(req.tenant_id,req.tab_id) THEN RAISE EXCEPTION 'FORBIDDEN: aprovação de mudança indisponível.' USING ERRCODE='42501'; END IF;
 IF p_approve IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT: escolha autorizar ou recusar.'; END IF;
 IF p_approve THEN
  SELECT * INTO s FROM public.tab_sessions WHERE id=req.session_id AND tenant_id=req.tenant_id AND tab_id=req.tab_id FOR UPDATE;
  IF NOT FOUND OR s.auth_user_id IS DISTINCT FROM t.responsible_user_id OR s.approved_at IS NULL OR s.ended_at IS NOT NULL OR s.expires_at<=now() THEN
   RAISE EXCEPTION 'MOVE_SESSION_INVALID: sessão da solicitação não está mais aprovada.';
  END IF;
  IF t.table_id<>req.from_table_id THEN RAISE EXCEPTION 'MOVE_STALE: a conta mudou desde a solicitação.'; END IF;
  PERFORM public._salon_assert_changeable(t.id);
  SELECT * INTO dest FROM public.dining_tables WHERE tenant_id=req.tenant_id AND id=req.to_table_id AND active;
  IF NOT FOUND OR public._qr_paused(req.tenant_id,dest.id) THEN RAISE EXCEPTION 'TABLE_UNAVAILABLE: mesa indisponível.'; END IF;
  IF public._tenant_role_of_caller(req.tenant_id)='WAITER' AND EXISTS(SELECT 1 FROM public.waiter_table_assignments a
   WHERE a.tenant_id=req.tenant_id AND a.table_id=dest.id AND a.waiter_id<>auth.uid()) THEN
   RAISE EXCEPTION 'FORBIDDEN: mesa de destino atribuída a outro garçom.' USING ERRCODE='42501';
  END IF;
  IF public._salon_tab_for_table(dest.id) IS NOT NULL THEN RAISE EXCEPTION 'TABLE_OCCUPIED: mesa ocupada após a solicitação.'; END IF;
  DELETE FROM public.dining_tab_tables WHERE tab_id=t.id AND tenant_id=t.tenant_id;
  UPDATE public.dining_tabs SET table_id=dest.id WHERE id=t.id AND tenant_id=t.tenant_id;
  UPDATE public._salon_session_seats ss SET table_id=dest.id WHERE ss.tenant_id=t.tenant_id AND ss.session_id IN(SELECT id FROM public.tab_sessions WHERE tab_id=t.id AND tenant_id=t.tenant_id);
  UPDATE public._salon_order_seats os SET table_id=dest.id WHERE os.tenant_id=t.tenant_id AND os.order_id IN(SELECT id FROM public.orders WHERE tab_id=t.id AND tenant_id=t.tenant_id);
  UPDATE public.dining_tab_invites SET revoked_at=now() WHERE tab_id=t.id AND tenant_id=t.tenant_id AND revoked_at IS NULL;
  UPDATE public.waiter_calls SET tab_id=t.id WHERE tab_id=t.id AND tenant_id=t.tenant_id AND status='OPEN';
  PERFORM public._salon_table_notice(t.tenant_id,t.id,'TABLE_MOVED','STAFF',auth.uid(),req.from_label,dest.label,
   jsonb_build_object('request_id',req.id,'requested_by_session',s.id,'from_table',req.from_table_id,'to_table',dest.id));
 END IF;
 UPDATE public.table_move_requests SET status=CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END,resolved_at=now(),resolved_by=auth.uid()
 WHERE id=req.id RETURNING * INTO req;
 PERFORM public._tab_access_log(req.tenant_id,req.tab_id,CASE WHEN p_approve THEN 'TABLE_MOVE_APPROVED' ELSE 'TABLE_MOVE_REJECTED' END,
  'STAFF',auth.uid(),NULL,jsonb_build_object('request_id',req.id));
 INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision) VALUES(req.tenant_id,req.tab_id,clock_timestamp()) ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 RETURN jsonb_build_object('requestId',req.id,'status',req.status,'tabId',req.tab_id,'tableId',CASE WHEN p_approve THEN req.to_table_id ELSE t.table_id END,
  'tableLabel',CASE WHEN p_approve THEN req.to_label ELSE req.from_label END,'fromLabel',req.from_label,'toLabel',req.to_label);
END $$;

REVOKE ALL ON FUNCTION public._salon_move_setting_guard(),public.set_waiter_table_move_approval(uuid,boolean),
 public._salon_can_approve_table_move(uuid,uuid),public._salon_owns_move_session(uuid,uuid,uuid),
 public.list_table_move_requests(uuid),public.list_my_table_move_requests(uuid),public.resolve_table_move_request(uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_waiter_table_move_approval(uuid,boolean),public._salon_can_approve_table_move(uuid,uuid),
 public._salon_owns_move_session(uuid,uuid,uuid),public.list_table_move_requests(uuid),public.list_my_table_move_requests(uuid),
 public.resolve_table_move_request(uuid,boolean) TO authenticated;
COMMIT;

