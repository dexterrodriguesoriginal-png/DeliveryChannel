-- Retira a funcionalidade, preservando todos os pedidos e a auditoria.
-- A proibição de exclusão permanece intencionalmente: rollback não reabre DELETE.
BEGIN;
DROP FUNCTION public.archive_orders(uuid[], boolean);
DROP INDEX public.orders_tenant_archived_at_idx;
ALTER TABLE public.orders DROP CONSTRAINT orders_archive_state,
  DROP COLUMN archived_at, DROP COLUMN archived_by;
CREATE OR REPLACE FUNCTION public._orders_protect_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_mutable TEXT[] := ARRAY['status','payment_status','driver_id','notes','updated_at','driver_accepted_at','picked_up_at','delivered_at'];
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

COMMIT;
