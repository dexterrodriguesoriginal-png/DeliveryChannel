/**
 * Compressão (brotli/gzip) sem dependência nova, segura para o Cloud Run:
 *  - precompressedStatic: arquivos de texto do build (js/css/svg/json/webmanifest/txt/map) comprimidos
 *    UMA vez por arquivo+mtime e guardados em memória (limite de bytes); imagens (png/jpg/webp/gif/woff2)
 *    já vêm comprimidas e passam direto para o express.static.
 *  - sendCompressedHtml: HTML das vitrines (pequeno, montado por requisição) comprimido na hora.
 * Sempre envia `Vary: Accept-Encoding`; quem não aceita br/gzip recebe o arquivo original.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export type Encoding = 'br' | 'gzip';

export const COMPRESSIBLE_EXT: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};
/** Abaixo disso a compressão não compensa. */
export const MIN_COMPRESS_BYTES = 1024;
export const DEFAULT_MAX_CACHE_BYTES = 48 * 1024 * 1024;
/** Brotli 6: ~17% menor que gzip e rápido (bundle de 3 MB em ~70 ms) para a 1ª requisição de cada arquivo. */
export const BROTLI_QUALITY = 6;

/** Escolhe br > gzip pelo Accept-Encoding (respeita q=0). */
export function pickEncoding(acceptEncoding: string | undefined): Encoding | null {
  if (!acceptEncoding) return null;
  const accepted = new Map<string, number>();
  for (const part of acceptEncoding.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    accepted.set(name, Number.isFinite(q) ? q : 0);
  }
  const ok = (n: string) => (accepted.get(n) ?? accepted.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

export async function compressBuffer(buf: Buffer, enc: Encoding, brotliQuality = BROTLI_QUALITY): Promise<Buffer> {
  if (enc === 'br') {
    return brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  }
  return gzip(buf, { level: 6 });
}

function appendVary(res: Response) {
  const cur = String(res.getHeader('Vary') || '');
  if (!/\baccept-encoding\b/i.test(cur)) res.setHeader('Vary', cur ? `${cur}, Accept-Encoding` : 'Accept-Encoding');
}

export interface PrecompressedOptions {
  /** Cache-Control por arquivo (mesma regra do express.static); null => padrão. */
  cacheControl?: (filePath: string) => string | null;
  defaultCacheControl?: string;
  maxCacheBytes?: number;
}

interface Entry { key: string; body: Buffer; etag: string; }

/**
 * Middleware antes do express.static. Só GET/HEAD, só extensões de texto, só arquivos DENTRO de rootDir.
 * Qualquer falha (arquivo ausente, erro de compressão) => next() e o express.static segue como antes.
 */
export function precompressedStatic(rootDir: string, opts: PrecompressedOptions = {}) {
  const root = path.resolve(rootDir);
  const maxBytes = opts.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry | null>>();
  let cacheBytes = 0;

  function remember(e: Entry) {
    if (e.body.length > maxBytes) return;
    cache.set(e.key, e);
    cacheBytes += e.body.length;
    while (cacheBytes > maxBytes && cache.size) {
      const oldestKey = cache.keys().next().value as string;
      cacheBytes -= cache.get(oldestKey)!.body.length;
      cache.delete(oldestKey);
    }
  }

  async function build(file: string, mtimeMs: number, size: number, enc: Encoding): Promise<Entry | null> {
    const key = `${file}|${mtimeMs}|${size}|${enc}`;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
    let job = pending.get(key);
    if (!job) {
      job = (async () => {
        const raw = await fs.readFile(file);
        const body = await compressBuffer(raw, enc);
        const e: Entry = { key, body, etag: `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}-${enc}"` };
        remember(e);
        return e;
      })().catch(() => null).finally(() => pending.delete(key));
      pending.set(key, job);
    }
    return job;
  }

  /** Comprime de antemão (br) os arquivos de texto de uma pasta do build; melhor esforço, em sequência. */
  async function warmup(subdir = 'assets'): Promise<number> {
    let n = 0;
    try {
      const dir = path.resolve(root, subdir);
      if (dir !== root && !dir.startsWith(root + path.sep)) return 0;
      for (const name of await fs.readdir(dir)) {
        if (!COMPRESSIBLE_EXT[path.extname(name).toLowerCase()]) continue;
        const file = path.join(dir, name);
        const st = await fs.stat(file).catch(() => null);
        if (!st?.isFile() || st.size < MIN_COMPRESS_BYTES) continue;
        if (await build(file, st.mtimeMs, st.size, 'br')) n++;
      }
    } catch { /* sem pasta: nada a aquecer */ }
    return n;
  }

  const middleware = async function precompressed(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ext = path.extname(req.path).toLowerCase();
    const type = COMPRESSIBLE_EXT[ext];
    if (!type) return next();
    const enc = pickEncoding(req.headers['accept-encoding']);
    if (!enc) return next();
    let rel: string;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.includes('\0')) return next();
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) return next();
    if (path.basename(file).startsWith('.')) return next();
    let st;
    try { st = await fs.stat(file); } catch { return next(); }
    if (!st.isFile() || st.size < MIN_COMPRESS_BYTES) return next();
    const entry = await build(file, st.mtimeMs, st.size, enc);
    if (!entry) return next();
    appendVary(res);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Cache-Control', opts.cacheControl?.(file) ?? opts.defaultCacheControl ?? 'public, max-age=3600');
    res.setHeader('ETag', entry.etag);
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    if (req.headers['if-none-match'] === entry.etag) { res.status(304).end(); return; }
    res.setHeader('Content-Length', String(entry.body.length));
    if (req.method === 'HEAD') { res.status(200).end(); return; }
    res.status(200).end(entry.body);
  };
  return Object.assign(middleware, { warmup });
}

/** HTML pequeno montado por requisição (vitrine): brotli rápido (q5) ou gzip; senão texto puro. */
export async function sendCompressedHtml(req: Request, res: Response, html: string): Promise<void> {
  const enc = pickEncoding(req.headers['accept-encoding']);
  res.type('html');
  appendVary(res);
  const raw = Buffer.from(html, 'utf8');
  if (!enc || raw.length < MIN_COMPRESS_BYTES) { res.send(html); return; }
  try {
    const body = await compressBuffer(raw, enc, 5);
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', String(body.length));
    res.end(body);
  } catch {
    res.removeHeader('Content-Encoding');
    res.send(html);
  }
}
