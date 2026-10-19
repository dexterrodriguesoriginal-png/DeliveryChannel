import { describe, it, expect } from 'vitest';
import { slaLevel, prepLimitMinutes, DEFAULT_PREP_MINUTES } from '../sla';

const MIN = 60000;
describe('slaLevel (semáforo de tempo)', () => {
  it('padrão 25 min quando a loja não configurou', () => {
    expect(DEFAULT_PREP_MINUTES).toBe(25);
    expect(prepLimitMinutes(undefined)).toBe(25);
    expect(prepLimitMinutes(0)).toBe(25);
    expect(prepLimitMinutes(40)).toBe(40);
  });
  it('verde < 70%, âmbar >= 70%, vermelho quando passou', () => {
    expect(slaLevel('PREPARING', 10 * MIN, 20)).toBe('ok');
    expect(slaLevel('PREPARING', 14 * MIN, 20)).toBe('warn');
    expect(slaLevel('CONFIRMED', 20 * MIN, 20)).toBe('warn');
    expect(slaLevel('CONFIRMED', 21 * MIN, 20)).toBe('late');
    expect(slaLevel('PENDING', 26 * MIN)).toBe('late');
  });
  it('pronto/em rota sem semáforo; entregue/cancelado sem cronômetro', () => {
    expect(slaLevel('READY', 99 * MIN)).toBe('neutral');
    expect(slaLevel('OUT_FOR_DELIVERY', 99 * MIN)).toBe('neutral');
    expect(slaLevel('DELIVERED', 99 * MIN)).toBe('none');
    expect(slaLevel('CANCELLED', 1 * MIN)).toBe('none');
  });
});
