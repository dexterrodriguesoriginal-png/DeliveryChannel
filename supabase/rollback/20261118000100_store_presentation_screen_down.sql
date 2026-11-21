-- Rollback da tela inicial personalizada. Restaura a definição EXATA de get_public_store.
-- Recusa rodar se alguma loja já configurou a tela (preserva os dados; exporte antes de reverter).
BEGIN;
DO $$ DECLARE d text; BEGIN
 IF EXISTS (SELECT 1 FROM public.tenant_presentation_screens)
    OR EXISTS (SELECT 1 FROM public.tenant_modules WHERE module_key = 'store_presentation') THEN
  RAISE EXCEPTION 'PRESENTATION DOWN: há telas configuradas; exporte/remova antes de reverter.';
 END IF;
 SELECT definition INTO d FROM public._presentation_20261118_restore WHERE signature IN ('get_public_store(text)', 'public.get_public_store(text)');
 IF d IS NULL THEN RAISE EXCEPTION 'PRESENTATION DOWN: definição original ausente.'; END IF;
 EXECUTE d;
 SELECT definition INTO d FROM public._presentation_20261118_restore
 WHERE signature IN ('set_tenant_module(uuid,text,boolean,jsonb)', 'public.set_tenant_module(uuid,text,boolean,jsonb)');
 IF d IS NULL THEN RAISE EXCEPTION 'PRESENTATION DOWN: set_tenant_module original ausente.'; END IF;
 EXECUTE d;
END $$;
GRANT EXECUTE ON FUNCTION public.get_public_store(text) TO anon, authenticated;
DROP FUNCTION IF EXISTS public._presentation_store_base(text);
DROP FUNCTION public.set_presentation_screen(uuid,uuid,numeric,boolean);
DROP FUNCTION public.clear_presentation_screen(uuid);
DROP TABLE public.tenant_presentation_screens;
ALTER TABLE public.tenant_modules DROP CONSTRAINT IF EXISTS tenant_modules_module_key_check;
ALTER TABLE public.tenant_modules ADD CONSTRAINT tenant_modules_module_key_check
 CHECK (module_key IN ('delivery','pickup','addons','kds','dine_in','counter','service_fee',
 'printing','weight','barcode','substitution','variants','reserve_exchange','scheduling',
 'quotes','street_vendor','pos','loyalty','credit_tab'));
DROP TABLE public._presentation_20261118_restore;
NOTIFY pgrst, 'reload schema';
COMMIT;
