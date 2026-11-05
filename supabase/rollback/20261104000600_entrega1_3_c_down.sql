-- Rollback exato de C: restaura definições e ACL capturadas antes do apply e remove tabelas/funções de C.
BEGIN;
DO $$ BEGIN
 IF EXISTS(
  SELECT 1 FROM (SELECT tenant_id,config FROM public.tenant_modules WHERE module_key='dine_in') m
  FULL JOIN public._entrega1_3_c_code_settings_restore r USING(tenant_id)
  WHERE COALESCE(m.config ? 'require_delivery_code',false) IS DISTINCT FROM COALESCE(r.has_key,false)
   OR m.config->'require_delivery_code' IS DISTINCT FROM r.setting
 ) THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve/restaure a configuração de código antes do rollback.'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tab_table_moves) OR EXISTS(SELECT 1 FROM public.dining_tab_tables)
 OR EXISTS(SELECT 1 FROM public.salon_order_delivery_codes)
 OR EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='TABLE_MOVED') THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve/arquive o histórico de mudanças e códigos de entrega antes do rollback.';
 END IF;
END $$;
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

DROP TRIGGER salon_delivery_code_order_guard ON public.orders;
DROP FUNCTION public._salon_delivery_code_order_guard();
DROP TRIGGER salon_delivery_code_setting_guard ON public.tenant_modules;
DROP FUNCTION public._salon_delivery_code_setting_guard();
DROP FUNCTION public.salon_delivery_states(uuid,uuid[]);
DROP TRIGGER salon_order_create_delivery_code ON public.orders;
DROP FUNCTION public.waiter_mark_delivered(uuid,text);
DROP FUNCTION public._salon_order_create_delivery_code();
DROP FUNCTION public.set_salon_delivery_code_required(uuid,boolean);
DROP FUNCTION public._salon_delivery_code_required(uuid);
DROP FUNCTION public.staff_separate_table(uuid,uuid);
DROP FUNCTION public.staff_join_tables(uuid[]);
DROP FUNCTION public.staff_join_tables(uuid[],boolean);
DROP FUNCTION public.staff_submit_table_round(uuid,jsonb,uuid);
DROP FUNCTION public.customer_move_table(uuid,uuid,text);
DROP FUNCTION public.list_free_tables_for_session(uuid);
DROP FUNCTION public._table_active_tab(uuid,uuid);

DROP TRIGGER salon_session_seat ON public.tab_sessions;
DROP TRIGGER salon_order_seat ON public.orders;
DROP TRIGGER salon_call_transfer_route ON public.waiter_calls;
DROP FUNCTION public._salon_transfer_account(uuid,uuid,uuid,uuid);
DROP FUNCTION public._salon_table_notice(uuid,uuid,text,text,uuid,text,text,jsonb);
DROP FUNCTION public._salon_assert_changeable(uuid);
DROP FUNCTION public._salon_assert_staff(uuid,uuid);
DROP FUNCTION public._salon_record_seat();
DROP FUNCTION public._salon_place_session(uuid,uuid);
DROP FUNCTION public._salon_transfer_allowed(uuid,uuid,uuid);
DROP FUNCTION public._salon_tab_for_table(uuid);
DROP FUNCTION public._salon_lock_tenant(uuid);
DROP TABLE public._salon_account_transfers;
DROP TABLE public._salon_session_seats;
DROP TABLE public._salon_order_seats;
DROP TABLE public.salon_order_delivery_codes;
DROP TABLE public.tab_table_moves;
DROP TABLE public.dining_tab_tables;
DROP FUNCTION public._salon_can_read_tab(uuid,uuid);

-- Nunca apaga notificações de mudanças; o guard exige arquivamento antes da reversão.
ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE','TAB_REOPENED','ORDER_DELIVERY_DISPUTE'));

DROP TABLE public._entrega1_3_c_code_settings_restore;
DROP TABLE public._entrega1_3_c_restore;
COMMIT;

