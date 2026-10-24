import { describe, it, expect } from 'vitest';
import { PRESET_THEMES } from '../presetThemes';
import { validateHexColor, validateWcagContrast, contrastRatio } from '../themeEngine';

describe('Suíte de Testes — 40 Temas Homologados (presetThemes.test.ts)', () => {
  it('contém exatamente 40 temas prontos na galeria', () => {
    expect(PRESET_THEMES.length).toBe(40);
  });

  it('todos os 40 temas possuem IDs únicos e não duplicados', () => {
    const ids = PRESET_THEMES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(40);
    expect(uniqueIds.size).toBe(PRESET_THEMES.length);
  });

  it('cobre todos os 20 segmentos de comércio solicitados', () => {
    const normalize = (str: string) =>
      str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

    const requiredSegments = [
      'pizzaria',
      'padaria',
      'barbearia',
      'salao',
      'mercado',
      'acai',
      'hamburgueria',
      'japonesa',
      'adega',
      'farmacia',
      'pet',
      'perfumaria',
      'tabacaria',
      'cafe',
      'doceria',
      'churrasco',
      'hotdog',
      'saudavel',
      'darkpremium',
      'minimal',
    ];

    const presentCategories = new Set(
      PRESET_THEMES.map((t) => normalize(t.category || ''))
    );

    for (const segment of requiredSegments) {
      expect(
        presentCategories.has(segment),
        `Segmento "${segment}" ausente nas categorias dos temas`
      ).toBe(true);
    }
  });

  it('todas as cores da paleta em todos os 40 temas possuem códigos HEX válidos', () => {
    for (const theme of PRESET_THEMES) {
      const p = theme.tokens.palette;
      const keys: (keyof typeof p)[] = [
        'primary',
        'secondary',
        'accent',
        'bgGeneral',
        'bgHeader',
        'bgCard',
        'bgMenu',
        'categoryBg',
        'iconColor',
        'textTitle',
        'textMain',
        'textSecondary',
        'buttonBg',
        'buttonText',
        'price',
        'promoPrice',
        'border',
      ];
      for (const k of keys) {
        expect(
          validateHexColor(p[k]),
          `Tema "${theme.name}" (${theme.id}) possui cor inválida no token "${k}": ${p[k]}`
        ).toBe(true);
      }
    }
  });

  it('todos os 40 temas são 100% aprovados em conformidade WCAG AA (texto/card, título/card, botão/texto)', () => {
    for (const theme of PRESET_THEMES) {
      const p = theme.tokens.palette;

      // 1. Texto principal sobre fundo do card (norma normal >= 4.5:1)
      const textCardContrast = contrastRatio(p.textMain, p.bgCard);
      expect(
        textCardContrast,
        `Tema "${theme.name}" reprovou no contraste Texto Principal x Card: ${textCardContrast}:1`
      ).toBeGreaterThanOrEqual(4.5);

      // 2. Título sobre fundo do card (norma normal >= 4.5:1)
      const titleCardContrast = contrastRatio(p.textTitle, p.bgCard);
      expect(
        titleCardContrast,
        `Tema "${theme.name}" reprovou no contraste Título x Card: ${titleCardContrast}:1`
      ).toBeGreaterThanOrEqual(4.5);

      // 3. Texto do botão sobre fundo do botão (botões/texto grande >= 3.0:1, normal >= 4.5:1)
      const buttonContrast = contrastRatio(p.buttonText, p.buttonBg);
      expect(
        buttonContrast,
        `Tema "${theme.name}" reprovou no contraste Botão Texto x Botão Fundo: ${buttonContrast}:1`
      ).toBeGreaterThanOrEqual(3.0);

      // 4. Validação pelo motor validateWcagContrast
      const wcagBtn = validateWcagContrast(p.buttonText, p.buttonBg);
      expect(
        wcagBtn.passLarge,
        `Tema "${theme.name}" reprovou na validação WCAG para botão`
      ).toBe(true);
    }
  });
});
