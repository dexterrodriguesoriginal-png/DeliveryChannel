-- 20261018001900_customer_order_driver_location.sql
-- Acompanhamento ao vivo do motoboy pelo CLIENTE, no pedido em rota de entrega.
-- 100% ADITIVA e idempotente: só cria a RPC get_order_driver_location; nenhuma tabela/coluna/dado é alterado.
-- Regras (todas no servidor):
--   * só o dono do pedido (customers.user_id = auth.uid(), mesmo tenant do pedido);
--   * só com o pedido em OUT_FOR_DELIVERY, fulfillment DELIVERY e com entregador atribuído (orders.driver_id);
--   * a posição é a do entregador ATRIBUÍDO àquele pedido (drivers.user_id = orders.driver_id, mesmo tenant);
--   * devolve só posição/rumo/precisão/horário/is_stale (> 2 min). Nenhuma identidade do entregador
--     (nome, telefone, ids) — o app do cliente hoje não expõe o nome do entregador.
--   * caso contrário devolve zero linhas (não diferencia "não é seu" de "ainda não saiu").
-- driver_locations continua sem acesso direto (RLS sem policies, REVOKE ALL).
-- Rollback: supabase/rollback/20261018001900_customer_order_driver_location_down.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.get_order_driver_location(p_order_id uuid)
RETURNS TABLE (lat double precision, lng double precision, heading real, accuracy real,
               recorded_at timestamptz, is_stale boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT l.lat, l.lng, l.heading, l.accuracy_m, l.recorded_at,
           l.recorded_at < now() - interval '2 minutes'
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
    JOIN public.drivers d ON d.user_id = o.driver_id AND d.tenant_id = o.tenant_id
    JOIN public.driver_locations l ON l.driver_id = d.id AND l.tenant_id = o.tenant_id
    WHERE auth.uid() IS NOT NULL
      AND p_order_id IS NOT NULL
      AND o.id = p_order_id
      AND c.user_id = auth.uid()
      AND o.status = 'OUT_FOR_DELIVERY'
      AND o.fulfillment_type = 'DELIVERY'
      AND o.driver_id IS NOT NULL
    LIMIT 1;
$$;
COMMENT ON FUNCTION public.get_order_driver_location(uuid) IS
    '1900: posição do entregador do pedido para o cliente dono, só em OUT_FOR_DELIVERY. Sem identidade do entregador.';
REVOKE ALL ON FUNCTION public.get_order_driver_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_driver_location(uuid) TO authenticated;

COMMIT;
