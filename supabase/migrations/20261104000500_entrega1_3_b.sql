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
FROM pg_catalog.pg_proc p WHERE p.oid IN ('public.reserve_tab_receipt(uuid,uuid)'::regprocedure,'public.tab_receipt_target(uuid)'::regprocedure);

-- Permite recibo também em fechamento em dinheiro/cartão sem cobrança PIX associada.
ALTER TABLE public.tab_receipt_sends ALTER COLUMN charge_id DROP NOT NULL;

-- A mailbox validator is separate from masking: a display name/list is never a recipient.
CREATE FUNCTION public._receipt_is_valid_email(p_email text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_email IS NOT NULL AND length(btrim(p_email)) BETWEEN 3 AND 254
  AND p_email !~ E'[\\r\\n]'
  AND length(split_part(btrim(p_email),'@',1)) BETWEEN 1 AND 64
  AND split_part(btrim(p_email),'@',1) !~ '(^[.]|[.]$|[.][.])'
  AND lower(btrim(p_email)) ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';
$$;
REVOKE ALL ON FUNCTION public._receipt_is_valid_email(text) FROM PUBLIC,anon,authenticated,service_role;

-- Closing a joined account removes live group links. Its verified closer / paid-PIX
-- requester retains receipt access to that account only, while still active staff.
CREATE FUNCTION public._receipt_staff_account_access(p_tab uuid,p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.dining_tabs tb WHERE tb.id=p_tab
   AND public._tab_pix_staff(p_user,tb.tenant_id)
   AND (NOT EXISTS(SELECT 1 FROM public.tenant_users tu WHERE tu.user_id=p_user AND tu.tenant_id=tb.tenant_id AND tu.role_id='WAITER' AND tu.status='ACTIVE')
    OR public._waiter_serves_tab(tb.id,p_user)
    OR (tb.status='CLOSED' AND public._store_user_permission(p_user,tb.tenant_id,'waiter')
     AND NOT EXISTS(SELECT 1 FROM public.waiter_profiles wp WHERE wp.user_id=p_user AND wp.tenant_id=tb.tenant_id AND NOT wp.active)
     AND (tb.closed_by=p_user OR EXISTS(SELECT 1 FROM public.tab_pix_charges c
      WHERE c.tenant_id=tb.tenant_id AND c.tab_id=tb.id AND c.created_by=p_user
       AND c.status='paid' AND c.paid_at IS NOT NULL AND NOT c.needs_review
       AND c.amount_cents=public._tab_total_cents(tb.tenant_id,tb.id)))))
 );
$$;
REVOKE ALL ON FUNCTION public._receipt_staff_account_access(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.tab_receipt_target(p_tab uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_email text;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab;
 IF NOT FOUND OR NOT public._receipt_staff_account_access(v_tab.id,auth.uid()) THEN
  RAISE EXCEPTION 'FORBIDDEN: comprovante indisponível.' USING ERRCODE='42501';
 END IF;
 v_email:=public._tab_receipt_email(v_tab.id);
 RETURN jsonb_build_object('exists',v_email IS NOT NULL,'email_masked',public._receipt_mask_email(v_email));
END $$;
REVOKE ALL ON FUNCTION public.tab_receipt_target(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.tab_receipt_target(uuid) TO authenticated;

-- Configuration failures still require the verified staff/account, but consume no send attempt.
CREATE FUNCTION public.authorize_tab_receipt(p_tab uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tab public.dining_tabs; v_total integer;
BEGIN
 SELECT * INTO v_tab FROM public.dining_tabs tb WHERE tb.id=p_tab;
 IF NOT FOUND OR NOT public._receipt_staff_account_access(v_tab.id,p_user) THEN
  RAISE EXCEPTION 'FORBIDDEN: comprovante indisponível.' USING ERRCODE='42501';
 END IF;
 v_total:=public._tab_total_cents(v_tab.tenant_id,v_tab.id);
 IF v_tab.status<>'CLOSED' OR v_total<=0 OR NOT (
  EXISTS(SELECT 1 FROM public.tab_pix_charges c WHERE c.tab_id=v_tab.id AND c.tenant_id=v_tab.tenant_id
   AND c.status='paid' AND c.paid_at IS NOT NULL AND NOT c.needs_review AND c.amount_cents=v_total)
  OR (SELECT COALESCE(sum(p.amount_cents),0) FROM public.tab_payments p
   WHERE p.tab_id=v_tab.id AND p.tenant_id=v_tab.tenant_id AND p.method<>'PIX')=v_total
 ) THEN RAISE EXCEPTION 'Comprovante indisponível.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.authorize_tab_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authorize_tab_receipt(uuid,uuid) TO service_role;

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
 IF NOT FOUND OR NOT public._receipt_staff_account_access(v_tab.id,p_user) THEN
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
   string_agg(DISTINCT p.method::text,' + ' ORDER BY p.method::text),
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
 IF p_override_email IS NOT NULL THEN
  v_email:=lower(btrim(p_override_email));
  IF NOT public._receipt_is_valid_email(p_override_email) THEN
   RAISE EXCEPTION 'INVALID_EMAIL: informe um e-mail válido.' USING ERRCODE='22023';
  END IF;
 ELSE
  v_email:=public._tab_receipt_email(v_tab.id);
  IF v_email IS NULL OR NOT public._receipt_is_valid_email(v_email) THEN RAISE EXCEPTION 'Cliente sem e-mail para comprovante.'; END IF;
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

