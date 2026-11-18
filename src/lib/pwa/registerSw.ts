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
  /** Guarda anti-loop da recarga automática (sessionStorage por padrão). */
  session?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Ambiente para ouvir visibilitychange/pageshow e saber se a recarga é segura (window por padrão). */
  win?: AutoUpdateWindowLike | null;
  now?: () => number;
}

export interface AutoUpdateWindowLike {
  location?: { pathname?: string; search?: string };
  document?: {
    visibilityState?: string;
    activeElement?: unknown;
    addEventListener?: (type: string, listener: () => void) => void;
  };
  addEventListener?: (type: string, listener: (e: { persisted?: boolean }) => void) => void;
  top?: unknown;
  self?: unknown;
}

/** Intervalo mínimo entre verificações ao voltar para o app (evita rajadas ao alternar apps). */
export const RESUME_CHECK_MIN_MS = 15_000;
/** Janela anti-loop: no máximo uma recarga automática neste intervalo por aba. */
export const AUTO_RELOAD_GUARD_MS = 60_000;
export const AUTO_RELOAD_GUARD_KEY = 'deliverychannel_pwa_auto_reload_at';

const reloadBlockers = new Set<string>();
/**
 * Telas com dados digitados que uma recarga perderia (checkout, endereço) bloqueiam a recarga automática;
 * nesses casos fica o toast "Nova versão disponível — atualizar" para o cliente decidir.
 */
export function setPwaAutoReloadBlocked(key: string, blocked: boolean): void {
  if (blocked) reloadBlockers.add(key); else reloadBlockers.delete(key);
}

function isEditable(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const e = el as { tagName?: string; isContentEditable?: boolean; type?: string };
  const tag = (e.tagName || '').toUpperCase();
  if (e.isContentEditable) return true;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(e.type || '');
  return false;
}

/**
 * Recarga automática só no app da loja (/app/<slug>), fora do QR de mesa (?mesa=) e da prévia do painel (iframe),
 * com a página visível, sem campo de texto em edição e sem tela de checkout/endereço aberta.
 * O carrinho e a sessão ficam no localStorage e sobrevivem à recarga.
 */
export function isAutoReloadSafe(w: AutoUpdateWindowLike | null | undefined): boolean {
  if (!w) return false;
  const pathname = w.location?.pathname || '';
  if (!/^\/app\/[^/]+/.test(pathname)) return false;
  if (/[?&]mesa=/.test(w.location?.search || '')) return false;
  if (w.top !== undefined && w.self !== undefined && w.top !== w.self) return false;
  if (w.document?.visibilityState && w.document.visibilityState !== 'visible') return false;
  if (isEditable(w.document?.activeElement)) return false;
  return reloadBlockers.size === 0;
}

/** Anti-loop: permite uma recarga automática por janela de AUTO_RELOAD_GUARD_MS (marca antes de recarregar). */
export function claimAutoReload(session: Pick<Storage, 'getItem' | 'setItem'> | null | undefined, now: number): boolean {
  if (!session) return false;
  try {
    const last = Number(session.getItem(AUTO_RELOAD_GUARD_KEY));
    if (last > 0 && now - last >= 0 && now - last < AUTO_RELOAD_GUARD_MS) return false;
    session.setItem(AUTO_RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
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
  const m = /^\/(?:app|totem)\/([^/]+)/.exec(pathname);
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
let autoReloadPending = false;
let activeWin: AutoUpdateWindowLike | null = null;
let activeSession: Pick<Storage, 'getItem' | 'setItem'> | null = null;
let activeNow: () => number = () => Date.now();
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
  autoReloadPending = false;
  reloadBlockers.clear();
  notify();
}

/**
 * Versão nova encontrada com o app aberto: recarrega UMA vez se for seguro; senão, mostra o toast.
 * Retorna true se recarregou.
 */
function autoReloadOrToast(worker?: SwWorkerLike | null, nextVersion?: string | null): boolean {
  if (nextVersion && activeStorage) {
    // Grava antes de recarregar: a página nova já encontra a versão igual (sem loop).
    try { activeStorage.setItem(pwaVersionStorageKey(currentScope), nextVersion); } catch { /* ignora */ }
  }
  if (isAutoReloadSafe(activeWin) && claimAutoReload(activeSession, activeNow())) {
    updateAvailable = false;
    pendingVersion = null;
    notify();
    activeReload?.();
    return true;
  }
  triggerSwUpdateToast(worker, nextVersion);
  return false;
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
  // Worker já ativado (ativação automática): não há outro controllerchange a esperar — recarrega já.
  if (waitingWorker && waitingWorker.state !== 'activated' && waitingWorker.state !== 'activating' && waitingWorker.state !== 'redundant') {
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
  /**
   * 'startup': a página acabou de carregar da rede (HTML/manifesto no-cache, SW sem cache), então já é a
   * versão nova; só registra a versão. 'resume': app voltou do segundo plano com a página antiga em memória.
   */
  mode?: 'startup' | 'resume' | 'manual';
}): Promise<boolean> {
  const mode = opts.mode ?? 'manual';
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
      if (mode === 'startup') {
        try { opts.storage?.setItem(key, remote); } catch { /* ignora */ }
        return false;
      }
      pendingVersion = remote;
      await opts.registration?.update?.().catch(() => {});
      if (mode === 'resume') {
        autoReloadOrToast(opts.registration?.waiting ?? waitingWorker, remote);
      } else {
        triggerSwUpdateToast(opts.registration?.waiting ?? waitingWorker, remote);
      }
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
  activeWin = opts.win !== undefined ? opts.win : typeof window !== 'undefined' ? (window as unknown as AutoUpdateWindowLike) : null;
  activeSession = opts.session !== undefined ? opts.session : typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  activeNow = opts.now ?? (() => Date.now());
  const win = activeWin;

  let reg: SwRegistrationLike | null = null;
  if (sw && typeof sw.register === 'function') {
    // Sem controller = primeira instalação do SW: o clients.claim não deve recarregar a página.
    const hadController = !!sw.controller;
    try {
      reg = await sw.register('/sw.js', { scope, updateViaCache: 'none' });
      const r = reg;
      // Worker novo já baixado (versões antigas do sw.js esperavam o clique): ativa agora.
      if (r.waiting) {
        autoReloadPending = hadController;
        r.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      r.addEventListener?.('updatefound', () => {
        const installing = r.installing;
        if (!installing) return;
        // Atualização (já havia SW controlando): o worker novo ativa sozinho (skipWaiting) e recarregamos 1 vez.
        if (sw.controller) autoReloadPending = true;
        installing.addEventListener?.('statechange', () => {
          if (installing.state === 'installed' && (sw.controller || r.active)) {
            autoReloadPending = true;
            // O sw.js novo já chama skipWaiting no install; a mensagem cobre workers que ainda esperam.
            (r.waiting ?? installing).postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      sw.addEventListener?.('controllerchange', () => {
        // O worker que esperava já assumiu: o toast, se aparecer, só precisa recarregar.
        waitingWorker = null;
        if (userRequestedUpdate) {
          userRequestedUpdate = false;
          autoReloadPending = false;
          activeReload?.();
          return;
        }
        if (autoReloadPending && hadController) {
          autoReloadPending = false;
          autoReloadOrToast(null, null);
        }
      });
      // Procura sw.js novo a cada abertura.
      void r.update?.()?.catch?.(() => {});
    } catch {
      reg = null;
    }
  }

  if (fetchImpl) {
    await checkPwaVersion({ pathname, scope, fetchImpl, storage, registration: reg, mode: 'startup' });
    // Ao voltar para o app (WebAPK/aba em segundo plano), confere versão e sw.js de novo.
    let lastResumeCheck = activeNow();
    const onResume = () => {
      if (win?.document?.visibilityState && win.document.visibilityState !== 'visible') return;
      const t = activeNow();
      if (t - lastResumeCheck < RESUME_CHECK_MIN_MS) return;
      lastResumeCheck = t;
      void reg?.update?.()?.catch?.(() => {});
      void checkPwaVersion({ pathname, scope, fetchImpl, storage, registration: reg, mode: 'resume' });
    };
    win?.document?.addEventListener?.('visibilitychange', onResume);
    win?.addEventListener?.('pageshow', (e) => { if (e?.persisted) { lastResumeCheck = 0; onResume(); } });
  }

  return reg;
}

