/**
 * Rotas PWA por estabelecimento, servidas pelo próprio app (HTTPS do Cloud Run):
 *   GET /app/:slug/manifest.webmanifest
 *   GET /app/:slug/icons/(icon-192|icon-512|maskable-512).png
 * Somente leitura pública; slug validado; loja desconhecida => 404; cache por loja.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { buildStoreManifest, ManifestIcon, iconFallbackColor, storeDisplayName, storeIconVersion, storeAppIdentity, storeIdentityVersion, StoreIdentityInput } from '../../src/lib/pwa/storeManifest';
import { buildTotemManifest } from '../../src/lib/pwa/totemManifest';
import { storeAppCanonicalPath } from '../../src/lib/pwa/storeScopeUrl';
import { ICON_VARIANTS, IconVariant, isNearlyFlatPng, renderInitialsPng, renderStoreIconPng, SPLASH_TEST_ICON_VARIANTS, SplashTestIconVariant } from './icons';
import { DC_BRAND_SVG, DC_SPLASH_ICON_VERSION, SPLASH_TEST_COLOR } from './splashTest';
import { fetchPublicImage } from './safeFetch';
import { isValidSlug, StoreResolver, supabaseEnvFrom } from './storeSource';
import { RateLimiter } from '../payments/security';
import { splitStoreSegment, versionedAppId, versionedManifestPath, versionedStartUrl, versionedStoreScope } from '../../src/lib/pwa/appIdentity';
import { isVersionedStoreApp } from '../../src/lib/pwa/appVersionMode';

declare const __PWA_BUILD_VERSION__: string | undefined;

export interface PwaRouteOptions {
  resolveStore: StoreResolver;
  /** Pasta com os arquivos públicos (dist em produção, public em dev) para logos relativos (/demo/...). */
  publicDir: string;
  fetchLogo?: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
  ttlMs?: number;
  /** Idade máxima da leitura em cache servida ao HTML enquanto atualiza (padrão DEFAULT_HTML_STALE_MS). */
  htmlStaleMs?: number;
  logoTtlMs?: number;
  maxLogoCacheEntries?: number;
  maxLogoCacheBytes?: number;
  buildVersion?: string;
  /** Experimento da splash (server/pwa/splashTest.ts): slugs de TESTE. Padrão: nenhum. */
  splashTestSlugs?: Iterable<string>;
  /** Lista histórica do experimento (não altera manifestos canônicos). */
  identityTestSlugs?: Iterable<string>;
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export const IMMUTABLE_ICON_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const DEFAULT_LOGO_CACHE_TTL_MS = 60 * 1000;
export const RETRY_ICON_AFTER_SECONDS = 30;
export const DEFAULT_MAX_LOGO_CACHE_ENTRIES = 100;
export const DEFAULT_MAX_LOGO_CACHE_BYTES = 16 * 1024 * 1024;
export const MAX_SINGLE_LOGO_CACHE_BYTES = 2 * 1024 * 1024;

/** Regex para arquivos de build que contêm hash no nome (ex.: index-AbCd1234.js). */
export const HASHED_ASSET_RE = /-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg)$/i;

/**
 * Define o Cache-Control de arquivos estáticos do build:
 * - HTML, manifestos e sw.js: `no-cache`
 * - Somente assets com hash no nome (e nunca `/assets/aistudio/`): `public, max-age=31536000, immutable`
 * - Demais arquivos: `null` (mantém política padrão do static)
 */
export function staticAssetCacheControl(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const base = path.posix.basename(normalized);
  if (
    base.endsWith('.html') ||
    base === 'manifest.json' ||
    base.endsWith('.webmanifest') ||
    base === 'sw.js'
  ) {
    return 'no-cache';
  }
  if (!normalized.includes('/assets/aistudio/') && HASHED_ASSET_RE.test(base)) {
    return IMMUTABLE_ICON_CACHE_CONTROL;
  }
  return null;
}

const PROCESS_BOOT_VERSION = `build-${Date.now().toString(36)}`;
let cachedGitCommitVersion: string | null | undefined;

function readGitCommitShort(): string | null {
  if (cachedGitCommitVersion !== undefined) return cachedGitCommitVersion;
  try {
    const out = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    cachedGitCommitVersion = /^[0-9a-f]{7,40}$/i.test(out) ? out : null;
  } catch {
    cachedGitCommitVersion = null;
  }
  return cachedGitCommitVersion;
}

/**
 * Resolve a versão do build/deploy sem cair em string estática fixa:
 * 1. Variáveis de ambiente (PWA_BUILD_VERSION, K_REVISION, COMMIT_SHA, GITHUB_SHA)
 * 2. Constante injetada no build (__PWA_BUILD_VERSION__)
 * 3. Manifesto/hash gerado no dist (pwa-version.json ou hash de dist/index.html)
 * 4. Hash curto do commit git atual
 * 5. Identificador único de boot do processo
 */
export function resolveBuildVersion(publicDir?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = (
    env.PWA_BUILD_VERSION ||
    env.VITE_PWA_BUILD_VERSION ||
    env.K_REVISION ||
    env.COMMIT_SHA ||
    env.GITHUB_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    ''
  ).trim();
  if (fromEnv) return fromEnv;

  if (typeof __PWA_BUILD_VERSION__ === 'string' && __PWA_BUILD_VERSION__.trim()) {
    return __PWA_BUILD_VERSION__.trim();
  }

  if (publicDir) {
    try {
      const versionFile = path.resolve(publicDir, 'pwa-version.json');
      if (fsSync.existsSync(versionFile)) {
        const parsed = JSON.parse(fsSync.readFileSync(versionFile, 'utf8')) as { version?: string };
        if (parsed?.version && typeof parsed.version === 'string' && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
      const indexFile = path.resolve(publicDir, 'index.html');
      if (fsSync.existsSync(indexFile)) {
        const raw = fsSync.readFileSync(indexFile);
        return `dist-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
      }
    } catch {
      /* continua para fallback de git/boot */
    }
  }

  return readGitCommitShort() || PROCESS_BOOT_VERSION;
}

/**
 * Versão do ícone (?v=), igual em storeHtml.ts, applyStoreIdentity.identityHash e serverManifest.
 * Só muda quando a imagem do ícone muda (logo, ou nome/cor do ícone de iniciais). Só metadados, sem download.
 */
export function iconVersion(store: StoreIdentityInput): string {
  return storeIconVersion(store);
}

/** Versão da identidade (inclui cores/barras) para /api/pwa/version; nunca usada em URL de ícone. */
export function identityVersion(store: StoreIdentityInput): string {
  return storeIdentityVersion(store);
}

export function serverManifest(store: StoreIdentityInput, opts: { splashTest?: boolean } = {}) {
  const base = `/app/${encodeURIComponent(store.slug)}/icons`;
  const v = iconVersion(store);
  if (opts.splashTest) return splashTestManifest(store, base, v);
  const icons: ManifestIcon[] = [
    { src: `${base}/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/maskable-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  // origin '' => id/start_url/scope relativos à mesma origem do manifesto (HTTPS do app).
  return buildStoreManifest(store, '', icons);
}

/**
 * EXPERIMENTO (só slugs de teste): launcher = logo da loja (maskable 332), splash = Delivery Channel
 * (maskable 1024) em #121212. Ver server/pwa/splashTest.ts para a regra de escolha do Chrome.
 */
function splashTestManifest(store: StoreIdentityInput, base: string, v: string) {
  const icons: ManifestIcon[] = [
    { src: `${base}/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/splash-store-maskable-332.png?v=${v}`, sizes: '332x332', type: 'image/png', purpose: 'maskable' },
    { src: `${base}/splash-dc-maskable-1024.png?v=${DC_SPLASH_ICON_VERSION}`, sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
  ];
  return { ...buildStoreManifest(store, '', icons), theme_color: SPLASH_TEST_COLOR, background_color: SPLASH_TEST_COLOR };
}

/**
 * COMPATIBILIDADE LEGADA: manifesto da loja com id/start_url/scope do hash já instalado
 * (/app/<slug>~<hash>/). Não gerar novas identidades. Ver src/lib/pwa/appIdentity.ts.
 */
export function identityTestManifest(store: StoreIdentityInput, identity: string, opts: { splashTest?: boolean } = {}) {
  const m = serverManifest(store, opts);
  return {
    ...m,
    id: versionedAppId(store.id, identity),
    start_url: versionedStartUrl(store.slug, identity),
    scope: versionedStoreScope(store.slug, identity),
    related_applications: [{ platform: 'webapp', url: versionedManifestPath(store.slug, identity) }],
  };
}

export function serverTotemManifest(store: StoreIdentityInput) {
  const base = `/app/${encodeURIComponent(store.slug)}/icons`;
  const v = iconVersion(store);
  const icons: ManifestIcon[] = [
    { src: `${base}/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/maskable-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  const manifest = buildTotemManifest(store, '');
  return { ...manifest, icons };
}

export interface IdentityHeadOptions { manifestHref?: string; appIdentity?: string }

export type PwaRouter = Router & {
  lookupStore: (slug: string) => Promise<StoreIdentityInput | null>;
  /** Apenas rotas legadas ~hash recebem manifesto versionado. */
  identityHeadOptions: (store: StoreIdentityInput | null, identity: string | null) => IdentityHeadOptions;
  /** HTML usa identidade enriquecida com hash dos bytes da logo. */
  lookupStoreForHtml: (slug: string) => Promise<StoreIdentityInput | null>;
  /** Remove dados e ícones de um tenant após salvar seu Design do App. */
  invalidateStore: (slug: string, tenantId: string) => void;
};

/** Limite máximo para o HTML; invalidação explícita permite antecipar a atualização. */
export const DEFAULT_HTML_STALE_MS = 60 * 1000;

interface CachedLogoEntry {
  at: number;
  bytes: Buffer;
  contentType: string;
}

export function createPwaRouter(opts: PwaRouteOptions): PwaRouter {
  // Leitura fresca a cada solicitação para garantir identidade atual mesmo entre réplicas do servidor.
  const ttl = opts.ttlMs ?? 0;
  const logoTtlMs = opts.logoTtlMs ?? DEFAULT_LOGO_CACHE_TTL_MS;
  const maxLogoCacheEntries = opts.maxLogoCacheEntries ?? DEFAULT_MAX_LOGO_CACHE_ENTRIES;
  const maxLogoCacheBytes = opts.maxLogoCacheBytes ?? DEFAULT_MAX_LOGO_CACHE_BYTES;
  const publicRoot = path.resolve(opts.publicDir);
  const buildVersion = opts.buildVersion || resolveBuildVersion(publicRoot);
  const storeCache = new Map<string, { at: number; v: Awaited<ReturnType<StoreResolver>> }>();
  const logoCache = new Map<string, CachedLogoEntry>();
  let logoCacheBytes = 0;
  const iconCache = new Map<string, Buffer>();
  const fetchLogo = opts.fetchLogo ?? ((u: string) => fetchPublicImage(u));
  const splashTestSlugs = new Set(opts.splashTestSlugs ?? []);
  let dcSplashPng: Buffer | null = null;

  // Sem stale implícito: a próxima visita após salvar precisa consultar o tema atualizado.
  const htmlStaleMs = Math.min(opts.htmlStaleMs ?? 0, DEFAULT_HTML_STALE_MS);
  const cacheGeneration = new Map<string, number>();
  const inflight = new Map<string, Promise<Awaited<ReturnType<StoreResolver>>>>();
  const invalidateIpLimit = new RateLimiter(30, 60_000);
  const invalidateUserLimit = new RateLimiter(20, 60_000);

  /** Uma consulta por loja por vez (pedidos simultâneos dividem a mesma resposta). */
  function refresh(slug: string) {
    let job = inflight.get(slug);
    if (!job) {
      const generation = cacheGeneration.get(slug) ?? 0;
      job = opts.resolveStore(slug).then((v) => {
        if (v.status !== 'error' && (cacheGeneration.get(slug) ?? 0) === generation) storeCache.set(slug, { at: Date.now(), v });
        if (storeCache.size > 500) storeCache.delete(storeCache.keys().next().value as string);
        return v;
      }).finally(() => { if (inflight.get(slug) === job) inflight.delete(slug); });
      inflight.set(slug, job);
    }
    return job;
  }

  async function lookup(slug: string) {
    const hit = storeCache.get(slug);
    if (hit && Date.now() - hit.at < ttl) return hit.v;
    return refresh(slug);
  }

  /** Stale-while-revalidate só para o HTML: o manifesto e os ícones continuam sempre com a leitura fresca. */
  async function lookupForHtml(slug: string) {
    const hit = storeCache.get(slug);
    if (hit) {
      const age = Date.now() - hit.at;
      if (age < ttl) return hit.v;
      if (age < htmlStaleMs) {
        void refresh(slug).catch(() => undefined);
        return hit.v;
      }
    }
    return refresh(slug);
  }

  function invalidateStore(slug: string, tenantId: string) {
    cacheGeneration.set(slug, (cacheGeneration.get(slug) ?? 0) + 1);
    storeCache.delete(slug);
    inflight.delete(slug);
    // Todas as imagens/variantes antigas deste tenant ficam inválidas, inclusive URL mantida.
    for (const key of [...logoCache.keys()]) {
      if (key.startsWith(`${tenantId}|`)) evictLogoCacheEntry(key);
    }
    for (const key of [...iconCache.keys()]) {
      if (key.startsWith(`${tenantId}|`)) iconCache.delete(key);
    }
  }

  function evictLogoCacheEntry(key: string) {
    const existing = logoCache.get(key);
    if (existing) {
      logoCacheBytes = Math.max(0, logoCacheBytes - existing.bytes.byteLength);
      logoCache.delete(key);
    }
  }

  async function loadLogo(storeId: string, logoUrl: string | undefined, revision = ''): Promise<{ bytes: Buffer; contentType: string } | null> {
    const u = (logoUrl || '').trim();
    if (!u) return null;
    // updatedAt do tema torna o cache diferente em TODAS as réplicas após salvar.
    const cacheKey = `${storeId}|${u}|${revision}`;
    const now = Date.now();
    const cached = logoCache.get(cacheKey);
    if (cached) {
      if (now - cached.at < logoTtlMs) {
        return { bytes: cached.bytes, contentType: cached.contentType };
      }
      evictLogoCacheEntry(cacheKey);
    }

    let loaded: { bytes: Buffer; contentType: string } | null = null;
    try {
      if (u.startsWith('/') && !u.startsWith('//')) {
        const rel = decodeURIComponent(u.split(/[?#]/)[0]);
        const file = path.resolve(publicRoot, '.' + rel);
        if (!file.startsWith(publicRoot + path.sep)) return null;
        const ct = MIME_BY_EXT[path.extname(file).toLowerCase()];
        if (!ct) return null;
        loaded = { bytes: await fs.readFile(file), contentType: ct };
      } else if (/^https?:\/\//i.test(u)) {
        loaded = await fetchLogo(u);
      }
    } catch {
      loaded = null;
    }

    // Um download vazio, grande demais ou não obtido não deve ser usado como logo.
    if (!loaded || loaded.bytes.byteLength === 0 ||
        loaded.bytes.byteLength > Math.min(MAX_SINGLE_LOGO_CACHE_BYTES, maxLogoCacheBytes)) {
      return null;
    }
    while (
      logoCache.size >= maxLogoCacheEntries ||
      (logoCache.size > 0 && logoCacheBytes + loaded.bytes.byteLength > maxLogoCacheBytes)
    ) {
      const oldestKey = logoCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      evictLogoCacheEntry(oldestKey);
    }
    logoCache.set(cacheKey, { at: Date.now(), bytes: loaded.bytes, contentType: loaded.contentType });
    logoCacheBytes += loaded.bytes.byteLength;
    return loaded;
  }

  /** Hash de conteúdo real: URL igual e imagem alterada geram uma versão nova. */
  async function withLogoDigest(store: StoreIdentityInput): Promise<StoreIdentityInput | null> {
    const url = store.theme?.logoUrl?.trim();
    if (!url) return store;
    const logo = await loadLogo(store.id, url, store.theme?.updatedAt || store.updatedAt);
    if (!logo) return null;
    const contentHash = crypto.createHash('sha256').update(logo.bytes).digest('hex').slice(0, 24);
    return { ...store, iconContentHash: contentHash };
  }

  /** O HTML no servidor.ts tem orçamento de 1,5s; não esperar o download da logo (até 4s). */
  const HTML_LOGO_DIGEST_BUDGET_MS = 400;
  async function withLogoDigestForHtml(store: StoreIdentityInput): Promise<StoreIdentityInput> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raced = await Promise.race([
        withLogoDigest(store),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), HTML_LOGO_DIGEST_BUDGET_MS); }),
      ]);
      return raced || store;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function iconUnavailable(res: Response) {
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', String(RETRY_ICON_AFTER_SECONDS));
    res.set('X-Content-Type-Options', 'nosniff');
    res.status(503).type('text/plain').send('Ícone temporariamente indisponível');
  }

  /** Segmentos versionados existentes são permanentes, independentemente da logo atual. */
  function parseSegment(raw: string): { slug: string; identity: string | null } {
    const seg = splitStoreSegment(raw);
    return seg.identity && isValidSlug(seg.slug) ? seg : { slug: raw, identity: null };
  }

  async function guard(req: Request, res: Response): Promise<StoreIdentityInput | null> {
    const slug = parseSegment(String(req.params.slug || '')).slug;
    if (!isValidSlug(slug)) { res.status(404).type('text/plain').send('Loja não encontrada'); return null; }
    const r = await lookup(slug);
    if (r.status === 'not_found') { res.status(404).type('text/plain').send('Loja não encontrada'); return null; }
    if (r.status === 'error') { res.status(503).set('Cache-Control', 'no-store').type('text/plain').send('Indisponível'); return null; }
    if (r.store.slug !== slug) { res.status(404).type('text/plain').send('Loja não encontrada'); return null; }
    return r.store;
  }

  const router = express.Router();

  // Invalidação autenticada após salvar o Design do App. Nunca aceitar um tenant arbitrário
  // sem verificar a sessão Supabase, a associação ativa e o slug real no banco.
  router.post('/api/pwa/invalidate', express.json({ limit: '2kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cfg = supabaseEnvFrom(process.env);
    if (!cfg) { res.status(503).json({ error: 'Serviço indisponível' }); return; }
    const origin = req.get('origin');
    if (origin) {
      try {
        // Cloud Run termina TLS no proxy; req.protocol pode ser "http" apesar de Origin HTTPS.
        const supplied = new URL(origin);
        if (!['https:', 'http:'].includes(supplied.protocol) || supplied.host !== req.get('host')) {
          res.status(403).json({ error: 'Origem não autorizada' }); return;
        }
      } catch { res.status(403).json({ error: 'Origem inválida' }); return; }
    }
    const token = req.get('authorization')?.match(/^Bearer ([^\s]{1,8192})$/)?.[1];
    const slug = req.body?.slug;
    const tenantId = req.body?.tenantId;
    if (!token) { res.status(401).json({ error: 'Autenticação necessária' }); return; }
    if (!isValidSlug(slug) || typeof tenantId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      res.status(400).json({ error: 'Loja inválida' }); return;
    }
    const ip = req.socket.remoteAddress || 'unknown';
    if (!invalidateIpLimit.allow(ip)) {
      res.status(429).set('Retry-After', '60').json({ error: 'Muitas solicitações' }); return;
    }
    try {
      const db = createClient(cfg.url, cfg.key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: session, error: authError } = await db.auth.getUser(token);
      if (authError || !session.user) { res.status(401).json({ error: 'Sessão inválida' }); return; }
      if (!invalidateUserLimit.allow(session.user.id)) {
        res.status(429).set('Retry-After', '60').json({ error: 'Muitas solicitações' }); return;
      }
      const { data: membership, error: membershipError } = await db.from('tenant_users')
        .select('tenant_id,role_id').eq('tenant_id', tenantId).eq('user_id', session.user.id)
        .eq('status', 'ACTIVE').in('role_id', ['OWNER', 'MANAGER']).maybeSingle();
      const role = membership && (membership as { role_id?: string }).role_id;
      if (membershipError || !membership || (role !== 'OWNER' && role !== 'MANAGER')) {
        res.status(403).json({ error: 'Sem acesso à loja' }); return;
      }
      // Consulta direta à fonte pública (sem confiar no cache local para autorizar a operação).
      const resolved = await opts.resolveStore(slug);
      if (resolved.status !== 'ok' || resolved.store.id !== tenantId || resolved.store.slug !== slug) {
        res.status(403).json({ error: 'Loja não corresponde ao vínculo' }); return;
      }
      invalidateStore(slug, tenantId);
      res.json({ ok: true });
    } catch {
      res.status(503).json({ error: 'Não foi possível invalidar o cache' });
    }
  });

  router.get('/api/pwa/version', async (req, res) => {
    const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : '';
    let storeVer: string | undefined;
    let appIdentity: string | undefined;
    if (slug && isValidSlug(slug)) {
      const r = await lookup(slug);
      if (r.status === 'ok' && r.store.slug === slug) {
        storeVer = identityVersion(r.store);
        // O hash de instalação deve ser idêntico ao usado pelo manifesto PNG,
        // inclusive quando os bytes da mesma URL forem modificados.
        const verified = await withLogoDigest(r.store);
        if (verified && isVersionedStoreApp(verified)) appIdentity = storeAppIdentity(verified);
      }
    }
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('X-Content-Type-Options', 'nosniff');
    res.json({
      version: buildVersion,
      ...(slug && storeVer ? { slug, identityVersion: storeVer } : {}),
      ...(appIdentity ? { appIdentity } : {}),
    });
  });

  // Rotas ~hash de apps já instalados permanecem válidas mesmo sem appBaseLogoUrl.
  // Não redirecionar para fora do scope legado, inclusive em falha de consulta.

  // Vitrine sempre dentro do scope do manifesto (/app/<slug>/): instalar de "/app/<slug>" (fora do scope e
  // sem Service Worker) deixava o app da loja como atalho comum em vez de WebAPK. Mantém a query (mesa, preview, OAuth).
  router.get('/app/:slug', (req, res, next) => {
    const q = req.originalUrl.indexOf('?');
    const target = storeAppCanonicalPath(req.path, q >= 0 ? req.originalUrl.slice(q) : '');
    if (!target) return next();
    res.set('Cache-Control', 'no-cache');
    res.redirect(302, target);
  });

  router.get('/app/:slug/manifest.webmanifest', async (req, res) => {
    const store = await guard(req, res);
    if (!store) return;
    const { identity } = parseSegment(String(req.params.slug || ''));
    const verified = await withLogoDigest(store);
    if (!verified) { iconUnavailable(res); return; }
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    // Sempre revalidado: tema/logo/barras novos chegam ao app logo após a loja salvar.
    res.set('Cache-Control', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    const splashTest = splashTestSlugs.has(store.slug);
    res.send(JSON.stringify(identity ? identityTestManifest(verified, identity, { splashTest }) : serverManifest(verified, { splashTest })));
  });

  router.get('/totem/:slug/manifest.webmanifest', async (req, res) => {
    const store = await guard(req, res);
    if (!store) return;
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify(serverTotemManifest(store)));
  });

  router.get('/app/:slug/icons/:variant.png', async (req, res) => {
    const variant = String(req.params.variant) as IconVariant;
    const testVariant = variant in SPLASH_TEST_ICON_VARIANTS && splashTestSlugs.has(String(req.params.slug));
    if (!(variant in ICON_VARIANTS) && !testVariant) { res.status(404).type('text/plain').send('Ícone não encontrado'); return; }
    const store = await guard(req, res);
    if (!store) return;
    if (testVariant) { await sendSplashTestIcon(res, store, variant as unknown as SplashTestIconVariant); return; }
    const configuredLogo = Boolean(store.theme?.logoUrl?.trim());
    const logo = configuredLogo ? await loadLogo(store.id, store.theme?.logoUrl, store.theme?.updatedAt || store.updatedAt) : null;
    if (configuredLogo && !logo) { iconUnavailable(res); return; }
    const verified = logo
      ? { ...store, iconContentHash: crypto.createHash('sha256').update(logo.bytes).digest('hex').slice(0, 24) }
      : store;
    const ver = iconVersion(verified);
    const key = `${store.id}|${ver}|${variant}`;
    let png = iconCache.get(key);
    if (!png) {
      if (logo) {
        try {
          const rendered = await renderStoreIconPng(logo.bytes, logo.contentType, variant);
          if (await isNearlyFlatPng(rendered)) { iconUnavailable(res); return; }
          png = rendered;
          iconCache.set(key, png); // somente PNG renderizado a partir de logo real verificada
          if (iconCache.size > 600) iconCache.delete(iconCache.keys().next().value as string);
        } catch {
          iconUnavailable(res);
          return;
        }
      } else {
        // Iniciais só quando NÃO há logo configurada. Nunca armazenar fallback no iconCache.
        png = renderInitialsPng(storeDisplayName(store), iconFallbackColor(store.theme), variant);
      }
    }
    const reqV = typeof req.query.v === 'string' ? req.query.v : '';
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', logo && reqV === ver ? IMMUTABLE_ICON_CACHE_CONTROL : 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(png);
  });

  /** Ícones do experimento da splash (sempre no-cache: é teste). */
  async function sendSplashTestIcon(res: Response, store: StoreIdentityInput, variant: SplashTestIconVariant) {
    let png: Buffer | undefined;
    if (variant === 'splash-dc-maskable-1024') {
      if (!dcSplashPng) {
        try {
          const svg = await fs.readFile(path.resolve(publicRoot, DC_BRAND_SVG));
          dcSplashPng = await renderStoreIconPng(svg, 'image/svg+xml', variant, SPLASH_TEST_COLOR);
        } catch {
          res.status(503).set('Cache-Control', 'no-store').type('text/plain').send('Indisponível');
          return;
        }
      }
      png = dcSplashPng;
    } else {
      const configuredLogo = Boolean(store.theme?.logoUrl?.trim());
      const logo = configuredLogo ? await loadLogo(store.id, store.theme?.logoUrl, store.theme?.updatedAt || store.updatedAt) : null;
      if (configuredLogo && !logo) { iconUnavailable(res); return; }
      if (logo) {
        try {
          const p = await renderStoreIconPng(logo.bytes, logo.contentType, variant);
          if (!(await isNearlyFlatPng(p))) png = p;
        } catch { png = undefined; }
      }
      if (!png) {
        if (configuredLogo) { iconUnavailable(res); return; }
        png = renderInitialsPng(storeDisplayName(store), iconFallbackColor(store.theme), variant);
      }
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(png);
  }

  const lookupStore = async (slug: string) => {
    if (!isValidSlug(slug)) return null;
    const r = await lookup(slug);
    return r.status === 'ok' && r.store.slug === slug ? r.store : null;
  };
  const lookupStoreForHtml = async (slug: string) => {
    if (!isValidSlug(slug)) return null;
    const r = await lookupForHtml(slug);
    if (r.status !== 'ok' || r.store.slug !== slug) return null;
    // Quando o storage falha, preserva o HTML/cores; o manifesto/PNG respondem 503,
    // sem publicar uma imagem de iniciais indevida. Digest só entra se o cache/orçamento permitir.
    return withLogoDigestForHtml(r.store);
  };
  const identityHeadOptions = (store: StoreIdentityInput | null, identity: string | null): IdentityHeadOptions => {
    if (!store) return {};
    // HTML pode ter esgotado o orçamento de 400ms da logo. Nesse caso, não
    // anunciar uma identidade baseada só no endereço (incompatível com o manifesto).
    const digestReady = !store.theme?.logoUrl || Boolean(store.iconContentHash);
    const appIdentity = digestReady && isVersionedStoreApp(store) ? storeAppIdentity(store) : undefined;
    const manifestHref = identity && /^[0-9a-f]{10}$/.test(identity)
      ? versionedManifestPath(store.slug, identity) : undefined;
    return { ...(manifestHref ? { manifestHref } : {}), ...(appIdentity ? { appIdentity } : {}) };
  };
  return Object.assign(router, { lookupStore, lookupStoreForHtml, identityHeadOptions, invalidateStore });
}

