-- Entrega 1.3 / B: recibo por e-mail em qualquer fechamento pago e destinatário alternativo validado.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.reserve_tab_receipt(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'PRECHECK: Entrega 1.1 A ausente.';
 END IF;
END $$;

CREATE TABLE public._entrega1_3_b_restore(signature text PRIMARY KEY,definition text NOT NULL,acl jsonb NOT NULL);
ALTER TABLE public._entrega1_3_b_restore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._entrega1_3_b_restore FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._entrega1_3_b_restore
SELECT p.oid::regprocedure::text,pg_catalog.pg_get_functiondef(p.oid),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
  'privilege',a.privilege_type,'grantable',a.is_grantable)) FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::jsonb)
FROM pg_catalog.pg_proc p WHERE p.oid='public.reserve_tab_receipt(uuid,uuid)'::regprocedure;

-- Permite recibo também em fechamento em dinheiro/cartão sem cobrança PIX associada.
ALTER TABLE public.tab_receipt_sends ALTER COLUMN charge_id DROP NOT NULL;

CREATE FUNCTION public.reserve_tab_receipt(p_tab uuid,p_user uuid,p_override_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_tab public.dining_tabs;
 v_charge public.tab_pix_charges;
 v_total integer;
 v_paid_sum integer;
 v_payment_id uuid;
 v_method text;
 v_paid_at timestamptz;
 v_amount_cents integer;
 v_email text;
 v_attempt uuid;
 v_subtotal integer;
 v_payload jsonb;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab FOR UPDATE;
 IF p_user IS NULL OR NOT FOUND OR NOT public._tab_pix_staff(p_user,v_tab.tenant_id)
  OR (EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=p_user AND tu.tenant_id=v_tab.tenant_id AND tu.role_id='WAITER' AND tu.status='ACTIVE')
      AND NOT public._waiter_serves_tab(v_tab.id,p_user)) THEN
  RAISE EXCEPTION 'FORBIDDEN: comprovante indisponível.' USING ERRCODE='42501';
 END IF;
 v_total:=public._tab_total_cents(v_tab.tenant_id,v_tab.id);
 SELECT * INTO v_charge FROM public.tab_pix_charges c WHERE c.tab_id=v_tab.id AND c.tenant_id=v_tab.tenant_id
  AND c.status='paid' AND c.paid_at IS NOT NULL AND NOT c.needs_review
  AND c.amount_cents=v_total
 ORDER BY c.paid_at DESC,c.id DESC LIMIT 1;
 IF v_charge.id IS NOT NULL THEN
  v_amount_cents:=v_charge.amount_cents;
  v_method:='PIX';
  v_paid_at:=v_charge.paid_at;
  v_payment_id:=v_charge.id;
 ELSE
  SELECT COALESCE(sum(p.amount_cents),0)::integer,
   (array_agg(p.method ORDER BY p.created_at DESC,p.id DESC))[1],
   max(p.created_at),
   (array_agg(p.id ORDER BY p.created_at DESC,p.id DESC))[1]
  INTO v_paid_sum,v_method,v_paid_at,v_payment_id
  FROM public.tab_payments p
  WHERE p.tab_id=v_tab.id AND p.tenant_id=v_tab.tenant_id AND p.method<>'PIX';
  v_amount_cents:=v_paid_sum;
 END IF;
 IF v_tab.status<>'CLOSED' OR v_payment_id IS NULL OR v_amount_cents IS DISTINCT FROM v_total OR v_total<=0 THEN
  RAISE EXCEPTION 'Comprovante indisponível.';
 END IF;
 IF p_override_email IS NOT NULL AND btrim(p_override_email)<>'' THEN
  v_email:=lower(btrim(p_override_email));
  IF length(v_email)>254 OR public._receipt_mask_email(v_email) IS NULL THEN
   RAISE EXCEPTION 'INVALID_EMAIL: informe um e-mail válido.' USING ERRCODE='22023';
  END IF;
 ELSE
  v_email:=public._tab_receipt_email(v_tab.id);
  IF v_email IS NULL THEN RAISE EXCEPTION 'Cliente sem e-mail para comprovante.'; END IF;
 END IF;
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
  'service_fee_cents',v_amount_cents-v_subtotal,'total_cents',v_amount_cents,
  'method',v_method,'paid_at',COALESCE(v_paid_at,v_tab.closed_at,now()),'charge_id',v_payment_id)
 INTO v_payload FROM public.tenants t JOIN public.dining_tables dt ON dt.tenant_id=t.id AND dt.id=v_tab.table_id WHERE t.id=v_tab.tenant_id;
 RETURN v_payload;
END $$;
REVOKE ALL ON FUNCTION public.reserve_tab_receipt(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_tab_receipt(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_tab_receipt(p_tab uuid,p_user uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.reserve_tab_receipt(p_tab,p_user,NULL);
$$;
REVOKE ALL ON FUNCTION public.reserve_tab_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_tab_receipt(uuid,uuid) TO service_role;
COMMIT;
