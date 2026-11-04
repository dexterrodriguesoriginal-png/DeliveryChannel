-- Rollback A: restaura definição/ACL do get_my_tab e elimina apenas estruturas A.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.owner_notifications WHERE kind='TAB_REOPENED') THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: há notificações de reabertura; arquive-as antes do rollback.';
 END IF;
END $$;
DO $$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_1_a_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP FUNCTION public.finish_tab_receipt(uuid,boolean,text);
DROP FUNCTION public.reserve_tab_receipt(uuid,uuid);
DROP FUNCTION public.tab_receipt_target(uuid);
DROP FUNCTION public._tab_receipt_email(uuid);
DROP FUNCTION public._receipt_mask_email(text);
DROP TABLE public.tab_receipt_sends;
DROP FUNCTION public.staff_reopen_tab(uuid);
DROP FUNCTION public.reopen_tab_from_bill(uuid);
DROP FUNCTION public._reopen_tab_from_bill(uuid,uuid,text);
ALTER TABLE public.owner_notifications DROP CONSTRAINT owner_notifications_kind_check;
ALTER TABLE public.owner_notifications ADD CONSTRAINT owner_notifications_kind_check
 CHECK(kind IN ('ORDER_NEW','DRIVER_JOIN_REQUEST','ORDER_MESSAGE'));
DROP TABLE public._entrega1_1_a_restore;
COMMIT;
