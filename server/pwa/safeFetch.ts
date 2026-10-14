/**
 * Download de logotipo com proteção contra SSRF:
 * só http(s), portas 80/443, sem credenciais na URL, bloqueia IPs privados/loopback/link-local
 * (checado em cada redirecionamento), tempo e tamanho limitados, somente image/*.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export type HostResolver = (host: string) => Promise<string[]>;
const defaultResolver: HostResolver = async (h) => (await lookup(h, { all: true })).map(r => r.address);

export async function assertPublicUrl(raw: string, resolve: HostResolver = defaultResolver): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('esquema bloqueado');
  if (u.username || u.password) throw new Error('credenciais na URL bloqueadas');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('porta bloqueada');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new Error('host bloqueado');
  const addrs = net.isIP(host) ? [host] : await resolve(host);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('endereço privado bloqueado');
  return u;
}

export interface FetchedImage { bytes: Buffer; contentType: string; }

export async function fetchPublicImage(raw: string, fetchImpl: typeof fetch = fetch, resolve: HostResolver = defaultResolver): Promise<FetchedImage> {
  let url = raw;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const u = await assertPublicUrl(url, resolve);
    const res = await fetchImpl(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'image/*' } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirecionamento sem destino');
      url = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ct.startsWith('image/')) throw new Error('não é imagem');
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_LOGO_BYTES) throw new Error('imagem grande demais');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('sem corpo');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_LOGO_BYTES) { await reader.cancel(); throw new Error('imagem grande demais'); }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), contentType: ct };
  }
  throw new Error('redirecionamentos demais');
}
