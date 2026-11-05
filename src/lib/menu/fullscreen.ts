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
