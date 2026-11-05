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
import { buildStoreManifest, FALLBACK_THEME_COLOR, ManifestIcon, safeColor, storeDisplayName, storeIconVersion, StoreIdentityInput } from '../../src/lib/pwa/storeManifest';
import { ICON_VARIANTS, IconVariant, renderInitialsPng, renderLogoPng } from './icons';
import { fetchPublicImage } from './safeFetch';
import { isValidSlug, StoreResolver } from './storeSource';

declare const __PWA_BUILD_VERSION__: string | undefined;

export interface PwaRouteOptions {
  resolveStore: StoreResolver;
  /** Pasta com os arquivos públicos (dist em produção, public em dev) para logos relativos (/demo/...). */
  publicDir: string;
  fetchLogo?: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
  ttlMs?: number;
  logoTtlMs?: number;
  maxLogoCacheEntries?: number;
  maxLogoCacheBytes?: number;
  buildVersion?: string;
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export const IMMUTABLE_ICON_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const DEFAULT_LOGO_CACHE_TTL_MS = 5 * 60 * 1000;
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
 * Versão única do ícone e da identidade da loja (mesmo valor usado em storeHtml.ts,
 * applyStoreIdentity.identityHash e serverManifest).
 * Calculada apenas com metadados (logoUrl, updatedAt, cores, nomes) para nunca exigir download em /api/pwa/version.
 */
export function iconVersion(store: StoreIdentityInput): string {
  return storeIconVersion(store);
}

export function identityVersion(store: StoreIdentityInput): string {
  return storeIconVersion(store);
}

export function serverManifest(store: StoreIdentityInput) {
  const base = `/app/${encodeURIComponent(store.slug)}/icons`;
  const v = iconVersion(store);
  const icons: ManifestIcon[] = [
    { src: `${base}/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/maskable-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  // origin '' => id/start_url/scope relativos à mesma origem do manifesto (HTTPS do app).
  return buildStoreManifest(store, '', icons);
}

export type PwaRouter = Router & { lookupStore: (slug: string) => Promise<StoreIdentityInput | null> };

interface CachedLogoEntry {
  at: number;
  bytes: Buffer;
  contentType: string;
}

export function createPwaRouter(opts: PwaRouteOptions): PwaRouter {
  const ttl = opts.ttlMs ?? 30 * 1000;
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

  async function lookup(slug: string) {
    const hit = storeCache.get(slug);
    if (hit && Date.now() - hit.at < ttl) return hit.v;
    const v = await opts.resolveStore(slug);
    if (v.status !== 'error') storeCache.set(slug, { at: Date.now(), v });
    if (storeCache.size > 500) storeCache.delete(storeCache.keys().next().value as string);
    return v;
  }

  function evictLogoCacheEntry(key: string) {
    const existing = logoCache.get(key);
    if (existing) {
      logoCacheBytes = Math.max(0, logoCacheBytes - existing.bytes.byteLength);
      logoCache.delete(key);
    }
  }

  async function loadLogo(storeId: string, logoUrl: string | undefined): Promise<{ bytes: Buffer; contentType: string } | null> {
    const u = (logoUrl || '').trim();
    if (!u) return null;
    const cacheKey = `${storeId}|${u}`;
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

    if (
      loaded &&
      loaded.bytes.byteLength > 0 &&
      loaded.bytes.byteLength <= Math.min(MAX_SINGLE_LOGO_CACHE_BYTES, maxLogoCacheBytes)
    ) {
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
    }
    return loaded;
  }

  async function guard(req: Request, res: Response): Promise<StoreIdentityInput | null> {
    const slug = String(req.params.slug || '');
    if (!isValidSlug(slug)) { res.status(404).type('text/plain').send('Loja não encontrada'); return null; }
    const r = await lookup(slug);
    if (r.status === 'not_found') { res.status(404).type('text/plain').send('Loja não encontrada'); return null; }
    if (r.status === 'error') { res.status(503).set('Cache-Control', 'no-store').type('text/plain').send('Indisponível'); return null; }
    if (r.store.slug !== slug) { res.status(404).type('text/plain').send('Loja não encontrada'); return null; }
    return r.store;
  }

  const router = express.Router();

  router.get('/api/pwa/version', async (req, res) => {
    const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : '';
    let storeVer: string | undefined;
    if (slug && isValidSlug(slug)) {
      const r = await lookup(slug);
      if (r.status === 'ok' && r.store.slug === slug) {
        storeVer = identityVersion(r.store);
      }
    }
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('X-Content-Type-Options', 'nosniff');
    res.json({
      version: buildVersion,
      ...(slug && storeVer ? { slug, identityVersion: storeVer } : {}),
    });
  });

  router.get('/app/:slug/manifest.webmanifest', async (req, res) => {
    const store = await guard(req, res);
    if (!store) return;
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    // Sempre revalidado: tema/logo/barras novos chegam ao app logo após a loja salvar.
    res.set('Cache-Control', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify(serverManifest(store)));
  });

  router.get('/app/:slug/icons/:variant.png', async (req, res) => {
    const variant = String(req.params.variant) as IconVariant;
    if (!(variant in ICON_VARIANTS)) { res.status(404).type('text/plain').send('Ícone não encontrado'); return; }
    const store = await guard(req, res);
    if (!store) return;
    const ver = iconVersion(store);
    const key = `${store.id}|${ver}|${variant}`;
    let png = iconCache.get(key);
    let usedRealLogo = Boolean(png);
    if (!png) {
      const logo = await loadLogo(store.id, store.theme?.logoUrl);
      if (logo) {
        try {
          png = renderLogoPng(logo.bytes, logo.contentType, variant);
          usedRealLogo = true;
        } catch {
          png = undefined;
          usedRealLogo = false;
        }
      }
      if (png && usedRealLogo) {
        iconCache.set(key, png);
        if (iconCache.size > 600) iconCache.delete(iconCache.keys().next().value as string);
      } else {
        png = renderInitialsPng(storeDisplayName(store), safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR), variant);
      }
    }
    const reqV = typeof req.query.v === 'string' ? req.query.v : '';
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', usedRealLogo && reqV === ver ? IMMUTABLE_ICON_CACHE_CONTROL : 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(png);
  });

  const lookupStore = async (slug: string) => {
    if (!isValidSlug(slug)) return null;
    const r = await lookup(slug);
    return r.status === 'ok' && r.store.slug === slug ? r.store : null;
  };
  return Object.assign(router, { lookupStore });
}

