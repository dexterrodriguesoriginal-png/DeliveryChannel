/**
 * "Abrir app": uma aba não consegue lançar de forma confiável um PWA instalado.
 * Estratégia em camadas — nunca um botão morto:
 *  1) window.open(start_url, '_blank') — o Chrome pode capturar o link para o app
 *     (handle_links / launch_handler no manifesto) ou abrir uma nova aba no escopo.
 *  2) Android: se o popup for bloqueado, tenta intent:// VIEW + BROWSABLE (sem package,
 *     pois o WebAPK é gerado pelo Chrome). Não usa location.assign na mesma aba:
 *     se já estamos no start_url, isso não faz nada.
 *  3) Sempre deixe a UI mostrar: "Abra o app Totem na tela inicial", com um <a target=_blank>.
 */
export function buildOpenAppIntent(absoluteUrl: string): string | null {
  let u: URL;
  try { u = new URL(absoluteUrl); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const hostPath = `${u.host}${u.pathname}${u.search}`;
  return `intent://${hostPath}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}

export const OPEN_APP_FALLBACK_MS = 1600;

interface OpenEnv {
  location: { href: string; assign(u: string): void; origin: string };
  document: { visibilityState: string };
  userAgent: string;
  setTimeout: (fn: () => void, ms: number) => unknown;
  open?: (url: string, target?: string, features?: string) => { closed?: boolean } | null;
  onStillVisible?: () => void;
}

export function openInstalledApp(startPath: string, env: OpenEnv = {
  location: window.location, document, userAgent: navigator.userAgent,
  setTimeout: (f, ms) => window.setTimeout(f, ms),
  open: (url, target, features) => window.open(url, target, features),
}): 'popup' | 'intent' | 'navigate' {
  const abs = new URL(startPath, env.location.origin).href;
  const openFn = env.open ?? ((url: string, target?: string, features?: string) => {
    try { return window.open(url, target, features); } catch { return null; }
  });
  const popup = openFn(abs, '_blank', 'noopener,noreferrer');
  if (popup) return 'popup';

  const intent = /Android/i.test(env.userAgent) ? buildOpenAppIntent(abs) : null;
  if (intent) {
    const check = () => env.setTimeout(() => {
      if (env.document.visibilityState === 'visible') env.onStillVisible?.();
    }, OPEN_APP_FALLBACK_MS);
    env.location.href = intent;
    check();
    return 'intent';
  }

  env.onStillVisible?.();
  return 'navigate';
}

/** Detecta o app instalado via getInstalledRelatedApps (Chrome Android, mesma origem/escopo). */
export async function detectInstalledApp(nav: Navigator = navigator): Promise<boolean> {
  const fn = (nav as unknown as { getInstalledRelatedApps?: () => Promise<{ platform: string }[]> }).getInstalledRelatedApps;
  if (typeof fn !== 'function') return false;
  try { const apps = await fn.call(nav); return apps.some(a => a.platform === 'webapp'); } catch { return false; }
}

const openAttemptKey = (appId: string) => `deliverychannel_pwa_open_attempt_${appId}`;
type OpenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Mantém a orientação se o fallback navegar nesta mesma aba (o timer anterior é destruído). */
export function rememberOpenAttempt(storage: OpenStorage, appId: string, now = Date.now()): void {
  try { storage.setItem(openAttemptKey(appId), String(now)); } catch { /* navegador sem storage */ }
}
export function consumeOpenAttempt(storage: OpenStorage, appId: string, now = Date.now()): boolean {
  try {
    const at = Number(storage.getItem(openAttemptKey(appId)));
    storage.removeItem(openAttemptKey(appId));
    return at > 0 && now >= at && now - at < 10_000;
  } catch { return false; }
}
