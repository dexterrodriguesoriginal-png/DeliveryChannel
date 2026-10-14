-- ROLLBACK MANUAL da 027 (não executar automaticamente). Não remove nem altera dados:
-- apenas desfaz as proteções; colunas e atribuições gravadas pela 026 permanecem.
DROP TRIGGER IF EXISTS trg_orders_promo_attribution_guard ON public.orders;
DROP TRIGGER IF EXISTS trg_order_items_promo_attribution_guard ON public.order_items;
DROP FUNCTION IF EXISTS public._orders_promo_attribution_guard();
DROP FUNCTION IF EXISTS public._order_items_promo_attribution_guard();
DROP INDEX IF EXISTS public.idx_orders_tenant_offer_created;
-- customers.notes NÃO é removida no rollback: a RPC de checkout promocional da 026 depende dela
-- e a coluna pode conter observações de clientes já cadastrados (remover = perda de dados).
-- process_promotional_checkout_atomic NÃO volta para a versão da 026 no rollback: aquela versão
-- violava o FK campaign_analytics_events.card_id → campaign_cards e fazia todo checkout promocional falhar.
