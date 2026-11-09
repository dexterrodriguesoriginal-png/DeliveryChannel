type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function isFullscreenSupported(doc: Document = document): boolean {
  const el = doc.documentElement as FullscreenEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreenActive(doc: Document = document): boolean {
  const d = doc as FullscreenDoc;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Alterna a tela cheia; falha silenciosa quando o navegador recusa. */
export async function toggleFullscreen(doc: Document = document): Promise<boolean> {
  const d = doc as FullscreenDoc;
  const el = doc.documentElement as FullscreenEl;
  try {
    if (isFullscreenActive(doc)) {
      if (d.exitFullscreen) await d.exitFullscreen(); else await d.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) await el.requestFullscreen();
    else await el.webkitRequestFullscreen?.();
  } catch { /* o navegador pode negar a tela cheia; o cardápio segue funcionando */ }
  return isFullscreenActive(doc);
}

/** Entra em tela cheia a partir de um gesto do usuário. Falha silenciosa (ex.: iOS Safari). */
export async function requestFullscreen(doc: Document = document): Promise<boolean> {
  if (isFullscreenActive(doc) || !isFullscreenSupported(doc)) return isFullscreenActive(doc);
  const el = doc.documentElement as FullscreenEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else await el.webkitRequestFullscreen?.();
  } catch { /* iOS Safari e permissões recusam sem quebrar o cardápio */ }
  return isFullscreenActive(doc);
}

export type StandaloneNav = Navigator & { standalone?: boolean };

/** App instalado (PWA fullscreen/standalone ou iOS navigator.standalone), já em tela cheia sem o aviso do Chrome. */
export function isInstalledDisplayMode(win: Window = window): boolean {
  const nav = win.navigator as StandaloneNav;
  if (nav.standalone === true) return true;
  if (typeof win.matchMedia !== 'function') return false;
  return win.matchMedia('(display-mode: fullscreen)').matches
    || win.matchMedia('(display-mode: standalone)').matches;
}

let totemFullscreenRequestedThisSession = false;

/** Só para testes: zera o controle "uma vez por sessão". */
export function resetTotemFullscreenSession(): void {
  totemFullscreenRequestedThisSession = false;
}

/**
 * Totem em aba comum: pede tela cheia no máximo uma vez por sessão (no toque do CTA da capa).
 * Não chama a API se já estiver em PWA/kiosk (display-mode fullscreen/standalone), para não
 * mostrar o aviso do Chrome Android. Nunca re-pede ao sair da tela cheia.
 */
export async function requestTotemFullscreenOnce(
  doc: Document = document,
  win: Window = window,
): Promise<boolean> {
  if (typeof win !== 'undefined' && isInstalledDisplayMode(win)) {
    return isFullscreenActive(doc);
  }
  if (totemFullscreenRequestedThisSession) return isFullscreenActive(doc);
  totemFullscreenRequestedThisSession = true;
  if (isFullscreenActive(doc) || !isFullscreenSupported(doc)) return isFullscreenActive(doc);
  return requestFullscreen(doc);
}
