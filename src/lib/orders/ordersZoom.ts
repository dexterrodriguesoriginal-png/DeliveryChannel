import { useCallback, useEffect, useState } from 'react';

/** Zoom de densidade da página de Pedidos (Kanban e Lista): 10% a 130%, de 10 em 10, por usuário. */
export const ZOOM_MIN = 10;
export const ZOOM_MAX = 130;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

export const ordersZoomKey = (userId?: string | null) => `dc:orders-zoom:v1:${userId || 'anon'}`;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_DEFAULT;
  const snapped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, snapped));
}

export function readOrdersZoom(userId?: string | null): number {
  try {
    const raw = localStorage.getItem(ordersZoomKey(userId));
    if (raw == null) return ZOOM_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampZoom(n) : ZOOM_DEFAULT;
  } catch {
    return ZOOM_DEFAULT;
  }
}

export function writeOrdersZoom(userId: string | null | undefined, value: number) {
  try { localStorage.setItem(ordersZoomKey(userId), String(clampZoom(value))); } catch { /* storage bloqueado: vale só na sessão */ }
}

/** Estado do zoom, persistido por usuário. Não escuta teclado: Ctrl +/- continuam sendo do navegador. */
export function useOrdersZoom(userId?: string | null) {
  const [zoom, setZoom] = useState(() => readOrdersZoom(userId));
  useEffect(() => { setZoom(readOrdersZoom(userId)); }, [userId]);
  const apply = useCallback((next: number) => {
    const v = clampZoom(next);
    setZoom(v);
    writeOrdersZoom(userId, v);
  }, [userId]);
  const step = useCallback((delta: number) => {
    setZoom(prev => {
      const v = clampZoom(prev + delta);
      writeOrdersZoom(userId, v);
      return v;
    });
  }, [userId]);
  return { zoom, scale: zoom / 100, zoomIn: () => step(ZOOM_STEP), zoomOut: () => step(-ZOOM_STEP), reset: () => apply(ZOOM_DEFAULT) };
}
