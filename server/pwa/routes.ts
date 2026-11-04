/**
 * Rotas PWA por estabelecimento, servidas pelo próprio app (HTTPS do Cloud Run):
 *   GET /app/:slug/manifest.webmanifest
 *   GET /app/:slug/icons/(icon-192|icon-512|maskable-512).png
 * Somente leitura pública; slug validado; loja desconhecida => 404; cache por loja.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import express from 'express';
import { buildStoreManifest, FALLBACK_THEME_COLOR, ManifestIcon, safeColor, storeDisplayName, StoreIdentityInput } from '../../src/lib/pwa/storeManifest';
import { ICON_VARIANTS, IconVariant, renderInitialsPng, renderLogoPng } from './icons';
import { fetchPublicImage } from './safeFetch';
import { isValidSlug, StoreResolver } from './storeSource';

export interface PwaRouteOptions {
  resolveStore: StoreResolver;
  /** Pasta com os arquivos públicos (dist em produção, public em dev) para logos relativos (/demo/...). */
  publicDir: string;
  fetchLogo?: (url: string) => Promise<{ bytes: Buffer; contentType: string }>;
  ttlMs?: number;
  buildVersion?: string;
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export const IMMUTABLE_ICON_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function iconVersion(store: StoreIdentityInput, logoBytes?: Buffer | Uint8Array | null): string {
  const t = store.theme || {};
  const logoHash = logoBytes && logoBytes.length > 0
    ? crypto.createHash('sha256').update(logoBytes).digest('hex').slice(0, 12)
    : '';
  const src = [
    store.id,
    storeDisplayName(store),
    t.shortName || '',
    t.logoUrl || '',
    t.primaryColor || '',
    t.backgroundColor || '',
    t.headerColor || '',
    t.statusBarColor || '',
    t.navBarColor || '',
    t.updatedAt || store.updatedAt || '',
    logoHash,
  ].join('|');
  return crypto.createHash('sha256').update(src).digest('hex').slice(0, 10);
}

/** Versão da identidade completa (logo, nome, cores, barras do sistema e updated_at). */
export function identityVersion(store: StoreIdentityInput, logoBytes?: Buffer | Uint8Array | null): string {
  const t = store.theme || {};
  const src = [
    iconVersion(store, logoBytes),
    t.headerColor || '',
    t.statusBarColor || '',
    t.navBarColor || '',
    t.backgroundColor || '',
    t.shortName || '',
    t.tagline || '',
    t.updatedAt || store.updatedAt || '',
  ].join('|');
  return crypto.createHash('sha256').update(src).digest('hex').slice(0, 10);
}

export function serverManifest(store: StoreIdentityInput, logoBytes?: Buffer | Uint8Array | null) {
  const base = `/app/${encodeURIComponent(store.slug)}/icons`;
  const v = iconVersion(store, logoBytes);
  const icons: ManifestIcon[] = [
    { src: `${base}/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/maskable-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  // origin '' => id/start_url/scope relativos à mesma origem do manifesto (HTTPS do app).
  return buildStoreManifest(store, '', icons);
}

export type PwaRouter = Router & { lookupStore: (slug: string) => Promise<StoreIdentityInput | null> };

export function createPwaRouter(opts: PwaRouteOptions): PwaRouter {
  const ttl = opts.ttlMs ?? 30 * 1000;
  const buildVersion = opts.buildVersion || process.env.PWA_BUILD_VERSION || process.env.K_REVISION || process.env.COMMIT_SHA || 'dc-pwa-v1';
  const storeCache = new Map<string, { at: number; v: Awaited<ReturnType<StoreResolver>> }>();
  const iconCache = new Map<string, Buffer>();
  const fetchLogo = opts.fetchLogo ?? ((u: string) => fetchPublicImage(u));
  const publicRoot = path.resolve(opts.publicDir);

  async function lookup(slug: string) {
    const hit = storeCache.get(slug);
    if (hit && Date.now() - hit.at < ttl) return hit.v;
    const v = await opts.resolveStore(slug);
    if (v.status !== 'error') storeCache.set(slug, { at: Date.now(), v });
    if (storeCache.size > 500) storeCache.delete(storeCache.keys().next().value as string);
    return v;
  }

  async function loadLogo(logoUrl: string | undefined): Promise<{ bytes: Buffer; contentType: string } | null> {
    const u = (logoUrl || '').trim();
    if (!u) return null;
    try {
      if (u.startsWith('/') && !u.startsWith('//')) {
        const rel = decodeURIComponent(u.split(/[?#]/)[0]);
        const file = path.resolve(publicRoot, '.' + rel);
        if (!file.startsWith(publicRoot + path.sep)) return null;
        const ct = MIME_BY_EXT[path.extname(file).toLowerCase()];
        if (!ct) return null;
        return { bytes: await fs.readFile(file), contentType: ct };
      }
      if (/^https?:\/\//i.test(u)) return await fetchLogo(u);
      return null; // data:, blob: e outros esquemas não são aceitos no servidor
    } catch {
      return null;
    }
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
        const logo = await loadLogo(r.store.theme?.logoUrl);
        storeVer = identityVersion(r.store, logo?.bytes);
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
    const logo = await loadLogo(store.theme?.logoUrl);
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    // Sempre revalidado: tema/logo/barras novos chegam ao app logo após a loja salvar.
    res.set('Cache-Control', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify(serverManifest(store, logo?.bytes)));
  });

  router.get('/app/:slug/icons/:variant.png', async (req, res) => {
    const variant = String(req.params.variant) as IconVariant;
    if (!(variant in ICON_VARIANTS)) { res.status(404).type('text/plain').send('Ícone não encontrado'); return; }
    const store = await guard(req, res);
    if (!store) return;
    const logo = await loadLogo(store.theme?.logoUrl);
    const ver = iconVersion(store, logo?.bytes);
    const key = `${store.id}|${ver}|${variant}`;
    let png = iconCache.get(key);
    if (!png) {
      if (logo) {
        try { png = renderLogoPng(logo.bytes, logo.contentType, variant); } catch { png = undefined; }
      }
      if (!png) png = renderInitialsPng(storeDisplayName(store), safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR), variant);
      iconCache.set(key, png);
      if (iconCache.size > 600) iconCache.delete(iconCache.keys().next().value as string);
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', req.query.v ? IMMUTABLE_ICON_CACHE_CONTROL : 'no-cache');
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
