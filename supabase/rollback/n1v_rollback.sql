-- ROLLBACK MANUAL DA N1.V — nunca automático. Remove apenas o CHECK criado pela N1.V.
-- (VALIDATE de FK não tem "desfazer": a FK continua existindo; para voltar a NOT VALID é preciso
--  recriá-la, o que este script faz.)
BEGIN;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_total_consistency;
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_product_same_tenant;
ALTER TABLE public.offers ADD CONSTRAINT offers_product_same_tenant FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products (tenant_id, id) NOT VALID;
COMMIT;
