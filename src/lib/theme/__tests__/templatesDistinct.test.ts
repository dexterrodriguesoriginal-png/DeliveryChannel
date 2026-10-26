import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../templates/catalog';
import { getLuminance, getContrast } from '../templates/palettes';
import { catalogViolations, deltaE2000, deltaE76, MIN_PRIMARY_DE_SAME_SEGMENT } from '../colorDistance';

const sigs = TEMPLATES.map((t) => ({
  id: t.id, segmentId: t.segmentId,
  primary: t.tokens.palette.primary, secondary: t.tokens.palette.secondary, bg: t.tokens.palette.bgGeneral,
}));

describe('ΔE: distância de cor', () => {
  it('cores iguais têm distância 0 e preto x branco ~100', () => {
    expect(deltaE2000('#336699', '#336699')).toBeCloseTo(0, 6);
    expect(deltaE2000('#000000', '#ffffff')).toBeCloseTo(100, 0);
    expect(deltaE76('#000000', '#ffffff')).toBeCloseTo(100, 0);
  });
  it('é simétrica e separa tons próximos de tons distintos', () => {
    expect(deltaE2000('#dc2626', '#2563eb')).toBeCloseTo(deltaE2000('#2563eb', '#dc2626'), 6);
    expect(deltaE2000('#dc2626', '#d92525')).toBeLessThan(2);
    expect(deltaE2000('#dc2626', '#15803d')).toBeGreaterThan(40);
  });
});

describe('150 modelos sem cores repetidas', () => {
  it('continua com 150 modelos e ids únicos', () => {
    expect(TEMPLATES).toHaveLength(150);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(150);
  });
  it(`primárias do mesmo segmento distam ΔE2000 >= ${MIN_PRIMARY_DE_SAME_SEGMENT}`, () => {
    expect(catalogViolations(sigs).sameSegment).toEqual([]);
  });
  it('nenhuma combinação primária + fundo se repete no catálogo inteiro', () => {
    expect(catalogViolations(sigs).nearDuplicates).toEqual([]);
  });
  it('há variedade real de fundos (claros, escuros e gradientes)', () => {
    expect(new Set(sigs.map((s) => s.bg)).size).toBeGreaterThanOrEqual(110);
    const gradients = TEMPLATES.filter((t) => t.tokens.backgrounds.general.type === 'gradient-linear');
    expect(gradients.length).toBeGreaterThanOrEqual(40);
    expect(TEMPLATES.some((t) => t.mode === 'dark' && t.tokens.backgrounds.general.type === 'gradient-linear')).toBe(true);
  });
  it('as cores do gradiente mantêm o texto legível', () => {
    for (const t of TEMPLATES) {
      const g = t.tokens.backgrounds.general;
      if (g.type !== 'gradient-linear') continue;
      expect(typeof g.angle).toBe('number');
      for (const c of g.gradientColors || []) {
        const lum = getLuminance(c);
        if (t.mode === 'dark') expect(lum, t.id).toBeLessThan(0.15); else expect(lum, t.id).toBeGreaterThan(0.75);
        expect(getContrast(t.tokens.palette.textTitle, c), t.id).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
