-- 20261026004400 — Libera o entregador quando o pedido dele termina sem entrega.
-- Bug: cancelar (manual ou expiração do PR #12) ou desatribuir um pedido com entregador deixava
-- drivers.status = 'ON_DELIVERY' para sempre; ele sumia do despacho e set_my_availability recusava.
-- Regra: ON_DELIVERY -> AVAILABLE somente se ele não tiver outro pedido ativo na mesma loja.
-- Não apaga nada; não altera SUSPENDED/UNAVAILABLE; backfill só para linhas na mesma condição exata.
BEGIN;

CREATE OR REPLACE FUNCTION public._release_driver_if_idle(p_tenant_id uuid, p_driver uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  UPDATE public.drivers d SET status = 'AVAILABLE', updated_at = now()
   WHERE d.tenant_id = p_tenant_id AND d.user_id = p_driver AND d.status = 'ON_DELIVERY'
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = p_tenant_id AND o.driver_id = p_driver
                       AND o.status IN ('READY','WAITING_FOR_DRIVER','OUT_FOR_DELIVERY'));
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public._release_driver_if_idle(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._orders_release_driver() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.driver_id IS NOT NULL AND (
       (NEW.status IN ('CANCELLED','DELIVERED') AND OLD.status IS DISTINCT FROM NEW.status)
       OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    PERFORM public._release_driver_if_idle(OLD.tenant_id, OLD.driver_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._orders_release_driver() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER orders_release_driver AFTER UPDATE OF status, driver_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public._orders_release_driver();

-- Backfill: entregadores presos (ON_DELIVERY sem nenhum pedido ativo).
DO $$ DECLARE r record; total integer := 0;
BEGIN
  FOR r IN SELECT tenant_id, user_id FROM public.drivers WHERE status = 'ON_DELIVERY' LOOP
    total := total + public._release_driver_if_idle(r.tenant_id, r.user_id);
  END LOOP;
  RAISE NOTICE 'RELEASED_DRIVERS=%', total;
END $$;
COMMIT;
