-- Reversão exata apenas antes de usar/personalizar sugestões. Nunca perde histórico.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.upsell_settings) OR EXISTS(SELECT 1 FROM public.upsell_pins) OR
  EXISTS(SELECT 1 FROM public.upsell_offers) OR EXISTS(SELECT 1 FROM public.upsell_metrics_daily) OR EXISTS(SELECT 1 FROM public.upsell_conversions) THEN
  RAISE EXCEPTION 'UPSELL_ROLLBACK_BLOCKED: preserve as sugestões e estatísticas em uso antes de reverter.';
 END IF;
END $$;
DROP TRIGGER upsell_order_changed ON public.orders;
DROP FUNCTION public.get_upsell_stats(uuid);
DROP FUNCTION public.record_upsell_conversion(uuid,uuid);
DROP FUNCTION public.accept_upsell(uuid,uuid);
DROP FUNCTION public.record_upsell_impression(uuid);
DROP FUNCTION public.recommend_upsell(text,uuid,jsonb,text);
DROP FUNCTION public.set_upsell_pins(uuid,uuid,uuid[]);
DROP FUNCTION public.get_upsell_pins(uuid,uuid);
DROP FUNCTION public.set_upsell_enabled(uuid,boolean);
DROP FUNCTION public.get_upsell_settings(uuid);
DROP FUNCTION public._upsell_staff(uuid);
DROP FUNCTION public._upsell_rank(uuid,uuid,uuid[],numeric,text,timestamptz);
DROP FUNCTION public._upsell_available(public.products,timestamptz);
DROP FUNCTION public._upsell_refresh_cache(uuid,timestamptz);
DROP FUNCTION public._upsell_order_changed();
DROP FUNCTION public._upsell_completed(text,text);
DROP TABLE public.upsell_conversions;
DROP TABLE public.upsell_metrics_daily;
DROP TABLE public.upsell_offers;
DROP TABLE public.upsell_rank_cache;
DROP TABLE public.upsell_pins;
DROP TABLE public.upsell_settings;
NOTIFY pgrst,'reload schema';
COMMIT;
