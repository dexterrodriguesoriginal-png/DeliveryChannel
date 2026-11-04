-- Entrega 1.1 / B: entrega de rodadas e contestação por sessão da mesa.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public._entrega1_1_a_restore') IS NULL THEN RAISE EXCEPTION 'PRECHECK: Entrega 1.1 A ausente.'; END IF;
END $$;
CREATE TABLE public._entrega1_1_b_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_1_b_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_1_b_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_1_b_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid IN('public.get_my_tab(uuid)'::regprocedure,'public.salon_rounds_for_staff(uuid,uuid)'::regprocedure,'public._orders_protect_columns()'::regprocedure);

-- delivered_at já pertence ao despacho; não é recriado nem removido no down.
ALTER TABLE public.orders ADD COLUMN delivered_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public._orders_protect_columns()'::regprocedure);
 v_new:=replace(v_def,$s$'delivered_at','archived_at'$s$,$s$'delivered_at','delivered_by','archived_at'$s$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_1_PATCH_MISMATCH: _orders_protect_columns/delivered_by'; END IF;
 EXECUTE v_new;
END $$;
ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED','ORDER_DELIVERY_DISPUTE'));

CREATE TABLE public.order_delivery_disputes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 order_id uuid NOT NULL UNIQUE,session_id uuid REFERENCES public.tab_sessions(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CONFIRMED_DELIVERED','RESENT')),
 resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,resolved_at timestamptz,
 call_id uuid REFERENCES public.waiter_calls(id) ON DELETE SET NULL,
 FOREIGN KEY(tenant_id,order_id) REFERENCES public.orders(tenant_id,id) ON DELETE CASCADE,
 CHECK((status='OPEN' AND resolved_at IS NULL) OR (status<>'OPEN' AND resolved_at IS NOT NULL))
);
CREATE INDEX order_delivery_disputes_tenant_open ON public.order_delivery_disputes(tenant_id,created_at) WHERE status='OPEN';
ALTER TABLE public.order_delivery_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_delivery_disputes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.order_delivery_disputes TO authenticated;

-- O helper público da policy verifica sempre a própria identidade, sem parâmetro de ator.
CREATE FUNCTION public._can_manage_delivery_dispute(p_order uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.orders o
 WHERE o.id=p_order AND o.fulfillment_type='DINE_IN' AND o.tab_id IS NOT NULL
 AND public._dine_in_config(o.tenant_id) IS NOT NULL AND public._tab_pix_staff(auth.uid(),o.tenant_id)
 AND (public._tenant_role_of_caller(o.tenant_id)<>'WAITER' OR public._waiter_serves_tab(o.tab_id,auth.uid())));
$$;
REVOKE ALL ON FUNCTION public._can_manage_delivery_dispute(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._can_manage_delivery_dispute(uuid) TO authenticated;
CREATE POLICY order_delivery_disputes_staff_read ON public.order_delivery_disputes FOR SELECT TO authenticated
 USING(public._can_manage_delivery_dispute(order_id));

CREATE FUNCTION public.waiter_mark_delivered(p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order public.orders;
BEGIN
 SELECT * INTO v_order FROM public.orders o WHERE o.id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT public._can_manage_delivery_dispute(p_order) THEN
  RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido indisponível.' USING ERRCODE='42501';
 END IF;
 IF v_order.status='DELIVERED' THEN
  RETURN jsonb_build_object('order_id',v_order.id,'status',v_order.status,'delivered_at',v_order.delivered_at,'delivered_by',v_order.delivered_by);
 END IF;
 IF v_order.status NOT IN ('READY','OUT_FOR_DELIVERY') THEN RAISE EXCEPTION 'INVALID_STATE: o pedido ainda não está pronto para entrega.'; END IF;
 PERFORM public._assert_online_payment_ready(p_order);
 UPDATE public.orders SET status='DELIVERED',delivered_at=now(),delivered_by=auth.uid(),updated_at=now()
 WHERE id=v_order.id AND tenant_id=v_order.tenant_id RETURNING * INTO v_order;
 -- Histórico visível ao cliente não contém nome, telefone ou e-mail da equipe.
 INSERT INTO public.order_status_history(order_id,status,note,changed_by)
 VALUES(v_order.id,'DELIVERED','Pedido entregue à mesa','Equipe do salão');
 RETURN jsonb_build_object('order_id',v_order.id,'status',v_order.status,'delivered_at',v_order.delivered_at,'delivered_by',v_order.delivered_by);
END $$;
REVOKE ALL ON FUNCTION public.waiter_mark_delivered(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.waiter_mark_delivered(uuid) TO authenticated;

CREATE FUNCTION public.customer_dispute_delivery(p_session_id uuid,p_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_order public.orders; v_s public.tab_sessions; v_dispute public.order_delivery_disputes; v_call uuid; v_label text;
BEGIN
 SELECT * INTO v_order FROM public.orders o WHERE o.id=p_order FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR v_order.fulfillment_type<>'DINE_IN' OR v_order.tab_id IS NULL THEN
  RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_s FROM public.tab_sessions s WHERE s.id=p_session_id AND s.auth_user_id=auth.uid()
  AND s.tenant_id=v_order.tenant_id AND s.tab_id=v_order.tab_id AND s.approved_at IS NOT NULL
  AND ((s.ended_at IS NULL AND s.expires_at>now()) OR (s.ended_reason='TAB_CLOSED' AND s.ended_at>now()-interval '2 hours'));
 IF NOT FOUND OR public._dine_in_config(v_order.tenant_id) IS NULL THEN
  RAISE EXCEPTION 'FORBIDDEN: sessão da mesa indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_dispute FROM public.order_delivery_disputes d WHERE d.order_id=v_order.id AND d.tenant_id=v_order.tenant_id;
 IF FOUND THEN RETURN jsonb_build_object('id',v_dispute.id,'status',v_dispute.status,'created_at',v_dispute.created_at); END IF;
 IF v_order.status<>'DELIVERED' OR v_order.delivered_at IS NULL
  OR v_order.delivered_at<now()-interval '5 minutes' OR v_order.delivered_at>now() THEN
  RAISE EXCEPTION 'DELIVERY_DISPUTE_EXPIRED: o prazo de cinco minutos para informar a entrega terminou.';
 END IF;
 INSERT INTO public.waiter_calls(tenant_id,tab_id,type) VALUES(v_order.tenant_id,v_order.tab_id,'HELP') RETURNING id INTO v_call;
 INSERT INTO public.order_delivery_disputes(tenant_id,order_id,session_id,call_id)
 VALUES(v_order.tenant_id,v_order.id,v_s.id,v_call) RETURNING * INTO v_dispute;
 SELECT dt.label INTO v_label FROM public.dining_tabs tb JOIN public.dining_tables dt ON dt.id=tb.table_id AND dt.tenant_id=tb.tenant_id WHERE tb.id=v_order.tab_id AND tb.tenant_id=v_order.tenant_id;
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title)
 VALUES(v_order.tenant_id,'ORDER_DELIVERY_DISPUTE',v_order.id,'Entrega não recebida: '||COALESCE(v_label,'Mesa'));
 RETURN jsonb_build_object('id',v_dispute.id,'status',v_dispute.status,'created_at',v_dispute.created_at);
END $$;
REVOKE ALL ON FUNCTION public.customer_dispute_delivery(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.customer_dispute_delivery(uuid,uuid) TO authenticated;

CREATE FUNCTION public.resolve_delivery_dispute(p_dispute uuid,p_resolution text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_dispute public.order_delivery_disputes; v_order public.orders; v_order_id uuid;
BEGIN
 IF p_resolution IS NULL OR p_resolution NOT IN ('CONFIRMED_DELIVERED','RESENT') THEN RAISE EXCEPTION 'INVALID_RESOLUTION: selecione confirmar entrega ou reenviar.'; END IF;
 SELECT d.order_id INTO v_order_id FROM public.order_delivery_disputes d WHERE d.id=p_dispute;
 SELECT * INTO v_order FROM public.orders o WHERE o.id=v_order_id FOR UPDATE;
 IF NOT FOUND OR NOT public._can_manage_delivery_dispute(v_order.id) THEN
  RAISE EXCEPTION 'FORBIDDEN: contestação indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_dispute FROM public.order_delivery_disputes d WHERE d.id=p_dispute AND d.tenant_id=v_order.tenant_id FOR UPDATE;
 IF v_dispute.status<>'OPEN' THEN
  IF v_dispute.status=p_resolution THEN RETURN jsonb_build_object('id',v_dispute.id,'status',v_dispute.status,'order_id',v_order.id,'order_status',v_order.status); END IF;
  RAISE EXCEPTION 'DISPUTE_RESOLVED: esta contestação já foi resolvida.';
 END IF;
 IF v_order.status<>'DELIVERED' THEN RAISE EXCEPTION 'INVALID_STATE: confira o estado atual do pedido antes de resolver.'; END IF;
 IF p_resolution='RESENT' THEN
  UPDATE public.orders SET status='PREPARING',delivered_at=NULL,delivered_by=NULL,archived_at=NULL,archived_by=NULL,updated_at=now()
  WHERE id=v_order.id AND tenant_id=v_order.tenant_id RETURNING * INTO v_order;
  INSERT INTO public.order_status_history(order_id,status,note,changed_by)
  VALUES(v_order.id,'PREPARING','Pedido reenviado após contestação de entrega','Equipe do salão');
 END IF;
 UPDATE public.order_delivery_disputes SET status=p_resolution,resolved_by=auth.uid(),resolved_at=now() WHERE id=v_dispute.id;
 UPDATE public.waiter_calls SET status='HANDLED',handled_by=auth.uid(),handled_at=now()
 WHERE id=v_dispute.call_id AND tenant_id=v_order.tenant_id AND tab_id=v_order.tab_id AND status='OPEN';
 RETURN jsonb_build_object('id',v_dispute.id,'status',p_resolution,'order_id',v_order.id,'order_status',v_order.status);
END $$;
REVOKE ALL ON FUNCTION public.resolve_delivery_dispute(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_dispute(uuid,text) TO authenticated;

CREATE FUNCTION public.list_open_delivery_disputes(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public._tab_pix_staff(auth.uid(),p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN: sem acesso às contestações.' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'order_id',o.id,'tab_id',o.tab_id,'table_id',tb.table_id,
  'table_label',dt.label,'order_number',o.order_number,'order_status',o.status,'created_at',d.created_at,'status',d.status) ORDER BY d.created_at,d.id)
 FROM public.order_delivery_disputes d JOIN public.orders o ON o.id=d.order_id AND o.tenant_id=d.tenant_id
 JOIN public.dining_tabs tb ON tb.id=o.tab_id AND tb.tenant_id=o.tenant_id
 JOIN public.dining_tables dt ON dt.id=tb.table_id AND dt.tenant_id=tb.tenant_id
 WHERE d.tenant_id=p_tenant AND (d.status='OPEN' OR (d.status='RESENT' AND o.status IN ('PREPARING','READY','OUT_FOR_DELIVERY')))
 AND public._can_manage_delivery_dispute(o.id)),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.list_open_delivery_disputes(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_open_delivery_disputes(uuid) TO authenticated;

-- Sinal mínimo da própria comanda inclui pagamentos/mesas já fechadas. Acesso por RLS
-- permanece no sinal existente; nenhum dado de pedido ou cliente é publicado nele.
CREATE FUNCTION public._delivery_dispute_tracking_signal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tenant uuid; v_tab uuid;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
  IF NEW.fulfillment_type<>'DINE_IN' OR NEW.tab_id IS NULL THEN RETURN NEW; END IF;
  v_tenant:=NEW.tenant_id; v_tab:=NEW.tab_id;
 ELSE
  SELECT o.tenant_id,o.tab_id INTO v_tenant,v_tab FROM public.orders o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id;
 END IF;
 IF v_tab IS NOT NULL THEN
  INSERT INTO public.dining_tracking_revisions(tenant_id,tab_id,revision) VALUES(v_tenant,v_tab,clock_timestamp())
  ON CONFLICT(tab_id) DO UPDATE SET revision=EXCLUDED.revision;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._delivery_dispute_tracking_signal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER delivery_dispute_tracking AFTER INSERT OR UPDATE OF status ON public.order_delivery_disputes FOR EACH ROW EXECUTE FUNCTION public._delivery_dispute_tracking_signal();
CREATE TRIGGER delivery_order_tracking AFTER UPDATE OF status,delivered_at ON public.orders FOR EACH ROW EXECUTE FUNCTION public._delivery_dispute_tracking_signal();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.order_delivery_disputes; END IF;
END $$;

DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.get_my_tab(uuid)'::regprocedure);
 v_new:=replace(v_def,$old$'deliveredAt', (SELECT min(h.created_at) FROM public.order_status_history h WHERE h.order_id = o.id AND h.status = 'DELIVERED'),$old$,
 $new$'deliveredAt', CASE WHEN o.status='DELIVERED' THEN o.delivered_at ELSE NULL END,
          'deliveryDispute', (SELECT jsonb_build_object('id',d.id,'status',d.status,'createdAt',d.created_at,'resolvedAt',d.resolved_at)
            FROM public.order_delivery_disputes d WHERE d.order_id=o.id AND d.tenant_id=o.tenant_id),
          'canDisputeDelivery', o.status='DELIVERED' AND o.delivered_at>=now()-interval '5 minutes' AND o.delivered_at<=now()
            AND NOT EXISTS(SELECT 1 FROM public.order_delivery_disputes d WHERE d.order_id=o.id AND d.tenant_id=o.tenant_id),$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_1_PATCH_MISMATCH: get_my_tab/delivery'; END IF;
 v_def:=v_new;
 v_new:=replace(v_def,$old$'totalPrice', oi.total_price, 'station', oi.station$old$,
 $new$'totalPrice', oi.total_price, 'station', oi.station,
            'deliveredAt', CASE WHEN o.status='DELIVERED' THEN o.delivered_at ELSE NULL END$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_1_PATCH_MISMATCH: get_my_tab/item_delivery'; END IF;
 EXECUTE v_new;
 v_def:=pg_catalog.pg_get_functiondef('public.salon_rounds_for_staff(uuid,uuid)'::regprocedure);
 v_new:=replace(v_def,$old$'waiter_id',o.waiter_id)$old$,
 $new$'waiter_id',o.waiter_id,'delivered_at',o.delivered_at,'delivered_by',o.delivered_by,
  'delivery_dispute',(SELECT jsonb_build_object('id',d.id,'status',d.status,'created_at',d.created_at,'resolved_at',d.resolved_at)
   FROM public.order_delivery_disputes d WHERE d.order_id=o.id AND d.tenant_id=o.tenant_id))$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_1_PATCH_MISMATCH: salon_rounds_for_staff/delivery'; END IF;
 EXECUTE v_new;
END $$;
COMMIT;
