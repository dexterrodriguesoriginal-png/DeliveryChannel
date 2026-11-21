// Tela inicial personalizada: migration + rollback em PGlite (fixture mínima das N3/N6).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const read = (p) => fs.readFileSync(p, 'utf8');
const T = '10000000-0000-0000-0000-000000000001', O = '10000000-0000-0000-0000-000000000002';
const U = '90000000-0000-0000-0000-000000000001';
const IMG = '50000000-0000-0000-0000-000000000001', VID = '50000000-0000-0000-0000-000000000002', LONG = '50000000-0000-0000-0000-000000000003',
  BIG = '50000000-0000-0000-0000-000000000004', DRAFT = '50000000-0000-0000-0000-000000000005', OTHER = '50000000-0000-0000-0000-000000000006',
  BIGVID = '50000000-0000-0000-0000-000000000007';
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION public.is_tenant_owner_or_manager(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.tenant',true)=$1::text AND current_setting('test.role',true) IN ('OWNER','MANAGER') $$;
GRANT EXECUTE ON FUNCTION public.is_tenant_owner_or_manager(uuid) TO authenticated;
CREATE TABLE public.tenants(id uuid PRIMARY KEY, slug text UNIQUE, name text);
CREATE TABLE public.tenant_modules (
 tenant_id uuid REFERENCES public.tenants(id), module_key text NOT NULL,
 enabled boolean NOT NULL DEFAULT false, config jsonb DEFAULT '{}'::jsonb,
 PRIMARY KEY (tenant_id,module_key),
 CONSTRAINT tenant_modules_module_key_check CHECK(module_key IN ('pos','loyalty','credit_tab'))
);
CREATE FUNCTION public.assert_tenant_module_enabled(p_tenant uuid,p_key text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.tenant_modules WHERE tenant_id=p_tenant AND module_key=p_key AND enabled) THEN
  RAISE EXCEPTION 'MODULE_DISABLED';
 END IF;
END $$;
CREATE FUNCTION public.set_tenant_module(p_tenant uuid,p_key text,p_enabled boolean,p_config jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_role text;
BEGIN
 -- Simula o SELECT real de tenant_users: usuário sem vínculo ativo => papel NULL.
 v_role := CASE WHEN current_setting('test.tenant',true) = p_tenant::text
   THEN NULLIF(current_setting('test.role',true), '') ELSE NULL END;
 IF v_role IS DISTINCT FROM 'OWNER' THEN RAISE EXCEPTION 'MODULE_OWNER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_key NOT IN ('pos', 'loyalty', 'credit_tab') THEN RAISE EXCEPTION 'MODULE_INVALID'; END IF;
 INSERT INTO public.tenant_modules(tenant_id,module_key,enabled) VALUES(p_tenant,p_key,p_enabled)
 ON CONFLICT(tenant_id,module_key) DO UPDATE SET enabled=excluded.enabled;
END $$;
CREATE TABLE public.marketing_media_assets(id uuid PRIMARY KEY, tenant_id uuid REFERENCES public.tenants(id), kind text, media_type text, status text,
  public_path text, private_path text, size_bytes bigint, width_px int, height_px int, duration_seconds numeric(8,3));
CREATE FUNCTION public._public_media_json(p_tenant uuid, p_asset uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('bucket','marketing-public','path',a.public_path,'mediaType',a.media_type,'width',a.width_px,'height',a.height_px,'durationSeconds',a.duration_seconds)
  FROM public.marketing_media_assets a WHERE a.id=p_asset AND a.tenant_id=p_tenant AND a.kind='CREATIVE' AND a.status='PUBLISHED' AND a.public_path IS NOT NULL $$;
CREATE FUNCTION public.get_public_store(p_slug text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug=p_slug) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('tenant', (SELECT jsonb_build_object('id',id,'slug',slug,'name',name) FROM public.tenants WHERE slug=p_slug), 'products', '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_public_store(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_store(text) TO anon, authenticated;
CREATE SCHEMA supabase_migrations;
INSERT INTO public.tenants VALUES ('${T}','loja','Loja'),('${O}','outra','Outra');
INSERT INTO public.marketing_media_assets VALUES
 ('${IMG}','${T}','CREATIVE','IMAGE','PUBLISHED','${T}/a.webp','${T}/p/a.webp',800000,1080,1920,NULL),
 ('${VID}','${T}','CREATIVE','VIDEO','PUBLISHED','${T}/v.mp4','${T}/p/v.mp4',9000000,1080,1920,9.8),
 ('${LONG}','${T}','CREATIVE','VIDEO','PUBLISHED','${T}/l.mp4','${T}/p/l.mp4',9000000,1080,1920,12),
 ('${BIG}','${T}','CREATIVE','IMAGE','PUBLISHED','${T}/b.png','${T}/p/b.png',4000000,1080,1920,NULL),
 ('${DRAFT}','${T}','CREATIVE','IMAGE','UPLOADED',NULL,'${T}/p/d.png',100000,1080,1920,NULL),
 ('${OTHER}','${O}','CREATIVE','IMAGE','PUBLISHED','${O}/o.png','${O}/p/o.png',100000,1080,1920,NULL),
 ('${BIGVID}','${T}','CREATIVE','VIDEO','PUBLISHED','${T}/bv.mp4','${T}/p/bv.mp4',20000000,1080,1920,8);
`);
const before = (await db.query(`SELECT pg_get_functiondef('public.get_public_store(text)'::regprocedure) d`)).rows[0].d;
const beforeModule = (await db.query(`SELECT pg_get_functiondef('public.set_tenant_module(uuid,text,boolean,jsonb)'::regprocedure) d`)).rows[0].d;
const baseline = (await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r;
const up = read('supabase/migrations/20261118000100_store_presentation_screen.sql').replace(/NOTIFY pgrst[^;]*;/g, '');
const down = read('supabase/rollback/20261118000100_store_presentation_screen_down.sql').replace(/NOTIFY pgrst[^;]*;/g, '');
await db.exec(up);

// Idempotência: reexecutar não altera a política, não recria dados nem perde a RPC original.
await db.exec(up);

const as = async (role, tenant, uid, fn) => {
  await db.exec(`SELECT set_config('test.role','${role}',false), set_config('test.tenant','${tenant}',false), set_config('test.uid','${uid}',false)`);
  try { return await fn(); } finally { await db.exec(`RESET ROLE`); }
};

// Sem tela: mesma resposta de antes + presentation null.
let s = (await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r;
assert.deepEqual({ ...s, presentation: undefined }, { ...baseline, presentation: undefined });
assert.equal(s.presentation, null);
assert.equal((await db.query(`SELECT public.get_public_store('nao-existe') r`)).rows[0].r, null);

// Papéis: anon, cliente, caixa e gerente de OUTRA loja não conseguem.
await db.exec('SET ROLE anon');
await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${IMG}')`), /permission denied/);
await assert.rejects(db.query(`SELECT * FROM public.tenant_presentation_screens`), /permission denied/);
await db.exec('RESET ROLE');
for (const [role, tenant] of [['CASHIER', T], ['CUSTOMER', T], ['OWNER', O]]) {
  await as(role, tenant, U, async () => {
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${IMG}')`), /FORBIDDEN/);
    await assert.rejects(db.query(`SELECT public.clear_presentation_screen('${T}')`), /FORBIDDEN/);
  });
}
// Sem usuário autenticado (uid nulo) também não.
await as('OWNER', T, '', async () => { await db.exec('SET ROLE authenticated'); await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${IMG}')`), /FORBIDDEN/); });

// Ferramenta começa desligada: gravação bloqueada; não há mídia pública.
await as('OWNER', T, U, async () => {
 await db.exec('SET ROLE authenticated');
 await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${IMG}')`), /MODULE_DISABLED/);
 await db.query(`SELECT public.set_tenant_module('${T}','store_presentation',true)`);
});
await as('MANAGER', O, U, async () => {
 await db.exec('SET ROLE authenticated');
 await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${IMG}')`), /FORBIDDEN/);
 await assert.rejects(db.query(`SELECT public.set_tenant_module('${T}','store_presentation',false)`), /MODULE_OWNER_REQUIRED|FORBIDDEN/);
});

// Regressão P1: vínculo inexistente deixa v_role NULL na SECURITY DEFINER.
for (const [role, tenant] of [['MANAGER', O], ['OWNER', O], ['', T]]) {
 await as(role, tenant, U, async () => {
  await db.exec('SET ROLE authenticated');
  for (const enabled of [true, false]) {
   await assert.rejects(
     db.query(`SELECT public.set_tenant_module('${T}','store_presentation',${enabled})`),
     /MODULE_OWNER_REQUIRED/
   );
  }
 });
}
assert.equal((await db.query(`SELECT enabled FROM public.tenant_modules
 WHERE tenant_id='${T}' AND module_key='store_presentation'`)).rows[0].enabled, true);
// Gerente realmente associado à própria loja continua autorizado.
await as('MANAGER', T, U, async () => {
 await db.exec('SET ROLE authenticated');
 await db.query(`SELECT public.set_tenant_module('${T}','store_presentation',true)`);
});

// Dono: escrita direta na tabela é proibida (só RPC).
await as('OWNER', T, U, async () => {
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query(`INSERT INTO public.tenant_presentation_screens(tenant_id,asset_id,media_type) VALUES ('${T}','${IMG}','IMAGE')`), /permission denied/);
  // Mídias inválidas.
  for (const [asset, re] of [[OTHER, /PRESENTATION_ASSET_INVALID/], [DRAFT, /PRESENTATION_ASSET_INVALID/], [LONG, /PRESENTATION_VIDEO_TOO_LONG/], [BIG, /PRESENTATION_IMAGE_TOO_LARGE/], [BIGVID, /PRESENTATION_VIDEO_TOO_LARGE/]]) {
    await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${asset}')`), re);
  }
  await assert.rejects(db.query(`SELECT public.set_presentation_screen('${T}','${IMG}', 9)`), /PRESENTATION_SECONDS_INVALID/);
  const r = (await db.query(`SELECT public.set_presentation_screen('${T}','${IMG}', 3, true) r`)).rows[0].r;
  assert.equal(r.mediaType, 'IMAGE'); assert.equal(Number(r.imageSeconds), 3); assert.equal(r.oncePerDay, true);
  const row = (await db.query(`SELECT tenant_id, media_type, updated_by FROM public.tenant_presentation_screens`)).rows;
  assert.equal(row.length, 1); assert.equal(row[0].updated_by, U);
});
// Leitura do painel isolada por loja.
await as('OWNER', O, U, async () => { await db.exec('SET ROLE authenticated'); assert.equal((await db.query(`SELECT * FROM public.tenant_presentation_screens`)).rows.length, 0); });

// Público (anon): só os campos publicados, sem caminho privado, ids internos ou usuário.
await db.exec('SET ROLE anon');
s = (await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r;
await db.exec('RESET ROLE');
assert.deepEqual(Object.keys(s.presentation).sort(), ['imageSeconds', 'media', 'oncePerDay']);
assert.equal(s.presentation.media.path, `${T}/a.webp`); assert.equal(s.presentation.media.bucket, 'marketing-public');
const txt = JSON.stringify(s.presentation);
for (const leak of ['/p/', U, IMG, 'private', 'updated']) assert.ok(!txt.includes(leak), `vazou ${leak}`);
assert.equal((await db.query(`SELECT public.get_public_store('outra') r`)).rows[0].r.presentation, null);

// Vídeo até 10 s troca a tela (upsert); gerente também pode.
await as('MANAGER', T, U, async () => { await db.exec('SET ROLE authenticated'); await db.query(`SELECT public.set_presentation_screen('${T}','${VID}')`); });
s = (await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r;
assert.equal(s.presentation.media.mediaType, 'VIDEO'); assert.equal(Number(s.presentation.media.durationSeconds), 9.8);

// Desabilitar a ferramenta não apaga a mídia, mas remove a leitura pública.
await as('OWNER', T, U, async () => {
 await db.exec('SET ROLE authenticated');
 await db.query(`SELECT public.set_tenant_module('${T}','store_presentation',false)`);
});
assert.equal((await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r.presentation, null);
assert.equal((await db.query(`SELECT count(*)::int c FROM public.tenant_presentation_screens`)).rows[0].c, 1);
await as('MANAGER', T, U, async () => {
 await db.exec('SET ROLE authenticated');
 await db.query(`SELECT public.set_tenant_module('${T}','store_presentation',true)`);
});
assert.equal((await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r.presentation.media.mediaType, 'VIDEO');

// Mídia despublicada some da vitrine sem erro.
await db.exec(`UPDATE public.marketing_media_assets SET status='UNPUBLISHED' WHERE id='${VID}'`);
assert.equal((await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r.presentation, null);
await db.exec(`UPDATE public.marketing_media_assets SET status='PUBLISHED' WHERE id='${VID}'`);

// ACL: funções privilegiadas fechadas para anon; base interna fechada para todos.
const acl = (await db.query(`SELECT has_function_privilege('anon','public.set_presentation_screen(uuid,uuid,numeric,boolean)','EXECUTE') a,
  has_function_privilege('authenticated','public._presentation_store_base(text)','EXECUTE') b,
  has_function_privilege('anon','public.get_public_store(text)','EXECUTE') c,
  (SELECT prosecdef FROM pg_proc WHERE oid='public.set_presentation_screen(uuid,uuid,numeric,boolean)'::regprocedure) d`)).rows[0];
assert.deepEqual(acl, { a: false, b: false, c: true, d: true });

// Rollback recusa com dados; limpa e reverte para a definição exata.
await assert.rejects(db.exec(down), /PRESENTATION DOWN/);
await db.exec('ROLLBACK').catch(() => {});
await as('OWNER', T, U, async () => { await db.exec('SET ROLE authenticated'); await db.query(`SELECT public.clear_presentation_screen('${T}')`); });
await db.exec(`DELETE FROM public.tenant_modules WHERE module_key='store_presentation'`);
await db.exec(down);
const after = (await db.query(`SELECT pg_get_functiondef('public.get_public_store(text)'::regprocedure) d`)).rows[0].d;
assert.equal(after, before);
assert.equal((await db.query(`SELECT pg_get_functiondef('public.set_tenant_module(uuid,text,boolean,jsonb)'::regprocedure) d`)).rows[0].d,beforeModule);
assert.deepEqual((await db.query(`SELECT public.get_public_store('loja') r`)).rows[0].r, baseline);
assert.equal((await db.query(`SELECT to_regclass('public.tenant_presentation_screens') t`)).rows[0].t, null);
// E aplica de novo depois do rollback.
await db.exec(up);
console.log('presentation_screen PGlite: OK');
