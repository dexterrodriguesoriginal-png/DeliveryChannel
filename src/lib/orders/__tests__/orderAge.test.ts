import { describe, it, expect } from 'vitest';
import { orderAgeInfo, formatAgePtBR, sortOrdersNewestFirst, countStaleActiveOrders, isActiveOrderStatus, AGE_WARN_MS, AGE_STALE_MS } from '../orderAge';

const NOW = Date.parse('2026-10-19T15:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, H = 60 * MIN, D = 24 * H;

describe('orderAge: selo "recebido há ..." do painel do dono', () => {
  it('formata em pt-BR', () => {
    expect(formatAgePtBR(45 * MIN)).toBe('45 min');
    expect(formatAgePtBR(3 * H + 10 * MIN)).toBe('3 h');
    expect(formatAgePtBR(D + 2 * H)).toBe('1 dia');
    expect(formatAgePtBR(3 * D)).toBe('3 dias');
  });
  it('pedido novo (< 30 min) não ganha selo', () => {
    const i = orderAgeInfo({ createdAt: ago(29 * MIN), status: 'PENDING' }, NOW);
    expect(i).toMatchObject({ level: 'fresh', show: false, label: '' });
  });
  it('30 min a 24 h = âmbar; 1 dia ou mais = vermelho', () => {
    expect(orderAgeInfo({ createdAt: ago(AGE_WARN_MS), status: 'PENDING' }, NOW)).toMatchObject({ level: 'warn', show: true, label: 'recebido há 30 min' });
    expect(orderAgeInfo({ createdAt: ago(5 * H), status: 'PREPARING' }, NOW)).toMatchObject({ level: 'warn', label: 'recebido há 5 h' });
    expect(orderAgeInfo({ createdAt: ago(AGE_STALE_MS), status: 'CONFIRMED' }, NOW)).toMatchObject({ level: 'stale', label: 'recebido há 1 dia' });
    expect(orderAgeInfo({ createdAt: ago(3 * D), status: 'PENDING' }, NOW)).toMatchObject({ level: 'stale', label: 'recebido há 3 dias' });
  });
  it('entregue ou cancelado nunca ganha selo, mesmo antigo', () => {
    expect(orderAgeInfo({ createdAt: ago(3 * D), status: 'DELIVERED' }, NOW).show).toBe(false);
    expect(orderAgeInfo({ createdAt: ago(3 * D), status: 'CANCELLED' }, NOW).show).toBe(false);
    expect(isActiveOrderStatus('WAITING_FOR_DRIVER')).toBe(true);
    expect(isActiveOrderStatus('OUT_FOR_DELIVERY')).toBe(true);
  });
  it('data inválida ou no futuro não quebra', () => {
    expect(orderAgeInfo({ createdAt: 'xx', status: 'PENDING' }, NOW).show).toBe(false);
    expect(orderAgeInfo({ createdAt: new Date(NOW + H).toISOString(), status: 'PENDING' }, NOW).show).toBe(false);
  });
  it('ordena com o pedido novo no topo, sem alterar a lista original', () => {
    const list = [
      { id: 'velho', orderNumber: 35, createdAt: ago(3 * D) },
      { id: 'novo', orderNumber: 37, createdAt: ago(MIN) },
      { id: 'meio', orderNumber: 36, createdAt: ago(2 * H) },
      { id: 'empate', orderNumber: 38, createdAt: ago(MIN) },
    ];
    const copy = JSON.stringify(list);
    expect(sortOrdersNewestFirst(list).map(o => o.id)).toEqual(['empate', 'novo', 'meio', 'velho']);
    expect(JSON.stringify(list)).toBe(copy);
  });
  it('conta só os ativos parados há 1 dia ou mais (dois pedidos do mesmo cliente contam os dois)', () => {
    expect(countStaleActiveOrders([
      { createdAt: ago(2 * D), status: 'PENDING' },
      { createdAt: ago(2 * D), status: 'PENDING' },
      { createdAt: ago(2 * D), status: 'DELIVERED' },
      { createdAt: ago(2 * H), status: 'PENDING' },
    ], NOW)).toBe(2);
  });
});
