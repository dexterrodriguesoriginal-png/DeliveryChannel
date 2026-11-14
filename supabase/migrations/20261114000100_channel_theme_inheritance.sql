-- Existing tenants retain their published appearance. Only future tenants opt in.
BEGIN;
ALTER TABLE public.tenants ADD COLUMN channel_theme_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenants ALTER COLUMN channel_theme_default SET DEFAULT true;

-- Extend the existing strict validators without weakening their color/shape checks.
DO $$
DECLARE sig text; source text; anchor text; patched text;
BEGIN
 FOREACH sig IN ARRAY ARRAY['public._menu_theme_valid(jsonb)', 'public._totem_design_valid(jsonb)'] LOOP
  source := pg_get_functiondef(sig::regprocedure);
  anchor := CASE WHEN sig LIKE '%_menu_%' THEN '''fontFamily'',''radius'',''layout'']' ELSE '''preset'',''bannerRadius'',''colors'']' END;
  IF position(anchor IN source)=0 THEN RAISE EXCEPTION 'CHANNEL_THEME_VALIDATOR_MISMATCH: %',sig; END IF;
  patched := replace(source,anchor,replace(anchor,']',',''followApp'',''templateId'']'));
  patched := replace(patched,'RETURN true;', $check$
  IF p_VALUE ? 'followApp' AND jsonb_typeof(p_VALUE->'followApp') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  IF p_VALUE ? 'templateId' AND (jsonb_typeof(p_VALUE->'templateId') IS DISTINCT FROM 'string' OR (p_VALUE->>'templateId') !~ '^[a-z0-9_-]{1,100}$') THEN RETURN false; END IF;
  RETURN true;
$check$);
  patched := replace(patched,'p_VALUE',CASE WHEN sig LIKE '%_menu_%' THEN 'p_theme' ELSE 'p_cfg' END);
  IF sig LIKE '%_totem_%' THEN
   patched := replace(patched,'''followApp'',''templateId'']','''followApp'',''templateId'',''fontFamily'']');
   patched := replace(patched,'RETURN true;', $font$
   IF p_cfg ? 'fontFamily' AND (jsonb_typeof(p_cfg->'fontFamily') IS DISTINCT FROM 'string' OR (p_cfg->>'fontFamily') <> ALL(ARRAY['Inter','Poppins','Montserrat','Roboto','Playfair Display','Outfit','Plus Jakarta Sans'])) THEN RETURN false; END IF;
   RETURN true;
$font$);
  END IF;
  EXECUTE patched;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._menu_theme_public(p_theme jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN public._menu_theme_valid(p_theme) THEN jsonb_build_object(
  'background',p_theme->'background','surface',p_theme->'surface','text',p_theme->'text',
  'accent',p_theme->'accent','accentText',p_theme->'accentText','categoryActiveBg',p_theme->'categoryActiveBg',
  'fontFamily',p_theme->'fontFamily','radius',p_theme->'radius','layout',p_theme->'layout')
  || CASE WHEN p_theme ? 'followApp' THEN jsonb_build_object('followApp',p_theme->'followApp') ELSE '{}'::jsonb END
  || CASE WHEN p_theme ? 'templateId' THEN jsonb_build_object('templateId',p_theme->'templateId') ELSE '{}'::jsonb END
 ELSE public._menu_theme_default() END;
$$;

-- Internal helpers expose only the already validated public tokens and opt-in bit.
CREATE FUNCTION public._channel_menu_theme(p_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public._menu_theme_public(COALESCE(s.menu_theme,public._menu_theme_default())) ||
 jsonb_build_object('followApp',COALESCE((s.menu_theme->>'followApp')::boolean,t.channel_theme_default,false))
 FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.id=p_tenant;
$$;
CREATE FUNCTION public._channel_totem_design(p_tenant uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(s.totem_design,public._totem_design_default()) ||
 jsonb_build_object('followApp',COALESCE((s.totem_design->>'followApp')::boolean,t.channel_theme_default,false))
 FROM public.tenants t LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id WHERE t.id=p_tenant;
$$;
REVOKE ALL ON FUNCTION public._channel_menu_theme(uuid),public._channel_totem_design(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Patch only the token reads. Authentication and token/device checks stay intact.
DO $$
DECLARE sig text; source text; patched text;
BEGIN
 FOREACH sig IN ARRAY ARRAY['public.get_menu_theme(uuid)','public.get_public_store(text)','public.get_totem_design(uuid)','public.get_totem_store(text)','public.totem_current_device(text)'] LOOP
  IF to_regprocedure(sig) IS NULL THEN
   RAISE EXCEPTION 'CHANNEL_THEME_RPC_MISSING: %',sig;
  END IF;
  source := pg_get_functiondef(sig::regprocedure);
  patched := source;
  IF sig='public.get_menu_theme(uuid)' THEN
   patched := replace(source,'COALESCE((SELECT public._menu_theme_public(s.menu_theme) FROM public.tenant_settings s WHERE s.tenant_id=p_tenant),public._menu_theme_default())','public._channel_menu_theme(p_tenant)');
  ELSIF sig='public.get_public_store(text)' THEN
   patched := replace(source,'public._menu_theme_public((SELECT s.menu_theme FROM public.tenant_settings s WHERE s.tenant_id=v_tenant.id))','public._channel_menu_theme(v_tenant.id)');
  ELSE
   patched := regexp_replace(source,'COALESCE\(\(SELECT s.totem_design FROM public.tenant_settings s WHERE s.tenant_id = (p_tenant|v_tenant)\), public._totem_design_default\(\)\)','public._channel_totem_design(\1)','g');
  END IF;
  IF patched=source THEN RAISE EXCEPTION 'CHANNEL_THEME_READ_MISMATCH: %',sig; END IF;
  EXECUTE patched;
 END LOOP;
END $$;
COMMENT ON COLUMN public.tenants.channel_theme_default IS 'Migration boundary: false for existing stores, true for new stores. Explicit per-channel followApp overrides it.';
-- Enforce AA on new independent writes, while leaving all published legacy JSON intact.
CREATE FUNCTION public._channel_contrast(fg text,bg text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE color text; lum numeric[] := '{}'; value numeric; total numeric; i integer;
BEGIN
 IF fg IS NULL OR bg IS NULL OR fg !~ '^#[0-9a-fA-F]{6}$' OR bg !~ '^#[0-9a-fA-F]{6}$' THEN RETURN 0; END IF;
 FOREACH color IN ARRAY ARRAY[fg,bg] LOOP
  total:=0;
  FOR i IN 0..2 LOOP
   value:=(('x'||substr(color,2+i*2,2))::bit(8)::integer)/255.0;
   value:=CASE WHEN value<=0.04045 THEN value/12.92 ELSE power((value+0.055)/1.055,2.4) END;
   total:=total+value*(ARRAY[0.2126,0.7152,0.0722])[i+1];
  END LOOP;
  lum:=array_append(lum,total);
 END LOOP;
 RETURN (greatest(lum[1],lum[2])+0.05)/(least(lum[1],lum[2])+0.05);
END $$;
REVOKE ALL ON FUNCTION public._channel_contrast(text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE source text; patched text;
BEGIN
 source:=pg_get_functiondef('public.set_menu_theme(uuid,jsonb)'::regprocedure);
 patched:=replace(source,'IF NOT public._menu_theme_valid(p_theme) THEN', $guard$
 IF NOT public._menu_theme_valid(p_theme) OR (COALESCE(p_theme->>'followApp','false')<>'true' AND (
  public._channel_contrast(p_theme->>'text',p_theme->>'background')<4.5 OR
  public._channel_contrast(p_theme->>'text',p_theme->>'surface')<4.5 OR
  public._channel_contrast(p_theme->>'accent',p_theme->>'surface')<4.5 OR
  public._channel_contrast(p_theme->>'accent',p_theme->>'background')<4.5 OR
  public._channel_contrast(p_theme->>'accentText',p_theme->>'accent')<4.5 OR
  public._channel_contrast(p_theme->>'accentText',p_theme->>'categoryActiveBg')<4.5)) THEN
$guard$);
 IF patched=source THEN RAISE EXCEPTION 'CHANNEL_THEME_MENU_WRITE_MISMATCH'; END IF;
 EXECUTE patched;
 source:=pg_get_functiondef('public.set_totem_design(uuid,jsonb)'::regprocedure);
 patched:=replace(source,'IF NOT public._totem_design_valid(p_cfg) THEN', $guard$
 IF NOT public._totem_design_valid(p_cfg) OR (COALESCE(p_cfg->>'followApp','false')<>'true' AND EXISTS(
  SELECT 1 FROM (VALUES
   ('sidebarCardText','sidebarCardBg'),('sidebarCardActiveText','sidebarCardActiveBg'),
   ('productCardText','productCardBg'),('productPrice','productCardBg'),('addButtonText','addButtonBg'),
   ('orderPanelText','orderPanelBg'),('checkoutButtonText','checkoutButtonBg')
  ) pairs(fg,bg) WHERE public._channel_contrast(p_cfg->'colors'->>fg,p_cfg->'colors'->>bg)<4.5)) THEN
$guard$);
 IF patched=source THEN RAISE EXCEPTION 'CHANNEL_THEME_TOTEM_WRITE_MISMATCH'; END IF;
 EXECUTE patched;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
