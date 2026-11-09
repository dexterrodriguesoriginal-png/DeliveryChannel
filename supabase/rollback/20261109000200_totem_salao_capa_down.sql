-- Reversão de 20261109000200_totem_salao_capa.
-- Recusa se alguma loja já configurou a capa do totem (preserva dados).
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_settings WHERE totem_welcome IS NOT NULL) THEN
  RAISE EXCEPTION 'ROLLBACK_BLOCKED: existem capas de totem configuradas; reversão recusada para preservar os dados.';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.get_public_totem_welcome(text);
DROP FUNCTION IF EXISTS public.set_totem_welcome(uuid,jsonb);
DROP FUNCTION IF EXISTS public.get_totem_welcome(uuid);
DROP TRIGGER IF EXISTS totem_welcome_write_guard ON public.tenant_settings;
DROP FUNCTION IF EXISTS public._totem_welcome_write_guard();
ALTER TABLE public.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_totem_welcome_valid;
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS totem_welcome;
DROP FUNCTION IF EXISTS public._totem_welcome_valid(uuid,jsonb);
DROP FUNCTION IF EXISTS public._totem_welcome_default();
NOTIFY pgrst,'reload schema';
COMMIT;
