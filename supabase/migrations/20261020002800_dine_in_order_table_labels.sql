BEGIN;

CREATE OR REPLACE FUNCTION public.get_dine_in_order_table_labels(
  p_tenant_id uuid,
  p_order_ids uuid[]
)
RETURNS TABLE(order_id uuid, table_label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_ceo(auth.uid()) OR
    public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'])
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: acesso negado aos rótulos das mesas.' USING ERRCODE = '42501';
  END IF;

  IF cardinality(p_order_ids) > 500 THEN
    RAISE EXCEPTION 'TOO_MANY_ORDERS: máximo de 500 pedidos por consulta.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT o.id, dt.label
  FROM public.orders o
  JOIN public.dining_tabs tb ON tb.id = o.tab_id AND tb.tenant_id = o.tenant_id
  JOIN public.dining_tables dt ON dt.id = tb.table_id AND dt.tenant_id = tb.tenant_id
  WHERE o.tenant_id = p_tenant_id
    AND o.fulfillment_type = 'DINE_IN'
    AND o.id = ANY(COALESCE(p_order_ids, ARRAY[]::uuid[]));
END;
$$;

REVOKE ALL ON FUNCTION public.get_dine_in_order_table_labels(uuid, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_dine_in_order_table_labels(uuid, uuid[]) TO authenticated;

COMMIT;
