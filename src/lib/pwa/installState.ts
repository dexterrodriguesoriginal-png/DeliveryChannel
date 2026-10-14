/** Estado de instalação do PWA por loja (localStorage) + detecção de plataforma. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;
const safe = <T,>(fn: () => T, fb: T): T => { try { return fn(); } catch { return fb; } };

export const installKeys = (tenantId: string) => ({
  modalSeen: `deliverychannel_pwa_modal_seen_${tenantId}`,
  installed: `deliverychannel_pwa_installed_${tenantId}`,
});

export function hasSeenInstallModal(s: KV, tenantId: string) { return safe(() => s.getItem(installKeys(tenantId).modalSeen) === '1', false); }
/** Fechar/recusar só marca o modal como visto — NUNCA como instalado. */
export function markInstallModalSeen(s: KV, tenantId: string) { safe(() => s.setItem(installKeys(tenantId).modalSeen, '1'), undefined); }
export function isMarkedInstalled(s: KV, tenantId: string) { return safe(() => s.getItem(installKeys(tenantId).installed) === '1', false); }
/** Chamar somente após appinstalled ou userChoice 'accepted' ou execução em modo standalone. */
export function markInstalled(s: KV, tenantId: string) { safe(() => s.setItem(installKeys(tenantId).installed, '1'), undefined); }

export type Platform = 'android-chrome' | 'android-other' | 'ios-safari' | 'ios-other' | 'desktop';
export function detectPlatform(ua: string): Platform {
  const ios = /iphone|ipad|ipod/i.test(ua);
  if (ios) return /crios|fxios|edgios|opios|gsa\//i.test(ua) || !/safari/i.test(ua) ? 'ios-other' : 'ios-safari';
  if (/android/i.test(ua)) return /chrome\//i.test(ua) && !/samsungbrowser|opr\/|firefox|edga?\//i.test(ua) ? 'android-chrome' : 'android-other';
  return 'desktop';
}

export function isStandalone(w: { matchMedia?: (q: string) => { matches: boolean }; navigator?: unknown }): boolean {
  const mm = (q: string) => safe(() => !!w.matchMedia?.(q).matches, false);
  return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || mm('(display-mode: minimal-ui)')
    || (w.navigator as { standalone?: boolean } | undefined)?.standalone === true;
}

export type PromoVisibility = 'none' | 'modal' | 'banner';
export function promoVisibility(o: { installed: boolean; standalone: boolean; modalSeen: boolean; checkoutOpen: boolean }): PromoVisibility {
  if (o.installed || o.standalone || o.checkoutOpen) return 'none';
  return o.modalSeen ? 'banner' : 'modal';
}

// --- Captura precoce do beforeinstallprompt (registrada em main.tsx) ---
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let installedFlag = false;
export function getDeferredPrompt() { return deferred; }
export function wasAppInstalledEvent() { return installedFlag; }
export function clearDeferredPrompt() { deferred = null; listeners.forEach(l => l()); }
export function subscribeInstall(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function captureInstallEvents(w: Window) {
  w.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; listeners.forEach(l => l()); });
  w.addEventListener('appinstalled', () => { installedFlag = true; deferred = null; listeners.forEach(l => l()); });
}
