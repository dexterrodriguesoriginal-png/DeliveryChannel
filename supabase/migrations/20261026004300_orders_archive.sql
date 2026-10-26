-- Arquivamento é apenas organização da tela Pedidos. Não filtrar relatórios/CRM por archived_at.
BEGIN;
ALTER TABLE public.orders
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid,
  ADD CONSTRAINT orders_archive_state CHECK (
    (archived_at IS NULL AND archived_by IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND status IN ('CANCELLED','DELIVERED'))
  );
-- archived_by não usa FK: a remoção de uma conta não deve apagar a autoria da auditoria.
COMMENT ON COLUMN public.orders.archived_at IS 'Organização da tela Pedidos; não altera faturamento, relatórios ou histórico.';
CREATE INDEX orders_tenant_archived_at_idx ON public.orders (tenant_id, archived_at);

CREATE OR REPLACE FUNCTION public._orders_protect_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_mutable TEXT[] := ARRAY['status','payment_status','driver_id','notes','updated_at','driver_accepted_at','picked_up_at','delivered_at','archived_at','archived_by'];
    -- Referências que FKs com ON DELETE SET NULL podem anular (ex.: exclusão de cliente, campanha).
    -- Só a transição para NULL é aceita; trocar por outro valor continua proibido.
    v_nullable_refs TEXT[] := ARRAY['customer_id','coupon_id','campaign_id','card_id','offer_id'];
    v_old JSONB := to_jsonb(OLD) - v_mutable;
    v_new JSONB := to_jsonb(NEW) - v_mutable;
    v_key TEXT;
BEGIN
    FOREACH v_key IN ARRAY v_nullable_refs LOOP
        IF v_new ? v_key AND (v_new -> v_key) = 'null'::jsonb THEN
            v_old := v_old - v_key;
            v_new := v_new - v_key;
        END IF;
    END LOOP;
    v_key := NULL;
    IF v_old IS DISTINCT FROM v_new THEN
        SELECT k INTO v_key FROM jsonb_object_keys(v_old || v_new) k
        WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k) LIMIT 1;
        RAISE EXCEPTION 'ORDER_FIELD_IMMUTABLE: o campo "%" do pedido é protegido e não pode ser alterado após a criação.', v_key
            USING ERRCODE = '42501';
    END IF;
    -- F5: pedido cancelado é terminal
    IF OLD.status = 'CANCELLED' AND NEW.status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'ORDER_CANCELLED_IS_FINAL: pedido cancelado não pode ser reaberto.' USING ERRCODE = '42501';
    END IF;
    -- REFUNDED é terminal
    IF OLD.payment_status = 'REFUNDED' AND NEW.payment_status IS DISTINCT FROM 'REFUNDED' THEN
        RAISE EXCEPTION 'ORDER_REFUND_IS_FINAL: pagamento estornado não pode voltar a outro status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- Encerra também o antigo caminho de exclusão de cancelados (incluindo cascatas).
REVOKE DELETE ON public.orders FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS orders_admin_delete ON public.orders;
CREATE OR REPLACE FUNCTION public._orders_before_delete_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'ORDER_DELETE_FORBIDDEN: pedidos devem ser arquivados, nunca excluídos.' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public._orders_before_delete_guard() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.archive_orders(p_order_ids uuid[], p_archive boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_ids uuid[];
  v_tenant uuid;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: autenticação obrigatória.' USING ERRCODE = '42501';
  END IF;
  IF p_archive IS NULL OR p_order_ids IS NULL OR cardinality(p_order_ids) = 0
     OR array_position(p_order_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_ORDER_IDS: selecione pedidos válidos.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids FROM unnest(p_order_ids) AS ids(id);
  -- Ordem determinística dos locks; valida todo o lote antes de escrever.
  FOR v_order IN SELECT o.* FROM public.orders o WHERE o.id = ANY(v_ids) ORDER BY o.id FOR UPDATE LOOP
    IF COALESCE(public._tenant_role_of_caller(v_order.tenant_id), '') NOT IN ('OWNER','MANAGER')
       OR (v_tenant IS NOT NULL AND v_tenant <> v_order.tenant_id) THEN
      RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado ou sem permissão.' USING ERRCODE = '42501';
    END IF;
    v_tenant := v_order.tenant_id;
    IF v_order.status NOT IN ('CANCELLED','DELIVERED') THEN
      RAISE EXCEPTION 'ORDER_ARCHIVE_STATUS: somente pedidos cancelados ou entregues podem ser arquivados.' USING ERRCODE = '42501';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: pedido não encontrado ou sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_count := 0;
  FOR v_order IN SELECT o.* FROM public.orders o
    WHERE o.id = ANY(v_ids) AND (o.archived_at IS NOT NULL) IS DISTINCT FROM p_archive ORDER BY o.id LOOP
    UPDATE public.orders SET archived_at = CASE WHEN p_archive THEN now() ELSE NULL END,
      archived_by = CASE WHEN p_archive THEN auth.uid() ELSE NULL END, updated_at = now()
    WHERE id = v_order.id;
    PERFORM public.log_audit_event(
      CASE WHEN p_archive THEN 'ORDER_ARCHIVED' ELSE 'ORDER_UNARCHIVED' END,
      'orders', 'Organização da tela de pedidos', v_order.id::text,
      jsonb_build_object('archived_at', v_order.archived_at, 'archived_by', v_order.archived_by)::text,
      jsonb_build_object('archived', p_archive, 'actor', auth.uid())::text, v_order.tenant_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_orders(uuid[], boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_orders(uuid[], boolean) TO authenticated;
COMMIT;
