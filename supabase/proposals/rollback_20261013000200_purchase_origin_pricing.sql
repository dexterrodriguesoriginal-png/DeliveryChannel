-- ROLLBACK da PROPOSTA 20261013000200_purchase_origin_pricing.sql (não destrutivo para dados).
-- Restaura a chamada original de _price_items em _checkout_core e remove _origin_normalize_items.
DO $rb$
DECLARE v_def TEXT;
BEGIN
    IF to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)') IS NOT NULL THEN
        v_def := pg_get_functiondef(to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'));
        IF position('[ORIGIN]' IN v_def) > 0 THEN
            v_def := replace(v_def, 'public._price_items(v_tenant.id, public._origin_normalize_items(v_tenant.id, p_items) /*[ORIGIN]*/, true)',
                                    'public._price_items(v_tenant.id, p_items, true)');
            EXECUTE v_def;
        END IF;
    END IF;
END
$rb$;
DROP FUNCTION IF EXISTS public._origin_normalize_items(uuid, jsonb);
DO $post$
BEGIN
    IF position('[ORIGIN]' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public._checkout_core(text,text,text,text,jsonb,text,text,text,text,jsonb,text,uuid,uuid,text)'))) > 0 THEN
        RAISE EXCEPTION 'ORIGIN ROLLBACK: _checkout_core ainda contém [ORIGIN].';
    END IF;
END
$post$;
