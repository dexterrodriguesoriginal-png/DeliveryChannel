import { describe, it, expect } from 'vitest';
import {
  boundsFor, distanceMeters, interpolateLatLng, isLiveTrackable, parseDriverLocationRow, shouldAnimateMove, shouldPollLive, updatedAgoLabel,
} from '../liveTracking';

const now = Date.parse('2026-10-17T22:00:00-03:00');
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe('acompanhamento ao vivo do motoboy', () => {
  it('só acompanha entrega em rota', () => {
    expect(isLiveTrackable({ status: 'OUT_FOR_DELIVERY', fulfillmentType: 'DELIVERY' })).toBe(true);
    expect(isLiveTrackable({ status: 'OUT_FOR_DELIVERY', fulfillmentType: 'PICKUP' })).toBe(false);
    expect(isLiveTrackable({ status: 'READY', fulfillmentType: 'DELIVERY' })).toBe(false);
    expect(isLiveTrackable({ status: 'DELIVERED' })).toBe(false);
    expect(isLiveTrackable(null)).toBe(false);
  });
  it('polling só em rota e com a aba visível; para em DELIVERED/CANCELLED', () => {
    expect(shouldPollLive('OUT_FOR_DELIVERY', 'visible')).toBe(true);
    expect(shouldPollLive('OUT_FOR_DELIVERY', 'hidden')).toBe(false);
    expect(shouldPollLive('DELIVERED', 'visible')).toBe(false);
    expect(shouldPollLive('CANCELLED', 'visible')).toBe(false);
  });
  it('lê a linha da RPC e marca desatualizado (servidor ou relógio local)', () => {
    const p = parseDriverLocationRow([{ lat: -23.5, lng: -46.8, heading: 90, accuracy: 12, recorded_at: iso(10_000), is_stale: false }], now);
    expect(p).toMatchObject({ lat: -23.5, lng: -46.8, heading: 90, accuracy: 12, isStale: false });
    expect(parseDriverLocationRow({ lat: -23.5, lng: -46.8, recorded_at: iso(10_000), is_stale: true }, now)?.isStale).toBe(true);
    expect(parseDriverLocationRow({ lat: -23.5, lng: -46.8, recorded_at: iso(3 * 60_000), is_stale: false }, now)?.isStale).toBe(true);
    expect(parseDriverLocationRow({ lat: -23.5, lng: -46.8, heading: null, accuracy: null, recorded_at: iso(1000) }, now)).toMatchObject({ heading: null, accuracy: null });
    expect(parseDriverLocationRow([], now)).toBeNull();
    expect(parseDriverLocationRow({ lat: 0, lng: 0, recorded_at: iso(1) }, now)).toBeNull();
    expect(parseDriverLocationRow({ lat: 'x', lng: 1, recorded_at: iso(1) }, now)).toBeNull();
    expect(parseDriverLocationRow({ lat: -23, lng: -46, recorded_at: 'nope' }, now)).toBeNull();
  });
  it('rótulo "Atualizado há X s"', () => {
    expect(updatedAgoLabel(iso(2000), now)).toBe('Atualizado agora');
    expect(updatedAgoLabel(iso(12_000), now)).toBe('Atualizado há 12 s');
    expect(updatedAgoLabel(iso(185_000), now)).toBe('Atualizado há 3 min');
    expect(updatedAgoLabel(iso(2 * 3600_000), now)).toBe('Atualizado há 2 h');
    expect(updatedAgoLabel(undefined, now)).toBe('');
  });
  it('interpolação suave e saltos grandes sem animação', () => {
    const a = { lat: -23.5, lng: -46.8 }, b = { lat: -23.4, lng: -46.7 };
    expect(interpolateLatLng(a, b, 0)).toEqual(a);
    expect(interpolateLatLng(a, b, 1)).toEqual(b);
    const mid = interpolateLatLng(a, b, 0.5);
    expect(mid.lat).toBeCloseTo(-23.45, 6);
    expect(interpolateLatLng(a, b, 2)).toEqual(b);
    expect(distanceMeters(a, a)).toBe(0);
    expect(Math.round(distanceMeters({ lat: -23.5, lng: -46.8 }, { lat: -23.501, lng: -46.8 }))).toBe(111);
    expect(shouldAnimateMove(a, { lat: -23.5005, lng: -46.8 })).toBe(true);
    expect(shouldAnimateMove(a, b)).toBe(false);
    expect(shouldAnimateMove(null, b)).toBe(false);
  });
  it('enquadramento motoboy + destino, com folga mínima', () => {
    expect(boundsFor([{ lat: -23.5, lng: -46.8 }, { lat: -23.52, lng: -46.83 }])).toEqual([[-23.52, -46.83], [-23.5, -46.8]]);
    const one = boundsFor([{ lat: -23.5, lng: -46.8 }, null])!;
    expect(one[1][0] - one[0][0]).toBeCloseTo(0.002, 9);
    expect(boundsFor([null, undefined])).toBeNull();
  });
});
