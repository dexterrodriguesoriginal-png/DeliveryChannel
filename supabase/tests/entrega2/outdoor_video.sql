-- 20261105000300: vídeo de até 5 min/200 MB, banner do YouTube (somente id) e exclusão isolada por loja.
\set A '10000000-0000-0000-0000-00000000000a'
\set B '10000000-0000-0000-0000-00000000000b'
\set OWNER 'a0000000-0000-0000-0000-000000000001'
\set MANAGER 'a0000000-0000-0000-0000-000000000002'
\set OPERATOR 'a0000000-0000-0000-0000-000000000003'
\set OWNERB 'b0000000-0000-0000-0000-000000000001'
\set ASSETA 'e2080000-0000-0000-0000-000000000001'
\set BIG 'e2080000-0000-0000-0000-0000000000b1'
\set YT 'dQw4w9WgXcQ'
RESET ROLE;
SELECT t.login(NULL);
SELECT t.is((SELECT string_agg(id||':'||file_size_limit,',' ORDER BY id) FROM storage.buckets WHERE id LIKE 'marketing%'),
  'marketing:209715200,marketing-public:209715200','OV buckets de marketing aceitam 200 MiB');
SELECT t.lives(format($q$INSERT INTO public.marketing_media_assets(id,tenant_id,kind,media_type,extension,private_path,size_bytes)
  VALUES(%L,%L,'CREATIVE','VIDEO','mp4',%L,150000000)$q$,:'BIG',:'A',:'A'||'/drafts/'||:'BIG'||'.mp4'),'OV vídeo de 150 MB cabe na regra da tabela');
SELECT t.throws(format($q$UPDATE public.marketing_media_assets SET size_bytes=209715201 WHERE id=%L$q$,:'BIG'),'mma_size_limits','OV vídeo acima de 200 MiB recusado na tabela');
SELECT t.throws(format($q$UPDATE public.marketing_media_assets SET media_type='IMAGE',extension='png',size_bytes=5242881 WHERE id=%L$q$,:'BIG'),'mma_size_limits','OV imagem continua limitada a 5 MiB');
SELECT t.ok(NOT has_function_privilege('anon','public.delete_menu_outdoor_slide(uuid,uuid)','EXECUTE'),'OV anon não exclui');
SELECT t.ok(NOT has_table_privilege('authenticated','public.menu_outdoor_slides','DELETE'),'OV exclusão somente via RPC');
SELECT t.ok(NOT has_function_privilege('anon','public.save_menu_outdoor_slide(uuid,uuid,uuid,text,uuid,integer,boolean,timestamptz,timestamptz,text)','EXECUTE'),'OV anon sem gestão');
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.ok((public.register_marketing_asset(:'A','CREATIVE','VIDEO','mp4',209715200)->>'max_bytes')::bigint=209715200,'OV dono registra vídeo de 200 MiB');
SELECT t.throws(format('SELECT public.register_marketing_asset(%L,''CREATIVE'',''VIDEO'',''mp4'',209715201)',:'A'),'MEDIA_TOO_LARGE','OV registro acima de 200 MiB recusado');
SELECT t.throws(format('SELECT public.register_marketing_asset(%L,''CREATIVE'',''IMAGE'',''png'',5242881)',:'A'),'MEDIA_TOO_LARGE','OV imagem acima de 5 MiB recusada');
SELECT public.register_marketing_asset(:'A','CREATIVE','VIDEO','mp4',1000) AS reg \gset
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('marketing',:'reg'::jsonb->>'path',jsonb_build_object('mimetype','video/mp4','size',150000000));
SET ROLE authenticated;
SELECT t.login(:'OWNER'::uuid);
SELECT t.throws(format('SELECT public.confirm_marketing_upload(%L,1920,1080,301)',:'reg'::jsonb->>'asset_id'),'MEDIA_TOO_LONG','OV vídeo acima de 5 minutos recusado no servidor');
SELECT t.is(public.confirm_marketing_upload((:'reg'::jsonb->>'asset_id')::uuid,1920,1080,300)->>'status','UPLOADED','OV vídeo de 5 min e 150 MB confirmado');

-- YouTube
SELECT public.save_menu_outdoor_slide(:'A',NULL,NULL,'Promo YouTube',NULL,5,true,NULL,NULL,:'YT') AS yt \gset
SELECT t.is(:'yt'::jsonb->>'media_type','YOUTUBE','OV dono cria banner do YouTube');
SELECT t.is(:'yt'::jsonb->>'youtube_id',:'YT','OV id guardado sem URL');
SELECT t.ok(:'yt'::jsonb->>'asset_id' IS NULL AND :'yt'::jsonb->>'public_path' IS NULL,'OV YouTube sem mídia de storage');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,NULL,''x'',NULL,0,true,NULL,NULL,%L)',:'A','https://evil.example/x'),'youtube_id|YOUTUBE_INVALID','OV URL arbitrária recusada');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,NULL,''x'',NULL,0,true,NULL,NULL,%L)',:'A','"><script>a'),'youtube_id|YOUTUBE_INVALID','OV HTML recusado');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,NULL,''x'',NULL,0,true,NULL,NULL,%L)',:'A','dQw4w9WgXc'),'youtube_id|YOUTUBE_INVALID','OV id curto recusado');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,''x'',NULL,0,true,NULL,NULL,%L)',:'A',:'ASSETA',:'YT'),'MEDIA_INVALID','OV mídia e YouTube juntos recusados');
SELECT t.throws(format('SELECT public.save_menu_outdoor_slide(%L,NULL,NULL,''x'',NULL,0,true,NULL,NULL,NULL)',:'A'),'MEDIA_INVALID','OV banner sem mídia recusado');
SELECT t.lives(format('SELECT public.save_menu_outdoor_slide(%L,NULL,%L,''Compat'',NULL,9,false,NULL,NULL)',:'A',:'ASSETA'),'OV chamada antiga de 9 argumentos continua funcionando');
SELECT t.is((SELECT count(*) FROM jsonb_array_elements(public.list_public_menu_outdoor((SELECT slug FROM public.tenants WHERE id=:'A'))) e
  WHERE e->>'media_type'='YOUTUBE' AND e->>'youtube_id'=:'YT' AND e->>'public_path' IS NULL),1::bigint,'OV cardápio público recebe somente o id do YouTube');
SELECT t.ok((SELECT bool_and(e->>'public_path' IS NOT NULL) FROM jsonb_array_elements(public.list_public_menu_outdoor((SELECT slug FROM public.tenants WHERE id=:'A'))) e
  WHERE e->>'media_type' IN ('IMAGE','VIDEO')),'OV fotos e vídeos seguem no cardápio público');

-- Exclusão
SELECT public.save_menu_outdoor_slide(:'A',NULL,:'ASSETA','Apagar',NULL,7,true,NULL,NULL) AS del \gset
SELECT t.login(:'OWNERB'::uuid);
SELECT t.throws(format('SELECT public.delete_menu_outdoor_slide(%L,%L)',:'A',:'del'::jsonb->>'id'),'FORBIDDEN','OV dono de outra loja não exclui');
SELECT t.throws(format('SELECT public.delete_menu_outdoor_slide(%L,%L)',:'B',:'del'::jsonb->>'id'),'SLIDE_NOT_FOUND','OV id de outra loja não é excluído fingindo tenant');
SELECT t.login(:'OPERATOR'::uuid);
SELECT t.throws(format('SELECT public.delete_menu_outdoor_slide(%L,%L)',:'A',:'del'::jsonb->>'id'),'FORBIDDEN','OV operador não exclui');
SELECT t.login(NULL);
SELECT t.throws(format('SELECT public.delete_menu_outdoor_slide(%L,%L)',:'A',:'del'::jsonb->>'id'),'FORBIDDEN','OV sem login não exclui');
SELECT t.login(:'MANAGER'::uuid);
SELECT t.is(public.delete_menu_outdoor_slide(:'A',(:'del'::jsonb->>'id')::uuid)->>'deleted','true','OV gerente exclui banner da própria loja');
SELECT t.throws(format('SELECT public.delete_menu_outdoor_slide(%L,%L)',:'A',:'del'::jsonb->>'id'),'SLIDE_NOT_FOUND','OV exclusão repetida informa não encontrado');
SELECT t.ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.list_menu_outdoor_slides(:'A')) e WHERE e->>'id'=:'del'::jsonb->>'id'),'OV banner excluído sai da gestão');
RESET ROLE;
SELECT t.ok(EXISTS(SELECT 1 FROM public.marketing_media_assets WHERE id=:'ASSETA' AND status='PUBLISHED'),'OV mídia continua na biblioteca após excluir banner');
