-- Refuse a destructive downgrade once the new feature has stored business data.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.products WHERE carousel_only)
 OR EXISTS(SELECT 1 FROM public.promotion_carousel_items WHERE unit_limit IS NOT NULL OR units_sold<>0)
 OR EXISTS(SELECT 1 FROM public.carousel_kit_components) THEN
 RAISE EXCEPTION 'ROLLBACK_BLOCKED: promotional data exists; export/migrate it before downgrading. No data was removed.';
 END IF;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM public._carousel_20261115_restore LOOP EXECUTE r.definition; END LOOP;
END $$;
DROP TRIGGER carousel_order_guard ON public.order_items;
DROP FUNCTION public._carousel_order_guard();
DROP FUNCTION public._carousel_store_base(text);
DROP FUNCTION public._carousel_insert_base(uuid,uuid,jsonb,numeric,numeric,text);
DROP FUNCTION public.create_carousel_product(uuid,uuid,jsonb,jsonb);
DROP FUNCTION public._carousel_terms(uuid,uuid,uuid,int,timestamptz,boolean);
DROP POLICY carousel_product_manager ON public.products;
DROP POLICY carousel_product_anon ON public.products;
DROP TABLE public.carousel_kit_components;
ALTER TABLE public.promotion_carousel_items DROP CONSTRAINT pci_tenant_item_key, DROP COLUMN unit_limit, DROP COLUMN units_sold;
ALTER TABLE public.products DROP COLUMN carousel_only;
DROP TABLE public._carousel_20261115_restore;
COMMIT;
