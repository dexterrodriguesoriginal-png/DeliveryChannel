-- Tela Inicial: draft/publish isolados; público só published de loja ACTIVE; sem PII.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MANAGER 'a0000000-0000-0000-0000-000000000002'
\set OPERATOR 'a0000000-0000-0000-0000-000000000003'
\set CLIENT 'a0000000-0000-0000-0000-000000000007'
\set OWNERB 'b0000000-0000-0000-0000-000000000001'
\set CEO 'c0000000-0000-0000-0000-000000000001'
RESET ROLE;
SELECT t.login(NULL);

SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.store_home_designs'::regclass),'HOME tabela com RLS');
SELECT t.ok(NOT has_table_privilege('anon','public.store_home_designs','SELECT')
  AND NOT has_table_privilege('authenticated','public.store_home_designs','SELECT')
  AND NOT has_table_privilege('authenticated','public.store_home_designs','INSERT'),'HOME sem acesso direto à tabela');
SELECT t.ok(NOT has_function_privilege('anon','public.store_home_get_private(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.store_home_save_draft(uuid,jsonb,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','public.store_home_publish(uuid,integer)','EXECUTE'),'HOME anon sem gestão');
SELECT t.ok(has_function_privilege('anon','public.store_home_get_published(text)','EXECUTE'),'HOME anon lê published');

SELECT jsonb_build_object(
  'version',1,
  'templateId','adega-noite',
  'headerTitle','Bem-vindo(a)!',
  'title','O que você deseja fazer hoje?',
  'subtitle','',
  'tagline','BEBIDAS • PETISCOS',
  'footerTitle','OFERTAS ESPECIAIS',
  'backgroundMode','full',
  'backgroundUrl','https://cdn.example.com/bg.webp',
  'topBannerUrl','',
  'bottomBannerUrl','',
  'backgroundPositionY',40,
  'overlayOpacity',0.55,
  'backgroundBlur',2,
  'logoSize',96,
  'logoPosition','center',
  'showFooter',true,
  'actions',jsonb_build_array('MENU','TABLE','PICKUP','DELIVERY','ACCOUNT','WAITER')
) AS good_design \gset

SET ROLE authenticated;
SELECT t.login(NULL);
SELECT t.throws(format('SELECT public.store_home_get_private(%L)',:'A'),'FORBIDDEN','HOME JWT ausente não lê rascunho');

SELECT t.login(:'OWNER'::uuid);
SELECT public.store_home_save_draft(:'A',:'good_design'::jsonb,0) AS rev1 \gset
SELECT t.is(:'rev1'::integer,1,'HOME dono salva rascunho na revisão 1');
SELECT t.is((public.store_home_get_private(:'A')->>'revision')::integer,1,'HOME get_private devolve revisão');
SELECT t.is(public.store_home_get_private(:'A')->'draft'->>'templateId','adega-noite','HOME draft preserva template');
SELECT t.is(public.store_home_get_published('adega-a'),NULL::jsonb,'HOME publicado ainda ausente');

SELECT public.store_home_publish(:'A',1) AS published \gset
SELECT t.is(:'published'::jsonb->>'templateId','adega-noite','HOME publish devolve design limpo');
SELECT t.is(public.store_home_get_private(:'A')->'published'->>'tagline','BEBIDAS • PETISCOS','HOME published no privado');

-- Concorrência
SELECT t.throws(format('SELECT public.store_home_save_draft(%L,%L::jsonb,1)',:'A',:'good_design'),'DESIGN_VERSION_CONFLICT','HOME revisão velha recusada');

-- Design inválido
SELECT t.throws(format('SELECT public.store_home_save_draft(%L,%L::jsonb,2)',:'A','{"version":1}'),'INVALID_HOME_DESIGN','HOME sem actions inválido');
SELECT t.throws(format('SELECT public.store_home_save_draft(%L,%L::jsonb,2)',:'A',
  replace(:'good_design','https://cdn.example.com/bg.webp','javascript:alert(1)')),'INVALID_HOME_DESIGN','HOME javascript bloqueado');
SELECT t.throws(format('SELECT public.store_home_save_draft(%L,%L::jsonb,2)',:'A',
  replace(:'good_design','https://cdn.example.com/bg.webp','http://cdn.example.com/bg.webp')),'INVALID_HOME_DESIGN','HOME http bloqueado');

SELECT t.login(:'MANAGER'::uuid);
SELECT public.store_home_save_draft(:'A', (:'good_design'::jsonb || '{"title":"Gerente ok"}'::jsonb), 2) AS rev3 \gset
SELECT t.is(:'rev3'::integer,3,'HOME gerente salva na própria loja');

SELECT t.login(:'OWNERB'::uuid);
SELECT t.throws(format('SELECT public.store_home_get_private(%L)',:'A'),'FORBIDDEN','HOME dono B não lê loja A');
SELECT t.throws(format('SELECT public.store_home_save_draft(%L,%L::jsonb,0)',:'A',:'good_design'),'FORBIDDEN','HOME dono B não escreve em A');
SELECT public.store_home_save_draft(:'B',:'good_design'::jsonb,0);
SELECT public.store_home_publish(:'B',1);

SELECT t.login(:'OPERATOR'::uuid);
SELECT t.throws(format('SELECT public.store_home_get_private(%L)',:'A'),'FORBIDDEN','HOME operador sem permissão');

SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws(format('SELECT public.store_home_save_draft(%L,%L::jsonb,0)',:'A',:'good_design'),'FORBIDDEN','HOME cliente não escreve');

SELECT t.login(:'CEO'::uuid);
SELECT t.throws(format('SELECT public.store_home_get_private(%L)',:'A'),'FORBIDDEN','HOME CEO sem vínculo não acessa');

SET ROLE anon;
SELECT t.login(NULL);
SELECT t.is(public.store_home_get_published('adega-a')->>'templateId','adega-noite','HOME público lê published A');
SELECT t.is(public.store_home_get_published('adega-b')->>'templateId','adega-noite','HOME público lê published B');
SELECT t.is(public.store_home_get_published('nao-existe'),NULL::jsonb,'HOME slug inexistente');
SELECT t.ok(NOT (COALESCE(public.store_home_get_published('adega-a')::text,'') ~ 'tenant_id|email|phone|customer|session|password|user_id'),'HOME projeção pública sem PII');
SELECT t.is(t.visible('SELECT * FROM public.store_home_designs'),(-1)::bigint,'HOME consulta direta pública proibida');

-- Loja inativa some do público
RESET ROLE;
SELECT t.login(NULL);
UPDATE public.tenants SET status='INACTIVE' WHERE id=:'A';
SET ROLE anon;
SELECT t.is(public.store_home_get_published('adega-a'),NULL::jsonb,'HOME loja inativa não publica design');
RESET ROLE;
UPDATE public.tenants SET status='ACTIVE' WHERE id=:'A';
