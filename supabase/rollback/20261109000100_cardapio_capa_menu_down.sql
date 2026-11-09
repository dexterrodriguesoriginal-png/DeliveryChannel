-- Reversão de 20261109000100_cardapio_capa_menu.
-- Recusa se alguma loja já personalizou capa ou menu (preserva dados).
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_settings WHERE menu_cover_url IS NOT NULL OR menu_category_mode <> 'ICON') THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: existem capas/menus personalizados; reversão recusada para preservar os dados.';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.get_public_menu_header(text);
DROP FUNCTION IF EXISTS public.set_menu_header(uuid,text,text);
DROP FUNCTION IF EXISTS public.get_menu_header(uuid);
DROP TRIGGER IF EXISTS menu_cover_write_guard ON public.tenant_settings;
DROP FUNCTION IF EXISTS public._menu_cover_write_guard();
ALTER TABLE public.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_menu_cover_url_valid;
ALTER TABLE public.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_menu_category_mode_valid;
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS menu_cover_url;
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS menu_category_mode;
DROP FUNCTION IF EXISTS public._menu_cover_url_valid(uuid,text);
NOTIFY pgrst,'reload schema';
COMMIT;
