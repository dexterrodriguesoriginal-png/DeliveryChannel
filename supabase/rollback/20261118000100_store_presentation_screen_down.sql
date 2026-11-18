-- Rollback da tela inicial personalizada. Restaura a definição EXATA de get_public_store.
-- Recusa rodar se alguma loja já configurou a tela (preserva os dados; exporte antes de reverter).
BEGIN;
DO $$ DECLARE d text; BEGIN
 IF EXISTS (SELECT 1 FROM public.tenant_presentation_screens) THEN
  RAISE EXCEPTION 'PRESENTATION DOWN: há telas configuradas; exporte/remova antes de reverter.';
 END IF;
 SELECT definition INTO d FROM public._presentation_20261118_restore WHERE signature IN ('get_public_store(text)', 'public.get_public_store(text)');
 IF d IS NULL THEN RAISE EXCEPTION 'PRESENTATION DOWN: definição original ausente.'; END IF;
 EXECUTE d;
END $$;
GRANT EXECUTE ON FUNCTION public.get_public_store(text) TO anon, authenticated;
DROP FUNCTION public._presentation_store_base(text);
DROP FUNCTION public.set_presentation_screen(uuid,uuid,numeric,boolean);
DROP FUNCTION public.clear_presentation_screen(uuid);
DROP TABLE public.tenant_presentation_screens;
DROP TABLE public._presentation_20261118_restore;
NOTIFY pgrst, 'reload schema';
COMMIT;
