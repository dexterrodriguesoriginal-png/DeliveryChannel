-- 20261019002000_orders_realtime_publication.sql
-- Supabase Realtime para pedidos: adiciona public.orders à publicação supabase_realtime.
-- Sem isso os canais postgres_changes do painel do dono e do app do cliente nunca recebiam eventos
-- (E2E de staging 19/10: 0 eventos), e tudo dependia só do polling (dono 10 s, cliente 8 s).
--
-- 100% ADITIVA e idempotente: só adiciona a tabela se ainda não for membro; nenhuma tabela, coluna,
-- policy, grant ou dado é alterado. Se a publicação não existir, aborta (não cria nada às cegas).
-- Segurança: o Realtime (postgres_changes) aplica a RLS de public.orders a cada assinante (staff da loja
-- pela tenant; cliente só os próprios pedidos via orders_customer_select) e só envia colunas com SELECT.
-- order_status_history NÃO entra: toda mudança de status já atualiza orders na mesma transação
-- (update_order_status / RPCs de entregador) e o histórico tem note/changed_by (nome de funcionário),
-- que não deve trafegar em evento para o cliente.
-- Rollback: supabase/rollback/20261019002000_orders_realtime_publication_down.sql
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RAISE EXCEPTION 'REALTIME_PUBLICATION_MISSING: publicação supabase_realtime não existe; nada foi alterado.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
END
$$;

COMMIT;
