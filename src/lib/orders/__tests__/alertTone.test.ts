import { describe, it, expect } from 'vitest';
import { alertTone, ALERT_TONE_CLASS } from '../alertTone';

const c = (p: Partial<Record<'novos' | 'emPreparo' | 'prontos' | 'atrasados', number>> = {}) =>
  ({ novos: 0, emPreparo: 0, prontos: 0, atrasados: 0, ...p });

describe('alertTone (cor da faixa de alertas, padrão KDS)', () => {
  it('filtro selecionado manda na cor', () => {
    const all = c({ novos: 1, emPreparo: 1, prontos: 1, atrasados: 1 });
    expect(alertTone(all, 'prontos')).toBe('green');
    expect(alertTone(all, 'emPreparo')).toBe('blue');
    expect(alertTone(all, 'novos')).toBe('amber');
    expect(alertTone(all, 'atrasados')).toBe('red');
  });
  it('sem filtro: Atrasados > Novos > Prontos > Em preparo > Estoque baixo > neutro', () => {
    expect(alertTone(c({ novos: 2, atrasados: 1 }), null)).toBe('red');
    expect(alertTone(c({ novos: 1, prontos: 3 }), null)).toBe('amber');
    expect(alertTone(c({ prontos: 1, emPreparo: 4 }), null)).toBe('green');
    expect(alertTone(c({ emPreparo: 1 }), null, 5)).toBe('blue');
    expect(alertTone(c(), null, 2)).toBe('stock');
    expect(alertTone(c(), null, 0)).toBe('neutral');
  });
  it('Prontos usa o verde da marca; estoque com acento laranja (diferente do âmbar dos Novos)', () => {
    expect(ALERT_TONE_CLASS.green).toContain('#15803d');
    expect(ALERT_TONE_CLASS.stock).toContain('orange');
    expect(ALERT_TONE_CLASS.amber).not.toContain('orange');
  });
});
