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
}

const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export function iconVersion(store: StoreIdentityInput): string {
  const src = `${store.id}|${store.theme?.logoUrl || ''}|${store.theme?.primaryColor || ''}|${storeDisplayName(store)}`;
  return crypto.createHash('sha256').update(src).digest('hex').slice(0, 10);
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

export function createPwaRouter(opts: PwaRouteOptions): PwaRouter {
  const ttl = opts.ttlMs ?? 5 * 60 * 1000;
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

  router.get('/app/:slug/manifest.webmanifest', async (req, res) => {
    const store = await guard(req, res);
    if (!store) return;
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify(serverManifest(store)));
  });

  router.get('/app/:slug/icons/:variant.png', async (req, res) => {
    const variant = String(req.params.variant) as IconVariant;
    if (!(variant in ICON_VARIANTS)) { res.status(404).type('text/plain').send('Ícone não encontrado'); return; }
    const store = await guard(req, res);
    if (!store) return;
    const key = `${store.id}|${iconVersion(store)}|${variant}`;
    let png = iconCache.get(key);
    if (!png) {
      const logo = await loadLogo(store.theme?.logoUrl);
      if (logo) {
        try { png = renderLogoPng(logo.bytes, logo.contentType, variant); } catch { png = undefined; }
      }
      if (!png) png = renderInitialsPng(storeDisplayName(store), safeColor(store.theme?.primaryColor, FALLBACK_THEME_COLOR), variant);
      iconCache.set(key, png);
      if (iconCache.size > 600) iconCache.delete(iconCache.keys().next().value as string);
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', req.query.v ? 'public, max-age=86400' : 'public, max-age=300');
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
