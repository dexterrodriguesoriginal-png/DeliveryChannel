-- Carousel-only SKUs reuse the existing order/inventory ledger. No existing rows change.
BEGIN;
CREATE TABLE public._carousel_20261115_restore(signature text PRIMARY KEY, definition text NOT NULL);
REVOKE ALL ON public._carousel_20261115_restore FROM PUBLIC, anon, authenticated;
INSERT INTO public._carousel_20261115_restore
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid) FROM pg_proc p
WHERE p.pronamespace='public'::regnamespace AND p.proname IN
('_effective_product_price','_price_items','_insert_order_lines','get_public_store','get_totem_store','create_totem_order',
 'get_menu_best_sellers','get_session_reorder_items','_upsell_available','_product_option_snapshot_after_order_item','_restock_order_items');
ALTER TABLE public.products ADD COLUMN carousel_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.promotion_carousel_items
 ADD COLUMN unit_limit integer CHECK (unit_limit > 0),
 ADD COLUMN units_sold integer NOT NULL DEFAULT 0 CHECK (units_sold >= 0);
ALTER TABLE public.promotion_carousel_items ADD CONSTRAINT pci_tenant_item_key UNIQUE(tenant_id,id);
CREATE TABLE public.carousel_kit_components (
 tenant_id uuid NOT NULL, item_id uuid NOT NULL, product_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 999),
 PRIMARY KEY(item_id,product_id),
 FOREIGN KEY(tenant_id,item_id) REFERENCES public.promotion_carousel_items(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,product_id) REFERENCES public.products(tenant_id,id)
);
ALTER TABLE public.carousel_kit_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY carousel_kit_manager ON public.carousel_kit_components TO authenticated
 USING(public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK(public.is_tenant_owner_or_manager(tenant_id));
REVOKE ALL ON public.carousel_kit_components FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.carousel_kit_components TO authenticated;
-- Carousel-only rows cannot be edited through broader catalogue staff policies.
CREATE POLICY carousel_product_manager ON public.products AS RESTRICTIVE TO authenticated
 USING(NOT carousel_only OR public.is_tenant_owner_or_manager(tenant_id))
 WITH CHECK(NOT carousel_only OR public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY carousel_product_anon ON public.products AS RESTRICTIVE TO anon USING(NOT carousel_only);

CREATE FUNCTION public._carousel_terms(p_tenant uuid,p_item uuid,p_product uuid,p_quantity int,p_at timestamptz,p_lock boolean)
RETURNS TABLE(unit_price numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.promotion_carousel_items; c public.promotion_carousels; p public.products; v numeric;
BEGIN
 IF p_lock THEN
  SELECT * INTO i FROM public.promotion_carousel_items WHERE tenant_id=p_tenant AND id=p_item FOR UPDATE;
 ELSE
  SELECT * INTO i FROM public.promotion_carousel_items WHERE tenant_id=p_tenant AND id=p_item;
 END IF;
 SELECT * INTO c FROM public.promotion_carousels WHERE tenant_id=p_tenant AND id=i.carousel_id;
 SELECT * INTO p FROM public.products WHERE tenant_id=p_tenant AND id=p_product;
 IF i.id IS NULL OR p.id IS NULL OR i.product_id<>p_product OR NOT p.is_active OR NOT i.is_active OR NOT c.is_active OR NOT c.show_in_store
  OR (i.start_at IS NOT NULL AND i.start_at>p_at) OR (i.end_at IS NOT NULL AND i.end_at<=p_at)
  OR (c.start_at IS NOT NULL AND c.start_at>p_at) OR (c.end_at IS NOT NULL AND c.end_at<=p_at)
  OR (i.unit_limit IS NOT NULL AND i.units_sold+p_quantity>i.unit_limit) OR p.stock_quantity<p_quantity THEN
  RAISE EXCEPTION 'CAMPAIGN_ITEM_INVALID: promoção vencida, indisponível ou sem unidades.';
 END IF;
 v := round(CASE i.discount_type WHEN 'PERCENTAGE' THEN p.price*(1-i.discount_value/100)
 WHEN 'FIXED_AMOUNT' THEN p.price-i.discount_value WHEN 'PROMOTIONAL_PRICE' THEN i.discount_value ELSE p.price END,2);
 IF v::text='NaN' OR v<=0 OR v>p.price THEN RAISE EXCEPTION 'CAMPAIGN_PRICE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.carousel_kit_components k JOIN public.products cp ON cp.tenant_id=k.tenant_id AND cp.id=k.product_id
 WHERE k.item_id=i.id AND (NOT cp.is_active OR cp.carousel_only OR cp.stock_quantity<k.quantity*p_quantity)) THEN
  RAISE EXCEPTION 'CAMPAIGN_ITEM_INVALID: componentes do kit indisponíveis.';
 END IF;
 RETURN QUERY SELECT v;
END $$;
REVOKE ALL ON FUNCTION public._carousel_terms(uuid,uuid,uuid,int,timestamptz,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_carousel_product(p_tenant uuid,p_carousel uuid,p_data jsonb,p_components jsonb DEFAULT '[]')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pid uuid:=gen_random_uuid(); iid uuid:=gen_random_uuid(); promo numeric; original numeric; component jsonb;
BEGIN
 IF NOT public.is_tenant_owner_or_manager(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM public.promotion_carousels WHERE tenant_id=p_tenant AND id=p_carousel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAROUSEL_NOT_FOUND'; END IF;
 promo:=round((p_data->>'price')::numeric,2); original:=round(COALESCE(NULLIF(p_data->>'originalPrice','')::numeric,promo),2);
 IF promo IS NULL OR promo::text='NaN' OR original::text='NaN' OR promo<=0 OR original<promo OR COALESCE(btrim(p_data->>'name'),'')='' OR COALESCE(btrim(p_data->>'imageUrl'),'')=''
 OR NULLIF(p_data->>'endDate','')::timestamptz IS NULL OR (p_data->>'endDate')::timestamptz<=now()
 OR (p_data->>'stock')::integer IS NULL OR (p_data->>'stock')::integer<1
 OR jsonb_typeof(p_components)<>'array' OR jsonb_array_length(p_components)>50 THEN RAISE EXCEPTION 'INVALID_PROMOTIONAL_PRODUCT'; END IF;
 INSERT INTO public.products(id,tenant_id,name,description,image_url,price,stock_quantity,carousel_only)
 VALUES(pid,p_tenant,btrim(p_data->>'name'),p_data->>'description',p_data->>'imageUrl',original,(p_data->>'stock')::int,true);
 INSERT INTO public.promotion_carousel_items(id,tenant_id,carousel_id,product_id,discount_type,discount_value,start_at,end_at)
 VALUES(iid,p_tenant,p_carousel,pid,'PROMOTIONAL_PRICE',promo,NULLIF(p_data->>'startDate','')::timestamptz,(p_data->>'endDate')::timestamptz);
 FOR component IN SELECT value FROM jsonb_array_elements(p_components) LOOP
  PERFORM 1 FROM public.products WHERE tenant_id=p_tenant AND id=(component->>'productId')::uuid AND NOT carousel_only AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_KIT_COMPONENT'; END IF;
  INSERT INTO public.carousel_kit_components VALUES(p_tenant,iid,(component->>'productId')::uuid,(component->>'quantity')::int);
 END LOOP;
 RETURN iid;
END $$;
REVOKE ALL ON FUNCTION public.create_carousel_product(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_carousel_product(uuid,uuid,jsonb,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public._price_items(p_tenant uuid, p_items jsonb, p_lock boolean)
RETURNS TABLE(r_product_id uuid, r_quantity int, r_notes text, r_name text, r_unit text, r_stock int,
              r_unit_price numeric, r_original_price numeric, r_is_promotional boolean, r_price_source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_elem jsonb;
  v_key text;
  v_agg record;
  v_prod record;
  v_price record;
  v_addon_cents integer;
  v_campaign record;
  v_plan jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART: a sacola de compras não pode estar vazia.';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'TOO_MANY_ITEMS: máximo de 100 linhas por pedido.';
  END IF;
  PERFORM set_config('app.carousel_plan', '[]', true);
  PERFORM set_config('app.product_option_items', p_items::text, true);
  PERFORM set_config('app.product_option_used', '[]', true);
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_ITEM: item do pedido inválido.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_elem) LOOP
      IF v_key NOT IN ('productId', 'quantity', 'notes', 'options', 'source', 'campaignItemId') THEN
        RAISE EXCEPTION 'UNEXPECTED_FIELD: campo "%" não é aceito nos itens.', v_key;
      END IF;
    END LOOP;
    IF jsonb_typeof(v_elem -> 'productId') IS DISTINCT FROM 'string'
       OR (v_elem ->> 'productId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_ITEM: ID do produto inválido no pedido.';
    END IF;
    IF jsonb_typeof(v_elem -> 'quantity') IS DISTINCT FROM 'number'
       OR (v_elem ->> 'quantity') !~ '^[0-9]+$'
       OR (v_elem ->> 'quantity')::numeric NOT BETWEEN 1 AND 999 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: a quantidade do item deve ser um inteiro entre 1 e 999.';
    END IF;
    IF v_elem ? 'notes' AND jsonb_typeof(v_elem -> 'notes') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'INVALID_ITEM: observação do item inválida.';
    END IF;
    IF length(COALESCE(v_elem ->> 'notes', '')) > 300 THEN
      RAISE EXCEPTION 'INVALID_ITEM: observação do item com mais de 300 caracteres.';
    END IF;
    IF v_elem ? 'options' AND jsonb_typeof(v_elem -> 'options') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'ADICIONAIS_INVALIDOS: As opções selecionadas são inválidas.';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    GROUP BY e.value ->> 'productId'
    HAVING sum((e.value ->> 'quantity')::integer) > 999
  ) THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: quantidade máxima por produto é 999.';
  END IF;

  FOR v_agg IN
    SELECT (line.value ->> 'productId')::uuid AS pid,
           sum((line.value ->> 'quantity')::integer)::integer AS qty,
           string_agg(NULLIF(btrim(line.value ->> 'notes'), ''), ' | ') AS notes,
           line.value ->> 'source' AS source, line.value ->> 'campaignItemId' AS campaign_id,
           line.normalized_options AS selections
    FROM (
      SELECT e.value, public._normalize_product_option_selections(e.value -> 'options') AS normalized_options
      FROM jsonb_array_elements(p_items) e
    ) line
    GROUP BY (line.value ->> 'productId')::uuid, line.normalized_options, line.value ->> 'source', line.value ->> 'campaignItemId'
    ORDER BY (line.value ->> 'productId')::uuid, line.normalized_options::text
  LOOP
    IF p_lock THEN
      SELECT p.* INTO v_prod FROM public.products p
      WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant FOR UPDATE;
    ELSE
      SELECT p.* INTO v_prod FROM public.products p
      WHERE p.id = v_agg.pid AND p.tenant_id = p_tenant;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: produto não encontrado no catálogo deste estabelecimento.';
    END IF;
    IF NOT v_prod.is_active THEN
      RAISE EXCEPTION 'PRODUCT_UNAVAILABLE: o produto "%" está temporariamente indisponível.', v_prod.name;
    END IF;
    SELECT * INTO v_price FROM public._effective_product_price(p_tenant, v_agg.pid, now());
    IF v_agg.source = 'campaign' THEN
      SELECT * INTO v_campaign FROM public._carousel_terms(p_tenant, v_agg.campaign_id::uuid, v_agg.pid, v_agg.qty, now(), p_lock);
      v_price.unit_price := v_campaign.unit_price;
      v_price.original_price := v_prod.price;
      -- Coupon eligibility follows the validated origin, even without a reference price.
      v_price.is_promotional := true;
      v_price.price_source := 'CAROUSEL';
      v_plan := v_plan || jsonb_build_object('item', v_agg.campaign_id, 'product', v_agg.pid, 'quantity', v_agg.qty);
    ELSIF v_agg.campaign_id IS NOT NULL OR COALESCE(v_agg.source, 'catalog') <> 'catalog' OR v_prod.carousel_only THEN
      RAISE EXCEPTION 'CAMPAIGN_ITEM_INVALID: origem promocional obrigatória ou inválida.';
    END IF;
    v_addon_cents := public._product_option_selection_price(p_tenant, v_agg.pid, v_agg.selections);
    r_product_id := v_agg.pid;
    r_quantity := v_agg.qty;
    r_notes := v_agg.notes;
    r_name := v_prod.name;
    r_unit := v_prod.unit;
    r_stock := v_prod.stock_quantity;
    r_unit_price := v_price.unit_price + (v_addon_cents::numeric / 100);
    r_original_price := v_price.original_price + (v_addon_cents::numeric / 100);
    r_is_promotional := v_price.is_promotional;
    r_price_source := v_price.price_source;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.carousel_plan', v_plan::text, true);
END;
$$;

-- Immutable quantities actually consumed per order, independent of later recipe edits/removal.
CREATE TABLE public.carousel_kit_order_consumptions (
 tenant_id uuid NOT NULL, order_id uuid NOT NULL, product_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity > 0), restored_at timestamptz,
 PRIMARY KEY(order_id,product_id),
 FOREIGN KEY(tenant_id,order_id) REFERENCES public.orders(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES public.products(tenant_id,id)
);
ALTER TABLE public.carousel_kit_order_consumptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY carousel_kit_consumption_manager ON public.carousel_kit_order_consumptions FOR SELECT TO authenticated
 USING(public.is_tenant_owner_or_manager(tenant_id));
REVOKE ALL ON public.carousel_kit_order_consumptions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.carousel_kit_order_consumptions TO authenticated;

CREATE FUNCTION public._carousel_restock_components(p_order_id uuid,p_actor text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; component record; previous numeric; restored integer:=0;
BEGIN
 -- Serialize both cancellation paths and repeated restock calls on the same order.
 SELECT tenant_id INTO tenant FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 FOR component IN SELECT * FROM public.carousel_kit_order_consumptions
 WHERE tenant_id=tenant AND order_id=p_order_id AND restored_at IS NULL ORDER BY product_id FOR UPDATE LOOP
  SELECT stock_quantity INTO STRICT previous FROM public.products
  WHERE tenant_id=tenant AND id=component.product_id FOR UPDATE;
  UPDATE public.products SET stock_quantity=previous+component.quantity,updated_at=now()
  WHERE tenant_id=tenant AND id=component.product_id;
  -- Do not use ESTORNO: the legacy writer uses any ESTORNO as its whole-order marker.
  INSERT INTO public.inventory_movements(tenant_id,product_id,product_name,quantity,type,reference_id,reason,previous_stock,new_stock,created_by_name)
  SELECT tenant,id,name,component.quantity,'CANCEL_RELEASE',p_order_id::text,
   'Devolução de componentes de kit promocional',previous,previous+component.quantity,COALESCE(p_actor,'Sistema')
  FROM public.products WHERE tenant_id=tenant AND id=component.product_id;
  UPDATE public.carousel_kit_order_consumptions SET restored_at=now()
  WHERE order_id=p_order_id AND product_id=component.product_id;
  restored:=restored+1;
 END LOOP;
 RETURN restored;
END $$;
REVOKE ALL ON FUNCTION public._carousel_restock_components(uuid,text) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE d text; BEGIN
 SELECT definition INTO d FROM public._carousel_20261115_restore WHERE signature LIKE '%_restock_order_items(%';
 IF d IS NULL THEN RAISE EXCEPTION 'MISSING_RESTOCK_WRITER'; END IF;
 EXECUTE replace(d,'public._restock_order_items(', 'public._carousel_restock_base(');
END $$;
REVOKE ALL ON FUNCTION public._carousel_restock_base(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._restock_order_items(p_order_id uuid,p_actor text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE restored integer;
BEGIN
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 restored:=public._carousel_restock_base(p_order_id,p_actor);
 RETURN restored+public._carousel_restock_components(p_order_id,p_actor);
END $$;
CREATE FUNCTION public._carousel_cancel_components() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='CANCELLED' AND OLD.status IS DISTINCT FROM NEW.status THEN
  PERFORM public._carousel_restock_components(NEW.id,'Sistema');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._carousel_cancel_components() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER carousel_cancel_components AFTER UPDATE OF status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._carousel_cancel_components();

-- Reuse the order writer, adding atomic campaign counters and component inventory first.
DO $$ DECLARE d text; BEGIN
 SELECT definition INTO d FROM public._carousel_20261115_restore WHERE signature LIKE '%_insert_order_lines(%';
 IF d IS NULL THEN RAISE EXCEPTION 'MISSING_ORDER_WRITER'; END IF;
 EXECUTE replace(d,'public._insert_order_lines(', 'public._carousel_insert_base(');
END $$;
REVOKE ALL ON FUNCTION public._carousel_insert_base(uuid,uuid,jsonb,numeric,numeric,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._insert_order_lines(p_order_id uuid,p_tenant uuid,p_lines jsonb,p_discount numeric,p_eligible_base numeric,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan jsonb; x jsonb; k record; result jsonb; previous numeric;
BEGIN
 plan:=COALESCE(NULLIF(current_setting('app.carousel_plan',true),'')::jsonb,'[]');
 FOR x IN SELECT value FROM jsonb_array_elements(plan) ORDER BY value->>'item' LOOP
  PERFORM public._carousel_terms(p_tenant,(x->>'item')::uuid,(x->>'product')::uuid,(x->>'quantity')::int,now(),true);
  UPDATE public.promotion_carousel_items SET units_sold=units_sold+(x->>'quantity')::int WHERE tenant_id=p_tenant AND id=(x->>'item')::uuid;
 END LOOP;
 FOR k IN SELECT c.product_id,sum(c.quantity*(x.value->>'quantity')::int)::int qty
 FROM jsonb_array_elements(plan) x JOIN public.carousel_kit_components c ON c.item_id=(x.value->>'item')::uuid AND c.tenant_id=p_tenant
 GROUP BY c.product_id ORDER BY c.product_id LOOP
  SELECT stock_quantity INTO previous FROM public.products WHERE tenant_id=p_tenant AND id=k.product_id AND is_active FOR UPDATE;
  IF previous IS NULL OR previous<k.qty THEN RAISE EXCEPTION 'OUT_OF_STOCK: componentes do kit.'; END IF;
  INSERT INTO public.carousel_kit_order_consumptions(tenant_id,order_id,product_id,quantity)
  VALUES(p_tenant,p_order_id,k.product_id,k.qty);
  UPDATE public.products SET stock_quantity=previous-k.qty WHERE tenant_id=p_tenant AND id=k.product_id;
  INSERT INTO public.inventory_movements(tenant_id,product_id,product_name,quantity,type,reference_id,reason,previous_stock,new_stock,created_by_name)
  SELECT p_tenant,id,name,-k.qty,'VENDA',p_order_id::text,'Componentes de kit promocional',previous,previous-k.qty,p_actor
  FROM public.products WHERE tenant_id=p_tenant AND id=k.product_id;
 END LOOP;
 result:=public._carousel_insert_base(p_order_id,p_tenant,p_lines,p_discount,p_eligible_base,p_actor);
 PERFORM set_config('app.carousel_plan','[]',true);
 RETURN result;
END $$;
-- Direct alternate checkout paths may never sell a hidden SKU without a validated carousel origin.
CREATE FUNCTION public._carousel_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid;
BEGIN
 SELECT tenant_id INTO tenant FROM public.orders WHERE id=NEW.order_id;
 IF EXISTS(SELECT 1 FROM public.products WHERE id=NEW.product_id AND tenant_id=tenant AND carousel_only)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(current_setting('app.carousel_plan',true),'')::jsonb,'[]')) x
 WHERE (x->>'product')::uuid=NEW.product_id) THEN RAISE EXCEPTION 'CAMPAIGN_SOURCE_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER carousel_order_guard BEFORE INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._carousel_order_guard();
REVOKE ALL ON FUNCTION public._carousel_order_guard() FROM PUBLIC,anon,authenticated;
-- Limited campaigns require an explicit origin; catalogue checkout cannot bypass their quota.
-- Filter all non-carousel discovery paths, including recommendations and reorder history.
-- Keep exact definitions for rollback, without changing function identities or grants.
DO $$ DECLARE r record; d text; BEGIN
 FOR r IN SELECT * FROM public._carousel_20261115_restore WHERE signature NOT LIKE '%_price_items(%' AND signature NOT LIKE '%_insert_order_lines(%' AND signature NOT LIKE '%_restock_order_items(%' LOOP
  d:=regexp_replace(r.definition,'(FROM|JOIN) public[.]products([[:space:]])','\1 (SELECT * FROM public.products WHERE NOT carousel_only)\2','gi');
  IF r.signature LIKE '%_product_option_snapshot_after_order_item(%' THEN
   d:=replace(r.definition, 'NEW.product_id::text || '':'' || public._normalize_product_option_selections',
    'NEW.product_id::text || '':'' || COALESCE(e.value->>''campaignItemId'',''catalog'') || '':'' || public._normalize_product_option_selections');
   d:=replace(d,'price.unit_price +',
    'CASE WHEN e.value->>''source''=''campaign'' THEN (SELECT unit_price FROM public._carousel_terms((SELECT tenant_id FROM public.orders WHERE id=NEW.order_id),(e.value->>''campaignItemId'')::uuid,NEW.product_id,0,now(),false)) ELSE price.unit_price END +');
  END IF;
  IF r.signature LIKE '%_effective_product_price(%' THEN
   d:=replace(r.definition, 'i.discount_type <> ''NONE''', 'i.discount_type <> ''NONE'' AND i.unit_limit IS NULL');
  END IF;
  IF r.signature LIKE '%_upsell_available(%' THEN d:=replace(d,'SELECT p_product.is_active','SELECT NOT p_product.carousel_only AND p_product.is_active'); END IF;
  IF r.signature LIKE '%get_totem_store(%' THEN d:=replace(d,'RETURN v_store ||', 'RETURN (v_store - ''carousels'') ||'); END IF;
  IF d<>r.definition THEN EXECUTE d; END IF;
 END LOOP;
 -- The public-store wrapper adds promotional SKUs only to the carousel projection.
 SELECT pg_get_functiondef('public.get_public_store(text)'::regprocedure) INTO d;
 EXECUTE replace(d,'public.get_public_store(', 'public._carousel_store_base(');
END $$;
REVOKE ALL ON FUNCTION public._carousel_store_base(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tenant uuid; carousels jsonb;
BEGIN
 result:=public._carousel_store_base(p_slug);
 IF result IS NULL THEN RETURN result; END IF;
 SELECT id INTO tenant FROM public.tenants WHERE slug=p_slug;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'order',c.display_order,
 'cover',public._public_media_json(c.tenant_id,c.cover_asset_id),'startDate',c.start_at,'endDate',c.end_at,
 'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'id',i.id,'productId',p.id,'price',p.price,'effectivePrice',v.price,'isPromotional',v.price<p.price,
  'isAvailable',true,'order',i.display_order,'startDate',i.start_at,'endDate',i.end_at,
  'remainingUnits',LEAST(CASE WHEN i.unit_limit IS NULL THEN p.stock_quantity ELSE LEAST(p.stock_quantity,i.unit_limit-i.units_sold) END,
   COALESCE((SELECT min(floor(cp.stock_quantity/k.quantity)) FROM public.carousel_kit_components k JOIN public.products cp ON cp.tenant_id=k.tenant_id AND cp.id=k.product_id WHERE k.item_id=i.id),p.stock_quantity)),
  'product',jsonb_build_object('id',p.id,'tenantId',p.tenant_id,'name',p.name,'description',p.description,'price',p.price,
    'imageUrl',p.image_url,'unit',p.unit,'isActive',p.is_active,'isAvailable',true,'carouselOnly',p.carousel_only)
 ) ORDER BY i.display_order,i.id)
 FROM public.promotion_carousel_items i JOIN public.products p ON p.tenant_id=i.tenant_id AND p.id=i.product_id
 CROSS JOIN LATERAL(SELECT round(CASE i.discount_type WHEN 'PERCENTAGE' THEN p.price*(1-i.discount_value/100)
 WHEN 'FIXED_AMOUNT' THEN p.price-i.discount_value WHEN 'PROMOTIONAL_PRICE' THEN i.discount_value ELSE p.price END,2) price) v
 WHERE i.carousel_id=c.id AND i.tenant_id=c.tenant_id AND i.is_active AND p.is_active AND p.stock_quantity>0
 AND (i.start_at IS NULL OR i.start_at<=now()) AND (i.end_at IS NULL OR i.end_at>now())
 AND (i.unit_limit IS NULL OR i.units_sold<i.unit_limit) AND v.price>0 AND v.price<=p.price
 AND NOT EXISTS(SELECT 1 FROM public.carousel_kit_components k JOIN public.products cp ON cp.tenant_id=k.tenant_id AND cp.id=k.product_id
 WHERE k.item_id=i.id AND (NOT cp.is_active OR cp.stock_quantity<k.quantity))), '[]'::jsonb)
 ) ORDER BY c.display_order,c.id),'[]'::jsonb) INTO carousels
 FROM public.promotion_carousels c WHERE c.tenant_id=tenant AND c.is_active AND c.show_in_store
 AND (c.start_at IS NULL OR c.start_at<=now()) AND (c.end_at IS NULL OR c.end_at>now());
 result:=jsonb_set(result,'{products}',COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(COALESCE(result->'products','[]')) x
 WHERE NOT EXISTS(SELECT 1 FROM public.products p WHERE p.tenant_id=tenant AND p.id=(x->>'id')::uuid AND p.carousel_only)),'[]'::jsonb));
 RETURN jsonb_set(result,'{carousels}',carousels);
END $$;
COMMIT;
