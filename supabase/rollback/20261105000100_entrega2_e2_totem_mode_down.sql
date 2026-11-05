-- Reversão exata somente antes de ativar o modo totem; jamais descarta configuração em uso.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_settings WHERE menu_options IS DISTINCT FROM public._menu_options_default()) THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: preserve as opções do cardápio configuradas antes de reverter.';
 END IF;
END $$;
DO $$ DECLARE r record; a jsonb;
BEGIN
 FOR r IN SELECT * FROM public._entrega2_menu_options_restore LOOP
  EXECUTE r.definition;
  EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role';
  FOR a IN SELECT * FROM jsonb_array_elements(r.acl) LOOP
   EXECUTE 'GRANT '||(a->>'privilege')||' ON FUNCTION '||r.signature||' TO '||CASE WHEN a->>'grantee'='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(a->>'grantee') END||CASE WHEN (a->>'grantable')::boolean THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
 END LOOP;
END $$;
DROP FUNCTION public.set_menu_options(uuid,jsonb);
DROP FUNCTION public.get_menu_options(uuid);
DROP TRIGGER menu_options_write_guard ON public.tenant_settings;
DROP FUNCTION public._menu_options_write_guard();
ALTER TABLE public.tenant_settings DROP CONSTRAINT tenant_settings_menu_options_valid;
ALTER TABLE public.tenant_settings DROP COLUMN menu_options;
DROP FUNCTION public._menu_options_public(jsonb);
DROP FUNCTION public._menu_options_valid(jsonb);
DROP FUNCTION public._menu_options_default();
DROP TABLE public._entrega2_menu_options_restore;
NOTIFY pgrst,'reload schema';
COMMIT;
