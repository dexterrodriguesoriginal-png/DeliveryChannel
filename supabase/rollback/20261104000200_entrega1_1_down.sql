-- Rollback B; delivered_at continua pertencendo ao baseline do despacho.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.order_delivery_disputes) OR EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='ORDER_DELIVERY_DISPUTE') THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: há contestações de entrega; arquive os registros antes do rollback.';
 END IF;
END $$;
DROP TRIGGER delivery_dispute_tracking ON public.order_delivery_disputes;
DROP TRIGGER delivery_order_tracking ON public.orders;
DROP FUNCTION public._delivery_dispute_tracking_signal();
DROP FUNCTION public.list_open_delivery_disputes(uuid);
DROP FUNCTION public.resolve_delivery_dispute(uuid,text);
DROP FUNCTION public.customer_dispute_delivery(uuid,uuid);
DROP FUNCTION public.waiter_mark_delivered(uuid);
-- Remove também a FK composta ON DELETE CASCADE. Não recria RESTRICT em
-- uma tabela da Parte B que deixa de existir; a proteção de pedidos é preservada.
DROP TABLE public.order_delivery_disputes;
DROP FUNCTION public._can_manage_delivery_dispute(uuid);
DO $$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_1_b_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
ALTER TABLE public.orders DROP COLUMN delivered_by;
ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED'));
DROP TABLE public._entrega1_1_b_restore;
COMMIT;
