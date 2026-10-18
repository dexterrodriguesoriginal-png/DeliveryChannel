import { describe, it, expect } from 'vitest';
import { isValidCPF, formatCPF, cpfDigits, maskCPF } from '../cpf';

describe('CPF', () => {
  it('aceita CPFs válidos com e sem máscara', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('52998224725')).toBe(true);
    expect(isValidCPF('111.444.777-35')).toBe(true);
  });
  it('recusa dígito verificador errado, tamanho errado e sequências repetidas', () => {
    expect(isValidCPF('529.982.247-24')).toBe(false);
    expect(isValidCPF('5299822472')).toBe(false);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('000.000.000-00')).toBe(false);
    expect(isValidCPF('')).toBe(false);
    expect(isValidCPF(null)).toBe(false);
    expect(isValidCPF('529a982b247c25')).toBe(false);
  });
  it('formata progressivamente e limita a 11 dígitos', () => {
    expect(formatCPF('529')).toBe('529');
    expect(formatCPF('5299')).toBe('529.9');
    expect(formatCPF('5299822')).toBe('529.982.2');
    expect(formatCPF('529982247251234')).toBe('529.982.247-25');
    expect(cpfDigits('529.982.247-25')).toBe('52998224725');
  });
  it('mascara para exibição', () => {
    expect(maskCPF('52998224725')).toBe('***.982.247-**');
    expect(maskCPF('123')).toBe('');
  });
});
