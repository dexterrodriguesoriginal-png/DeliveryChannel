-- Rollback da 20261018001800 (app do cliente P1). Remove só as RPCs novas; o app volta sozinho ao fallback.
-- DADOS SÃO MANTIDOS: customers.cpf e a tabela customer_account_deletion_requests (pedidos LGPD registrados)
-- NÃO são removidos. Para removê-los (destrói dados — só com backup e decisão explícita), rode à parte:
--   ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_cpf_digits, DROP COLUMN IF EXISTS cpf;
--   DROP TABLE IF EXISTS public.customer_account_deletion_requests;
BEGIN;
DROP FUNCTION IF EXISTS public.update_my_customer_profile(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.list_store_coupons_for_customer(text);
DROP FUNCTION IF EXISTS public.request_my_account_deletion(text);
DROP FUNCTION IF EXISTS public._is_valid_cpf(text);
-- Sem RPC de escrita, a tabela fica só leitura (própria linha) — mantida por conter pedidos LGPD.
COMMIT;
