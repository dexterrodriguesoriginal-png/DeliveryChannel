/**
 * "Abrir app": tenta abrir o app instalado (WebAPK) em vez do navegador.
 * Nenhum site consegue FORÇAR isso; estratégia em camadas:
 *  1) Android: intent:// com action VIEW + BROWSABLE para a URL da loja (sem package, pois o
 *     pacote do WebAPK é gerado pelo Chrome e desconhecido). O Android resolve para o app que
 *     declara o escopo (o WebAPK); se não houver, cai em S.browser_fallback_url.
 *  2) Se a página continuar visível após ~1,6 s, navega para start_url normalmente (o Chrome pode
 *     capturar o link para o app — handle_links/launch_handler no manifesto — ou abre no navegador).
 * Nunca afirma que abriu.
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
}

export function openInstalledApp(startPath: string, env: OpenEnv = {
  location: window.location, document, userAgent: navigator.userAgent, setTimeout: (f, ms) => window.setTimeout(f, ms),
}): 'intent' | 'navigate' {
  const abs = new URL(startPath, env.location.origin).href;
  const intent = /Android/i.test(env.userAgent) ? buildOpenAppIntent(abs) : null;
  if (!intent) { env.location.assign(abs); return 'navigate'; }
  env.location.href = intent;
  env.setTimeout(() => { if (env.document.visibilityState === 'visible') env.location.assign(abs); }, OPEN_APP_FALLBACK_MS);
  return 'intent';
}

/** Detecta o app instalado via getInstalledRelatedApps (Chrome Android, mesma origem/escopo). */
export async function detectInstalledApp(nav: Navigator = navigator): Promise<boolean> {
  const fn = (nav as unknown as { getInstalledRelatedApps?: () => Promise<{ platform: string }[]> }).getInstalledRelatedApps;
  if (typeof fn !== 'function') return false;
  try { const apps = await fn.call(nav); return apps.some(a => a.platform === 'webapp'); } catch { return false; }
}
