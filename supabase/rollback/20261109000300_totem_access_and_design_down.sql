-- Reversão de 20261109000300_totem_access_and_design.
-- Recusa se já houver usuários, dispositivos, design salvo ou pedidos do totem.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.totem_users') IS NOT NULL AND EXISTS (SELECT 1 FROM public.totem_users) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: existem usuários do totem; reversão recusada para preservar os dados.';
  END IF;
  IF to_regclass('public.totem_devices') IS NOT NULL AND EXISTS (SELECT 1 FROM public.totem_devices) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: existem dispositivos de totem; reversão recusada para preservar os dados.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_settings WHERE totem_design IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: existem designs de totem configurados; reversão recusada para preservar os dados.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='orders' AND column_name='totem_device_id'
  ) AND EXISTS (SELECT 1 FROM public.orders WHERE totem_device_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: existem pedidos do totem; reversão recusada para preservar os dados.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.create_totem_order(text,jsonb,uuid);
DROP FUNCTION IF EXISTS public.get_totem_store(text);
DROP FUNCTION IF EXISTS public.totem_current_device(text);
DROP FUNCTION IF EXISTS public._totem_device_ok(text);
DROP FUNCTION IF EXISTS public.totem_activate_as_staff(text,text);
DROP FUNCTION IF EXISTS public.totem_activate(text,text,text,text,boolean,text);
DROP FUNCTION IF EXISTS public.admin_revoke_totem_device(uuid,uuid);
DROP FUNCTION IF EXISTS public.admin_list_totem_devices(uuid);
DROP FUNCTION IF EXISTS public.admin_set_totem_user_active(uuid,uuid,boolean);
DROP FUNCTION IF EXISTS public.admin_set_totem_user_password(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.admin_list_totem_users(uuid);
DROP FUNCTION IF EXISTS public.admin_create_totem_user(uuid,text,text,text);
DROP FUNCTION IF EXISTS public.get_public_totem_login(text);
DROP FUNCTION IF EXISTS public.set_totem_design(uuid,jsonb);
DROP FUNCTION IF EXISTS public.get_totem_design(uuid);
DROP TRIGGER IF EXISTS totem_design_write_guard ON public.tenant_settings;
DROP FUNCTION IF EXISTS public._totem_design_write_guard();
ALTER TABLE public.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_totem_design_valid;
ALTER TABLE public.tenant_settings DROP COLUMN IF EXISTS totem_design;
DROP FUNCTION IF EXISTS public._totem_design_valid(jsonb);
DROP FUNCTION IF EXISTS public._totem_design_default();
DROP FUNCTION IF EXISTS public._totem_require_manager(uuid);
DROP FUNCTION IF EXISTS public._totem_manager(uuid);
DROP FUNCTION IF EXISTS public._totem_token_hash(text);
DROP FUNCTION IF EXISTS public._totem_new_token();
DROP FUNCTION IF EXISTS public._totem_password_matches(text,text);
DROP FUNCTION IF EXISTS public._totem_password_hash(text);
ALTER TABLE public.orders DROP COLUMN IF EXISTS totem_device_id;
DROP TABLE IF EXISTS public.totem_devices;
DROP TABLE IF EXISTS public.totem_users;
NOTIFY pgrst, 'reload schema';
COMMIT;
