import { isDriverRoute } from './driverManifest';
import { isWaiterRoute } from './waiterManifest';

declare const __PWA_BUILD_VERSION__: string | undefined;

export const PWA_UPDATE_TOAST_TEXT = 'Nova versão disponível — atualizar';

export function getClientBuildVersion(): string {
  return typeof __PWA_BUILD_VERSION__ === 'string' && __PWA_BUILD_VERSION__.trim()
    ? __PWA_BUILD_VERSION__.trim()
    : '';
}

export interface SwWorkerLike {
  state?: string;
  postMessage: (message: unknown) => void;
  addEventListener?: (type: string, listener: () => void) => void;
}

export interface SwRegistrationLike {
  scope?: string;
  waiting?: SwWorkerLike | null;
  installing?: SwWorkerLike | null;
  active?: SwWorkerLike | null;
  update?: () => Promise<unknown>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export interface SwContainerLike {
  controller?: unknown;
  register: (scriptURL: string, options?: { scope?: string; updateViaCache?: 'all' | 'imports' | 'none' }) => Promise<SwRegistrationLike>;
  addEventListener?: (type: string, listener: () => void) => void;
}

export interface RegisterSwOptions {
  pathname?: string;
  serviceWorker?: SwContainerLike | null;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload?: () => void;
}

/**
 * Escopos isolados por aplicativo (loja, garçom, entregador, cozinha), sem conflito entre eles.
 */
export function resolvePwaScope(pathname: string): string {
  const storeMatch = /^\/app\/([^/]+)/.exec(pathname);
  if (storeMatch) {
    try {
      return `/app/${encodeURIComponent(decodeURIComponent(storeMatch[1]))}/`;
    } catch {
      return `/app/${storeMatch[1]}/`;
    }
  }
  if (isWaiterRoute(pathname)) return '/garcom';
  if (isDriverRoute(pathname)) return '/entregador';
  if (pathname === '/cozinha' || pathname.startsWith('/cozinha/')) return '/cozinha';
  return '/';
}

export function extractStoreSlugFromPath(pathname: string): string | null {
  const m = /^\/app\/([^/]+)/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export const pwaVersionStorageKey = (scope: string) => `deliverychannel_pwa_version_${scope}`;

let updateAvailable = false;
let waitingWorker: SwWorkerLike | null = null;
let currentScope = '/';
let pendingVersion: string | null = null;
let activeStorage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
let activeReload: (() => void) | null = null;
let userRequestedUpdate = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(l => l());
}

export function isSwUpdateAvailable(): boolean {
  return updateAvailable;
}

export function subscribeSwUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSwUpdateState(): void {
  updateAvailable = false;
  waitingWorker = null;
  pendingVersion = null;
  userRequestedUpdate = false;
  notify();
}

export function triggerSwUpdateToast(worker?: SwWorkerLike | null, nextVersion?: string | null): void {
  if (worker) waitingWorker = worker;
  if (nextVersion) pendingVersion = nextVersion;
  updateAvailable = true;
  notify();
}

/**
 * Acionado quando o usuário clica em "Nova versão disponível — atualizar".
 * Envia SKIP_WAITING ao service worker em espera e recarrega ao assumir controle.
 */
export function applySwUpdate(): void {
  userRequestedUpdate = true;
  if (pendingVersion && activeStorage) {
    try {
      activeStorage.setItem(pwaVersionStorageKey(currentScope), pendingVersion);
    } catch {
      /* storage indisponível */
    }
  }
  const reload = activeReload ?? (() => {
    if (typeof window !== 'undefined') window.location.reload();
  });
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    updateAvailable = false;
    notify();
    return;
  }
  updateAvailable = false;
  notify();
  reload();
}

export async function checkPwaVersion(opts: {
  pathname: string;
  scope: string;
  fetchImpl: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  registration?: SwRegistrationLike | null;
}): Promise<boolean> {
  const slug = extractStoreSlugFromPath(opts.pathname);
  const url = slug ? `/api/pwa/version?slug=${encodeURIComponent(slug)}` : '/api/pwa/version';
  try {
    const res = await opts.fetchImpl(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const data = (await res.json()) as { version?: string; identityVersion?: string };
    const remote = [data?.version, data?.identityVersion].filter(Boolean).join(':');
    if (!remote) return false;
    const key = pwaVersionStorageKey(opts.scope);
    let previous: string | null = null;
    try {
      previous = opts.storage?.getItem(key) ?? null;
    } catch {
      previous = null;
    }
    if (!previous) {
      try {
        opts.storage?.setItem(key, remote);
      } catch {
        /* ignora */
      }
      return false;
    }
    if (previous !== remote) {
      pendingVersion = remote;
      await opts.registration?.update?.().catch(() => {});
      triggerSwUpdateToast(opts.registration?.waiting ?? waitingWorker, remote);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function registerPwaServiceWorker(opts: RegisterSwOptions = {}): Promise<SwRegistrationLike | null> {
  const pathname = opts.pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  const sw =
    opts.serviceWorker !== undefined
      ? opts.serviceWorker
      : typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? (navigator.serviceWorker as unknown as SwContainerLike)
        : null;
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const storage =
    opts.storage !== undefined ? opts.storage : typeof localStorage !== 'undefined' ? localStorage : null;

  const scope = resolvePwaScope(pathname);
  currentScope = scope;
  activeStorage = storage;
  activeReload = opts.reload ?? (() => {
    if (typeof window !== 'undefined') window.location.reload();
  });

  let reg: SwRegistrationLike | null = null;
  if (sw && typeof sw.register === 'function') {
    try {
      reg = await sw.register('/sw.js', { scope, updateViaCache: 'none' });
      if (reg.waiting) {
        triggerSwUpdateToast(reg.waiting);
      }
      reg.addEventListener?.('updatefound', () => {
        const installing = reg?.installing;
        if (!installing) return;
        installing.addEventListener?.('statechange', () => {
          if (installing.state === 'installed' && (sw.controller || reg?.active)) {
            triggerSwUpdateToast(reg?.waiting ?? installing);
          }
        });
      });
      sw.addEventListener?.('controllerchange', () => {
        if (userRequestedUpdate) {
          userRequestedUpdate = false;
          activeReload?.();
        }
      });
    } catch {
      reg = null;
    }
  }

  if (fetchImpl) {
    await checkPwaVersion({ pathname, scope, fetchImpl, storage, registration: reg });
  }

  return reg;
}

