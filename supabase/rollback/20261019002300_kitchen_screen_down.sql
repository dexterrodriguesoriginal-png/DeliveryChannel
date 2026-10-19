-- Rollback de 20261019002300_kitchen_screen.sql. Remove a Tela da Cozinha e restaura handle_new_auth_user (0004).
-- ATENÇÃO: antes de rodar, DESLIGUE "Allow anonymous sign-ins" no Supabase (sem os bloqueios, anônimo poderia criar pedidos).
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='kitchen_order_signals') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.kitchen_order_signals; END IF; END $$;
DROP TRIGGER IF EXISTS trg_orders_kitchen_signal ON public.orders;
DROP TRIGGER IF EXISTS trg_customers_block_anonymous ON public.customers;
DROP TRIGGER IF EXISTS trg_orders_block_anonymous ON public.orders;
DROP FUNCTION IF EXISTS public.kitchen_set_order_status(uuid, text);
DROP FUNCTION IF EXISTS public.kitchen_list_orders(uuid);
DROP FUNCTION IF EXISTS public._kitchen_resolve_tenant(uuid);
DROP FUNCTION IF EXISTS public.kitchen_lock();
DROP FUNCTION IF EXISTS public.kitchen_unlock(text);
DROP FUNCTION IF EXISTS public.kitchen_get_context(uuid);
DROP FUNCTION IF EXISTS public.redeem_kitchen_pairing_code(text, text, text);
DROP FUNCTION IF EXISTS public.revoke_kitchen_device(uuid);
DROP FUNCTION IF EXISTS public.list_kitchen_devices(uuid);
DROP FUNCTION IF EXISTS public.create_kitchen_pairing_code(uuid, text);
DROP FUNCTION IF EXISTS public.set_kitchen_settings(uuid, boolean, text, boolean);
DROP FUNCTION IF EXISTS public.get_kitchen_settings(uuid);
DROP POLICY IF EXISTS kitchen_signals_select ON public.kitchen_order_signals;
DROP FUNCTION IF EXISTS public._kitchen_can_read_tenant(uuid);
DROP FUNCTION IF EXISTS public._kitchen_device_of_caller();
DROP FUNCTION IF EXISTS public._kitchen_assert_manager(uuid);
DROP FUNCTION IF EXISTS public._kitchen_new_code();
DROP FUNCTION IF EXISTS public._orders_kitchen_signal();
DROP FUNCTION IF EXISTS public._block_anonymous_writes();
DROP TABLE IF EXISTS public.kitchen_order_signals;
DROP TABLE IF EXISTS public.kitchen_devices;
DROP TABLE IF EXISTS public.kitchen_pairing_codes;
DROP TABLE IF EXISTS public.kitchen_settings;
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name pg_catalog.varchar(255);
BEGIN
    -- Validação estrita: email é NOT NULL em public.users
    IF NEW.email IS NULL THEN
        RAISE EXCEPTION 'O e-mail não pode ser nulo para provisionamento de usuário em public.users';
    END IF;

    -- Obtém o nome real a partir de raw_user_meta_data quando disponível
    v_name := COALESCE(
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'full_name',
        pg_catalog.split_part(NEW.email, '@', 1)
    );

    -- Insere ou atualiza de forma idempotente em public.users sincronizando telefone
    INSERT INTO public.users (
        id,
        name,
        email,
        phone,
        avatar_url,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        v_name,
        NEW.email,
        NEW.raw_user_meta_data->>'phone',
        NEW.raw_user_meta_data->>'avatar_url',
        pg_catalog.now(),
        pg_catalog.now()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.users.phone),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
        updated_at = pg_catalog.now();

    RETURN NEW;
END;
$$;
COMMIT;
