/** Sessão explícita de instalação da versão nova (?instalar=1). */

import { APP_IDENTITY_RE, splitStoreSegment, storeSegmentFromPath, storeSlugFromAppPath } from './appIdentity';

export const INSTALL_PARAM = 'instalar';
export const pendingInstallKey = (slug: string) => `dc:pending-install:${slug}`;
export const PENDING_INSTALL_TTL_MS = 15 * 60 * 1000;

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function paramsOf(search: string): URLSearchParams {
  return new URLSearchParams(String(search || '').replace(/^\?/, ''));
}

export function isInstallSession(search: string): boolean {
  return paramsOf(search).get(INSTALL_PARAM) === '1';
}

export interface PendingInstall { at: number; identity: string }

export function readPendingInstall(slug: string, storage?: Readable, now = Date.now()): PendingInstall | null {
  if (!slug) return null;
  try {
    const raw = (storage || window.localStorage).getItem(pendingInstallKey(slug));
    if (!raw) return null;
    const rec = JSON.parse(raw) as PendingInstall;
    if (!Number.isFinite(rec.at) || rec.at <= 0 || now - rec.at < 0 || now - rec.at >= PENDING_INSTALL_TTL_MS) return null;
    if (!APP_IDENTITY_RE.test(rec.identity)) return null;
    return rec;
  } catch {
    return null;
  }
}

export function markPendingInstall(
  slug: string,
  identity: string,
  storage?: Pick<Storage, 'setItem'>,
  now = Date.now(),
): void {
  if (!slug || !APP_IDENTITY_RE.test(identity)) return;
  try {
    (storage || window.localStorage).setItem(pendingInstallKey(slug), JSON.stringify({ at: now, identity }));
  } catch { /* bloqueado */ }
}

export function hasFreshPendingInstall(slug: string, identity: string, storage?: Readable, now = Date.now()): boolean {
  const rec = readPendingInstall(slug, storage, now);
  return !!rec && rec.identity === identity;
}

export function clearPendingInstall(slug: string, storage?: Pick<Storage, 'removeItem'>): void {
  if (!slug) return;
  try { (storage || window.localStorage).removeItem(pendingInstallKey(slug)); } catch { /* bloqueado */ }
}

/** Apaga todas as marcas de instalação pendente nesta origem (após appinstalled). */
export function clearAllPendingInstalls(storage?: Pick<Storage, 'removeItem'> & { length?: number; key?: (i: number) => string | null }): void {
  const s = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!s?.removeItem || typeof s.key !== 'function' || typeof s.length !== 'number') return;
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith('dc:pending-install:')) keys.push(k);
  }
  for (const k of keys) {
    try { s.removeItem(k); } catch { /* bloqueado */ }
  }
}

/**
 * Se o Chrome abriu o start_url (?source=pwa) depois do prompt no app antigo,
 * acrescenta ?instalar=1 quando há uma marca recente. Não altera o manifesto.
 * Devolve a query nova (com ?) ou null se não houver o que mudar.
 */
export function searchToAddInstallSession(
  pathname: string,
  search: string,
  storage?: Readable,
  now = Date.now(),
): string | null {
  if (isInstallSession(search)) return null;
  const slug = storeSlugFromAppPath(pathname);
  const identity = splitStoreSegment(storeSegmentFromPath(pathname) || '').identity;
  if (!slug || !identity) return null;
  if (!hasFreshPendingInstall(slug, identity, storage, now)) return null;
  const params = paramsOf(search);
  params.set(INSTALL_PARAM, '1');
  return `?${params.toString()}`;
}

/** Aplica a query de instalação no endereço atual, sem recarregar. */
export function applyInstallSessionFromLocation(w: Window = window, storage?: Readable, now = Date.now()): boolean {
  const next = searchToAddInstallSession(w.location.pathname, w.location.search, storage, now);
  if (next == null) return false;
  try {
    w.history.replaceState(w.history.state, '', w.location.pathname + next + w.location.hash);
    return true;
  } catch {
    return false;
  }
}
