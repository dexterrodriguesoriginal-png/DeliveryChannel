-- Entrega 2 E1: sugestões agregadas e isoladas por loja; sem alterar preços ou checkout.
-- Cache de 90 dias: TTL 15 minutos e invalidação na conclusão/reversão dos pedidos.
BEGIN;
CREATE TABLE IF NOT EXISTS public.upsell_settings (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id), enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.upsell_pins (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), source_product_id uuid NOT NULL,
 product_id uuid NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 2),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,source_product_id,product_id),
 FOREIGN KEY(tenant_id,source_product_id) REFERENCES public.products(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES public.products(tenant_id,id),
 CHECK(source_product_id<>product_id)
);
CREATE TABLE IF NOT EXISTS public.upsell_rank_cache (
 tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id), refreshed_at timestamptz,
 dirty boolean NOT NULL DEFAULT true, order_count bigint NOT NULL DEFAULT 0,
 product_stats jsonb NOT NULL DEFAULT '[]', pair_stats jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS public.upsell_offers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 source_product_id uuid NOT NULL, product_ids uuid[] NOT NULL, accepted_ids uuid[] NOT NULL DEFAULT '{}',
 -- An opaque capability. The optional per-offer salted guard stores no raw user ID
 -- and cannot correlate customers across offers; anonymous signup keeps bearer semantics.
 auth_guard text, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT(now()+interval '30 minutes'), impression_at timestamptz,
 last_accept_at timestamptz, bound_order_id uuid REFERENCES public.orders(id),
 FOREIGN KEY(tenant_id,source_product_id) REFERENCES public.products(tenant_id,id),
 CHECK(cardinality(product_ids) BETWEEN 1 AND 3), CHECK(accepted_ids <@ product_ids)
);
CREATE INDEX IF NOT EXISTS upsell_offers_tenant_time_idx ON public.upsell_offers(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS public.upsell_metrics_daily (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), day date NOT NULL,
 source_product_id uuid NOT NULL, product_id uuid NOT NULL,
 impressions bigint NOT NULL DEFAULT 0 CHECK(impressions>=0), accepts bigint NOT NULL DEFAULT 0 CHECK(accepts>=0),
 PRIMARY KEY(tenant_id,day,source_product_id,product_id),
 FOREIGN KEY(tenant_id,source_product_id) REFERENCES public.products(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES public.products(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS public.upsell_conversions (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), order_id uuid NOT NULL REFERENCES public.orders(id),
 product_id uuid NOT NULL, source_product_id uuid NOT NULL,
 offer_id uuid NOT NULL REFERENCES public.upsell_offers(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(order_id,product_id),
 FOREIGN KEY(tenant_id,source_product_id) REFERENCES public.products(tenant_id,id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES public.products(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS upsell_conversions_tenant_idx ON public.upsell_conversions(tenant_id,created_at);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['upsell_settings','upsell_pins','upsell_rank_cache','upsell_offers','upsell_metrics_daily','upsell_conversions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',name);
 END LOOP;
END $$;
GRANT SELECT ON public.upsell_settings,public.upsell_pins,public.upsell_metrics_daily TO authenticated;
CREATE POLICY upsell_settings_staff ON public.upsell_settings FOR SELECT TO authenticated USING(public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY upsell_pins_staff ON public.upsell_pins FOR SELECT TO authenticated USING(public.is_tenant_owner_or_manager(tenant_id));
CREATE POLICY upsell_metrics_staff ON public.upsell_metrics_daily FOR SELECT TO authenticated USING(public.is_tenant_owner_or_manager(tenant_id));

CREATE FUNCTION public._upsell_completed(p_status text,p_payment text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_status NOT IN('CANCELLED','CANCELLED_BY_CUSTOMER','REFUNDED') AND p_payment<>'REFUNDED'
  AND (p_status='DELIVERED' OR p_payment='PAID');
$$;
CREATE FUNCTION public._upsell_order_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public._upsell_completed(NEW.status,NEW.payment_status) OR
    (TG_OP='UPDATE' AND public._upsell_completed(OLD.status,OLD.payment_status)) THEN
  IF EXISTS(SELECT 1 FROM public.upsell_settings WHERE tenant_id=NEW.tenant_id AND enabled) OR
     EXISTS(SELECT 1 FROM public.upsell_rank_cache WHERE tenant_id=NEW.tenant_id) THEN
   INSERT INTO public.upsell_rank_cache(tenant_id,dirty) VALUES(NEW.tenant_id,true)
   ON CONFLICT(tenant_id) DO UPDATE SET dirty=true;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER upsell_order_changed AFTER INSERT OR UPDATE OF status,payment_status ON public.orders
 FOR EACH ROW EXECUTE FUNCTION public._upsell_order_changed();

CREATE FUNCTION public._upsell_refresh_cache(p_tenant uuid,p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_products jsonb; v_pairs jsonb; v_orders bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM public.upsell_rank_cache c WHERE c.tenant_id=p_tenant
  AND ((NOT c.dirty AND c.refreshed_at>p_at-interval '15 minutes') OR (c.dirty AND c.refreshed_at>p_at-interval '60 seconds')) AND c.refreshed_at<=p_at) THEN RETURN; END IF;
 -- One refresh per tenant, without forcing unrelated tenants to wait.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('upsell-cache:'||p_tenant::text,0));
 IF EXISTS(SELECT 1 FROM public.upsell_rank_cache c WHERE c.tenant_id=p_tenant
  AND ((NOT c.dirty AND c.refreshed_at>p_at-interval '15 minutes') OR (c.dirty AND c.refreshed_at>p_at-interval '60 seconds')) AND c.refreshed_at<=p_at) THEN RETURN; END IF;
 WITH eligible AS MATERIALIZED (
  SELECT o.id,o.created_at,o.fulfillment_type FROM public.orders o
  WHERE o.tenant_id=p_tenant AND o.created_at>=p_at-interval '90 days' AND o.created_at<=p_at
    AND public._upsell_completed(o.status,o.payment_status)
 ), lines AS MATERIALIZED (
  SELECT DISTINCT e.id order_id,i.product_id,e.created_at,e.fulfillment_type FROM eligible e
  JOIN public.order_items i ON i.order_id=e.id JOIN public.products p ON p.id=i.product_id AND p.tenant_id=p_tenant
 ), prod AS (
  SELECT product_id,count(*) n,
   count(*) FILTER(WHERE extract(hour FROM created_at AT TIME ZONE 'America/Sao_Paulo')<12) morning,
   count(*) FILTER(WHERE extract(hour FROM created_at AT TIME ZONE 'America/Sao_Paulo') BETWEEN 12 AND 17) afternoon,
   count(*) FILTER(WHERE extract(hour FROM created_at AT TIME ZONE 'America/Sao_Paulo')>=18) evening,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=0) d0,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=1) d1,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=2) d2,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=3) d3,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=4) d4,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=5) d5,
   count(*) FILTER(WHERE extract(dow FROM created_at AT TIME ZONE 'America/Sao_Paulo')=6) d6,
   count(*) FILTER(WHERE fulfillment_type='DINE_IN') dinein,
   count(*) FILTER(WHERE fulfillment_type<>'DINE_IN') delivery
  FROM lines GROUP BY product_id
 ), pairs AS (
  SELECT a.product_id source_product_id,b.product_id,count(*) n FROM lines a
  JOIN lines b ON b.order_id=a.order_id AND b.product_id<>a.product_id
  GROUP BY a.product_id,b.product_id
 ) SELECT (SELECT count(*) FROM eligible),
   coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM prod p),'[]'),
   coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM pairs p),'[]')
 INTO v_orders,v_products,v_pairs;
 INSERT INTO public.upsell_rank_cache(tenant_id,refreshed_at,dirty,order_count,product_stats,pair_stats)
 VALUES(p_tenant,p_at,false,v_orders,v_products,v_pairs)
 ON CONFLICT(tenant_id) DO UPDATE SET refreshed_at=EXCLUDED.refreshed_at,dirty=false,
  order_count=EXCLUDED.order_count,product_stats=EXCLUDED.product_stats,pair_stats=EXCLUDED.pair_stats;
END $$;

-- Static catalog availability is authoritative; scheduled promotion prices are
-- resolved by the same _effective_product_price helper used by checkout.
CREATE FUNCTION public._upsell_available(p_product public.products,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_product.is_active AND p_product.stock_quantity>=1
 AND EXISTS(SELECT 1 FROM public.stock_location_balances b WHERE b.tenant_id=p_product.tenant_id AND b.product_id=p_product.id
  AND b.location_id=public._stock_default_location(p_product.tenant_id) AND b.available_quantity>=1)
 AND coalesce((to_jsonb(p_product)->>'is_available')::boolean,true)
 AND (p_product.category_id IS NULL OR EXISTS(SELECT 1 FROM public.categories c WHERE c.id=p_product.category_id AND c.tenant_id=p_product.tenant_id AND c.is_active))
 AND (coalesce(to_jsonb(p_product)->>'available_from','')='' OR (to_jsonb(p_product)->>'available_from')::timestamptz<=p_at)
 AND (coalesce(to_jsonb(p_product)->>'available_until','')='' OR (to_jsonb(p_product)->>'available_until')::timestamptz>p_at);
$$;

CREATE FUNCTION public._upsell_rank(p_tenant uuid,p_source uuid,p_cart uuid[],p_total numeric,p_channel text,p_at timestamptz)
RETURNS TABLE(product_id uuid,reason text,score numeric,pin_position integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH cache AS (SELECT * FROM public.upsell_rank_cache WHERE tenant_id=p_tenant),
 ps AS (SELECT * FROM jsonb_to_recordset(coalesce((SELECT product_stats FROM cache),'[]')) AS x(product_id uuid,n bigint,morning bigint,afternoon bigint,evening bigint,d0 bigint,d1 bigint,d2 bigint,d3 bigint,d4 bigint,d5 bigint,d6 bigint,dinein bigint,delivery bigint)),
 pairs AS (SELECT * FROM jsonb_to_recordset(coalesce((SELECT pair_stats FROM cache),'[]')) AS x(source_product_id uuid,product_id uuid,n bigint)),
 personal AS (
  SELECT i.product_id,count(DISTINCT o.id) n FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
  LEFT JOIN public.customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id
  LEFT JOIN public.tab_sessions ts ON ts.id=o.ordered_by_session_id AND ts.tenant_id=o.tenant_id
  WHERE auth.uid() IS NOT NULL AND o.tenant_id=p_tenant AND o.created_at>=p_at-interval '90 days'
   AND public._upsell_completed(o.status,o.payment_status)
   AND (c.user_id=auth.uid() OR (ts.auth_user_id=auth.uid() AND ts.approved_at IS NOT NULL))
  GROUP BY i.product_id
 ), metrics AS (
  SELECT m.product_id,sum(m.impressions) impressions,sum(m.accepts) accepts FROM public.upsell_metrics_daily m
  WHERE m.tenant_id=p_tenant AND m.source_product_id=p_source AND m.day>=(p_at AT TIME ZONE 'America/Sao_Paulo')::date-90 GROUP BY m.product_id
 ), candidates AS (
  SELECT p.id,p.name,c.name category_name,pr.unit_price,pi.position,
   coalesce(s.n,0)::numeric n,coalesce(pair.n,0)::numeric pair_count,
   coalesce((SELECT n FROM ps WHERE product_id=p_source),0)::numeric source_count,
   greatest(coalesce((SELECT order_count FROM cache),0),1)::numeric total_orders,
   CASE WHEN p.category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products cp WHERE cp.id=ANY(p_cart) AND cp.tenant_id=p_tenant AND cp.category_id=p.category_id) THEN 1 ELSE 0 END complementary,
   coalesce(personal.n,0)::numeric own_count,
   CASE WHEN extract(hour FROM p_at AT TIME ZONE 'America/Sao_Paulo')<12 THEN coalesce(s.morning,0)
    WHEN extract(hour FROM p_at AT TIME ZONE 'America/Sao_Paulo')<18 THEN coalesce(s.afternoon,0) ELSE coalesce(s.evening,0) END::numeric context_time,
   coalesce((to_jsonb(s)->>('d'||extract(dow FROM p_at AT TIME ZONE 'America/Sao_Paulo')::integer::text))::numeric,0) context_day,
   CASE WHEN p_channel IN('DINE_IN','TOTEM') THEN coalesce(s.dinein,0) ELSE coalesce(s.delivery,0) END::numeric context_channel,
   coalesce(m.impressions,0)::numeric impressions,coalesce(m.accepts,0)::numeric accepts
  FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id AND c.tenant_id=p_tenant
  CROSS JOIN LATERAL public._effective_product_price(p_tenant,p.id,p_at) pr
  LEFT JOIN ps s ON s.product_id=p.id LEFT JOIN pairs pair ON pair.product_id=p.id AND pair.source_product_id=p_source
  LEFT JOIN personal ON personal.product_id=p.id LEFT JOIN metrics m ON m.product_id=p.id
  LEFT JOIN public.upsell_pins pi ON pi.tenant_id=p_tenant AND pi.source_product_id=p_source AND pi.product_id=p.id AND pi.active
  WHERE p.tenant_id=p_tenant AND NOT(p.id=ANY(p_cart)) AND p.id<>p_source
   AND public._upsell_available(p,p_at) AND pr.unit_price>0 AND pr.unit_price<=p_total
 ) SELECT id,
  CASE WHEN position IS NOT NULL THEN 'Sugestão da casa' WHEN pair_count>=3 THEN 'Combina com seu pedido'
   WHEN own_count>0 THEN 'Um favorito seu' ELSE 'Para completar seu pedido' END,
  (CASE WHEN pair_count>=3 AND source_count>0 THEN 12*pair_count/source_count + 4*ln(greatest(pair_count*total_orders/greatest(source_count*n,1),1)) ELSE 0 END
   +6*complementary+CASE WHEN unit_price<=round(p_total*0.40,2) THEN 6 ELSE 0 END+ln(1+n)+2*ln(1+own_count)
   +2*context_time/greatest(n,1)+context_day/greatest(n,1)+context_channel/greatest(n,1)
   +CASE WHEN extract(hour FROM p_at AT TIME ZONE 'America/Sao_Paulo')<12 AND lower(coalesce(name,'')||' '||coalesce(category_name,''))~'(café|cafe|cappuccino|café da manhã)' THEN 2 ELSE 0 END
   -CASE WHEN impressions>=10 THEN 12*(1-accepts/greatest(impressions,1)) ELSE 0 END
   -unit_price/greatest(p_total,0.01))::numeric,
  position FROM candidates
 ORDER BY CASE WHEN position IS NULL THEN 1 ELSE 0 END,position,3 DESC,id;
$$;

CREATE FUNCTION public._upsell_staff(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(public._tenant_role_of_caller(p_tenant),'') IN('OWNER','MANAGER');
$$;
CREATE FUNCTION public.get_upsell_settings(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public._upsell_staff(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN: sugestões indisponíveis.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('enabled',coalesce((SELECT enabled FROM public.upsell_settings WHERE tenant_id=p_tenant),false));
END $$;
CREATE FUNCTION public.set_upsell_enabled(p_tenant uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public._upsell_staff(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera as sugestões.' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'UPSELL_INVALID: informe se as sugestões estão ativas.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.upsell_settings(tenant_id,enabled) VALUES(p_tenant,p_enabled)
 ON CONFLICT(tenant_id) DO UPDATE SET enabled=EXCLUDED.enabled;
 RETURN jsonb_build_object('enabled',p_enabled);
END $$;
CREATE FUNCTION public.get_upsell_pins(p_tenant uuid,p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public._upsell_staff(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN: sugestões indisponíveis.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE tenant_id=p_tenant AND id=p_product_id) THEN RAISE EXCEPTION 'UPSELL_INVALID: produto indisponível.' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('productIds',coalesce((SELECT jsonb_agg(product_id ORDER BY position,product_id) FROM public.upsell_pins WHERE tenant_id=p_tenant AND source_product_id=p_product_id AND active),'[]'));
END $$;
CREATE FUNCTION public.set_upsell_pins(p_tenant uuid,p_product_id uuid,p_suggested_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public._upsell_staff(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN: somente dono ou gerente da loja altera as sugestões.' USING ERRCODE='42501'; END IF;
 IF p_suggested_ids IS NULL OR cardinality(p_suggested_ids)>3 OR array_position(p_suggested_ids,NULL) IS NOT NULL OR
    cardinality(p_suggested_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_suggested_ids) x) OR
    p_product_id=ANY(p_suggested_ids) OR NOT EXISTS(SELECT 1 FROM public.products WHERE tenant_id=p_tenant AND id=p_product_id) OR
    EXISTS(SELECT 1 FROM unnest(p_suggested_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.products p WHERE p.tenant_id=p_tenant AND p.id=x)) THEN
  RAISE EXCEPTION 'UPSELL_INVALID: escolha até três produtos diferentes desta loja.' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('upsell-pins:'||p_tenant::text||':'||p_product_id::text,0));
 UPDATE public.upsell_pins SET active=false WHERE tenant_id=p_tenant AND source_product_id=p_product_id AND active;
 INSERT INTO public.upsell_pins(tenant_id,source_product_id,product_id,position,active)
 SELECT p_tenant,p_product_id,id,ordinality-1,true FROM unnest(p_suggested_ids) WITH ORDINALITY x(id,ordinality)
 ON CONFLICT(tenant_id,source_product_id,product_id) DO UPDATE SET active=true,position=EXCLUDED.position;
 RETURN public.get_upsell_pins(p_tenant,p_product_id);
END $$;

CREATE FUNCTION public.recommend_upsell(p_slug text,p_source_product_id uuid,p_cart_items jsonb,p_channel text DEFAULT 'DELIVERY') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tenant uuid; cart uuid[]; total numeric; offer uuid:=gen_random_uuid(); ids uuid[]; suggestions jsonb; subject text;
BEGIN
 SELECT id INTO tenant FROM public.tenants WHERE slug=p_slug AND status='ACTIVE';
 IF tenant IS NULL OR NOT coalesce((SELECT enabled FROM public.upsell_settings WHERE tenant_id=tenant),false) THEN
  RETURN '{"offerToken":null,"suggestions":[]}'::jsonb; END IF;
 IF p_channel IS NULL OR p_channel NOT IN('DELIVERY','DINE_IN','TOTEM') OR p_source_product_id IS NULL OR
  jsonb_typeof(p_cart_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cart_items) NOT BETWEEN 1 AND 100 OR pg_column_size(p_cart_items)>32768 THEN
  RAISE EXCEPTION 'UPSELL_INVALID: sacola inválida.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_cart_items) x WHERE jsonb_typeof(x)<>'object'
  OR coalesce(x->>'productId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR coalesce(x->>'quantity','') !~ '^[1-9][0-9]?$') THEN
  RAISE EXCEPTION 'UPSELL_INVALID: sacola inválida.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_cart_items) x WHERE NOT EXISTS(SELECT 1 FROM public.products p WHERE p.tenant_id=tenant AND p.id=(x->>'productId')::uuid)) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p_cart_items) x GROUP BY x->>'productId' HAVING sum((x->>'quantity')::integer)>99) THEN
  RAISE EXCEPTION 'UPSELL_INVALID: produto não pertence à sacola desta loja.' USING ERRCODE='22023'; END IF;
 WITH c AS (SELECT (x->>'productId')::uuid id,sum((x->>'quantity')::integer) qty FROM jsonb_array_elements(p_cart_items) x GROUP BY 1)
 SELECT array_agg(c.id),sum(c.qty*pr.unit_price) INTO cart,total FROM c
 CROSS JOIN LATERAL public._effective_product_price(tenant,c.id,now()) pr;
 IF NOT(p_source_product_id=ANY(cart)) OR total IS NULL OR total<=0 OR
  NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id=p_source_product_id AND p.tenant_id=tenant AND public._upsell_available(p,now())) THEN
  RETURN '{"offerToken":null,"suggestions":[]}'::jsonb; END IF;
 subject:=public._sha256_hex(coalesce(auth.uid()::text,NULLIF(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','anonymous'));
 IF NOT public._rate_limit_hit('upsell_recommend',subject,tenant,30,60) OR
    NOT public._rate_limit_hit('upsell_tenant',public._sha256_hex(tenant::text),tenant,300,60) THEN
  RETURN '{"offerToken":null,"suggestions":[]}'::jsonb; END IF;
 PERFORM public._upsell_refresh_cache(tenant,now());
 SELECT array_agg(r.product_id ORDER BY r.ord),jsonb_agg(jsonb_build_object('productId',r.product_id,'reason',r.reason) ORDER BY r.ord)
 INTO ids,suggestions FROM (SELECT product_id,reason,ord FROM public._upsell_rank(tenant,p_source_product_id,cart,total,p_channel,now()) WITH ORDINALITY r(product_id,reason,score,pin_position,ord) LIMIT 3) r;
 IF ids IS NULL THEN RETURN '{"offerToken":null,"suggestions":[]}'::jsonb; END IF;
 INSERT INTO public.upsell_offers(id,tenant_id,source_product_id,product_ids,auth_guard)
 VALUES(offer,tenant,p_source_product_id,ids,CASE WHEN auth.uid() IS NOT NULL AND NOT coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
  THEN public._sha256_hex(auth.uid()::text||':'||offer::text) ELSE NULL END);
 RETURN jsonb_build_object('offerToken',offer,'suggestions',suggestions);
END $$;

CREATE FUNCTION public.record_upsell_impression(p_offer_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.upsell_offers;
BEGIN
 SELECT * INTO o FROM public.upsell_offers WHERE id=p_offer_token FOR UPDATE;
 IF NOT FOUND OR o.expires_at<=now() OR
  (o.auth_guard IS NOT NULL AND o.auth_guard IS DISTINCT FROM public._sha256_hex(auth.uid()::text||':'||o.id::text)) OR
  NOT coalesce((SELECT enabled FROM public.upsell_settings WHERE tenant_id=o.tenant_id),false) OR
  NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=o.tenant_id AND status='ACTIVE') THEN RETURN false; END IF;
 IF o.impression_at IS NOT NULL THEN RETURN true; END IF;
 UPDATE public.upsell_offers SET impression_at=now() WHERE id=o.id;
 INSERT INTO public.upsell_metrics_daily(tenant_id,day,source_product_id,product_id,impressions)
 SELECT o.tenant_id,(now() AT TIME ZONE 'America/Sao_Paulo')::date,o.source_product_id,p,1 FROM unnest(o.product_ids) p
 ON CONFLICT(tenant_id,day,source_product_id,product_id) DO UPDATE SET impressions=public.upsell_metrics_daily.impressions+1;
 RETURN true;
END $$;
CREATE FUNCTION public.accept_upsell(p_offer_token uuid,p_product_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.upsell_offers;
BEGIN
 SELECT * INTO o FROM public.upsell_offers WHERE id=p_offer_token FOR UPDATE;
 IF NOT FOUND OR o.impression_at IS NULL OR o.expires_at<=now() OR o.bound_order_id IS NOT NULL OR
  (o.auth_guard IS NOT NULL AND o.auth_guard IS DISTINCT FROM public._sha256_hex(auth.uid()::text||':'||o.id::text)) OR
  NOT(p_product_id=ANY(o.product_ids)) OR NOT coalesce((SELECT enabled FROM public.upsell_settings WHERE tenant_id=o.tenant_id),false) OR
  NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=o.tenant_id AND status='ACTIVE') OR
  NOT EXISTS(SELECT 1 FROM public.products p WHERE p.tenant_id=o.tenant_id AND p.id=p_product_id AND public._upsell_available(p,now())) THEN RETURN false; END IF;
 IF p_product_id=ANY(o.accepted_ids) THEN RETURN true; END IF;
 UPDATE public.upsell_offers SET accepted_ids=array_append(accepted_ids,p_product_id),last_accept_at=now() WHERE id=o.id;
 INSERT INTO public.upsell_metrics_daily(tenant_id,day,source_product_id,product_id,accepts)
 VALUES(o.tenant_id,(o.impression_at AT TIME ZONE 'America/Sao_Paulo')::date,o.source_product_id,p_product_id,1)
 ON CONFLICT(tenant_id,day,source_product_id,product_id) DO UPDATE SET accepts=public.upsell_metrics_daily.accepts+1;
 RETURN true;
END $$;
CREATE FUNCTION public.record_upsell_conversion(p_offer_token uuid,p_order_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE off public.upsell_offers; ord public.orders; result integer;
BEGIN
 IF auth.uid() IS NULL THEN RETURN 0; END IF;
 SELECT * INTO off FROM public.upsell_offers WHERE id=p_offer_token FOR UPDATE;
 SELECT * INTO ord FROM public.orders WHERE id=p_order_id;
 IF off.id IS NULL OR ord.id IS NULL OR off.tenant_id<>ord.tenant_id OR off.impression_at IS NULL OR off.last_accept_at IS NULL OR
    (off.bound_order_id IS NOT NULL AND off.bound_order_id<>ord.id) OR
    off.last_accept_at>ord.created_at OR
    (off.auth_guard IS NOT NULL AND off.auth_guard IS DISTINCT FROM public._sha256_hex(auth.uid()::text||':'||off.id::text)) OR
    ord.created_at<off.created_at OR ord.created_at>off.expires_at OR
    NOT( EXISTS(SELECT 1 FROM public.customers c WHERE c.id=ord.customer_id AND c.tenant_id=ord.tenant_id AND c.user_id=auth.uid()) OR
     EXISTS(SELECT 1 FROM public.tab_sessions ts WHERE ts.id=ord.ordered_by_session_id AND ts.tenant_id=ord.tenant_id AND ts.auth_user_id=auth.uid() AND ts.approved_at IS NOT NULL)) OR
    NOT EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=ord.id AND i.product_id=off.source_product_id) OR
    NOT EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=ord.id AND i.product_id=ANY(off.accepted_ids)) THEN RETURN 0; END IF;
 UPDATE public.upsell_offers SET bound_order_id=ord.id WHERE id=off.id;
 INSERT INTO public.upsell_conversions(tenant_id,order_id,product_id,source_product_id,offer_id)
 SELECT off.tenant_id,ord.id,p,off.source_product_id,off.id FROM unnest(off.accepted_ids) p
 WHERE EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=ord.id AND i.product_id=p)
 ON CONFLICT(order_id,product_id) DO NOTHING;
 GET DIAGNOSTICS result=ROW_COUNT;
 RETURN result;
END $$;

CREATE FUNCTION public.get_upsell_stats(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public._upsell_staff(p_tenant) THEN RAISE EXCEPTION 'FORBIDDEN: estatísticas indisponíveis.' USING ERRCODE='42501'; END IF;
 WITH metrics AS (SELECT source_product_id,product_id,sum(impressions) impressions,sum(accepts) accepts
  FROM public.upsell_metrics_daily WHERE tenant_id=p_tenant AND day>=(now() AT TIME ZONE 'America/Sao_Paulo')::date-90 GROUP BY 1,2),
 sales AS (
  SELECT a.source_product_id,a.product_id,sum(i.quantity) quantity,sum(i.total_price) revenue
  FROM public.upsell_conversions a JOIN public.orders o ON o.id=a.order_id AND o.tenant_id=a.tenant_id
  JOIN public.order_items i ON i.order_id=o.id AND i.product_id=a.product_id
  WHERE a.tenant_id=p_tenant AND o.created_at>=now()-interval '90 days' AND public._upsell_completed(o.status,o.payment_status)
  GROUP BY 1,2
 ), pairs AS (SELECT coalesce(m.source_product_id,s.source_product_id) source_product_id,coalesce(m.product_id,s.product_id) product_id,
   coalesce(m.accepts,0) accepts,coalesce(s.quantity,0) quantity,coalesce(s.revenue,0) revenue FROM metrics m FULL JOIN sales s USING(source_product_id,product_id))
 SELECT jsonb_build_object('itemsSold',coalesce((SELECT sum(quantity) FROM sales),0),'revenue',coalesce((SELECT sum(revenue) FROM sales),0),
  'impressions',coalesce((SELECT sum(impressions) FROM metrics),0),'accepts',coalesce((SELECT sum(accepts) FROM metrics),0),
  'acceptanceRate',coalesce((SELECT sum(accepts)::numeric/nullif(sum(impressions),0) FROM metrics),0),
  'topPairs',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceProductId',source_product_id,'productId',product_id,'itemsSold',quantity,'revenue',revenue,'accepts',accepts))
   FROM (SELECT * FROM pairs WHERE quantity>0 ORDER BY quantity DESC,revenue DESC,accepts DESC,source_product_id,product_id LIMIT 5) best),'[]')) INTO result;
 RETURN result;
END $$;

-- Legacy default grants must not turn internal helpers or event ledgers public.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure::text signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE '\_upsell\_%' ESCAPE '\' OR p.proname IN('get_upsell_settings','set_upsell_enabled','get_upsell_pins','set_upsell_pins','recommend_upsell','record_upsell_impression','accept_upsell','record_upsell_conversion','get_upsell_stats')) LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated,service_role';
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.get_upsell_settings(uuid),public.set_upsell_enabled(uuid,boolean),public.get_upsell_pins(uuid,uuid),public.set_upsell_pins(uuid,uuid,uuid[]),public.get_upsell_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recommend_upsell(text,uuid,jsonb,text),public.record_upsell_impression(uuid),public.accept_upsell(uuid,uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_upsell_conversion(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
