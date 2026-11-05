-- Rollback exato e sem perda de dados: nunca apaga um outdoor já cadastrado.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.menu_outdoor_slides) THEN
    RAISE EXCEPTION 'MENU_OUTDOOR_ROLLBACK_HAS_DATA: existem outdoors cadastrados; reversão recusada para preservar os dados.';
  END IF;
END $$;
DROP FUNCTION public.list_public_menu_outdoor(text);
DROP FUNCTION public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz);
DROP FUNCTION public.list_menu_outdoor_slides(uuid);
DROP TRIGGER menu_outdoor_slide_validate ON public.menu_outdoor_slides;
DROP FUNCTION public._validate_menu_outdoor_slide();
DROP TABLE public.menu_outdoor_slides;
