-- Restore application together with this rollback. Orders/payment/stock rows are never deleted.
BEGIN;
DROP TRIGGER aa_online_payment_transition_guard ON public.orders;
DROP TRIGGER ab_online_payment_flag_guard ON public.orders;
DROP TRIGGER online_payment_received_notify ON public.orders;
DROP TRIGGER online_payment_received_kitchen ON public.orders;
DO $$
DECLARE t text; r record; a record;
BEGIN
 FOREACH t IN ARRAY ARRAY['order_items','order_status_history','pickup_arrivals','stock_reservations','order_messages','coupon_redemptions',
 'order_item_options','order_payments','inventory_movements','owner_notifications','kitchen_order_signals','audit_logs'] LOOP
   EXECUTE format('DROP POLICY online_payment_gate ON public.%I',t);
 END LOOP;
 FOR r IN SELECT * FROM private.online_payment_gate_policies LOOP
   EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)',r.policyname,r.tablename,r.qual);
 END LOOP;
 -- Drop only the new checkout signatures. No CASCADE: fail safely on unexpected dependencies.
 FOR r IN SELECT * FROM private.online_payment_gate_snapshot WHERE signature<>replacement_signature LOOP
   EXECUTE 'DROP FUNCTION '||r.replacement_signature;
 END LOOP;
 FOR r IN SELECT * FROM private.online_payment_gate_snapshot ORDER BY signature LOOP
   EXECUTE r.definition;
   IF r.signature<>r.replacement_signature THEN
     EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
     FOR a IN SELECT * FROM aclexplode(coalesce(r.acl,acldefault('f',r.owner_id))) LOOP
       EXECUTE format('GRANT %s ON FUNCTION %s TO %s%s',a.privilege_type,r.signature,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
       CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
     END LOOP;
   END IF;
 END LOOP;
END $$;
DROP FUNCTION public._kitchen_order_payment_visible(uuid),public._online_payment_transition_guard(),public._assert_online_payment_ready(uuid),
 public.list_payments_to_confirm(uuid),public.confirm_pending_online_payment(uuid,integer),public.expire_unpaid_online_orders();
ALTER TABLE public.orders DROP COLUMN awaiting_online_payment;
DROP TABLE private.online_payment_gate_snapshot,private.online_payment_gate_policies;
NOTIFY pgrst,'reload schema';
COMMIT;
