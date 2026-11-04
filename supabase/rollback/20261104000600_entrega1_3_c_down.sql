-- Rollback exato de C: restaura definições e ACL capturadas antes do apply e remove tabelas/funções de C.
BEGIN;
DO $$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_3_c_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;

DROP TRIGGER salon_order_create_delivery_code ON public.orders;
DROP FUNCTION public.waiter_mark_delivered(uuid,text);
DROP FUNCTION public._salon_order_create_delivery_code();
DROP FUNCTION public.set_salon_delivery_code_required(uuid,boolean);
DROP FUNCTION public._salon_delivery_code_required(uuid);
DROP FUNCTION public.staff_separate_table(uuid,uuid);
DROP FUNCTION public.staff_join_tables(uuid[]);
DROP FUNCTION public.customer_move_table(uuid,uuid,text);
DROP FUNCTION public.list_free_tables_for_session(uuid);
DROP FUNCTION public._table_active_tab(uuid,uuid);

DROP TABLE public.salon_order_delivery_codes;
DROP TABLE public.tab_table_moves;
DROP TABLE public.dining_tab_tables;

DELETE FROM public.owner_notifications WHERE kind='TABLE_MOVED';
ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED','ORDER_DELIVERY_DISPUTE'));

DROP TABLE public._entrega1_3_c_restore;
COMMIT;
