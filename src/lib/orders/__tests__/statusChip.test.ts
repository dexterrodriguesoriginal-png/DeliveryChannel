import { describe, it, expect } from 'vitest';
import { statusChip, FILTER_CHIP_CLASS, FILTER_CHIP_COLORS } from '../statusChip';
import { STATUS_COLORS } from '../statusColors';

describe('statusChip (paleta única de Pedidos)', () => {
  it('usa vermelho, laranja, roxo, verde e cinza do Kanban para todos os canais', () => {
    expect(statusChip('PENDING')).toMatchObject({ label: 'NOVO', icon: 'bell', colors: STATUS_COLORS.PENDING });
    expect(statusChip('PREPARING')).toMatchObject({ icon: 'flame', colors: STATUS_COLORS.PREPARING });
    expect(statusChip('READY').colors).toBe(STATUS_COLORS.READY);
    expect(statusChip('WAITING_FOR_DRIVER').label).toBe('PRONTO');
    expect(statusChip('OUT_FOR_DELIVERY')).toMatchObject({ icon: 'bike', colors: STATUS_COLORS.READY });
    expect(statusChip('CANCELLED')).toMatchObject({ icon: 'cancelled', colors: STATUS_COLORS.CANCELLED });
    expect(statusChip('PREPARING', true)).toMatchObject({ label: 'ATRASADO', icon: 'late', colors: STATUS_COLORS.LATE });
  });
  it('filtros usam os mesmos tokens dos selos', () => {
    expect(FILTER_CHIP_CLASS.novos).toBe(statusChip('PENDING').className);
    expect(FILTER_CHIP_COLORS.novos).toBe(statusChip('PENDING').colors);
    expect(FILTER_CHIP_COLORS.emPreparo).toBe(statusChip('PREPARING').colors);
    expect(FILTER_CHIP_COLORS.prontos).toBe(statusChip('READY').colors);
    expect(FILTER_CHIP_COLORS.atrasados).toBe(statusChip('CONFIRMED', true).colors);
    expect(FILTER_CHIP_CLASS.estoque).toContain('orange');
  });
  it('salão mantém rótulos específicos e compartilha a paleta dos demais canais', () => {
    expect(statusChip('PENDING', false, 'DINE_IN').colors).toBe(STATUS_COLORS.PENDING);
    expect(statusChip('PREPARING', false, 'DINE_IN').colors).toBe(STATUS_COLORS.PREPARING);
    expect(statusChip('READY', false, 'DINE_IN')).toMatchObject({ label: 'AGUARDANDO GARÇOM' });
    expect(statusChip('READY', false, 'DINE_IN').colors).toBe(STATUS_COLORS.READY);
    expect(statusChip('OUT_FOR_DELIVERY', false, 'DINE_IN')).toMatchObject({ label: 'INDO ATÉ A MESA', icon: 'ready' });
    expect(statusChip('DELIVERED', false, 'DINE_IN').colors).toBe(STATUS_COLORS.DELIVERED);
    expect(statusChip('PREPARING', false, 'DELIVERY')).toEqual(statusChip('PREPARING'));
    expect(statusChip('READY', false, 'PICKUP')).toEqual(statusChip('READY'));
  });
});
