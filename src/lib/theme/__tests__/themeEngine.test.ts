import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../../supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import {
  validateHexColor,
  normalizeHexColor,
  calculateContrast,
  validateWcagContrast,
  calculateRelativeLuminance,
  hexToRgb,
  formatCssBackground,
  createDefaultThemeTokens,
  themeToTokens,
  tokensToTheme,
  generateCssVariables,
  DEFAULT_DELIVERY_CHANNEL_THEME,
  SAFE_FONT_FAMILIES,
} from '../themeEngine';
import { PRESET_THEMES } from '../presetThemes';
import { themeService } from '../../../services/themeService';
import { tenantRepository } from '../../../repositories/tenantRepository';
import { SecurityContext } from '../../../services/securityEngine';
import { mapTheme } from '../../../repositories/publicStoreMapper';

const mockContext: SecurityContext = {
  userId: 'user-owner-1',
  userName: 'Proprietário Teste',
  userRole: 'OWNER',
  tenantId: 'tenant-111',
};

describe('Motor de Design do App — Contraste & Validações WCAG AA', () => {
  it('valida cores hexadecimais corretamente', () => {
    expect(validateHexColor('#15803d')).toBe(true);
    expect(validateHexColor('#fff')).toBe(true);
    expect(validateHexColor('#000000')).toBe(true);
    expect(validateHexColor('#F8FAFC')).toBe(true);
    expect(validateHexColor('15803d')).toBe(false);
    expect(validateHexColor('#12')).toBe(false);
    expect(validateHexColor('red')).toBe(false);
    expect(validateHexColor('')).toBe(false);
  });

  it('normaliza cores hexadecimais para formato de 7 caracteres', () => {
    expect(normalizeHexColor('#fff')).toBe('#ffffff');
    expect(normalizeHexColor('#15803D')).toBe('#15803d');
    expect(normalizeHexColor('invalido', '#15803d')).toBe('#15803d');
  });

  it('converte hex para RGB com precisão', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#15803d')).toEqual({ r: 21, g: 128, b: 61 });
  });

  it('calcula luminância relativa conforme WCAG 2.1', () => {
    const whiteLum = calculateRelativeLuminance({ r: 255, g: 255, b: 255 });
    const blackLum = calculateRelativeLuminance({ r: 0, g: 0, b: 0 });
    expect(whiteLum).toBeCloseTo(1.0, 2);
    expect(blackLum).toBeCloseTo(0.0, 2);
  });

  it('calcula razão de contraste exata entre preto e branco (21:1)', () => {
    const ratio = calculateContrast('#000000', '#ffffff');
    expect(ratio).toBe(21.0);
  });

  it('valida conformidade WCAG AA (>= 4.5:1 para texto normal)', () => {
    const good = validateWcagContrast('#ffffff', '#15803d');
    expect(good.passNormal).toBe(true);
    expect(good.ratio).toBeGreaterThanOrEqual(4.5);

    const bad = validateWcagContrast('#e2e8f0', '#ffffff');
    expect(bad.passNormal).toBe(false);
    expect(bad.level).toBe('FAIL');
  });
});

describe('Motor de Design — Formatação de Fundos CSS', () => {
  it('formata fundo sólido', () => {
    expect(formatCssBackground({ type: 'solid', color: '#ffffff' })).toBe('#ffffff');
  });

  it('formata gradiente linear com ângulo configurável', () => {
    const css = formatCssBackground({
      type: 'gradient-linear',
      color: '#15803d',
      gradientColors: ['#15803d', '#166534'],
      angle: 90,
    });
    expect(css).toBe('linear-gradient(90deg, #15803d, #166534)');
  });

  it('formata gradiente radial', () => {
    const css = formatCssBackground({
      type: 'gradient-radial',
      color: '#15803d',
      gradientColors: ['#15803d', '#166534'],
    });
    expect(css).toBe('radial-gradient(circle at center, #15803d, #166534)');
  });

  it('formata imagem com overlay e opacidade', () => {
    const css = formatCssBackground({
      type: 'image',
      color: '#000000',
      imageUrl: 'https://example.com/capa.jpg',
      overlayColor: '#000000',
      overlayOpacity: 50,
    });
    expect(css).toContain('url("https://example.com/capa.jpg")');
    expect(css).toContain('rgba(0, 0, 0, 0.50)');
  });
});

describe('Galeria de 20 Temas Prontos — Validação Completa', () => {
  it('contém exatamente 20 temas prontos', () => {
    expect(PRESET_THEMES.length).toBe(20);
  });

  it('todos os 20 temas possuem IDs únicos e nomes descritivos', () => {
    const ids = new Set(PRESET_THEMES.map(t => t.id));
    expect(ids.size).toBe(20);

    for (const preset of PRESET_THEMES) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.category.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('todas as cores da paleta em todos os 20 temas são HEX válidos', () => {
    for (const preset of PRESET_THEMES) {
      const p = preset.tokens.palette;
      const paletteKeys: (keyof typeof p)[] = [
        'primary', 'secondary', 'accent', 'bgGeneral', 'bgHeader',
        'bgCard', 'bgMenu', 'categoryBg', 'iconColor', 'textTitle', 'textMain', 'textSecondary',
        'buttonBg', 'buttonText', 'price', 'promoPrice', 'border'
      ];
      for (const key of paletteKeys) {
        const val = p[key];
        expect(validateHexColor(val), `Cor inválida "${key}": ${val} no tema ${preset.name}`).toBe(true);
      }
    }
  });

  it('todos os 20 temas possuem conformidade WCAG AA garantida em botões e cards', () => {
    for (const preset of PRESET_THEMES) {
      const p = preset.tokens.palette;

      // 1. Texto do botão sobre botão
      const btnContrast = validateWcagContrast(p.buttonText, p.buttonBg);
      expect(
        btnContrast.ratio,
        `Contraste botão falhou no tema ${preset.name}: ${btnContrast.ratio}:1`
      ).toBeGreaterThanOrEqual(4.5);

      // 2. Título sobre card
      const titleContrast = validateWcagContrast(p.textTitle, p.bgCard);
      expect(
        titleContrast.ratio,
        `Contraste título sobre card falhou no tema ${preset.name}: ${titleContrast.ratio}:1`
      ).toBeGreaterThanOrEqual(4.5);

      // 3. Texto principal sobre card
      const textContrast = validateWcagContrast(p.textMain, p.bgCard);
      expect(
        textContrast.ratio,
        `Contraste texto sobre card falhou no tema ${preset.name}: ${textContrast.ratio}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('todos os temas usam uma fonte pertencente à lista fechada de fontes seguras', () => {
    const safeNames = SAFE_FONT_FAMILIES.map(f => f.name.toLowerCase());
    for (const preset of PRESET_THEMES) {
      const font = preset.tokens.typography.fontFamily.toLowerCase();
      expect(safeNames, `Fonte desconhecida "${font}" no tema ${preset.name}`).toContain(font);
    }
  });
});

describe('Conversão Bi-direcional e Fallbacks de Tokens', () => {
  it('converte tema legado sem tokens para tokens estruturados completos', () => {
    const legacyTheme = {
      primaryColor: '#b91c1c',
      secondaryColor: '#991b1b',
      backgroundColor: '#fafaf9',
      cardColor: '#ffffff',
      buttonColor: '#b91c1c',
      textColor: '#1c1917',
      borderRadius: '0.75rem',
      fontFamily: 'Outfit',
      storeName: 'Pizzaria Nobre',
      tagline: 'Massa artesanal',
    };

    const tokens = themeToTokens(legacyTheme);
    expect(tokens.version).toBe(1);
    expect(tokens.palette.primary).toBe('#b91c1c');
    expect(tokens.palette.bgCard).toBe('#ffffff');
    expect(tokens.typography.fontFamily).toBe('Outfit');
    expect(tokens.components.borderRadius).toBe('0.75rem');
  });

  it('converte tokens de volta para TenantTheme preservando retrocompatibilidade', () => {
    const defaultTokens = createDefaultThemeTokens(DEFAULT_DELIVERY_CHANNEL_THEME);
    const theme = tokensToTheme(defaultTokens, {
      storeName: 'Adega Express',
      tagline: 'Bebidas nobres',
      logoUrl: 'https://example.com/logo.png',
      bannerUrl: 'https://example.com/banner.png',
    });

    expect(theme.storeName).toBe('Adega Express');
    expect(theme.primaryColor).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.primaryColor);
    expect(theme.backgroundColor).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.backgroundColor);
    expect(theme.tokens).toBeDefined();
    expect(theme.tokens?.palette.primary).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.primaryColor);
  });

  it('gera CSS Custom Properties corretas para escopo do cliente', () => {
    const defaultTokens = createDefaultThemeTokens(DEFAULT_DELIVERY_CHANNEL_THEME);
    const vars = generateCssVariables(defaultTokens);

    expect(vars['--dc-primary']).toBe('#15803d');
    expect(vars['--dc-bg-card']).toBe('#ffffff');
    expect(vars['--dc-button-bg']).toBe('#15803d');
    expect(vars['--dc-font-family']).toContain('Inter');
  });
});

describe('Isolamento de Tenant & Cache em themeService', () => {
  beforeEach(() => {
    themeService.clearCache();
    vi.spyOn(tenantRepository, 'updateTheme').mockResolvedValue(undefined);
  });

  it('isola o tema por tenantId sem contaminação entre lojas', () => {
    const themeA = {
      ...DEFAULT_DELIVERY_CHANNEL_THEME,
      primaryColor: '#15803d',
      storeName: 'Loja A',
    };
    const themeB = {
      ...DEFAULT_DELIVERY_CHANNEL_THEME,
      primaryColor: '#b91c1c',
      storeName: 'Loja B',
    };

    themeService.setCache('tenant-a', themeA);
    themeService.setCache('tenant-b', themeB);

    expect(themeService.getTheme(mockContext, 'tenant-a')?.primaryColor).toBe('#15803d');
    expect(themeService.getTheme(mockContext, 'tenant-b')?.primaryColor).toBe('#b91c1c');

    // Limpa apenas tenant-a
    themeService.clearCache('tenant-a');
    expect(themeService.getTheme(mockContext, 'tenant-a')).toBeUndefined();
    expect(themeService.getTheme(mockContext, 'tenant-b')?.primaryColor).toBe('#b91c1c');
  });

  it('restaura o padrão oficial do Delivery Channel sem resíduos', async () => {
    const restored = await themeService.resetToDeliveryChannelDefault(mockContext, 'tenant-111', {
      storeName: 'Minha Loja',
      tagline: 'Bebidas e Conveniência',
      logoUrl: 'https://example.com/logo.png',
      bannerUrl: 'https://example.com/banner.png',
    });

    expect(restored.primaryColor).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.primaryColor);
    expect(restored.secondaryColor).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.secondaryColor);
    expect(restored.backgroundColor).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.backgroundColor);
    expect(restored.storeName).toBe('Minha Loja');
    expect(restored.tokens?.palette.primary).toBe(DEFAULT_DELIVERY_CHANNEL_THEME.primaryColor);
  });
});

describe('Mapeamento em publicStoreMapper com tokens', () => {
  it('mapeia tema da vitrine pública preservando retrocompatibilidade e theme_tokens', () => {
    const rawTheme = {
      store_name: 'Adega Teste',
      primary_color: '#0369a1',
      secondary_color: '#075985',
      background_color: '#f0f9ff',
      card_color: '#ffffff',
      button_color: '#0369a1',
      text_color: '#082f49',
      border_radius: '0.75rem',
      font_family: 'Plus Jakarta Sans',
      theme_tokens: {
        version: 1,
        palette: { primary: '#0369a1' },
      },
    };

    const mapped = mapTheme(rawTheme, 'Adega Teste');
    expect(mapped.storeName).toBe('Adega Teste');
    expect(mapped.primaryColor).toBe('#0369a1');
    expect(mapped.fontFamily).toBe('Plus Jakarta Sans');
    expect(mapped.tokens).toBeDefined();
    expect((mapped.tokens as any).palette.primary).toBe('#0369a1');
  });
});
