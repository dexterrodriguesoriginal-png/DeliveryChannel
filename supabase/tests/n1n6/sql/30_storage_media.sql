-- N3: buckets marketing/marketing-public, policies de storage.objects simuladas, publicação auditada.
\set A '\'10000000-0000-0000-0000-00000000000a\''
SELECT t.ok((SELECT NOT public FROM storage.buckets WHERE id='marketing') AND (SELECT public FROM storage.buckets WHERE id='marketing-public'), 'buckets: marketing privado, marketing-public público');
SELECT t.is((SELECT file_size_limit FROM storage.buckets WHERE id='marketing'), 36700160::bigint, 'bucket: limite 35 MB');
SELECT t.ok(public.is_valid_marketing_path('10000000-0000-0000-0000-00000000000a/drafts/123e4567-e89b-12d3-a456-426614174000.png','marketing'), 'path válido');
SELECT t.ok(NOT public.is_valid_marketing_path('10000000-0000-0000-0000-00000000000a/drafts/../123e4567-e89b-12d3-a456-426614174000.png','marketing'), 'path com .. rejeitado');
SELECT t.ok(NOT public.is_valid_marketing_path('10000000-0000-0000-0000-00000000000a/published/123e4567-e89b-12d3-a456-426614174000.png','marketing'), 'segmento published não vale no bucket privado');
SELECT t.ok(NOT public.is_valid_marketing_path('10000000-0000-0000-0000-00000000000a/drafts/123e4567-e89b-12d3-a456-426614174000.svg','marketing'), 'extensão svg rejeitada');
SELECT t.ok(NOT public.is_valid_marketing_path('10000000-0000-0000-0000-00000000000a/drafts/123e4567-e89b-12d3-a456-426614174000.png ','marketing'), 'espaço rejeitado');

SET ROLE authenticated;
SELECT t.login('a0000000-0000-0000-0000-000000000001');
SELECT set_config('t.r1', public.register_marketing_asset(:A,'CREATIVE','IMAGE','png',1000)::text, false);
SELECT set_config('t.a1', current_setting('t.r1')::jsonb ->> 'asset_id', false);
SELECT set_config('t.p1', current_setting('t.r1')::jsonb ->> 'path', false);
SELECT t.ok(current_setting('t.p1') LIKE '10000000-0000-0000-0000-00000000000a/drafts/%.png', 'register: path {tenant}/drafts/{id}.png');
SELECT t.throws($$SELECT public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','CREATIVE','IMAGE','png',6000000)$$, 'MEDIA_TOO_LARGE', 'imagem > 5 MB recusada');
SELECT t.throws($$SELECT public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','CREATIVE','IMAGE','mp4',1000)$$, 'MEDIA_INVALID_EXTENSION', 'extensão incoerente com tipo recusada');
SELECT t.throws($$SELECT public.register_marketing_asset('10000000-0000-0000-0000-00000000000b','CREATIVE','IMAGE','png',1000)$$, 'MEDIA_FORBIDDEN', 'OWNER A não registra mídia em B');
-- upload simulado (INSERT em storage.objects sob RLS)
SELECT t.throws($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing','10000000-0000-0000-0000-00000000000a/drafts/123e4567-e89b-12d3-a456-426614174000.png','{"mimetype":"image/png","size":1000}')$$, 'row-level security', 'storage: upload em path não registrado negado');
SELECT t.throws($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing','10000000-0000-0000-0000-00000000000b/drafts/123e4567-e89b-12d3-a456-426614174000.png','{"mimetype":"image/png","size":1000}')$$, 'row-level security', 'storage: upload no tenant B negado');
SELECT t.lives(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing',%L,'{"mimetype":"image/png","size":1000}')$$, current_setting('t.p1')), 'storage: OWNER faz upload no path registrado');
SELECT t.lives(format($$SELECT public.confirm_marketing_upload(%L, 1080, 1920, NULL)$$, current_setting('t.a1')), 'confirm_upload lê metadata do servidor');
SELECT t.is(t.sq(format($$SELECT status || '/' || mime_type || '/' || size_bytes FROM public.marketing_media_assets WHERE id = %L$$, current_setting('t.a1'))), 'UPLOADED/image/png/1000', 'asset UPLOADED com mime/tamanho do storage');
SELECT t.throws(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing',%L,'{"mimetype":"image/png","size":1}')$$, current_setting('t.p1')), 'row-level security|duplicate', 'storage: sem sobrescrita após confirmação');
SELECT t.lives(format($$UPDATE storage.objects SET metadata = '{"mimetype":"image/png","size":5}' WHERE name = %L$$, current_setting('t.p1')), 'storage UPDATE não tem policy (0 linhas)');
SELECT t.is(t.sq(format($$SELECT metadata->>'size' FROM storage.objects WHERE name = %L$$, current_setting('t.p1'))), '1000', 'storage: UPDATE não alterou o objeto');
-- MIME divergente
SELECT set_config('t.r2', public.register_marketing_asset(:A,'CREATIVE','IMAGE','png',1000)::text, false);
SELECT t.lives(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing',%L,'{"mimetype":"image/jpeg","size":1000}')$$, current_setting('t.r2')::jsonb ->> 'path'), 'upload com mime divergente');
SELECT t.throws(format($$SELECT public.confirm_marketing_upload(%L, NULL, NULL, NULL)$$, current_setting('t.r2')::jsonb ->> 'asset_id'), 'MEDIA_MIME_MISMATCH', 'confirm recusa mime que não confere com extensão');
-- PRIVATE nunca publica
SELECT set_config('t.r3', public.register_marketing_asset(:A,'PRIVATE','IMAGE','jpg',1000)::text, false);
SELECT t.ok((current_setting('t.r3')::jsonb ->> 'path') LIKE '%/private/%', 'PRIVATE vai para /private/');
SELECT t.lives(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing',%L,'{"mimetype":"image/jpeg","size":1000}')$$, current_setting('t.r3')::jsonb ->> 'path'), 'upload PRIVATE');
SELECT t.lives(format($$SELECT public.confirm_marketing_upload(%L, NULL, NULL, NULL)$$, current_setting('t.r3')::jsonb ->> 'asset_id'), 'confirm PRIVATE');
SELECT t.throws(format($$SELECT public.request_publish_marketing_asset(%L)$$, current_setting('t.r3')::jsonb ->> 'asset_id'), 'MEDIA_PRIVATE', 'PRIVATE não publica');
-- Publicação
SELECT set_config('t.pub', public.request_publish_marketing_asset(current_setting('t.a1')::uuid)::text, false);
SELECT t.is(current_setting('t.pub')::jsonb ->> 'status', 'PUBLISHING', 'request_publish → PUBLISHING');
SELECT t.throws(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing-public',%L,'{"mimetype":"image/png","size":1000}')$$, replace(current_setting('t.pub')::jsonb ->> 'target_path', '/published/', '/drafts/')), 'row-level security', 'storage público: só path published');
SELECT t.lives(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing-public',%L,'{"mimetype":"image/png","size":1000}')$$, current_setting('t.pub')::jsonb ->> 'target_path'), 'cópia para marketing-public (asset em PUBLISHING)');
SELECT t.is(public.confirm_publish_marketing_asset(current_setting('t.a1')::uuid) ->> 'status', 'PUBLISHED', 'confirm_publish → PUBLISHED');
SELECT t.lives(format($$DELETE FROM storage.objects WHERE bucket_id='marketing-public' AND name = %L$$, current_setting('t.pub')::jsonb ->> 'target_path'), 'DELETE do público enquanto PUBLISHED não remove (RLS)');
SELECT t.is(t.sq(format($$SELECT count(*) FROM storage.objects WHERE bucket_id='marketing-public' AND name = %L$$, current_setting('t.pub')::jsonb ->> 'target_path')), '1', 'objeto publicado continua');
SELECT t.lives(format($$DELETE FROM storage.objects WHERE bucket_id='marketing' AND name = %L$$, current_setting('t.p1')), 'DELETE do original enquanto PUBLISHED não remove (RLS)');
SELECT t.is(t.sq(format($$SELECT count(*) FROM storage.objects WHERE bucket_id='marketing' AND name = %L$$, current_setting('t.p1'))), '1', 'original preservado enquanto publicado');
-- Despublicar
SELECT t.throws(format($$SELECT public.unpublish_marketing_asset(%L, '')$$, current_setting('t.a1')), 'REASON_REQUIRED', 'despublicar exige motivo');
SELECT t.is(public.unpublish_marketing_asset(current_setting('t.a1')::uuid, 'campanha encerrada') ->> 'status', 'UNPUBLISHED', 'despublicação (RPC distinta)');
SELECT t.lives(format($$DELETE FROM storage.objects WHERE bucket_id='marketing-public' AND name = %L$$, current_setting('t.pub')::jsonb ->> 'target_path'), 'remove o objeto público após despublicar');
SELECT t.is(t.sq(format($$SELECT count(*) FROM storage.objects WHERE bucket_id='marketing-public' AND name = %L$$, current_setting('t.pub')::jsonb ->> 'target_path')), '0', 'objeto público removido');
SELECT t.is(public.archive_marketing_asset(current_setting('t.a1')::uuid, 'fim') ->> 'status', 'ARCHIVED', 'arquivar');
-- Falha de publicação (objeto divergente)
SELECT set_config('t.r4', public.register_marketing_asset(:A,'CREATIVE','IMAGE','webp',2000)::text, false);
SELECT t.lives(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing',%L,'{"mimetype":"image/webp","size":2000}')$$, current_setting('t.r4')::jsonb ->> 'path'), 'upload webp');
SELECT t.lives(format($$SELECT public.confirm_marketing_upload(%L, NULL, NULL, NULL)$$, current_setting('t.r4')::jsonb ->> 'asset_id'), 'confirm webp');
SELECT set_config('t.pub4', public.request_publish_marketing_asset((current_setting('t.r4')::jsonb ->> 'asset_id')::uuid)::text, false);
SELECT t.lives(format($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing-public',%L,'{"mimetype":"image/webp","size":1}')$$, current_setting('t.pub4')::jsonb ->> 'target_path'), 'cópia divergente');
SELECT t.is(public.confirm_publish_marketing_asset((current_setting('t.r4')::jsonb ->> 'asset_id')::uuid) ->> 'error', 'PUBLISH_FAILED', 'objeto divergente → PUBLISH_FAILED, volta a UPLOADED');
-- Log append-only
SELECT t.throws($$INSERT INTO public.marketing_media_publication_log (tenant_id, asset_id, action, from_status, to_status, actor_user_id) VALUES ('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'PUBLISHED','A','B','a0000000-0000-0000-0000-000000000001')$$, 'permission denied', 'log: INSERT direto negado');
SELECT t.throws($$UPDATE public.marketing_media_publication_log SET reason = 'x'$$, 'permission denied', 'log: UPDATE negado');
SELECT t.throws($$DELETE FROM public.marketing_media_publication_log$$, 'permission denied', 'log: DELETE negado');
SELECT t.throws($$UPDATE public.marketing_media_assets SET status = 'PUBLISHED'$$, 'permission denied', 'assets: UPDATE direto negado');
SELECT t.is(t.sq(format($$SELECT string_agg(action || ':' || from_status || '>' || to_status, ',' ORDER BY id) FROM public.marketing_media_publication_log WHERE asset_id = %L$$, current_setting('t.a1'))),
    'PUBLISH_REQUESTED:UPLOADED>PUBLISHING,PUBLISHED:PUBLISHING>PUBLISHED,UNPUBLISHED:PUBLISHED>UNPUBLISHED,ARCHIVED:UNPUBLISHED>ARCHIVED', 'log completo da publicação/despublicação');
SELECT t.ok(t.sq(format($$SELECT bool_and(actor_user_id = 'a0000000-0000-0000-0000-000000000001')::text FROM public.marketing_media_publication_log WHERE asset_id = %L$$, current_setting('t.a1')))::boolean, 'log registra o ator (auth.uid())');
SELECT t.is(t.sq(format($$SELECT reason FROM public.marketing_media_publication_log WHERE asset_id = %L AND action='UNPUBLISHED'$$, current_setting('t.a1'))), 'campanha encerrada', 'log registra o motivo da despublicação');
SELECT t.ok(t.sq(format($$SELECT count(*) FROM public.audit_logs WHERE resource_id = %L AND action LIKE 'MEDIA_%%'$$, current_setting('t.a1')))::int = 4, 'cada ação também em audit_logs');
-- Outros papéis
SELECT t.login('a0000000-0000-0000-0000-000000000004');
SELECT t.throws($$SELECT public.register_marketing_asset('10000000-0000-0000-0000-00000000000a','CREATIVE','IMAGE','png',1000)$$, 'MEDIA_FORBIDDEN', 'CASHIER não registra mídia');
SELECT t.is(t.visible($$SELECT * FROM storage.objects WHERE bucket_id = 'marketing'$$), 0::bigint, 'CASHIER não lê bucket privado');
SELECT t.is(t.visible($$SELECT * FROM public.marketing_media_assets$$), 0::bigint, 'CASHIER não lê assets');
SELECT t.login('b0000000-0000-0000-0000-000000000001');
SELECT t.throws(format($$SELECT public.request_publish_marketing_asset(%L)$$, current_setting('t.r4')::jsonb ->> 'asset_id'), 'ASSET_NOT_FOUND', 'OWNER B não publica mídia de A');
SELECT t.is(t.visible($$SELECT * FROM storage.objects WHERE bucket_id = 'marketing'$$), 0::bigint, 'OWNER B não lê bucket privado de A');
SELECT t.login('c0000000-0000-0000-0000-000000000001');
SELECT t.is(t.visible($$SELECT * FROM public.marketing_media_assets$$), 0::bigint, 'F2: CEO não lê assets');
SELECT t.is(t.visible($$SELECT * FROM public.marketing_media_publication_log$$), 0::bigint, 'F2: CEO não lê log');
SELECT t.is(t.visible($$SELECT * FROM storage.objects WHERE bucket_id = 'marketing'$$), 0::bigint, 'F2: CEO não lê bucket privado');
SELECT t.login('a0000000-0000-0000-0000-000000000002');
SELECT t.ok(t.visible($$SELECT * FROM storage.objects WHERE bucket_id = 'marketing'$$) >= 3, 'MANAGER lê bucket privado do próprio tenant');
RESET ROLE;
SET ROLE anon;
SELECT t.login(NULL);
SELECT t.is(t.visible($$SELECT * FROM storage.objects WHERE bucket_id IN ('marketing','marketing-public')$$), 0::bigint, 'anon não lista marketing nem marketing-public');
SELECT t.throws($$INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('marketing-public','10000000-0000-0000-0000-00000000000a/published/123e4567-e89b-12d3-a456-426614174000.png','{}')$$, 'permission denied|row-level security', 'anon não envia arquivo');
RESET ROLE;
