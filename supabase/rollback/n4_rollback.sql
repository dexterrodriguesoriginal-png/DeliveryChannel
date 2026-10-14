-- ============================================================================
-- ROLLBACK MANUAL DA N4 — NÃO É MIGRATION. NUNCA EXECUTADO AUTOMATICAMENTE.
-- Uso: BEGIN; SET LOCAL n1n6.rollback_confirm = 'N4'; \i supabase/rollback/n4_rollback.sql; COMMIT;
-- Pré-requisito: N5–N6 revertidas. Restaura _effective_product_price da N2.
-- PERDA DE DADOS: carrosséis/itens e as 13 colunas novas de offers (valores digitados nelas
-- após a N4). As colunas originais das ofertas (001–020) não são tocadas.
-- ============================================================================
DO $rb$
BEGIN
    IF current_setting('n1n6.rollback_confirm', true) IS DISTINCT FROM 'N4' THEN
        RAISE EXCEPTION 'Rollback N4 não confirmado: SET LOCAL n1n6.rollback_confirm = ''N4''.';
    END IF;
    IF to_regclass('public.campaigns') IS NOT NULL THEN
        RAISE EXCEPTION 'Rollback N4 abortado: N5 ainda aplicada.';
    END IF;
END
$rb$;
CREATE OR REPLACE FUNCTION public._effective_product_price(p_tenant UUID, p_product UUID, p_at TIMESTAMPTZ)
RETURNS TABLE(unit_price NUMERIC, original_price NUMERIC, is_promotional BOOLEAN, price_source TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT CASE WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price <= p.price
                THEN p.promotional_price ELSE p.price END,
           p.price,
           (p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price < p.price),
           CASE WHEN p.promotional_price IS NOT NULL AND p.promotional_price > 0 AND p.promotional_price < p.price
                THEN 'PRODUCT_PROMO' ELSE 'BASE' END
    FROM public.products p
    WHERE p.id = p_product AND p.tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public._effective_product_price(uuid,uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_offers_media_reference ON public.offers;
DROP TRIGGER IF EXISTS trg_offers_protect_counter ON public.offers;
DROP TABLE IF EXISTS public.promotion_carousel_items;
DROP TABLE IF EXISTS public.promotion_carousels;
DROP FUNCTION IF EXISTS public._media_reference_check();
DROP FUNCTION IF EXISTS public._offers_protect_counter();
ALTER TABLE public.offers
    DROP CONSTRAINT IF EXISTS offers_media_asset_fk,
    DROP CONSTRAINT IF EXISTS offers_promo_price_positive,
    DROP CONSTRAINT IF EXISTS offers_promo_limits_positive,
    DROP CONSTRAINT IF EXISTS offers_promo_fulfillment_check,
    DROP CONSTRAINT IF EXISTS offers_promo_times_used_check,
    DROP CONSTRAINT IF EXISTS offers_window_check,
    DROP CONSTRAINT IF EXISTS offers_promo_checkout_requires_price;
ALTER TABLE public.offers
    DROP COLUMN IF EXISTS media_asset_id, DROP COLUMN IF EXISTS start_at, DROP COLUMN IF EXISTS end_at,
    DROP COLUMN IF EXISTS auto_overlay, DROP COLUMN IF EXISTS has_promo_checkout, DROP COLUMN IF EXISTS promo_price,
    DROP COLUMN IF EXISTS promo_usage_limit, DROP COLUMN IF EXISTS promo_usage_limit_per_customer,
    DROP COLUMN IF EXISTS promo_max_qty_per_order, DROP COLUMN IF EXISTS promo_fulfillment,
    DROP COLUMN IF EXISTS promo_times_used, DROP COLUMN IF EXISTS internal_name, DROP COLUMN IF EXISTS internal_notes;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261006000400';
