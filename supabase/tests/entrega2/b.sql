-- Outdoor público sem dados pessoais; gestão isolada por vínculo real no servidor.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MANAGER 'a0000000-0000-0000-0000-000000000002'
\set OPERATOR 'a0000000-0000-0000-0000-000000000003'
\set CLIENT 'a0000000-0000-0000-0000-000000000007'
\set OWNERB 'b0000000-0000-0000-0000-000000000001'
\set CEO 'c0000000-0000-0000-0000-000000000001'
\set SUPER 'c0000000-0000-0000-0000-000000000002'
\set ASSETA 'e2080000-0000-0000-0000-000000000001'
\set ASSETB 'e2080000-0000-0000-0000-000000000002'
\set VIDEO 'e2080000-0000-0000-0000-000000000003'
\set PRIVATE 'e2080000-0000-0000-0000-000000000004'
\set BADPATH 'e2080000-0000-0000-0000-000000000005'
RESET ROLE;
SELECT t.login(NULL);
INSERT INTO public.marketing_media_assets(id,tenant_id,kind,media_type,extension,private_path,public_path,status,duration_seconds)
VALUES
(:'ASSETA',:'A','CREATIVE','IMAGE','webp',:'A'||'/drafts/'||:'ASSETA'||'.webp',:'A'||'/published/'||:'ASSETA'||'.webp','PUBLISHED',NULL),
(:'ASSETB',:'B','CREATIVE','IMAGE','png',:'B'||'/drafts/'||:'ASSETB'||'.png',:'B'||'/published/'||:'ASSETB'||'.png','PUBLISHED',NULL),
(:'VIDEO',:'A','CREATIVE','VIDEO','mp4',:'A'||'/drafts/'||:'VIDEO'||'.mp4',:'A'||'/published/'||:'VIDEO'||'.mp4','PUBLISHED',10),
(:'PRIVATE',:'A','CREATIVE','IMAGE','jpg',:'A'||'/drafts/'||:'PRIVATE'||'.jpg',NULL,'UPLOADED',NULL),
(:'BADPATH',:'A','CREATIVE','IMAGE','jpg',:'A'||'/drafts/'||:'BADPATH'||'.jpg','javascript:alert(1)','PUBLISHED',NULL);
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.menu_outdoor_slides'::regclass),'2.B tabela com RLS');
SELECT t.ok(NOT has_table_privilege('anon','public.menu_outdoor_slides','SELECT'),'2.B anon sem leitura direta');
SELECT t.ok(NOT has_table_privilege('authenticated','public.menu_outdoor_slides','INSERT') AND NOT has_table_privilege('authenticated','public.menu_outdoor_slides','UPDATE') AND NOT has_table_privilege('authenticated','public.menu_outdoor_slides','DELETE'),'2.B gravação somente por RPC validada');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid='public.menu_outdoor_slides'::regclass AND a.grantee=0) AND NOT has_table_privilege('service_role','public.menu_outdoor_slides','SELECT'),'2.B grants padrão legados não vazam leitura direta');
SELECT t.ok(NOT has_function_privilege('anon','public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz)','EXECUTE') AND NOT has_function_privilege('anon','public.list_menu_outdoor_slides(uuid)','EXECUTE'),'2.B anon sem gestão');
SET ROLE authenticated;
SELECT t.login(NULL);
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B JWT ausente não recebe gestão');
SELECT t.login(:'OWNER'::uuid);
SELECT public.save_menu_outdoor_slide(:'A',NULL,:'ASSETA','  Especial da casa  ','d0000000-0000-0000-0000-0000000000a1',2,true,NULL,NULL) AS slide \gset
SELECT t.is(:'slide'::jsonb->>'title','Especial da casa','2.B dono cria e normaliza título');
SELECT t.is(:'slide'::jsonb->>'public_path',:'A'||'/published/'||:'ASSETA'||'.webp','2.B mídia usa path público governado');
SELECT t.is(t.visible('SELECT * FROM public.menu_outdoor_slides'),1::bigint,'2.B dono lê somente sua loja via RLS');
SELECT t.throws(format('DELETE FROM public.menu_outdoor_slides WHERE id=%L',:'slide'::jsonb->>'id'),'permission denied','2.B nem dono apaga dados do outdoor diretamente');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,NULL,NULL)',:'A',:'ASSETB','Outra'),'MEDIA_INVALID','2.B asset de outra loja recusado');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,NULL,NULL)',:'A',:'PRIVATE','Privada'),'MEDIA_INVALID','2.B mídia privada não pode aparecer');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,NULL,NULL)',:'A',:'BADPATH','URL'),'MEDIA_INVALID','2.B javascript e paths externos recusados no servidor');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,%L,0,true,NULL,NULL)',:'A',:'ASSETA','Cruzado','d0000000-0000-0000-0000-0000000000b1'),'PRODUCT_INVALID','2.B vínculo de produto de outra loja recusado');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,-1,true,NULL,NULL)',:'A',:'ASSETA','Ordem'),'sort_order','2.B ordem negativa recusada');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,now(),now()-interval ''1 day'')',:'A',:'ASSETA','Data'),'schedule','2.B intervalo invertido recusado');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,NULL,NULL)',:'A',:'ASSETA',repeat('x',121)),'title','2.B título limitado no servidor');
SELECT t.login(:'MANAGER'::uuid);
SELECT public.save_menu_outdoor_slide(:'A',NULL,:'VIDEO','Vídeo',NULL,1,true,now()-interval '1 hour',now()+interval '1 hour') AS video_slide \gset
SELECT t.is(jsonb_array_length(public.list_menu_outdoor_slides(:'A')),2,'2.B gerente gerencia a própria loja');
SELECT public.save_menu_outdoor_slide(:'A',NULL,:'ASSETA','Pausado',NULL,0,false,NULL,NULL);
SELECT public.save_menu_outdoor_slide(:'A',NULL,:'ASSETA','Futuro',NULL,0,true,now()+interval '1 day',NULL);
SELECT public.save_menu_outdoor_slide(:'A',NULL,:'ASSETA','Encerrado',NULL,0,true,NULL,now()-interval '1 day');
SELECT t.login(:'OWNERB'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.menu_outdoor_slides'),0::bigint,'2.B RLS esconde outdoors de outra loja');
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B dono B não lê gestão A');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,%L,%L,%L,NULL,0,true,NULL,NULL)',:'B',:'slide'::jsonb->>'id',:'ASSETB','Alteração'),'SLIDE_NOT_FOUND','2.B id A não pode ser atualizado fingindo tenant B');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,NULL,NULL)',:'A',:'ASSETA','Alteração'),'FORBIDDEN','2.B tenant fornecido pelo cliente não dá autoridade');
SELECT public.save_menu_outdoor_slide(:'B',NULL,:'ASSETB','Loja B',NULL,0,true,NULL,NULL);
SELECT t.login(:'OPERATOR'::uuid);
SELECT t.is(t.visible('SELECT * FROM public.menu_outdoor_slides'),0::bigint,'2.B operador não lê gestão');
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B operador sem permissão');
SELECT t.login(:'CLIENT'::uuid);
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,%L,NULL,0,true,NULL,NULL)',:'A',:'ASSETA','Ataque'),'FORBIDDEN','2.B cliente não escreve');
SELECT t.login(:'CEO'::uuid);
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B CEO sem vínculo não recebe acesso global');
SELECT t.login(:'SUPER'::uuid);
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B superadmin sem vínculo não recebe acesso global');
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.is(jsonb_array_length(public.list_public_menu_outdoor('adega-a')),2,'2.B público recebe só ativos dentro do agendamento');
SELECT t.is(public.list_public_menu_outdoor('adega-a')->0->>'title','Vídeo','2.B ordem de exibição determinística');
SELECT t.is(public.list_public_menu_outdoor('adega-a')->0->>'media_type','VIDEO','2.B mídia de vídeo disponível');
SELECT t.is(jsonb_array_length(public.list_public_menu_outdoor('adega-b')),1,'2.B slug isola a projeção pública');
SELECT t.is(public.list_public_menu_outdoor('nao-existe'),'[]'::jsonb,'2.B slug inexistente devolve lista vazia');
SELECT t.ok(NOT (public.list_public_menu_outdoor('adega-a')::text ~ 'tenant_id|asset_id|created|updated|phone|email|customer|session|private|cost_price|stock'),'2.B projeção pública sem dados pessoais ou operacionais');
SELECT t.ok((SELECT count(*)=6 FROM jsonb_object_keys(public.list_public_menu_outdoor('adega-a')->0)),'2.B projeção pública tem somente seis campos permitidos');
SELECT t.is(t.visible('SELECT * FROM public.menu_outdoor_slides'),(-1)::bigint,'2.B consulta direta pública proibida');
RESET ROLE;
UPDATE public.products SET is_active=false WHERE id='d0000000-0000-0000-0000-0000000000a1';
SET ROLE anon;
SELECT t.is(public.list_public_menu_outdoor('adega-a')->1->>'product_id',NULL::text,'2.B produto inativo deixa de ser linkado');
RESET ROLE;
UPDATE public.products SET is_active=true WHERE id='d0000000-0000-0000-0000-0000000000a1';
INSERT INTO public.categories(id,tenant_id,name,is_active) VALUES('e2080000-0000-0000-0000-000000000010',:'A','Categoria do outdoor',false);
UPDATE public.products SET category_id='e2080000-0000-0000-0000-000000000010' WHERE id='d0000000-0000-0000-0000-0000000000a1';
SET ROLE anon;
SELECT t.is(public.list_public_menu_outdoor('adega-a')->1->>'product_id',NULL::text,'2.B categoria inativa não divulga vínculo de produto');
RESET ROLE;
UPDATE public.categories SET is_active=true WHERE id=(SELECT category_id FROM public.products WHERE id='d0000000-0000-0000-0000-0000000000a1');
UPDATE public.marketing_media_assets SET status='UNPUBLISHED' WHERE id=:'VIDEO';
SET ROLE anon;
SELECT t.is(jsonb_array_length(public.list_public_menu_outdoor('adega-a')),1,'2.B despublicação de mídia retira o outdoor imediatamente');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.list_menu_outdoor_slides(:'A')) s WHERE s->>'id'=:'video_slide'::jsonb->>'id' AND s->>'public_path' IS NULL),'2.B gestão mantém mídia indisponível sem divulgar caminho privado');
SELECT t.lives(format('SELECT public.save_menu_outdoor_slide(%L,%L,%L,%L,NULL,1,false,NULL,NULL)',:'A',:'video_slide'::jsonb->>'id',:'VIDEO','Desativado'),'2.B é possível desativar outdoor com mídia despublicada');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,%L,%L,%L,NULL,1,true,NULL,NULL)',:'A',:'video_slide'::jsonb->>'id',:'VIDEO','Reativado'),'MEDIA_INVALID','2.B reativação exige republicar a mídia');
SELECT t.is(jsonb_array_length(public.list_menu_outdoor_slides(:'A')),5,'2.B pausar preserva o histórico do outdoor');
RESET ROLE;
UPDATE public.tenant_users SET status='INACTIVE' WHERE user_id=:'MANAGER' AND tenant_id=:'A';
SET ROLE authenticated;
SELECT t.login(:'MANAGER'::uuid);
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B vínculo inativo revoga acesso imediatamente');
RESET ROLE;
UPDATE public.tenant_users SET status='ACTIVE' WHERE user_id=:'MANAGER' AND tenant_id=:'A';
UPDATE public.tenants SET status='SUSPENDED' WHERE id=:'A';
SET ROLE anon;
SELECT t.is(public.list_public_menu_outdoor('adega-a'),'[]'::jsonb,'2.B loja suspensa não publica outdoors');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.list_menu_outdoor_slides(%L)',:'A'),'FORBIDDEN','2.B loja suspensa também bloqueia gestão');
RESET ROLE;
UPDATE public.tenants SET status='ACTIVE' WHERE id=:'A';
