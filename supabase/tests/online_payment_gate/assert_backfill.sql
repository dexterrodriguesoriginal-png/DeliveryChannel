DO $$ BEGIN
 ASSERT (SELECT count(*)=5 FROM public.orders WHERE id::text LIKE '43000000-%' AND awaiting_online_payment), 'five unpaid orders must be gated';
 ASSERT NOT EXISTS(SELECT 1 FROM public.orders o JOIN public.gate_backfill_before b USING(id)
 WHERE (o.status,o.created_at,o.updated_at) IS DISTINCT FROM (b.status,b.created_at,b.updated_at)), 'backfill mutated orders';
 ASSERT NOT EXISTS(SELECT 1 FROM public.products p JOIN public.gate_stock_before b USING(id) WHERE p.stock_quantity<>b.stock_quantity), 'backfill changed stock';
END $$;
