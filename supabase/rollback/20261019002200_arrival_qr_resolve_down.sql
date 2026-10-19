-- Rollback de 20261019002200 (restaura get_store_arrival_qr da 2100; coluna fica — sem perda de dados).
BEGIN;
DROP FUNCTION IF EXISTS public.resolve_arrival_qr(text);
DROP FUNCTION IF EXISTS public.set_arrival_tv_show_name(uuid, boolean);
CREATE OR REPLACE FUNCTION public.get_store_arrival_qr(p_tenant_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
    AS $$
DECLARE v text;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_tenant_role(auth.uid(), p_tenant_id, ARRAY['OWNER','MANAGER','OPERATOR','CASHIER']) THEN
        RAISE EXCEPTION 'FORBIDDEN: sem acesso a esta loja.' USING ERRCODE = '42501';
    END IF;
    SELECT token INTO v FROM public.store_arrival_qr WHERE tenant_id = p_tenant_id;
    IF v IS NULL THEN
        LOOP
            BEGIN
                INSERT INTO public.store_arrival_qr (tenant_id, token) VALUES (p_tenant_id, public._arrival_token())
                ON CONFLICT (tenant_id) DO NOTHING;
                EXIT;
            EXCEPTION WHEN unique_violation THEN NULL;
            END;
        END LOOP;
        SELECT token INTO v FROM public.store_arrival_qr WHERE tenant_id = p_tenant_id;
    END IF;
    RETURN jsonb_build_object('token', v);
END;
$$;
COMMIT;
