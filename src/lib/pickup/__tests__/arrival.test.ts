import { describe, it, expect } from 'vitest';
import { parseStoreToken, isArrivalFeatureMissing, arrivalQueue, arrivalLine, calledCodes, arrivalErrorMessage, arrivalQrUrl } from '../arrival';

describe('fila de chegada', () => {
  it('lê o token do QR ou do código digitado', () => {
    expect(parseStoreToken('https://x.app/chegada/ABC234')).toBe('ABC234');
    expect(parseStoreToken(' abc-234 ')).toBe('ABC234');
    expect(parseStoreToken('ABC1')).toBeNull();
    expect(parseStoreToken(arrivalQrUrl('https://a.b/', 'ZZZ999'))).toBe('ZZZ999');
  });
  it('detecta banco sem a migration', () => {
    expect(isArrivalFeatureMissing({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isArrivalFeatureMissing({ code: '42P01' })).toBe(true);
    expect(isArrivalFeatureMissing({ message: 'WRONG_STORE: x' })).toBe(false);
  });
  it('ordena por chegada e numera', () => {
    const q = arrivalQueue([
      { order_id: 'b', pickup_code: '222', arrived_at: '2026-10-19T10:05:00Z', called_at: null },
      { order_id: 'a', pickup_code: '111', arrived_at: '2026-10-19T10:01:00Z', called_at: null },
      { order_id: 'c', pickup_code: '333', arrived_at: null, called_at: null },
      { order_id: 'd', pickup_code: '444', arrived_at: '2026-10-19T09:00:00Z', called_at: null, closed_at: '2026-10-19T09:10:00Z' },
    ]);
    expect(q.map(r => [r.order_id, r.position])).toEqual([['a', 1], ['b', 2]]);
  });
  it('texto do painel', () => {
    const now = Date.parse('2026-10-19T10:10:00Z');
    expect(arrivalLine('Cleusa Aparecida', '2026-10-19T10:06:00Z', now)).toBe('Cleusa chegou, aguardando há 4 min');
  });
  it('códigos chamados recentes', () => {
    const now = Date.parse('2026-10-19T10:40:00Z');
    expect(calledCodes([
      { order_id: '1', pickup_code: '568', arrived_at: null, called_at: '2026-10-19T10:35:00Z' },
      { order_id: '2', pickup_code: '123', arrived_at: null, called_at: '2026-10-19T10:38:00Z' },
      { order_id: '3', pickup_code: '999', arrived_at: null, called_at: '2026-10-19T09:00:00Z' },
    ], now)).toEqual(['123', '568']);
  });
  it('mensagens', () => {
    expect(arrivalErrorMessage({ message: 'WRONG_STORE: x' })).toMatch(/não é da loja/);
  });
});
