-- ==============================================================================
-- MIGRATION 011: GRANT PRIVILEGES FOR CATALOG MANAGEMENT (CATEGORIES, PRODUCTS, OFFERS)
-- COMANDO 74: Concede privilégios de tabela para a role authenticated poder
-- gerenciar o catálogo do seu próprio estabelecimento sob as regras do RLS.
-- ==============================================================================

-- 1. Conceder privilégios de CRUD para o papel 'authenticated' nas tabelas de catálogo
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.offers TO authenticated;

-- 2. Garantir que o papel 'anon' NÃO tenha privilégios de leitura/escrita direta nessas tabelas
-- O catálogo público deve continuar sendo acessado exclusivamente através da RPC
-- SECURITY DEFINER public.get_public_store(p_slug).
REVOKE ALL ON TABLE public.categories FROM anon;
REVOKE ALL ON TABLE public.products FROM anon;
REVOKE ALL ON TABLE public.offers FROM anon;

-- 3. Confirmação das políticas RLS existentes:
-- - categories_admin_manage (FOR ALL): has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
-- - categories_staff_select (FOR SELECT): has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER', 'DRIVER'])
-- - products_admin_manage (FOR ALL): has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
-- - products_staff_select (FOR SELECT): has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER', 'DRIVER'])
-- - offers_admin_manage (FOR ALL): has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER'])
-- - offers_staff_select (FOR SELECT): has_tenant_role(auth.uid(), tenant_id, ARRAY['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'])
-- Nenhuma política RLS é removida ou enfraquecida. O RLS continua garantindo isolamento estrito por tenant.
