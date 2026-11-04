-- Rollback exato de B: restaura definições, ACL e restrição de coluna.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tab_receipt_sends WHERE charge_id IS NULL) THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve/arquive a auditoria dos recibos manuais antes do rollback.';
 END IF;
END $$;
DROP FUNCTION public.reserve_tab_receipt(uuid,uuid,text);
DROP FUNCTION public.authorize_tab_receipt(uuid,uuid);
DROP FUNCTION public._receipt_is_valid_email(text);
DROP FUNCTION public._receipt_staff_account_access(uuid,uuid);
ALTER TABLE public.tab_receipt_sends ALTER COLUMN charge_id SET NOT NULL;
DO $$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_3_b_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP TABLE public._entrega1_3_b_restore;
COMMIT;
