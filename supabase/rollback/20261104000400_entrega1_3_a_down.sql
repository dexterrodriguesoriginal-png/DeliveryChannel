-- Rollback exato de A: restaura definições e ACL capturadas antes do apply.
BEGIN;
DROP TRIGGER salon_order_pickup_call ON public.orders;
DROP FUNCTION public._salon_order_pickup_call();
ALTER TABLE public.waiter_calls DROP COLUMN order_id;
DO $$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_3_a_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP TABLE public._entrega1_3_a_restore;
COMMIT;

