import { describe, it, expect } from 'vitest';
import { couponCountdownLabel } from '../couponCountdown';

const now = Date.parse('2026-10-17T20:00:00-03:00');
const plus = (ms: number) => new Date(now + ms).toISOString();
const MIN = 60000;

describe('contagem do cupom', () => {
  it('menos de 1 h → minutos, urgente', () => {
    expect(couponCountdownLabel(plus(45 * MIN), now)).toEqual({ label: 'Acaba em 45 min', urgent: true, expired: false });
    expect(couponCountdownLabel(plus(10 * 1000), now)?.label).toBe('Acaba em 1 min');
  });
  it('entre 1 h e 24 h → horas e minutos', () => {
    expect(couponCountdownLabel(plus(200 * MIN), now)?.label).toBe('Acaba em 3h 20min');
    expect(couponCountdownLabel(plus(120 * MIN), now)?.label).toBe('Acaba em 2h');
  });
  it('24 h ou mais → data, sem urgência', () => {
    const r = couponCountdownLabel('2026-10-25T23:00:00-03:00', now);
    expect(r).toEqual({ label: 'Válido até 25/10', urgent: false, expired: false });
  });
  it('expirado, sem data ou data inválida', () => {
    expect(couponCountdownLabel(plus(-1), now)?.expired).toBe(true);
    expect(couponCountdownLabel(undefined, now)).toBeNull();
    expect(couponCountdownLabel('xx', now)).toBeNull();
  });
});
