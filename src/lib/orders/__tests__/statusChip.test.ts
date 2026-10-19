import { describe, it, expect } from 'vitest';
import { statusChip, FILTER_CHIP_CLASS } from '../statusChip';

describe('statusChip (padrão KDS)', () => {
  it('Novo âmbar, Em preparo azul, Pronto verde, Em rota ciano, Cancelado vermelho suave, Atrasado vermelho forte', () => {
    expect(statusChip('PENDING')).toMatchObject({ label: 'NOVO', icon: 'bell' });
    expect(statusChip('PENDING').className).toContain('amber');
    expect(statusChip('PREPARING')).toMatchObject({ icon: 'flame' });
    expect(statusChip('PREPARING').className).toContain('blue');
    expect(statusChip('READY').className).toContain('green');
    expect(statusChip('WAITING_FOR_DRIVER').label).toBe('PRONTO');
    expect(statusChip('OUT_FOR_DELIVERY')).toMatchObject({ icon: 'bike' });
    expect(statusChip('OUT_FOR_DELIVERY').className).toContain('cyan');
    expect(statusChip('CANCELLED')).toMatchObject({ icon: 'cancelled' });
    expect(statusChip('PREPARING', true)).toMatchObject({ label: 'ATRASADO', icon: 'late' });
    expect(statusChip('PREPARING', true).className).toContain('bg-red-600');
  });
  it('filtros usam as mesmas cores dos selos; estoque laranja', () => {
    expect(FILTER_CHIP_CLASS.novos).toBe(statusChip('PENDING').className);
    expect(FILTER_CHIP_CLASS.atrasados).toBe(statusChip('CONFIRMED', true).className);
    expect(FILTER_CHIP_CLASS.estoque).toContain('orange');
  });
});
