-- Reversão exata somente antes de personalizar o cardápio; jamais descarta design em uso.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_settings WHERE menu_theme IS DISTINCT FROM public._menu_theme_default()) THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve o Design do Cardápio personalizado antes de reverter.';
 END IF;
END $$;
DO $$ DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega2_menu_theme_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP FUNCTION public.set_menu_theme(uuid,jsonb);
DROP FUNCTION public.get_menu_theme(uuid);
DROP TRIGGER menu_theme_write_guard ON public.tenant_settings;
DROP FUNCTION public._menu_theme_write_guard();
ALTER TABLE public.tenant_settings DROP CONSTRAINT tenant_settings_menu_theme_valid;
ALTER TABLE public.tenant_settings DROP COLUMN menu_theme;
DROP FUNCTION public._menu_theme_public(jsonb);
DROP FUNCTION public._menu_theme_valid(jsonb);
DROP FUNCTION public._menu_theme_default();
DROP TABLE public._entrega2_menu_theme_restore;
NOTIFY pgrst,'reload schema';
COMMIT;
