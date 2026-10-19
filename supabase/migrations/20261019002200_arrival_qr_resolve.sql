-- 20261019002200_arrival_qr_resolve.sql
-- QR de chegada pela câmera comum: /chegada/<código> resolve a loja e os pedidos de retirada abertos DO PRÓPRIO cliente.
-- Opção do dono "Mostrar primeiro nome na TV" (padrão: só código). 100% ADITIVA; nenhum dado alterado/apagado.
-- Rollback: supabase/rollback/20261019002200_arrival_qr_resolve_down.sql
BEGIN;

ALTER TABLE public.store_arrival_qr ADD COLUMN IF NOT EXISTS show_name_on_tv boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_store_arrival_qr(p_tenant_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v RECORD;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: sem acesso a esta loja.' USING ERRCODE = '42501';
    END IF;
    SELECT token, show_name_on_tv INTO v FROM public.store_arrival_qr WHERE tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        LOOP
            BEGIN
                INSERT INTO public.store_arrival_qr (tenant_id, token) VALUES (p_tenant_id, public._arrival_token())
                ON CONFLICT (tenant_id) DO NOTHING;
                EXIT;
            EXCEPTION WHEN unique_violation THEN NULL;
            END;
        END LOOP;
        SELECT token, show_name_on_tv INTO v FROM public.store_arrival_qr WHERE tenant_id = p_tenant_id;
    END IF;
    RETURN jsonb_build_object('token', v.token, 'showNameOnTv', v.show_name_on_tv);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_arrival_tv_show_name(p_tenant_id uuid, p_show boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: só dono ou gerente altera.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.get_store_arrival_qr(p_tenant_id);
    UPDATE public.store_arrival_qr SET show_name_on_tv = COALESCE(p_show, false) WHERE tenant_id = p_tenant_id;
    PERFORM public.log_audit_event('ARRIVAL_TV_NAME_SET', 'store_arrival_qr', 'Primeiro nome na TV: ' || COALESCE(p_show, false)::text,
        p_tenant_id::text, NULL, NULL, p_tenant_id);
    RETURN jsonb_build_object('showNameOnTv', COALESCE(p_show, false));
END;
$$;

-- Cliente logado: loja do QR + SEUS pedidos de retirada abertos nela (nada de outros clientes).
CREATE OR REPLACE FUNCTION public.resolve_arrival_qr(p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tok text := upper(regexp_replace(COALESCE(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
    v_t RECORD;
    v_orders jsonb;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: entre na sua conta.' USING ERRCODE = '42501'; END IF;
    IF NOT public._rate_limit_hit('arrival_resolve', v_uid::text, NULL, 20, 60) THEN
        RAISE EXCEPTION 'RATE_LIMITED: muitas tentativas; aguarde um minuto.';
    END IF;
    SELECT t.id, t.name, t.slug INTO v_t FROM public.store_arrival_qr q JOIN public.tenants t ON t.id = q.tenant_id WHERE q.token = v_tok;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_QR: QR Code inválido ou trocado pela loja.'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'orderNumber', o.order_number, 'status', o.status, 'createdAt', o.created_at)
                              ORDER BY o.created_at), '[]'::jsonb) INTO v_orders
    FROM public.orders o JOIN public.customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id AND c.user_id = v_uid
    WHERE o.tenant_id = v_t.id AND o.fulfillment_type = 'PICKUP' AND o.status NOT IN ('DELIVERED','CANCELLED');
    RETURN jsonb_build_object('tenantId', v_t.id, 'storeName', v_t.name, 'slug', v_t.slug, 'orders', v_orders);
END;
$$;

REVOKE ALL ON FUNCTION public.set_arrival_tv_show_name(uuid, boolean), public.resolve_arrival_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_arrival_tv_show_name(uuid, boolean), public.resolve_arrival_qr(text) TO authenticated;

COMMIT;
