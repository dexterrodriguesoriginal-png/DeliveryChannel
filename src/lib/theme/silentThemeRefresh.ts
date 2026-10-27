/** Recarrega só o tema da vitrine quando o app volta a ficar visível (PWA fica aberto em segundo plano). */
export const THEME_REFRESH_MIN_MS = 5_000;

export function shouldRefreshTheme(lastLoadedAt: number, now: number, visible: boolean): boolean {
  return visible && now - lastLoadedAt > THEME_REFRESH_MIN_MS;
}

export function subscribeThemeRefresh(
  w: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  d: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>,
  onVisible: () => void,
): () => void {
  const vis = () => { if (d.visibilityState === 'visible') onVisible(); };
  d.addEventListener('visibilitychange', vis);
  w.addEventListener('focus', onVisible);
  return () => { d.removeEventListener('visibilitychange', vis); w.removeEventListener('focus', onVisible); };
}
