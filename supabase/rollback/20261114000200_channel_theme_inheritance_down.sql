-- Restore the exact definitions captured before inheritance was installed.
BEGIN;
DO $$
DECLARE saved record;
BEGIN
 IF (SELECT count(*) FROM public._channel_theme_20261114000200_restore) <> 10 THEN
  RAISE EXCEPTION 'CHANNEL_THEME_ROLLBACK_SNAPSHOT_INCOMPLETE';
 END IF;
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
