-- Rollback C: restaura exatamente a listagem anterior e remove os objetos novos.
BEGIN;
DROP FUNCTION public.salon_night_stats(uuid);
DROP TRIGGER salon_track_opening ON public.tenant_settings;
DROP FUNCTION public._salon_track_opening();
ALTER TABLE public.tenant_settings DROP COLUMN salon_opened_at;

DROP FUNCTION public.resend_team_invite(uuid);
DO $$
DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega1_1_c_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP TABLE public._entrega1_1_c_restore;
COMMIT;
