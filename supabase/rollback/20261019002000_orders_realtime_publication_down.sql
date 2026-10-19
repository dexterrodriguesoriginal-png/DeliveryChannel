-- Rollback da 20261019002000: tira public.orders da publicação supabase_realtime (nenhum dado é tocado).
-- Use só onde a 2000 foi quem adicionou a tabela (staging e produção em 19/10: não era membro antes).
-- O app continua funcionando pelo polling (dono 10 s, cliente 8 s).
BEGIN;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;
    END IF;
END
$$;
COMMIT;
