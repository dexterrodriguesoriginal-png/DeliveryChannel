-- Fotografia (superusuário) das linhas existentes antes de N1–N6, para provar que nada foi alterado.
CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE t.snap (tbl TEXT, id TEXT, data JSONB, PRIMARY KEY (tbl, id));
INSERT INTO t.snap SELECT 'offers', id::text, to_jsonb(x) FROM public.offers x;
INSERT INTO t.snap SELECT 'orders', id::text, to_jsonb(x) FROM public.orders x;
INSERT INTO t.snap SELECT 'order_items', id::text, to_jsonb(x) FROM public.order_items x;
INSERT INTO t.snap SELECT 'customers', id::text, to_jsonb(x) FROM public.customers x;
INSERT INTO t.snap SELECT 'order_status_history', id::text, to_jsonb(x) FROM public.order_status_history x;
INSERT INTO t.snap SELECT 'products', id::text, to_jsonb(x) FROM public.products x;
INSERT INTO t.snap SELECT 'tenant_settings', id::text, to_jsonb(x) FROM public.tenant_settings x;
INSERT INTO t.snap SELECT 'inventory_movements', id::text, to_jsonb(x) FROM public.inventory_movements x;
-- Funções existentes antes de N1–N6 (para checar privilégios das funções novas)
CREATE TABLE t.fn_before AS SELECT p.oid::regprocedure::text AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
