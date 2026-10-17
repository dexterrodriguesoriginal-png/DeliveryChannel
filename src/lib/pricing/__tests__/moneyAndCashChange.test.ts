import { describe, it, expect } from 'vitest';
import { formatBRL, brNumber } from '../money';
import { computeCashChange, cashChangeLabel } from '../cashChange';

describe('formatBRL (pt-BR)', () => {
  it('usa vírgula decimal e ponto de milhar', () => {
    expect(formatBRL(9)).toBe('R$ 9,00');
    expect(formatBRL(7)).toBe('R$ 7,00');
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
    expect(formatBRL(0.1 + 0.2)).toBe('R$ 0,30');
  });
  it('valor inválido vira 0,00', () => {
    expect(brNumber(undefined)).toBe('0,00');
    expect(formatBRL('abc')).toBe('R$ 0,00');
  });
});

describe('troco do pagamento em dinheiro', () => {
  it('troco para 50 com total 22 → devolver 28', () => {
    const info = computeCashChange('50', 22);
    expect(info).toEqual({ status: 'ok', amount: 50, total: 22, change: 28 });
    expect(cashChangeLabel(info)).toBe('Troco para R$ 50,00 (devolver R$ 28,00)');
  });
  it('aceita "50,00", "R$ 100" e centavos', () => {
    expect(computeCashChange('50,00', 21.9)).toMatchObject({ status: 'ok', change: 28.1 });
    expect(computeCashChange('R$ 100', 37.45)).toMatchObject({ status: 'ok', change: 62.55 });
  });
  it('vazio = não precisa de troco; valor menor que o total ou inválido = aviso', () => {
    expect(computeCashChange('', 22)).toEqual({ status: 'none' });
    expect(cashChangeLabel(computeCashChange('', 22))).toBeNull();
    expect(computeCashChange('20', 22)).toMatchObject({ status: 'insufficient', amount: 20, total: 22 });
    expect(computeCashChange('abc', 22)).toEqual({ status: 'invalid' });
    expect(computeCashChange('0', 22)).toEqual({ status: 'invalid' });
  });
  it('valor exato: sem troco', () => {
    expect(cashChangeLabel(computeCashChange('22', 22))).toBe('Troco: não precisa (paga R$ 22,00 exato)');
  });
});
