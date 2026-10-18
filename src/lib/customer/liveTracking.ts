/**
 * Acompanhamento ao vivo do motoboy pelo cliente (RPC get_order_driver_location, migration 1900).
 * Funções puras: quando acompanhar, rótulo "Atualizado há X s", interpolação suave e enquadramento.
 */
export interface LatLng { lat: number; lng: number }
export interface DriverLivePosition extends LatLng {
  heading: number | null;
  accuracy: number | null;
  recordedAt: string;
  isStale: boolean;
}

export const LIVE_POLL_MS = 12_000;
export const LIVE_STALE_MS = 2 * 60_000;

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

/** Só pedidos de ENTREGA em rota têm mapa ao vivo. */
export function isLiveTrackable(order: { status?: string; fulfillmentType?: string } | null | undefined): boolean {
  return !!order && order.status === 'OUT_FOR_DELIVERY' && (order.fulfillmentType || 'DELIVERY') === 'DELIVERY';
}

/** Faz polling só com o pedido em rota E a aba visível. */
export function shouldPollLive(status: string | undefined, visibility: string | undefined): boolean {
  return status === 'OUT_FOR_DELIVERY' && visibility !== 'hidden';
}

/** Linha da RPC → posição (ou null se inválida). */
export function parseDriverLocationRow(row: unknown, nowMs = Date.now()): DriverLivePosition | null {
  const r = (Array.isArray(row) ? row[0] : row) as Record<string, unknown> | undefined;
  if (!r) return null;
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!isValidLatLng({ lat, lng })) return null;
  const recordedAt = String(r.recorded_at || '');
  const t = Date.parse(recordedAt);
  if (!Number.isFinite(t)) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    lat, lng, heading: num(r.heading), accuracy: num(r.accuracy), recordedAt,
    // Servidor decide (> 2 min); o relógio local só reforça se a resposta envelhecer na tela.
    isStale: Boolean(r.is_stale) || nowMs - t > LIVE_STALE_MS,
  };
}

/** "Atualizado agora" / "há 12 s" / "há 3 min". */
export function updatedAgoLabel(recordedAt: string | undefined, nowMs = Date.now()): string {
  const t = recordedAt ? Date.parse(recordedAt) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 5) return 'Atualizado agora';
  if (s < 60) return `Atualizado há ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Atualizado há ${m} min`;
  return `Atualizado há ${Math.floor(m / 60)} h`;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Posição intermediária entre duas leituras (t de 0 a 1, com easing). */
export function interpolateLatLng(from: LatLng, to: LatLng, t: number): LatLng {
  const k = easeInOut(Math.min(1, Math.max(0, t)));
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
}

/** Distância aproximada em metros (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Saltos grandes (ex.: GPS voltando após túnel) não são animados: vai direto. */
export function shouldAnimateMove(from: LatLng | null, to: LatLng): boolean {
  return !!from && distanceMeters(from, to) < 2000;
}

/** Caixa [[sul, oeste], [norte, leste]] com folga mínima, para enquadrar motoboy + destino. */
export function boundsFor(points: Array<LatLng | null | undefined>, minSpanDeg = 0.002): [[number, number], [number, number]] | null {
  const ps = points.filter(isValidLatLng);
  if (ps.length === 0) return null;
  let s = Math.min(...ps.map(p => p.lat)), n = Math.max(...ps.map(p => p.lat));
  let w = Math.min(...ps.map(p => p.lng)), e = Math.max(...ps.map(p => p.lng));
  if (n - s < minSpanDeg) { const c = (n + s) / 2; s = c - minSpanDeg / 2; n = c + minSpanDeg / 2; }
  if (e - w < minSpanDeg) { const c = (e + w) / 2; w = c - minSpanDeg / 2; e = c + minSpanDeg / 2; }
  return [[s, w], [n, e]];
}
