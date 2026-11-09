-- Complemento do stub de 090001/090002 para exercitar 090003 no PGlite (sem pgcrypto nativo).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS name text;
UPDATE public.tenants SET name = initcap(slug) WHERE name IS NULL;

CREATE TABLE IF NOT EXISTS public.tenant_themes (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  store_name text,
  logo_url text,
  primary_color text
);
INSERT INTO public.tenant_themes(tenant_id, store_name, logo_url, primary_color)
VALUES ('11111111-1111-1111-1111-111111111111', 'Adega Loja', 'https://cdn.example/logo.png', '#176444')
ON CONFLICT DO NOTHING;

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE OR REPLACE FUNCTION extensions.gen_salt(t text, n integer DEFAULT 10) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'bf$' || coalesce(t,'bf'); $$;

CREATE OR REPLACE FUNCTION extensions.crypt(pw text, salt text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'bf$' || md5(coalesce(pw,'')); $$;

CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea
LANGUAGE sql VOLATILE AS $$
  SELECT decode(
    md5(clock_timestamp()::text || random()::text) || md5(random()::text || clock_timestamp()::text),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION extensions.digest(p text, algo text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT decode(md5(coalesce(p,'')) || md5(coalesce(p,'') || ':sha256'), 'hex'); $$;

CREATE OR REPLACE FUNCTION public._sha256_hex(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL ELSE encode(extensions.digest(p_value, 'sha256'), 'hex') END;
$$;

CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  scope text NOT NULL,
  subject_key text NOT NULL,
  tenant_id uuid,
  window_start timestamptz NOT NULL,
  hits int NOT NULL,
  PRIMARY KEY (scope, subject_key, window_start)
);

CREATE OR REPLACE FUNCTION public._rate_limit_hit(p_scope text, p_subject text, p_tenant uuid, p_limit int, p_window_s int)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window timestamptz; v_hits int;
BEGIN
  IF p_subject IS NULL OR p_subject = '' THEN RETURN true; END IF;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / GREATEST(p_window_s, 1)) * GREATEST(p_window_s, 1));
  INSERT INTO public.security_rate_limits (scope, subject_key, tenant_id, window_start, hits)
  VALUES (p_scope, p_subject, p_tenant, v_window, 1)
  ON CONFLICT (scope, subject_key, window_start) DO UPDATE SET hits = public.security_rate_limits.hits + 1
  RETURNING hits INTO v_hits;
  RETURN v_hits <= p_limit;
END $$;

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id),
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO public.products(id, tenant_id, name, price, is_active) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Chopp Pilsen', 12.90, true),
  ('d0000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Inativo', 9.90, false),
  ('d0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Outro', 5.00, true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  delivery_address text NOT NULL,
  subtotal numeric(10,2) NOT NULL,
  delivery_fee numeric(10,2) NOT NULL DEFAULT 0,
  discount numeric(10,2) NOT NULL DEFAULT 0,
  total_amount numeric(10,2) NOT NULL,
  payment_method text NOT NULL,
  payment_status text NOT NULL,
  fulfillment_type text NOT NULL,
  status text NOT NULL,
  notes text,
  origin text NOT NULL DEFAULT 'direct',
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  quantity int NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  total_price numeric(10,2) NOT NULL,
  notes text
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  status text NOT NULL,
  note text,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.get_public_store(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name),
    'products', jsonb_build_array(jsonb_build_object('id','d0000000-0000-0000-0000-0000000000a1','name','Chopp Pilsen'))
  )
  FROM public.tenants t
  WHERE t.slug = lower(p_slug) AND t.status = 'ACTIVE'
  LIMIT 1;
$$;

-- Mirrors production immutability guards so tests catch post-insert updates
-- of protected order fields (e.g. idempotency_key).
CREATE OR REPLACE FUNCTION public._orders_protect_columns() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_mutable TEXT[] := ARRAY['status','payment_status','driver_id','notes','updated_at','driver_accepted_at','picked_up_at','delivered_at','archived_at','archived_by'];
    v_nullable_refs TEXT[] := ARRAY['customer_id','coupon_id','campaign_id','card_id','offer_id'];
    v_old JSONB := to_jsonb(OLD) - v_mutable;
    v_new JSONB := to_jsonb(NEW) - v_mutable;
    v_key TEXT;
BEGIN
    FOREACH v_key IN ARRAY v_nullable_refs LOOP
        IF v_new ? v_key AND (v_new -> v_key) = 'null'::jsonb THEN
            v_old := v_old - v_key;
            v_new := v_new - v_key;
        END IF;
    END LOOP;
    IF v_old IS DISTINCT FROM v_new THEN
        SELECT k INTO v_key FROM jsonb_object_keys(v_old || v_new) k
        WHERE (v_old -> k) IS DISTINCT FROM (v_new -> k) LIMIT 1;
        RAISE EXCEPTION 'ORDER_FIELD_IMMUTABLE: o campo "%" do pedido é protegido e não pode ser alterado após a criação.', v_key
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_protect_columns ON public.orders;
CREATE TRIGGER trg_orders_protect_columns
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_protect_columns();

CREATE OR REPLACE FUNCTION public._order_items_protect() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_old JSONB := to_jsonb(OLD);
    v_new JSONB := to_jsonb(NEW);
    v_key TEXT;
BEGIN
    FOREACH v_key IN ARRAY ARRAY['offer_id','card_id'] LOOP
        IF v_new ? v_key AND (v_new -> v_key) = 'null'::jsonb THEN
            v_old := v_old - v_key;
            v_new := v_new - v_key;
        END IF;
    END LOOP;
    IF v_old IS DISTINCT FROM v_new THEN
        RAISE EXCEPTION 'ORDER_ITEM_IMMUTABLE: itens de pedido não podem ser alterados após a criação.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_order_items_protect ON public.order_items;
CREATE TRIGGER trg_order_items_protect
    BEFORE UPDATE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION public._order_items_protect();

CREATE OR REPLACE FUNCTION public._orders_total_consistency_check() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NEW.total_amount <> NEW.subtotal - NEW.discount + NEW.delivery_fee
       OR NEW.total_amount < 0 OR NEW.discount < 0 OR NEW.subtotal < 0 OR NEW.delivery_fee < 0 THEN
        RAISE EXCEPTION 'ORDER_TOTAL_INCONSISTENT: total % <> subtotal % - desconto % + entrega %',
            NEW.total_amount, NEW.subtotal, NEW.discount, NEW.delivery_fee;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_orders_total_consistency ON public.orders;
CREATE TRIGGER trg_orders_total_consistency
    BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public._orders_total_consistency_check();
