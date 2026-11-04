-- Entrega 1.1 / A: reabertura controlada e comprovantes de PIX.
-- Nenhuma chamada remota; o endereço do cliente é acessível só ao servidor.
BEGIN;

DO $$ BEGIN
 IF to_regprocedure('public.get_store_access(uuid)') IS NULL THEN
  RAISE EXCEPTION 'PRECHECK: Entrega 1 ausente.';
 END IF;
END $$;

CREATE TABLE public._entrega1_1_a_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_1_a_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_1_a_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_1_a_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid='public.get_my_tab(uuid)'::regprocedure;

-- Acrescentar informação não pessoal evita oferecer "Pedir mais" durante um PIX.
DO $$
DECLARE v_def text; v_new text;
BEGIN
 v_def:=pg_catalog.pg_get_functiondef('public.get_my_tab(uuid)'::regprocedure);
 v_new:=replace(v_def,$old$'waiterAuthorized', tb.status = 'WAITER_AUTHORIZED',$old$,
 $new$'waiterAuthorized', tb.status = 'WAITER_AUTHORIZED',
      'pixStatus', (SELECT c.status FROM public.tab_pix_charges c
        WHERE c.tab_id=tb.id AND c.tenant_id=tb.tenant_id
        ORDER BY (c.status IN ('creating','pending','paid')) DESC,c.created_at DESC,c.id DESC LIMIT 1),$new$);
 IF v_new=v_def THEN RAISE EXCEPTION 'ENTREGA1_1_PATCH_MISMATCH: get_my_tab/pixStatus'; END IF;
 EXECUTE v_new;
END $$;

-- Um tipo próprio mantém a navegação de notificações de pedidos independente.
ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED'));

CREATE FUNCTION public._reopen_tab_from_bill(p_tab uuid,p_actor uuid,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_label text;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TAB_NOT_FOUND: comanda indisponível.'; END IF;
 IF public._dine_in_config(v_tab.tenant_id) IS NULL THEN RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.'; END IF;
 IF v_tab.status NOT IN ('BILL_REQUESTED','WAITER_AUTHORIZED') THEN
  RAISE EXCEPTION 'INVALID_STATE: esta comanda não pode receber novos pedidos.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tab_id=v_tab.id AND c.tenant_id=v_tab.tenant_id AND c.status IN ('creating','pending','paid'))
  OR EXISTS(SELECT 1 FROM public.tab_payments p WHERE p.tab_id=v_tab.id AND p.tenant_id=v_tab.tenant_id) THEN
  RAISE EXCEPTION 'TAB_PAYMENT_IN_PROGRESS: cancele o PIX antes de pedir mais.';
 END IF;
 -- Bloqueio da comanda serializa o limite e as alterações com reserve_tab_pix.
 IF (SELECT count(*) FROM public.tab_access_events e WHERE e.tenant_id=v_tab.tenant_id AND e.tab_id=v_tab.id
     AND e.event='TAB_REOPENED' AND e.created_at>now()-interval '10 minutes')>=3 THEN
  RAISE EXCEPTION 'RATE_LIMITED: muitas reaberturas. Aguarde.';
 END IF;
 UPDATE public.dining_tabs SET status='OPEN',waiter_authorized_by=NULL,waiter_authorized_at=NULL
 WHERE id=v_tab.id AND tenant_id=v_tab.tenant_id;
 UPDATE public.waiter_calls SET status='CANCELLED',handled_at=now(),
  handled_by=CASE WHEN p_kind='STAFF' THEN p_actor ELSE NULL END
 WHERE tab_id=v_tab.id AND tenant_id=v_tab.tenant_id AND type='BILL' AND status='OPEN';
 INSERT INTO public.waiter_calls(tenant_id,tab_id,type) VALUES(v_tab.tenant_id,v_tab.id,'CALL');
 SELECT dt.label INTO v_label FROM public.dining_tables dt WHERE dt.id=v_tab.table_id AND dt.tenant_id=v_tab.tenant_id;
 INSERT INTO public.owner_notifications(tenant_id,kind,ref_id,title)
 VALUES(v_tab.tenant_id,'TAB_REOPENED',v_tab.id,'Pedir mais: '||COALESCE(v_label,'Mesa'));
 PERFORM public._tab_access_log(v_tab.tenant_id,v_tab.id,'TAB_REOPENED',p_kind,p_actor,NULL);
END $$;
REVOKE ALL ON FUNCTION public._reopen_tab_from_bill(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reopen_tab_from_bill(p_session_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_s public.tab_sessions;
BEGIN
 SELECT * INTO v_s FROM public.tab_sessions s
 WHERE s.id=p_session_id AND s.auth_user_id=auth.uid() AND s.ended_at IS NULL
  AND s.expires_at>now() AND s.approved_at IS NOT NULL;
 IF auth.uid() IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN: sessão da mesa indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM public._reopen_tab_from_bill(v_s.tab_id,v_s.id,'CUSTOMER');
END $$;
REVOKE ALL ON FUNCTION public.reopen_tab_from_bill(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reopen_tab_from_bill(uuid) TO authenticated;

CREATE FUNCTION public.staff_reopen_tab(p_tab uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public._tab_pix_staff(auth.uid(),v_tab.tenant_id)
  OR (public._tenant_role_of_caller(v_tab.tenant_id)='WAITER' AND NOT public._waiter_serves_tab(v_tab.id,auth.uid())) THEN
  RAISE EXCEPTION 'FORBIDDEN: sem permissão para reabrir esta conta.' USING ERRCODE='42501';
 END IF;
 PERFORM public._reopen_tab_from_bill(v_tab.id,auth.uid(),'STAFF');
END $$;
REVOKE ALL ON FUNCTION public.staff_reopen_tab(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_reopen_tab(uuid) TO authenticated;

CREATE FUNCTION public._receipt_mask_email(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN btrim(p_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@.]+$' THEN
  left(split_part(btrim(p_email),'@',1),2)||'***@'||left(split_part(split_part(btrim(p_email),'@',2),'.',1),2)||'***.'||
  reverse(split_part(reverse(split_part(btrim(p_email),'@',2)),'.',1)) ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public._receipt_mask_email(text) FROM PUBLIC,anon,authenticated,service_role;

-- Destinatário: titular autenticado desta comanda, nunca um endereço enviado pela equipe.
CREATE FUNCTION public._tab_receipt_email(p_tab uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT nullif(btrim(u.email),'') FROM public.dining_tabs tb
 JOIN auth.users u ON u.id=tb.responsible_user_id
 WHERE tb.id=p_tab AND EXISTS(SELECT 1 FROM public.tab_sessions s
  WHERE s.tab_id=tb.id AND s.tenant_id=tb.tenant_id AND s.auth_user_id=u.id AND s.approved_at IS NOT NULL)
 AND public._receipt_mask_email(u.email) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public._tab_receipt_email(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.tab_receipt_target(p_tab uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_email text;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT public._tab_pix_staff(auth.uid(),v_tab.tenant_id)
  OR (public._tenant_role_of_caller(v_tab.tenant_id)='WAITER' AND NOT public._waiter_serves_tab(v_tab.id,auth.uid())) THEN
  RAISE EXCEPTION 'FORBIDDEN: comprovante indisponível.' USING ERRCODE='42501';
 END IF;
 v_email:=public._tab_receipt_email(v_tab.id);
 RETURN jsonb_build_object('exists',v_email IS NOT NULL,'email_masked',public._receipt_mask_email(v_email));
END $$;
REVOKE ALL ON FUNCTION public.tab_receipt_target(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.tab_receipt_target(uuid) TO authenticated;

CREATE TABLE public.tab_receipt_sends(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 tab_id uuid NOT NULL,actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,charge_id uuid NOT NULL REFERENCES public.tab_pix_charges(id),
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','SENT','FAILED')),
 reason text CHECK(reason IS NULL OR reason IN ('EMAIL_PROVIDER_NOT_CONFIGURED','PROVIDER_ERROR')),
 FOREIGN KEY(tenant_id,tab_id) REFERENCES public.dining_tabs(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX tab_receipt_sends_tab_time ON public.tab_receipt_sends(tenant_id,tab_id,created_at);
ALTER TABLE public.tab_receipt_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tab_receipt_sends FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.reserve_tab_receipt(p_tab uuid,p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_charge public.tab_pix_charges; v_email text; v_attempt uuid; v_subtotal integer; v_payload jsonb;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab FOR UPDATE;
 IF p_user IS NULL OR NOT FOUND OR NOT public._tab_pix_staff(p_user,v_tab.tenant_id)
  OR (EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=p_user AND tu.tenant_id=v_tab.tenant_id AND tu.role_id='WAITER' AND tu.status='ACTIVE')
      AND NOT public._waiter_serves_tab(v_tab.id,p_user)) THEN
  RAISE EXCEPTION 'FORBIDDEN: comprovante indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.tab_id=v_tab.id AND c.tenant_id=v_tab.tenant_id
  AND c.status='paid' AND c.paid_at IS NOT NULL AND NOT c.needs_review
  AND c.amount_cents=public._tab_total_cents(v_tab.tenant_id,v_tab.id)
 ORDER BY c.paid_at DESC,c.id DESC LIMIT 1;
 IF v_tab.status<>'CLOSED' OR v_charge.id IS NULL THEN RAISE EXCEPTION 'Comprovante indisponível.'; END IF;
 v_email:=public._tab_receipt_email(v_tab.id);
 IF v_email IS NULL THEN RAISE EXCEPTION 'Cliente sem e-mail para comprovante.'; END IF;
 IF (SELECT count(*) FROM public.tab_receipt_sends s WHERE s.tenant_id=v_tab.tenant_id AND s.tab_id=v_tab.id AND s.created_at>now()-interval '10 minutes')>=3 THEN
  RAISE EXCEPTION 'Muitos envios de comprovante. Aguarde.' USING ERRCODE='P0429';
 END IF;
 INSERT INTO public.tab_receipt_sends(tenant_id,tab_id,actor_id,charge_id)
 VALUES(v_tab.tenant_id,v_tab.id,p_user,v_charge.id) RETURNING id INTO v_attempt;
 SELECT round(COALESCE(sum(o.subtotal),0)*100)::integer INTO v_subtotal FROM public.orders o
 WHERE o.tab_id=v_tab.id AND o.tenant_id=v_tab.tenant_id AND o.fulfillment_type='DINE_IN' AND o.status<>'CANCELLED';
 SELECT jsonb_build_object('attempt_id',v_attempt,'recipient_email',v_email,'store_name',t.name,'table_label',dt.label,
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity,'unit_price',i.unit_price,'total_price',i.total_price) ORDER BY o.round_no,i.id)
   FROM public.orders o JOIN public.order_items i ON i.order_id=o.id
   WHERE o.tab_id=v_tab.id AND o.tenant_id=v_tab.tenant_id AND o.fulfillment_type='DINE_IN' AND o.status<>'CANCELLED'),'[]'::jsonb),
  'service_fee_cents',v_charge.amount_cents-v_subtotal,'total_cents',v_charge.amount_cents,
  'method','PIX','paid_at',v_charge.paid_at,'charge_id',v_charge.id)
 INTO v_payload FROM public.tenants t JOIN public.dining_tables dt ON dt.tenant_id=t.id AND dt.id=v_tab.table_id WHERE t.id=v_tab.tenant_id;
 RETURN v_payload;
END $$;
REVOKE ALL ON FUNCTION public.reserve_tab_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_tab_receipt(uuid,uuid) TO service_role;

CREATE FUNCTION public.finish_tab_receipt(p_attempt uuid,p_sent boolean,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.tab_receipt_sends SET completed_at=now(),status=CASE WHEN p_sent IS TRUE THEN 'SENT' ELSE 'FAILED' END,
  reason=CASE WHEN p_sent IS TRUE THEN NULL WHEN p_reason='EMAIL_PROVIDER_NOT_CONFIGURED' THEN p_reason ELSE 'PROVIDER_ERROR' END
 WHERE id=p_attempt AND completed_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.finish_tab_receipt(uuid,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finish_tab_receipt(uuid,boolean,text) TO service_role;
COMMIT;
