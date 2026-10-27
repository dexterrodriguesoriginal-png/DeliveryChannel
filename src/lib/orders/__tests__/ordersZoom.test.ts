// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clampZoom, ordersZoomKey, readOrdersZoom, useOrdersZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../ordersZoom';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('zoom da página de Pedidos', () => {
  it('limita a 10–130% em passos de 10', () => {
    expect(ZOOM_MIN).toBe(10);
    expect([clampZoom(0), clampZoom(-50), clampZoom(4), clampZoom(10), clampZoom(14), clampZoom(16), clampZoom(74), clampZoom(135), clampZoom(NaN)]).toEqual([10, 10, 10, 10, 10, 20, 70, ZOOM_MAX, ZOOM_DEFAULT]);
  });
  it('+/−/reset respeitam os limites e persistem por usuário', () => {
    const a = renderHook(() => useOrdersZoom('user-a'));
    act(() => a.result.current.zoomOut());
    act(() => a.result.current.zoomOut());
    expect(a.result.current.zoom).toBe(80);
    expect(localStorage.getItem(ordersZoomKey('user-a'))).toBe('80');
    for (let i = 0; i < 12; i++) act(() => a.result.current.zoomOut());
    expect(a.result.current.zoom).toBe(10);
    expect(a.result.current.scale).toBeCloseTo(0.1);
    for (let i = 0; i < 14; i++) act(() => a.result.current.zoomIn());
    expect(a.result.current.zoom).toBe(130);
    expect(a.result.current.scale).toBeCloseTo(1.3);
    act(() => a.result.current.reset());
    expect(a.result.current.zoom).toBe(100);
    act(() => a.result.current.zoomOut());
    const b = renderHook(() => useOrdersZoom('user-b'));
    expect(b.result.current.zoom).toBe(100); // outro usuário não herda
    const a2 = renderHook(() => useOrdersZoom('user-a'));
    expect(a2.result.current.zoom).toBe(90); // remonta e lembra
  });
  it('valor salvo antigo/fora da faixa é ajustado para 10–130%', () => {
    localStorage.setItem(ordersZoomKey('old'), '5');
    expect(readOrdersZoom('old')).toBe(10);
    localStorage.setItem(ordersZoomKey('old'), '250');
    expect(readOrdersZoom('old')).toBe(130);
    localStorage.setItem(ordersZoomKey('old'), '70');
    expect(readOrdersZoom('old')).toBe(70); // valor antigo continua válido
  });
  it('valor salvo inválido ou storage bloqueado voltam a 100%', () => {
    localStorage.setItem(ordersZoomKey('u'), 'abc');
    expect(readOrdersZoom('u')).toBe(100);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readOrdersZoom('u')).toBe(100);
    const h = renderHook(() => useOrdersZoom('u'));
    act(() => h.result.current.zoomIn());
    expect(h.result.current.zoom).toBe(110);
  });
  it('não captura teclado: Ctrl +/- ficam com o navegador', () => {
    renderHook(() => useOrdersZoom('u'));
    for (const key of ['+', '-', '=', '0']) {
      const ev = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true, bubbles: true });
      document.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });
});
