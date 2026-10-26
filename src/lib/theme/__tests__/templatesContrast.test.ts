import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../templates/catalog';
import { contrastRatio, validateWcagContrast } from '../themeEngine';

describe('Acessibilidade e Contraste WCAG AA dos 150 Modelos — templatesContrast.test.ts', () => {
  it('todos os 150 modelos são 100% aprovados pelo validador oficial validateWcagContrast()', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const textContrast = validateWcagContrast(p.textMain, p.bgCard);
      expect(
        textContrast.passNormal,
        `Modelo "${template.id}" reprovou no contraste Texto x Card: ${textContrast.ratio}:1`
      ).toBe(true);

      const btnContrast = validateWcagContrast(p.buttonText, p.buttonBg);
      expect(
        btnContrast.passLarge,
        `Modelo "${template.id}" reprovou no contraste Botão Texto x Botão Fundo: ${btnContrast.ratio}:1`
      ).toBe(true);
    }
  });

  it('todos os 150 modelos cumprem contraste estrito (≥ 4.5:1) em Texto Principal sobre Fundo do Card', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.textMain, p.bgCard);
      expect(
        ratio,
        `Modelo "${template.id}": textMain (${p.textMain}) vs bgCard (${p.bgCard}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os 150 modelos cumprem contraste estrito (≥ 4.5:1) em Título sobre Fundo Geral', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.textTitle, p.bgGeneral);
      expect(
        ratio,
        `Modelo "${template.id}": textTitle (${p.textTitle}) vs bgGeneral (${p.bgGeneral}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os 150 modelos cumprem contraste estrito (≥ 4.5:1) em Título sobre Fundo do Card', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.textTitle, p.bgCard);
      expect(
        ratio,
        `Modelo "${template.id}": textTitle (${p.textTitle}) vs bgCard (${p.bgCard}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os 150 modelos cumprem contraste estrito (≥ 4.5:1) em Texto Secundário sobre Fundo do Card', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.textSecondary, p.bgCard);
      expect(
        ratio,
        `Modelo "${template.id}": textSecondary (${p.textSecondary}) vs bgCard (${p.bgCard}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os 150 modelos cumprem contraste estrito (≥ 4.5:1) em Texto do Botão sobre Fundo do Botão', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.buttonText, p.buttonBg);
      expect(
        ratio,
        `Modelo "${template.id}": buttonText (${p.buttonText}) vs buttonBg (${p.buttonBg}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os 150 modelos cumprem contraste estrito (≥ 4.5:1) em Preço sobre Fundo do Card', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.price, p.bgCard);
      expect(
        ratio,
        `Modelo "${template.id}": price (${p.price}) vs bgCard (${p.bgCard}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os 150 modelos cumprem contraste (≥ 3.0:1) em Ícones sobre Fundo do Menu', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.iconColor, p.bgMenu);
      expect(
        ratio,
        `Modelo "${template.id}": iconColor (${p.iconColor}) vs bgMenu (${p.bgMenu}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('todos os 150 modelos cumprem contraste (≥ 4.5:1) em Título/Texto de Categoria sobre Fundo de Categoria', () => {
    for (const template of TEMPLATES) {
      const p = template.tokens.palette;
      const ratio = contrastRatio(p.textTitle, p.categoryBg);
      expect(
        ratio,
        `Modelo "${template.id}": textTitle (${p.textTitle}) vs categoryBg (${p.categoryBg}) teve ratio ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
