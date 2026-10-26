-- Payment visibility is decided at checkout INSERT, before any AFTER trigger/realtime.
-- Rollback retains the exact pre-migration function definitions and ACLs in private.
BEGIN;
ALTER TABLE public.orders ADD COLUMN awaiting_online_payment boolean NOT NULL DEFAULT false;
CREATE INDEX orders_awaiting_online_payment ON public.orders(tenant_id) WHERE awaiting_online_payment;
CREATE TABLE private.online_payment_gate_snapshot (
 signature text PRIMARY KEY, definition text NOT NULL, acl aclitem[], owner_id oid NOT NULL,
 replacement_signature text NOT NULL
);
REVOKE ALL ON private.online_payment_gate_snapshot FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.online_payment_gate_policies AS
 SELECT tablename,policyname,qual,with_check FROM pg_catalog.pg_policies
 WHERE schemaname='public' AND policyname IN ('orders_staff_select','orders_driver_select_assigned');
REVOKE ALL ON private.online_payment_gate_policies FROM PUBLIC,anon,authenticated,service_role;

-- Checked, narrowly scoped edits avoid duplicating thousands of lines of checkout/report logic.
-- Fail closed if a definition differs from the expected base. pg_temp helper is migration-only.
CREATE FUNCTION pg_temp.gate_patch(sig text, old_text text, new_text text, new_sig text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $helper$
DECLARE d text; r record; target text := coalesce(new_sig,sig); a record;
BEGIN
 SELECT pg_get_functiondef(oid) AS def,proacl,proowner INTO STRICT r FROM pg_proc WHERE oid=sig::regprocedure;
 IF strpos(r.def,old_text)=0 THEN RAISE EXCEPTION '04301: unexpected definition: % / %',sig,old_text; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.online_payment_gate_snapshot WHERE replacement_signature=sig) THEN
   INSERT INTO private.online_payment_gate_snapshot VALUES(sig,r.def,r.proacl,r.proowner,target);
 END IF;
 d := replace(r.def,old_text,new_text);
 d := regexp_replace(d, 'SET search_path TO [^\n]+', 'SET search_path TO ''''');
 IF target<>sig THEN EXECUTE 'DROP FUNCTION '||sig; END IF;
 EXECUTE d;
 -- CREATE OR REPLACE keeps ACLs. New signatures inherit the original ACL, not default grants.
 IF target<>sig THEN
   EXECUTE 'REVOKE ALL ON FUNCTION '||target||' FROM PUBLIC,anon,authenticated,service_role';
   FOR a IN SELECT * FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) LOOP
     EXECUTE format('GRANT %s ON FUNCTION %s TO %s%s',a.privilege_type,target,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
       CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
   END LOOP;
 END IF;
END $helper$;

-- Checkout: remove old signatures so PostgREST never sees ambiguous overloads.
SELECT pg_temp.gate_patch('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)',
 'p_customer_email_fallback text DEFAULT NULL::text)',
 'p_customer_email_fallback text DEFAULT NULL::text, p_online_payment boolean DEFAULT false)',
 'public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text,boolean)');
SELECT pg_temp.gate_patch('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text,boolean)',
 'campaign_id, card_id, attribution_source)', 'campaign_id, card_id, attribution_source, awaiting_online_payment)');
SELECT pg_temp.gate_patch('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text,boolean)',
 $edit$WHEN v_coupon_id IS NOT NULL THEN 'COUPON' ELSE 'DIRECT' END)$edit$,
 $edit$WHEN v_coupon_id IS NOT NULL THEN 'COUPON' ELSE 'DIRECT' END, coalesce(p_online_payment,false) OR p_payment_method='PIX')$edit$);

SELECT pg_temp.gate_patch('public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb)',
 'p_items jsonb)', 'p_items jsonb, p_online_payment boolean DEFAULT false)',
 'public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb,boolean)');
SELECT pg_temp.gate_patch('public.process_checkout_atomic(text,character varying,character varying,character varying,text,jsonb,character varying,character varying,text,character varying,jsonb,boolean)',
 'NULL, NULL, NULL, p_customer_email)', 'NULL, NULL, NULL, p_customer_email, p_online_payment)');
DO $block$
DECLARE v text; sig text; target text;
BEGIN
 FOREACH v IN ARRAY ARRAY['process_checkout_atomic_v2','process_checkout_atomic_v3'] LOOP
   sig:='public.'||v||'(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid)';
   target:='public.'||v||'(text,text,text,text,jsonb,text,text,text,jsonb,text,uuid,uuid,boolean)';
   PERFORM pg_temp.gate_patch(sig,'p_card_id uuid DEFAULT NULL::uuid)',
     'p_card_id uuid DEFAULT NULL::uuid, p_online_payment boolean DEFAULT false)',target);
   PERFORM pg_temp.gate_patch(target,'p_coupon_code, p_idempotency_key, p_card_id, NULL',
     'p_coupon_code, p_idempotency_key, p_card_id, NULL, p_online_payment');
 END LOOP;
END $block$;
SELECT pg_temp.gate_patch('public.process_promotional_checkout_atomic(text,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text,text,text,uuid)',
 'p_idempotency_key uuid DEFAULT NULL::uuid)', 'p_idempotency_key uuid DEFAULT NULL::uuid, p_online_payment boolean DEFAULT false)',
 'public.process_promotional_checkout_atomic(text,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text,text,text,uuid,boolean)');
SELECT pg_temp.gate_patch('public.process_promotional_checkout_atomic(text,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text,text,text,uuid,boolean)',
 'attribution_source)', 'attribution_source, awaiting_online_payment)');
SELECT pg_temp.gate_patch('public.process_promotional_checkout_atomic(text,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text,text,text,uuid,boolean)',
 $edit$ELSE 'OFFER' END)$edit$, $edit$ELSE 'OFFER' END, coalesce(p_online_payment,false) OR p_payment_method='PIX')$edit$);

SELECT pg_temp.gate_patch('public._orders_protect_columns()',
 $edit$ARRAY['status','payment_status'$edit$, $edit$ARRAY['awaiting_online_payment','status','payment_status'$edit$);
SELECT pg_temp.gate_patch('public.reserve_order_payment(uuid,uuid,text,text)',
 'SELECT * INTO v_payment FROM public.order_payments WHERE order_id=p_order;',
 $edit$-- Old customers are gated even when replaying an existing reservation. PDV/salon stays unchanged.
 IF v_order.origin<>'pos' AND v_order.fulfillment_type<>'DINE_IN' THEN
   UPDATE public.orders SET awaiting_online_payment=true WHERE id=p_order;
 END IF;
 SELECT * INTO v_payment FROM public.order_payments WHERE order_id=p_order;$edit$);
SELECT pg_temp.gate_patch('public.confirm_order_payment(uuid,jsonb,uuid)',
 $edit$SET payment_status='PAID',updated_at=now()$edit$, $edit$SET payment_status='PAID',awaiting_online_payment=false,updated_at=now()$edit$);

-- An authenticated manual confirmation can release only a charge already marked paid
-- by confirm_order_payment in this transaction. Staff cannot write order_payments.
SELECT pg_temp.gate_patch('public.guard_online_payment_status()',
 $edit$IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN$edit$,
 $edit$IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND NOT (
 NEW.payment_status='PAID' AND public._pr_b_staff(OLD.tenant_id,ARRAY['OWNER','MANAGER']) AND EXISTS(
 SELECT 1 FROM public.order_payments p WHERE p.order_id=OLD.id AND p.tenant_id=OLD.tenant_id
 AND p.provider IN ('manual_pix','infinitepay') AND p.status='paid' AND p.paid_at IS NOT NULL)) THEN$edit$);

-- Existing unpaid orders: flag only. Never change status, timestamps, stock, or delete notices.
UPDATE public.orders o SET awaiting_online_payment=true
 WHERE o.status NOT IN ('DELIVERED','CANCELLED') AND o.origin<>'pos' AND o.fulfillment_type<>'DINE_IN'
 AND o.payment_status NOT IN ('PAID','REFUNDED') AND (
 o.payment_status IN ('PENDING','FAILED','EXPIRED') OR EXISTS(
 SELECT 1 FROM public.order_payments p WHERE p.order_id=o.id AND p.status<>'paid'));

ALTER POLICY orders_staff_select ON public.orders USING (
 NOT awaiting_online_payment AND public._pr_b_staff(tenant_id,ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']));
ALTER POLICY orders_driver_select_assigned ON public.orders USING (
 NOT awaiting_online_payment AND public._pr_b_driver(id));
-- Restrictive policies also cover permissive legacy/CEO policies, while preserving customer access.
DO $block$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['order_items','order_status_history','pickup_arrivals','stock_reservations','order_messages','coupon_redemptions'] LOOP
   EXECUTE format('CREATE POLICY online_payment_gate ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id))',t);
 END LOOP;
END $block$;
CREATE POLICY online_payment_gate ON public.order_item_options AS RESTRICTIVE FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.order_items i WHERE i.id=order_item_id));
CREATE POLICY online_payment_gate ON public.order_payments AS RESTRICTIVE FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id));
CREATE POLICY online_payment_gate ON public.inventory_movements AS RESTRICTIVE FOR SELECT TO authenticated
 USING(order_id IS NULL OR EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id));
CREATE POLICY online_payment_gate ON public.audit_logs AS RESTRICTIVE FOR SELECT TO authenticated
 USING(resource<>'orders' OR resource_id IS NULL OR EXISTS(SELECT 1 FROM public.orders o WHERE o.id::text=resource_id));
CREATE POLICY online_payment_gate ON public.owner_notifications AS RESTRICTIVE FOR SELECT TO authenticated
 USING(kind='DRIVER_JOIN_REQUEST' OR EXISTS(SELECT 1 FROM public.orders o WHERE o.id=ref_id));

CREATE FUNCTION public._kitchen_order_payment_visible(p_order uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.orders o WHERE o.id=p_order AND NOT o.awaiting_online_payment
 AND public._kitchen_can_read_tenant(o.tenant_id));
$$;
REVOKE ALL ON FUNCTION public._kitchen_order_payment_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._kitchen_order_payment_visible(uuid) TO authenticated;
CREATE POLICY online_payment_gate ON public.kitchen_order_signals AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public._kitchen_order_payment_visible(order_id));
CREATE TRIGGER online_payment_received_kitchen AFTER UPDATE OF awaiting_online_payment,payment_status ON public.orders
 FOR EACH ROW WHEN (OLD.awaiting_online_payment AND NOT NEW.awaiting_online_payment)
 EXECUTE FUNCTION public._orders_kitchen_signal();

SELECT pg_temp.gate_patch('public.product_options_can_read_order_item(uuid,uuid)',
 'WHERE oi.id = p_item', $edit$WHERE oi.id = p_item AND (NOT o.awaiting_online_payment OR EXISTS (
 SELECT 1 FROM public.customers c WHERE c.id=o.customer_id AND c.tenant_id=o.tenant_id AND c.user_id=auth.uid()))$edit$);
SELECT pg_temp.gate_patch('public.product_options_can_read_order_item(uuid,uuid)',
 'public.is_ceo(auth.uid())', 'false');
SELECT pg_temp.gate_patch('public._pr_b_driver(uuid)', 'WHERE o.id=p_order', 'WHERE NOT o.awaiting_online_payment AND o.id=p_order');

-- SECURITY DEFINER read paths bypass RLS: filter every order relation in this explicit list.
DO $block$
DECLARE r record;
BEGIN
 FOR r IN SELECT oid,oid::regprocedure::text sig,prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
 'kitchen_list_orders','get_dispatch_queue','get_tenant_financial_summary','get_tenant_reports_summary',
 'get_tenant_customers_summary','get_customer_orders_history','get_campaign_metrics','get_promo_offer_performance',
 'crm_get_overview_metrics','crm_list_customers','crm_export_customers','crm_get_customer_orders',
 'get_dine_in_order_table_labels','list_tenant_driver_locations']) LOOP
   -- PostgreSQL 17 supports derived relations without aliases. Preserve o/od aliases
   -- and bare relations in the original definitions, including same-line WHERE clauses.
   PERFORM pg_temp.gate_patch(r.sig,'public.orders',
     '(SELECT * FROM public.orders WHERE NOT awaiting_online_payment)');
 END LOOP;
END $block$;
SELECT pg_temp.gate_patch('public.get_handoff_status(uuid)',
 'WHERE order_id=p_order_id;', 'WHERE order_id=p_order_id AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=p_order_id AND NOT o.awaiting_online_payment);');
SELECT pg_temp.gate_patch('public.send_order_message(uuid,text)',
 'WHERE id=p_order_id FOR SHARE', 'WHERE id=p_order_id AND NOT awaiting_online_payment FOR SHARE');
SELECT pg_temp.gate_patch('public.reset_handoff_code(uuid,text)',
 'WHERE id=p_order_id FOR UPDATE', 'WHERE id=p_order_id AND NOT awaiting_online_payment FOR UPDATE');
SELECT pg_temp.gate_patch('public.call_pickup(uuid)',
 'WHERE id = p_order_id;', 'WHERE id = p_order_id AND NOT awaiting_online_payment;');
SELECT pg_temp.gate_patch('public._arrival_position(uuid)',
 'WHERE b.tenant_id = a.tenant_id', 'WHERE EXISTS(SELECT 1 FROM public.orders o WHERE o.id=b.order_id AND NOT o.awaiting_online_payment) AND b.tenant_id = a.tenant_id');

-- Early RPC guard returns the same error even when an old/backfilled order is already CONFIRMED.
-- Cross-tenant callers get no payment/existence information.
CREATE FUNCTION public._assert_online_payment_ready(p_order uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF o.awaiting_online_payment AND public._pr_b_staff(o.tenant_id,ARRAY['OWNER','MANAGER','OPERATOR','CASHIER','DELIVERY_MANAGER']) THEN
   RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._assert_online_payment_ready(uuid) FROM PUBLIC,anon,authenticated;
DO $block$
DECLARE r record;
BEGIN
 FOR r IN SELECT oid::regprocedure::text sig FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname=ANY(ARRAY['update_order_status','assign_order_to_driver','confirm_order_pickup','confirm_order_delivery',
 'confirm_handover','kitchen_set_order_status','unassign_order_driver']) LOOP
   PERFORM pg_temp.gate_patch(r.sig,E'BEGIN\n',E'BEGIN\n    PERFORM public._assert_online_payment_ready(p_order_id);\n');
 END LOOP;
END $block$;

-- All UPDATE paths, including direct writes. The old flag prevents clearing+accepting together.
CREATE FUNCTION public._online_payment_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_ARGV[0]='status' AND (OLD.awaiting_online_payment OR NEW.awaiting_online_payment) THEN
   IF NEW.status<>'CANCELLED' THEN RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501'; END IF;
   IF current_setting('role',true) NOT IN ('service_role','none') AND NOT EXISTS(
     SELECT 1 FROM public.customers c WHERE c.id=OLD.customer_id AND c.tenant_id=OLD.tenant_id AND c.user_id=auth.uid()) THEN
     RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
   END IF;
 END IF;
 IF OLD.awaiting_online_payment AND NEW.payment_status='PAID' THEN
   IF OLD.status='CANCELLED' THEN RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501'; END IF;
   -- Provider charges already require service_role via guard_online_payment_status.
   -- Legacy manual PIX may be confirmed only by an active OWNER/MANAGER.
   IF current_setting('role',true) NOT IN ('service_role','none')
     AND NOT (public._pr_b_staff(OLD.tenant_id,ARRAY['OWNER','MANAGER']) AND (
 (OLD.payment_method='PIX' AND NOT EXISTS(SELECT 1 FROM public.order_payments p WHERE p.order_id=OLD.id))
 OR EXISTS(SELECT 1 FROM public.order_payments p WHERE p.order_id=OLD.id AND p.tenant_id=OLD.tenant_id
 AND p.provider IN ('manual_pix','infinitepay') AND p.status='paid'))) THEN
     RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
   END IF;
   NEW.awaiting_online_payment:=false;
 ELSIF OLD.awaiting_online_payment AND NOT NEW.awaiting_online_payment THEN
   RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
 ELSIF NEW.awaiting_online_payment IS DISTINCT FROM OLD.awaiting_online_payment
   AND current_setting('role',true) NOT IN ('service_role','none') THEN
   RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._online_payment_transition_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER aa_online_payment_transition_guard BEFORE UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._online_payment_transition_guard('status');
CREATE TRIGGER ab_online_payment_flag_guard BEFORE UPDATE OF awaiting_online_payment,payment_status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._online_payment_transition_guard('payment');

-- A single transaction releases visibility and produces the original ORDER_NEW notification.
SELECT pg_temp.gate_patch('public._pr_b_notify()',
 $edit$IF TG_TABLE_NAME='orders' THEN$edit$, $edit$IF TG_TABLE_NAME='orders' THEN
 IF NEW.awaiting_online_payment OR NEW.status='CANCELLED' THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='ORDER_NEW' AND ref_id=NEW.id) THEN RETURN NULL; END IF;$edit$);
CREATE TRIGGER online_payment_received_notify AFTER UPDATE OF awaiting_online_payment,payment_status ON public.orders
 FOR EACH ROW WHEN (OLD.awaiting_online_payment AND NOT NEW.awaiting_online_payment)
 EXECUTE FUNCTION public._pr_b_notify();

-- Minimal projection: no order UUID, address, phone, email, items, or provider secrets.
-- Confirmation below resolves the number inside the authenticated tenant, never from a browser tenant claim.
CREATE FUNCTION public.list_payments_to_confirm(p_tenant uuid) RETURNS TABLE (
 order_number integer, amount numeric, method text, created_at timestamptz, customer_first_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public._pr_b_staff(p_tenant,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT o.order_number::integer,o.total_amount::numeric,o.payment_method::text,o.created_at,
 split_part(btrim(o.customer_name),' ',1)
 FROM public.orders o LEFT JOIN public.order_payments p ON p.order_id=o.id AND p.tenant_id=o.tenant_id
 WHERE o.tenant_id=p_tenant AND o.awaiting_online_payment AND o.status NOT IN ('CANCELLED','DELIVERED')
 AND ((p.provider IN ('manual_pix','infinitepay') AND p.status='awaiting_confirmation')
 OR (p.id IS NULL AND o.payment_method='PIX')) ORDER BY o.created_at;
END $$;
CREATE FUNCTION public.confirm_pending_online_payment(p_tenant uuid,p_order_number integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; p public.order_payments;
BEGIN
 IF NOT public._pr_b_staff(p_tenant,ARRAY['OWNER','MANAGER']) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.orders WHERE tenant_id=p_tenant AND order_number=p_order_number FOR UPDATE;
 IF o.id IS NULL OR o.status IN ('CANCELLED','DELIVERED') THEN RAISE EXCEPTION 'PAYMENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.order_payments WHERE order_id=o.id AND tenant_id=p_tenant FOR UPDATE;
 IF p.id IS NOT NULL THEN
   IF p.status='paid' AND o.payment_status='PAID' THEN RETURN; END IF;
   PERFORM public.confirm_order_payment(p.id,'{}'::jsonb,auth.uid());
   RETURN;
 END IF;
 IF o.payment_method='PIX' AND o.payment_status='PAID' AND NOT o.awaiting_online_payment THEN RETURN; END IF;
 IF o.payment_method<>'PIX' OR NOT o.awaiting_online_payment THEN RAISE EXCEPTION 'PAYMENT_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM public.update_order_payment_status(o.id,'PAID','Recebimento conferido pela loja');
END $$;
REVOKE ALL ON FUNCTION public.list_payments_to_confirm(uuid),public.confirm_pending_online_payment(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_payments_to_confirm(uuid),public.confirm_pending_online_payment(uuid,integer) TO authenticated;

CREATE FUNCTION public.expire_unpaid_online_orders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders; n integer:=0;
BEGIN
 FOR o IN SELECT * FROM public.orders x WHERE x.awaiting_online_payment
 AND x.status NOT IN ('CANCELLED','DELIVERED') AND x.payment_status NOT IN ('PAID','REFUNDED')
 AND NOT EXISTS(SELECT 1 FROM public.order_payments p WHERE p.order_id=x.id AND p.status='paid')
 AND (x.created_at<now()-interval '60 minutes' OR EXISTS(
 SELECT 1 FROM public.order_payments p WHERE p.order_id=x.id AND p.status IN ('failed','expired')))
 ORDER BY x.id FOR UPDATE SKIP LOCKED LOOP
   UPDATE public.orders SET status='CANCELLED',notes=concat_ws(' | ',nullif(notes,''),'Pagamento não concluído'),updated_at=now() WHERE id=o.id;
   PERFORM public._restock_order_items(o.id,'Sistema');
   INSERT INTO public.order_status_history(order_id,status,note,changed_by) VALUES(o.id,'CANCELLED','Pagamento não concluído','Sistema');
   PERFORM public.log_audit_event('ONLINE_PAYMENT_EXPIRED','orders','Pagamento não concluído',o.id::text,o.status,'CANCELLED',o.tenant_id);
   n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.expire_unpaid_online_orders() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_online_orders() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
