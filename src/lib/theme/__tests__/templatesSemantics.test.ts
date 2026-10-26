import { describe, it, expect } from 'vitest';
import { TEMPLATES, getTemplateById } from '../templates/catalog';
import { rgbToHsl, hexToRgb, getLuminance } from '../templates/palettes';

describe('Semântica Cromática dos 150 Modelos — templatesSemantics.test.ts', () => {
  it('todas as famílias de cores respeitam os intervalos cromáticos estritos', () => {
    for (const template of TEMPLATES) {
      const primaryHex = template.tokens.palette.primary;
      const rgb = hexToRgb(primaryHex);
      const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

      switch (template.colorFamily) {
        case 'azul':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz azul`).toBeGreaterThanOrEqual(190);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz azul`).toBeLessThanOrEqual(250);
          break;
        case 'roxo':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz roxo`).toBeGreaterThanOrEqual(260);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz roxo`).toBeLessThanOrEqual(300);
          break;
        case 'rosa':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz rosa`).toBeGreaterThanOrEqual(300);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz rosa`).toBeLessThanOrEqual(345);
          break;
        case 'vermelho':
          const isRed = h >= 345 || h <= 15;
          expect(isRed, `Modelo ${template.id} com cor ${primaryHex} (h=${h}) deveria ter matiz vermelho`).toBe(true);
          break;
        case 'laranja':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz laranja`).toBeGreaterThanOrEqual(15);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz laranja`).toBeLessThanOrEqual(40);
          break;
        case 'amarelo':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz amarelo`).toBeGreaterThanOrEqual(40);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz amarelo`).toBeLessThanOrEqual(65);
          break;
        case 'verde':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz verde`).toBeGreaterThanOrEqual(70);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz verde`).toBeLessThanOrEqual(170);
          break;
        case 'marrom':
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz marrom`).toBeGreaterThanOrEqual(20);
          expect(h, `Modelo ${template.id} com cor ${primaryHex} deveria ter matiz marrom`).toBeLessThanOrEqual(50);
          expect(l, `Modelo ${template.id} com marrom deve ter luminosidade baixa`).toBeLessThan(0.45);
          expect(s, `Modelo ${template.id} com marrom deve ter saturação moderada`).toBeLessThan(0.60);
          break;
        case 'neutros':
          expect(s, `Modelo ${template.id} neutro deve ter saturação baixa`).toBeLessThan(0.15);
          break;
      }
    }
  });

  it('"adega-bordo-creme" utiliza bordô autêntico e NÃO magenta', () => {
    const tmpl = getTemplateById('adega-bordo-creme');
    expect(tmpl).toBeDefined();
    const primary = tmpl!.tokens.palette.primary;
    const rgb = hexToRgb(primary);
    const { h } = rgbToHsl(rgb.r, rgb.g, rgb.b);

    // Bordô é vermelho profundo (345° a 360° ou 0° a 15°). Magenta fica em 300°–340°.
    const isBordo = h >= 345 || h <= 15;
    expect(isBordo, `Adega bordô (${primary}) possui hue=${h}, não pode ser magenta`).toBe(true);

    const isMagenta = h >= 300 && h < 340;
    expect(isMagenta, `Adega bordô (${primary}) não pode ser magenta`).toBe(false);
  });

  it('luminâncias de fundo geral respeitam distinção clara entre light e dark', () => {
    for (const template of TEMPLATES) {
      const bg = template.tokens.palette.bgGeneral;
      const lum = getLuminance(bg);

      if (template.mode === 'dark') {
        expect(
          lum,
          `Modelo dark "${template.id}" deve ter bgGeneral escuro (lum < 0.15), obteve ${lum.toFixed(3)}`
        ).toBeLessThan(0.15);
      } else {
        expect(
          lum,
          `Modelo light "${template.id}" deve ter bgGeneral claro (lum > 0.80), obteve ${lum.toFixed(3)}`
        ).toBeGreaterThan(0.80);
      }
    }
  });
});
