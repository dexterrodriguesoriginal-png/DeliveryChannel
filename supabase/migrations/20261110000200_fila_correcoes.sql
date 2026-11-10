-- Correções da fila: agrega CARD_VIEW/CARD_CLICK na RPC N5 existente.
-- Adição não destrutiva; não aplicar automaticamente em staging/produção.
CREATE OR REPLACE FUNCTION public.get_promo_offer_performance(p_tenant_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR NOT public.is_tenant_owner_or_manager(p_tenant_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: sem permissão para o desempenho desta loja.' USING ERRCODE = '42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' THEN
        RAISE EXCEPTION 'INVALID_PERIOD: período inválido (máximo 400 dias).';
    END IF;

    WITH o AS (
        SELECT od.id, od.offer_id, od.created_at,
               (od.status <> 'CANCELLED' AND od.payment_status <> 'REFUNDED') AS valid,
               GREATEST(od.total_amount - od.delivery_fee, 0) AS revenue
        FROM public.orders od
        JOIN public.offers f ON f.id = od.offer_id AND f.tenant_id = od.tenant_id
        WHERE od.tenant_id = p_tenant_id AND od.offer_id IS NOT NULL
          AND od.created_at >= p_from AND od.created_at < p_to
    ), it AS (
        SELECT o.id AS order_id,
               COALESCE(sum(oi.quantity) FILTER (WHERE oi.item_kind = 'OFFER'), 0) AS units,
               COALESCE(sum(GREATEST(COALESCE(oi.original_unit_price, oi.unit_price) - oi.unit_price, 0) * oi.quantity
                            + oi.discount_amount), 0) AS discount
        FROM o JOIN public.order_items oi ON oi.order_id = o.id AND oi.offer_id = o.offer_id
        WHERE o.valid
        GROUP BY o.id
    ), agg AS (
        SELECT o.offer_id,
               count(*) FILTER (WHERE o.valid) AS valid_orders,
               count(*) FILTER (WHERE NOT o.valid) AS invalidated_orders,
               COALESCE(sum(o.revenue) FILTER (WHERE o.valid), 0) AS revenue,
               COALESCE(sum(it.units), 0) AS redeemed_units,
               COALESCE(sum(it.discount), 0) AS discount
        FROM o LEFT JOIN it ON it.order_id = o.id
        GROUP BY o.offer_id
    ), last_sale AS (
        SELECT od.offer_id, max(od.created_at) AS last_valid_order_at
        FROM public.orders od
        WHERE od.tenant_id = p_tenant_id AND od.offer_id IS NOT NULL
          AND od.status <> 'CANCELLED' AND od.payment_status <> 'REFUNDED'
        GROUP BY od.offer_id
    ), event_counts AS (
        SELECT e.offer_id,
               count(*) FILTER (WHERE e.event_type = 'CARD_VIEW') AS card_views,
               count(*) FILTER (WHERE e.event_type = 'CARD_CLICK') AS card_clicks
        FROM public.campaign_analytics_events e
        WHERE e.tenant_id = p_tenant_id AND e.source = 'CLIENT'
          AND e.offer_id IS NOT NULL
          AND e.event_type IN ('CARD_VIEW', 'CARD_CLICK')
          AND e.occurred_at >= p_from AND e.occurred_at < p_to
        GROUP BY e.offer_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'offer_id', f.id,
               'card_views', COALESCE(ev.card_views, 0),
               'card_clicks', COALESCE(ev.card_clicks, 0),
               'valid_orders', COALESCE(a.valid_orders, 0),
               'invalidated_orders', COALESCE(a.invalidated_orders, 0),
               'revenue', round(COALESCE(a.revenue, 0), 2),
               'redeemed_units', COALESCE(a.redeemed_units, 0),
               'discount', round(COALESCE(a.discount, 0), 2),
               'last_valid_order_at', l.last_valid_order_at) ORDER BY f.id), '[]'::jsonb)
    INTO v_rows
    FROM public.offers f
    LEFT JOIN agg a ON a.offer_id = f.id
    LEFT JOIN last_sale l ON l.offer_id = f.id
    LEFT JOIN event_counts ev ON ev.offer_id = f.id
    WHERE f.tenant_id = p_tenant_id;

    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'from', p_from, 'to', p_to,
                              'attribution', 'orders.offer_id (servidor)', 'revenue_rule', 'total_amount - delivery_fee',
                              'rows', v_rows);
END;
$$;
