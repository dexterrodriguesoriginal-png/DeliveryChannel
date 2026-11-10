-- Isolated fixture, not a production schema. Crypto doubles are supplied by stub_extra.sql.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE public.caller(uid uuid, role text, tenant_id uuid DEFAULT '11111111-1111-1111-1111-111111111111');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.caller LIMIT 1 $$;
CREATE FUNCTION public._tenant_role_of_caller(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM public.caller WHERE tenant_id=$1 AND uid=auth.uid() $$;
CREATE FUNCTION public._store_home_https_url(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT $1 LIKE 'https://%' $$;
CREATE TABLE public.tenants(id uuid PRIMARY KEY, slug text, status text DEFAULT 'ACTIVE');
INSERT INTO public.tenants(id,slug) VALUES ('11111111-1111-1111-1111-111111111111','loja'),('22222222-2222-2222-2222-222222222222','outra');
CREATE TABLE public.tenant_settings(tenant_id uuid PRIMARY KEY REFERENCES public.tenants, address text, phone_whatsapp text);
CREATE TABLE public.test_audit(id uuid DEFAULT gen_random_uuid(), action text, tenant_id uuid);
CREATE FUNCTION public.log_audit_event(varchar,varchar,text,varchar DEFAULT NULL,text DEFAULT NULL,text DEFAULT NULL,uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; BEGIN INSERT INTO public.test_audit(action,tenant_id) VALUES($1,$7) RETURNING id INTO v; RETURN v; END $$;
