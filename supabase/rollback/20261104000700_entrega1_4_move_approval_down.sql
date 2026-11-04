-- Reversão sem apagar histórico de solicitações nem retirar silenciosamente uma permissão em uso.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.table_move_requests) OR EXISTS(SELECT 1 FROM public.waiter_service_settings WHERE allow_waiter_table_move_approval) THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve/arquive as solicitações e desative a autorização do garçom antes do rollback.';
 END IF;
END $$;
DROP POLICY table_move_requests_read ON public.table_move_requests;
DROP FUNCTION public.resolve_table_move_request(uuid,boolean);
DROP FUNCTION public.list_my_table_move_requests(uuid);
DROP FUNCTION public.list_table_move_requests(uuid);
DROP TABLE public.table_move_requests;
DROP FUNCTION public._salon_owns_move_session(uuid,uuid,uuid);
DROP FUNCTION public._salon_can_approve_table_move(uuid,uuid);
DROP FUNCTION public.set_waiter_table_move_approval(uuid,boolean);
DROP TRIGGER salon_move_setting_guard ON public.waiter_service_settings;
DROP FUNCTION public._salon_move_setting_guard();
ALTER TABLE public.waiter_service_settings DROP COLUMN allow_waiter_table_move_approval;
DO $$ DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_4_move_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP TABLE public._entrega1_4_move_restore;
COMMIT;
