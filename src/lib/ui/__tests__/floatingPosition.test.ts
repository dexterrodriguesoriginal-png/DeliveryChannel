import { describe, expect, it } from 'vitest';
import { bounds, clampPoint, loadPosition, parseSaved, placePanel, pointFromSaved, positionKey, savePosition, snapToEdge } from '../floatingPosition';

const vp = { w: 1366, h: 768, bottomOffset: 0 }, size = { w: 196, h: 52 };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe('posição arrastável das notificações', () => {
  it('mantém o botão dentro da tela e acima da barra Salvar', () => {
    expect(clampPoint({ x: -50, y: -50 }, vp, size)).toEqual({ x: 12, y: 12 });
    const c = clampPoint({ x: 5000, y: 5000 }, { ...vp, bottomOffset: 64 }, size);
    expect(c.x).toBe(1366 - 196 - 12);
    expect(c.y).toBe(768 - 64 - 52 - 12);
  });
  it('encaixa na borda mais próxima e guarda borda + posição relativa', () => {
    expect(snapToEdge({ x: 100, y: 300 }, vp, size)).toMatchObject({ edge: 'left', x: 12 });
    expect(snapToEdge({ x: 1100, y: 300 }, vp, size)).toMatchObject({ edge: 'right', x: 1366 - 196 - 12 });
    expect(snapToEdge({ x: 600, y: 20 }, vp, size)).toMatchObject({ edge: 'top', y: 12 });
    const bottom = snapToEdge({ x: 600, y: 700 }, vp, size);
    expect(bottom.edge).toBe('bottom'); expect(bottom.y).toBe(bounds(vp, size).maxY);
    expect(bottom.t).toBeGreaterThan(0); expect(bottom.t).toBeLessThan(1);
  });
  it('reposiciona dentro dos limites quando a janela muda de tamanho', () => {
    const saved = { edge: 'right' as const, t: 1 };
    const big = pointFromSaved(saved, vp, size), small = pointFromSaved(saved, { w: 800, h: 500, bottomOffset: 0 }, size);
    expect(big).toEqual({ x: 1158, y: 704 }); expect(small).toEqual({ x: 592, y: 436 });
    const tiny = pointFromSaved({ edge: 'left', t: .5 }, { w: 100, h: 60, bottomOffset: 80 }, size);
    expect(tiny.x).toBeGreaterThanOrEqual(12); expect(tiny.y).toBeGreaterThanOrEqual(12);
  });
  it('persiste por usuário em localStorage, ignora lixo e restaura a posição', () => {
    const st = mem();
    savePosition(st, 'u1', { edge: 'left', t: .25 });
    expect(st.m.has(positionKey('u1'))).toBe(true);
    expect(loadPosition(st, 'u1')).toEqual({ edge: 'left', t: .25 });
    expect(loadPosition(st, 'u2')).toBeNull();
    st.setItem(positionKey('u3'), '{"edge":"nowhere","t":2}'); expect(loadPosition(st, 'u3')).toBeNull();
    expect(parseSaved('{"edge":"top","t":9}')).toEqual({ edge: 'top', t: 1 });
    expect(parseSaved('lixo')).toBeNull();
    savePosition(st, 'u1', null); expect(loadPosition(st, 'u1')).toBeNull();
  });
  it('o painel abre para o lado com mais espaço e nunca cobre a barra Salvar', () => {
    const bottomRight = placePanel({ x: 1158, y: 704, w: 196, h: 52 }, { ...vp, bottomOffset: 64 }, { w: 380, h: 560 });
    expect(bottomRight.openUp).toBe(true); expect(bottomRight.alignRight).toBe(true);
    expect(bottomRight.left + bottomRight.width).toBeLessThanOrEqual(1366 - 12);
    const topLeft = placePanel({ x: 12, y: 12, w: 196, h: 52 }, { ...vp, bottomOffset: 64 }, { w: 380, h: 560 });
    expect(topLeft.openUp).toBe(false); expect(topLeft.alignRight).toBe(false);
    expect(topLeft.top! + topLeft.maxHeight).toBeLessThanOrEqual(768 - 64 - 12);
    const nearBar = placePanel({ x: 12, y: 300, w: 196, h: 52 }, { w: 1366, h: 576, bottomOffset: 200 }, { w: 380, h: 560 });
    const bottomEdge = nearBar.openUp ? 576 - nearBar.bottom! : nearBar.top! + nearBar.maxHeight;
    if (!nearBar.openUp) expect(bottomEdge).toBeLessThanOrEqual(576 - 200 - 12);
    const mobile = placePanel({ x: 12, y: 500, w: 52, h: 52 }, { w: 360, h: 640, bottomOffset: 0 }, { w: 380, h: 560 });
    expect(mobile.width).toBe(336); expect(mobile.left).toBeGreaterThanOrEqual(12);
  });
});
