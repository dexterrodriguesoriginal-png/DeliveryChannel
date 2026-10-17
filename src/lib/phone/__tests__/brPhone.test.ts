import { describe, it, expect } from 'vitest';
import { normalizeBRPhone, formatBRPhone, brPhoneDigits } from '../brPhone';

describe('brPhone', () => {
  it('aceita 55/+55, espaços, parênteses e traços', () => {
    for (const v of ['5511999990000', '+55 11 99999-0000', '+55 (11) 99999-0000', '(11) 99999-0000', '11 99999 0000', '011999990000', '11999990000'])
      expect(normalizeBRPhone(v)).toBe('11999990000');
  });
  it('fixo com 10 dígitos (com e sem 55)', () => {
    expect(normalizeBRPhone('551133334444')).toBe('1133334444');
    expect(normalizeBRPhone('(11) 3333-4444')).toBe('1133334444');
  });
  it('recusa inválidos', () => {
    for (const v of ['', '12345', '999990000', '0011999990000', '123456789012345'])
      expect(normalizeBRPhone(v)).toBeNull();
  });
  it('máscara remove o 55 colado', () => {
    expect(formatBRPhone('5511999990000')).toBe('(11) 99999-0000');
    expect(formatBRPhone('1133334444')).toBe('(11) 3333-4444');
    expect(formatBRPhone('119')).toBe('(11) 9');
    expect(brPhoneDigits('+55 11 99999-0000')).toBe('11999990000');
  });
});
