import { describe, it, expect } from 'vitest';
import { statusChip, FILTER_CHIP_CLASS } from '../statusChip';

describe('statusChip (cores únicas do painel)', () => {
  it('Novo azul, Em preparo âmbar, Pronto verde, Atrasado vermelho', () => {
    expect(statusChip('PENDING').className).toContain('blue');
    expect(statusChip('PREPARING').className).toContain('amber');
    expect(statusChip('READY').className).toContain('green');
    expect(statusChip('WAITING_FOR_DRIVER').label).toBe('PRONTO');
    expect(statusChip('PREPARING', true)).toMatchObject({ label: 'ATRASADO' });
    expect(statusChip('PREPARING', true).className).toContain('red');
  });
  it('filtros usam as mesmas cores dos selos', () => {
    expect(FILTER_CHIP_CLASS.novos).toBe(statusChip('PENDING').className);
    expect(FILTER_CHIP_CLASS.atrasados).toBe(statusChip('CONFIRMED', true).className);
  });
});
