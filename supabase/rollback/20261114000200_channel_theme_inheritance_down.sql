-- Restore the exact definitions captured before inheritance was installed.
BEGIN;
DO $$
DECLARE saved record;
BEGIN
 IF (SELECT count(*) FROM public._channel_theme_20261114000200_restore) <> 10 THEN
  RAISE EXCEPTION 'CHANNEL_THEME_ROLLBACK_SNAPSHOT_INCOMPLETE';
 END IF;
 -- Normalize while the upgraded validators still accept the stored documents.
 -- Migration writes span tenants and must not require a tenant manager session.
 ALTER TABLE public.tenant_settings DISABLE TRIGGER menu_theme_write_guard;
 ALTER TABLE public.tenant_settings DISABLE TRIGGER totem_design_write_guard;
 UPDATE public.tenant_settings
 SET menu_theme = menu_theme - 'followApp' - 'templateId',
     totem_design = totem_design - 'followApp' - 'templateId' - 'fontFamily'
 WHERE menu_theme ?| ARRAY['followApp','templateId']
    OR totem_design ?| ARRAY['followApp','templateId','fontFamily'];
 ALTER TABLE public.tenant_settings ENABLE TRIGGER menu_theme_write_guard;
 ALTER TABLE public.tenant_settings ENABLE TRIGGER totem_design_write_guard;
 FOR saved IN SELECT definition FROM public._channel_theme_20261114000200_restore ORDER BY signature LOOP
  EXECUTE saved.definition;
 END LOOP;
END $$;
-- RESTRICT (the default) deliberately aborts if a later migration depends on these.
DROP FUNCTION public._channel_menu_theme(uuid), public._channel_totem_design(uuid), public._channel_contrast(text,text);
ALTER TABLE public.tenants DROP COLUMN channel_theme_default;
DROP TABLE public._channel_theme_20261114000200_restore;
NOTIFY pgrst,'reload schema';
COMMIT;
