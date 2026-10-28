-- Reverts 20261027004900_garcom_v2_login_modes_tracking.sql
-- Restaura handle_waiter_call de 20261019002700 e remove objetos do Garçom v2.
-- Dados de contas (auth.users/users/tenant_users) NÃO são apagados; perdem-se apenas perfis, atribuições, presença e colunas de rastreio v2.
BEGIN;

DROP POLICY IF EXISTS waiter_calls_waiter_routing ON public.waiter_calls;

DROP TRIGGER IF EXISTS waiter_calls_route ON public.waiter_calls;
DROP TRIGGER IF EXISTS orders_set_waiter ON public.orders;
DROP TRIGGER IF EXISTS dining_tabs_track_waiter ON public.dining_tabs;
DROP TRIGGER IF EXISTS waiter_profiles_deactivated ON public.waiter_profiles;

DROP FUNCTION IF EXISTS public.waiter_v2_capabilities();
DROP FUNCTION IF EXISTS public.get_my_table_waiter(uuid);
DROP FUNCTION IF EXISTS public.waiter_performance_report(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.waiter_roster(uuid);
DROP FUNCTION IF EXISTS public.waiter_help_table(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.escalate_due_waiter_calls(uuid);
DROP FUNCTION IF EXISTS public.escalate_waiter_call(uuid);
DROP FUNCTION IF EXISTS public.dispatch_waiter_call(uuid, uuid);
DROP FUNCTION IF EXISTS public.accept_waiter_call(uuid);
DROP FUNCTION IF EXISTS public.waiter_go_offline(uuid);
DROP FUNCTION IF EXISTS public.waiter_heartbeat(uuid);
DROP FUNCTION IF EXISTS public.pass_waiter_tables(uuid, uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.assign_waiter_tables(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.set_waiter_service_settings(uuid, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public._waiter_require_manager(uuid);
DROP FUNCTION IF EXISTS public.list_team_directory(uuid);
DROP FUNCTION IF EXISTS public.get_waiter_login_store(text);
DROP FUNCTION IF EXISTS public.waiter_login_check(text, text, text);
DROP FUNCTION IF EXISTS public.waiter_assert_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.waiter_set_active(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.waiter_update_profile(uuid, uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.waiter_provision(uuid, uuid, text, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.waiter_username_state(uuid, text);

-- A função original de handle_waiter_call não depende dos objetos v2.
CREATE OR REPLACE FUNCTION public.handle_waiter_call(p_call_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
BEGIN
  SELECT wc.tenant_id, wc.status
  INTO v_tenant, v_status
  FROM public.waiter_calls wc
  WHERE wc.id = p_call_id
  FOR UPDATE;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'WAITER_CALL_NOT_FOUND: chamado não encontrado.';
  END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_tenant_scoped_role(v_tenant, ARRAY['OWNER', 'MANAGER', 'WAITER', 'CASHIER']) THEN
    RAISE EXCEPTION 'FORBIDDEN: sem permissão para atender este chamado.' USING ERRCODE = '42501';
  END IF;
  IF public._dine_in_config(v_tenant) IS NULL THEN
    RAISE EXCEPTION 'MODULE_DISABLED: salão indisponível.';
  END IF;
  IF v_status <> 'OPEN' THEN
    RAISE EXCEPTION 'WAITER_CALL_NOT_OPEN: chamado não está aberto.';
  END IF;

  UPDATE public.waiter_calls
  SET status = 'HANDLED', handled_by = auth.uid(), handled_at = now()
  WHERE id = p_call_id AND tenant_id = v_tenant AND status = 'OPEN';
END;
$$;
REVOKE ALL ON FUNCTION public.handle_waiter_call(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_waiter_call(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public._waiter_call_visible(uuid, text, uuid, uuid, text, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public._waiter_calls_route();
DROP FUNCTION IF EXISTS public._orders_set_waiter();
DROP FUNCTION IF EXISTS public._dining_tabs_track_waiter();
DROP FUNCTION IF EXISTS public._waiter_profile_deactivated();
DROP FUNCTION IF EXISTS public._waiter_settings(uuid);
DROP FUNCTION IF EXISTS public._waiter_is_active(uuid, uuid);
DROP FUNCTION IF EXISTS public._waiter_is_online(uuid, uuid);

DROP INDEX IF EXISTS public.orders_waiter_idx;
ALTER TABLE public.orders DROP COLUMN IF EXISTS waiter_id;
ALTER TABLE public.dining_tabs DROP COLUMN IF EXISTS closed_by;
ALTER TABLE public.waiter_calls
  DROP COLUMN IF EXISTS escalated_at, DROP COLUMN IF EXISTS dispatched_at, DROP COLUMN IF EXISTS dispatched_by,
  DROP COLUMN IF EXISTS accepted_at, DROP COLUMN IF EXISTS accepted_by, DROP COLUMN IF EXISTS assigned_to,
  DROP COLUMN IF EXISTS route;

DROP TABLE IF EXISTS public.waiter_table_helpers;
DROP TABLE IF EXISTS public.waiter_presence;
DROP TABLE IF EXISTS public.waiter_table_assignments;
DROP TABLE IF EXISTS public.waiter_service_settings;
DROP TABLE IF EXISTS public.waiter_profiles;

-- Bucket de fotos 'waiter-photos': NÃO é removido aqui.
-- O Supabase bloqueia DELETE direto em storage.buckets/storage.objects (storage.protect_delete()).
-- A migration não cria policies em storage.objects; reaplicar é seguro (INSERT ... ON CONFLICT DO NOTHING).
DO $st$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    RAISE NOTICE 'ROLLBACK 20261027004900: bucket waiter-photos mantido. Se quiser removê-lo, use a Storage API (painel do Supabase > Storage, ou supabase.storage.emptyBucket + deleteBucket).';
  END IF;
END
$st$;

COMMIT;
