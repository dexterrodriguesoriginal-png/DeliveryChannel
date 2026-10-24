/**
 * Motor Central de Design do App (DeliveryChannel)
 * Matemática de contraste WCAG AA, serialização de tokens, CSS Custom Properties e conversão bi-direcional.
 *
 * ============================================================================
 * TABELA DE MAPEAMENTO: TOKENS DA PALETA -> ELEMENTOS DO APP
 * ============================================================================
 * Token             | Variável CSS                  | Elementos Afetados no App do Cliente
 * ------------------|-------------------------------|----------------------------------------------------
 * bgGeneral         | --dc-bg-general, -color       | Fundo geral da página (body / container principal)
 * bgHeader          | --dc-bg-header, -color        | Cabeçalho superior (Store Header)
 * bgCard            | --dc-bg-card, -color          | Fundo dos cartões de produtos (NÃO afeta busca/botões)
 * bgMenu            | --dc-bg-menu                  | Fundo da barra de navegação inferior
 * categoryBg        | --dc-category-bg              | Fundo dos botões / pílulas de categorias
 * iconColor         | --dc-icon-color               | Ícones do cabeçalho, pesquisa e navegação
 * textTitle         | --dc-text-title               | Nome da loja, títulos dos produtos e modais
 * textMain          | --dc-text-main                | Descrições dos produtos e textos corridos (Texto Principal)
 * textSecondary     | --dc-text-secondary           | Metadados, tempo de preparo, unidades e legendas
 * buttonBg          | --dc-button-bg                | Fundo dos botões de ação principal (Adicionar, Sacola)
 * buttonText        | --dc-button-text              | Texto dos botões de ação principal
 * price             | --dc-price                    | Preço normal dos produtos (R$)
 * promoPrice        | --dc-promo-price              | Preço promocional em destaque
 * border            | --dc-border                   | Bordas dos cartões, cabeçalho e divisórias
 * primary           | --dc-primary                  | Cor institucional principal da marca
 * secondary         | --dc-secondary                | Cor secundária complementar
 * accent            | --dc-accent                   | Badges de destaque (Mais Vendido, Promoção)
 * borderRadiusPx    | --dc-card-radius (0-28px)     | Raio dos cantos dos cartões de produtos
 * shadowLevel       | --dc-card-shadow (0-5 níveis) | Sombra dos cartões de produtos
 * ============================================================================
 */

import type React from 'react';
import {
  BackgroundStyleConfig,
  ComponentStyles,
  ContrastResult,
  ThemePalette,
  ThemeTokens,
  TypographyConfig,
} from '../../types/theme';
import { TenantTheme } from '../../types';

// ============================================================================
// FONTES CONFIÁVEIS (Lista fechada e homologada)
// ============================================================================
export interface SafeFont {
  id: string;
  name: string;
  category: 'Sans-Serif' | 'Serif' | 'Sistema';
  cssFamily: string;
  description: string;
}

export const SAFE_FONT_FAMILIES: SafeFont[] = [
  {
    id: 'Inter',
    name: 'Inter',
    category: 'Sans-Serif',
    cssFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    description: 'Moderna, limpa e altamente legível em telas mobile',
  },
  {
    id: 'Plus Jakarta Sans',
    name: 'Plus Jakarta Sans',
    category: 'Sans-Serif',
    cssFamily: "'Plus Jakarta Sans', sans-serif",
    description: 'Estilo premium e sofisticado para estabelecimentos selecionados',
  },
  {
    id: 'Outfit',
    name: 'Outfit',
    category: 'Sans-Serif',
    cssFamily: "'Outfit', sans-serif",
    description: 'Geométrica, arrojada e moderna para fast food e lanchonetes',
  },
  {
    id: 'Poppins',
    name: 'Poppins',
    category: 'Sans-Serif',
    cssFamily: "'Poppins', sans-serif",
    description: 'Amigável, arredondada e vibrante para açaí, docerias e cafés',
  },
  {
    id: 'Montserrat',
    name: 'Montserrat',
    category: 'Sans-Serif',
    cssFamily: "'Montserrat', sans-serif",
    description: 'Sólida, urbana e comercial para mercados e empórios',
  },
  {
    id: 'Roboto',
    name: 'Roboto',
    category: 'Sans-Serif',
    cssFamily: "'Roboto', sans-serif",
    description: 'Funcional, neutra e equilibrada para clínicas e farmácias',
  },
  {
    id: 'Playfair Display',
    name: 'Playfair Display',
    category: 'Serif',
    cssFamily: "'Playfair Display', Georgia, serif",
    description: 'Elegante e tradicional para adegas, vinhos e gastronomia fina',
  },
  {
    id: 'system-ui',
    name: 'Sistema Nativo (iOS / Android)',
    category: 'Sistema',
    cssFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    description: 'Carregamento instantâneo com tipografia nativa do dispositivo',
  },
];

// ============================================================================
// VALIDAÇÃO E CORES HEX
// ============================================================================
const HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function validateHexColor(hex: string): boolean {
  if (!hex || typeof hex !== 'string') return false;
  return HEX_REGEX.test(hex.trim());
}

export function normalizeHexColor(hex: string, fallback = '#15803d'): string {
  if (!validateHexColor(hex)) return fallback;
  const clean = hex.trim().toLowerCase();
  if (clean.length === 4) {
    // #abc -> #aabbcc
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  return clean.slice(0, 7);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const norm = normalizeHexColor(hex, '');
  if (!norm) return null;
  const num = parseInt(norm.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

// ============================================================================
// MATEMÁTICA DE CONTRASTE WCAG 2.1 (AA)
// ============================================================================

/**
 * Calcula a luminância relativa de uma cor sRGB conforme WCAG 2.1
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function calculateRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Razão de contraste entre duas cores hexadecimais (de 1.0:1 até 21.0:1)
 * Conforme norma WCAG 2.1
 */
export function calculateContrast(fgHex: string, bgHex: string): number {
  const fgRgb = hexToRgb(fgHex) || { r: 15, g: 23, b: 42 }; // fallback escuro
  const bgRgb = hexToRgb(bgHex) || { r: 255, g: 255, b: 255 }; // fallback claro

  const l1 = calculateRelativeLuminance(fgRgb);
  const l2 = calculateRelativeLuminance(bgRgb);

  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  const ratio = (brighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

/**
 * Função oficial de razão de contraste (alias para calculateContrast)
 * Texto normal >= 4.5:1 (AA), texto grande ou botões >= 3.0:1
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  return calculateContrast(fgHex, bgHex);
}

/**
 * Valida a conformidade WCAG AA (mínimo 4.5:1 para texto normal, 3.0:1 para texto grande)
 */
export function validateWcagContrast(fgHex: string, bgHex: string): ContrastResult {
  const ratio = contrastRatio(fgHex, bgHex);
  const passNormal = ratio >= 4.5;
  const passLarge = ratio >= 3.0;

  let level: 'AAA' | 'AA' | 'FAIL' = 'FAIL';
  if (ratio >= 7.0) level = 'AAA';
  else if (passNormal) level = 'AA';

  return {
    ratio,
    passNormal,
    passLarge,
    level,
  };
}

// ============================================================================
// FORMATAÇÃO DE FUNDOS (CSS) & SUPERFÍCIES ISOLADAS
// ============================================================================

export function resolveGradientColors(bg: BackgroundStyleConfig): string[] {
  const raw = bg.gradientColors && bg.gradientColors.length >= 2
    ? bg.gradientColors
    : [bg.color || '#15803d', '#166534'];

  const count = bg.gradientStops ?? raw.length;
  if (raw.length <= count) {
    return raw;
  }
  return raw.slice(0, count);
}

export function formatCssBackground(bg: BackgroundStyleConfig): string {
  if (!bg) return '#f8fafc';

  switch (bg.type) {
    case 'solid':
      return bg.color || '#f8fafc';

    case 'gradient-linear': {
      const colors = resolveGradientColors(bg);
      const angle = bg.angle !== undefined ? bg.angle : 135;
      return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
    }

    case 'gradient-radial': {
      const colors = resolveGradientColors(bg);
      return `radial-gradient(circle at center, ${colors.join(', ')})`;
    }

    case 'image': {
      const safeUrl = safeImageUrl(bg.imageUrl);
      if (!safeUrl) return bg.color || '#f8fafc';
      const overlayColor = bg.overlayColor || '#000000';
      const opacity = ((bg.overlayOpacity ?? 40) / 100).toFixed(2);
      const rgb = hexToRgb(overlayColor) || { r: 0, g: 0, b: 0 };
      const overlayRgba = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
      return `linear-gradient(${overlayRgba}, ${overlayRgba}), url("${safeUrl}")`;
    }

    default:
      return bg.color || '#f8fafc';
  }
}

export function getSurfaceBackgroundStyle(
  bg: BackgroundStyleConfig | undefined,
  fallbackSolidColor = '#ffffff'
): React.CSSProperties {
  if (!bg || bg.type === 'solid') {
    const c = bg?.color || fallbackSolidColor;
    return {
      backgroundColor: c,
      backgroundImage: 'none',
    };
  }

  if (bg.type === 'gradient-linear' || bg.type === 'gradient-radial') {
    const gradientCss = formatCssBackground(bg);
    return {
      backgroundColor: bg.color || fallbackSolidColor,
      backgroundImage: gradientCss,
    };
  }

  if (bg.type === 'image') {
    const safeUrl = safeImageUrl(bg.imageUrl);
    if (!safeUrl) {
      const c = bg.color || fallbackSolidColor;
      return {
        backgroundColor: c,
        backgroundImage: 'none',
      };
    }
    const posX = bg.positionX ?? 50;
    const posY =
      bg.positionY ??
      (bg.position === 'top' ? 0 : bg.position === 'bottom' ? 100 : 50);
    const zoom = bg.zoom ?? 100;
    const bgSize = zoom !== 100 ? `${zoom}%` : (bg.size || 'cover');

    return {
      backgroundColor: bg.color || fallbackSolidColor,
      backgroundImage: formatCssBackground(bg),
      backgroundPosition: `${posX}% ${posY}%`,
      backgroundSize: bgSize,
      backgroundRepeat: 'no-repeat',
    };
  }

  return {
    backgroundColor: bg.color || fallbackSolidColor,
  };
}

// ============================================================================
// CÁLCULOS DE TIPOGRAFIA E SOMBRAS DE COMPONENTES
// ============================================================================

export function resolveFontFamilyCss(fontFamily?: string): string {
  const target = (fontFamily || 'Inter').trim().toLowerCase();
  const fontObj = SAFE_FONT_FAMILIES.find(
    f => f.name.toLowerCase() === target || f.id.toLowerCase() === target
  );
  return fontObj ? fontObj.cssFamily : (fontFamily || "'Inter', sans-serif");
}

export interface ComputedTypographyStyles {
  cssFont: string;
  titleWeight: number;
  bodyWeight: number;
  scaleFactor: number;
  scalePercent: number;
  titleTextTransform: 'uppercase' | 'none';
  titleFontStyle: 'italic' | 'normal';
  letterSpacing: string;
  lineHeight: string;
}

export function computeTypographyStyles(t?: TypographyConfig): ComputedTypographyStyles {
  const cssFont = resolveFontFamilyCss(t?.fontFamily);

  const titleWeightMap: Record<string, number> = {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  };
  const bodyWeightMap: Record<string, number> = {
    normal: 400,
    medium: 500,
    semibold: 600,
  };

  const titleWeight = titleWeightMap[t?.titleWeight || 'bold'] ?? 700;
  const bodyWeight = bodyWeightMap[t?.bodyWeight || 'normal'] ?? 400;

  let scalePercent = t?.scalePercent;
  if (scalePercent === undefined) {
    if (t?.scale === 'compact') scalePercent = 90;
    else if (t?.scale === 'spacious') scalePercent = 112;
    else scalePercent = 100;
  }
  scalePercent = Math.max(85, Math.min(125, scalePercent));
  const scaleFactor = Number((scalePercent / 100).toFixed(2));

  const titleTextTransform = t?.titleUppercase ? 'uppercase' : 'none';
  const titleFontStyle = t?.titleItalic ? 'italic' : 'normal';

  const letterSpacingMap: Record<string, string> = {
    tight: '-0.025em',
    normal: '0em',
    wide: '0.05em',
  };
  const lineHeightMap: Record<string, string> = {
    tight: '1.2',
    normal: '1.45',
    relaxed: '1.65',
  };

  return {
    cssFont,
    titleWeight,
    bodyWeight,
    scaleFactor,
    scalePercent,
    titleTextTransform,
    titleFontStyle,
    letterSpacing: letterSpacingMap[t?.letterSpacing || 'normal'] || '0em',
    lineHeight: lineHeightMap[t?.lineHeight || 'normal'] || '1.45',
  };
}

export function resolveCardBorderRadius(c?: Partial<ComponentStyles>): string {
  if (c?.borderRadiusPx !== undefined) {
    return `${Math.max(0, Math.min(28, c.borderRadiusPx))}px`;
  }
  return c?.cardRadius || c?.borderRadius || '1rem';
}

export function resolveCardBorderWidth(c?: Partial<ComponentStyles>): number {
  if (c?.borderWidthPx !== undefined) {
    return Math.max(0, Math.min(4, c.borderWidthPx));
  }
  return c?.cardBorder === false ? 0 : 1;
}

export function computeCardBoxShadow(c?: Partial<ComponentStyles>): string {
  if (!c) return '0px 4px 12px 0px rgba(0, 0, 0, 0.08)';

  // Suporte a 0–5 níveis discretos de sombra
  if (c.shadowLevel !== undefined) {
    const level = Math.max(0, Math.min(5, Math.round(c.shadowLevel)));
    const shadowHex = c.shadowColor || '#000000';
    const rgb = hexToRgb(shadowHex) || { r: 0, g: 0, b: 0 };
    switch (level) {
      case 0:
        return 'none';
      case 1:
        return `0 1px 3px 0 rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08), 0 1px 2px -1px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`;
      case 2:
        return `0 4px 6px -1px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.10), 0 2px 4px -2px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`;
      case 3:
        return `0 10px 15px -3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12), 0 4px 6px -4px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`;
      case 4:
        return `0 20px 25px -5px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15), 0 8px 10px -6px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`;
      case 5:
        return `0 25px 50px -12px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
    }
  }

  let intensity = c.shadowIntensity;
  if (intensity === undefined) {
    if (c.cardShadow === 'none') intensity = 0;
    else if (c.cardShadow === 'sm') intensity = 8;
    else if (c.cardShadow === 'md') intensity = 16;
    else if (c.cardShadow === 'lg') intensity = 26;
    else intensity = 8;
  }

  if (intensity <= 0) {
    return 'none';
  }

  const blur =
    c.shadowBlur !== undefined
      ? Math.max(0, Math.min(40, c.shadowBlur))
      : c.cardShadow === 'lg'
      ? 24
      : c.cardShadow === 'md'
      ? 16
      : 12;

  const spread =
    c.shadowSpread !== undefined
      ? Math.max(-10, Math.min(20, c.shadowSpread))
      : 0;

  const shadowHex = c.shadowColor || '#000000';
  const rgb = hexToRgb(shadowHex) || { r: 0, g: 0, b: 0 };
  const alpha = Number((Math.max(0, Math.min(100, intensity)) / 100).toFixed(2));
  const offsetY = Math.max(1, Math.round(blur / 3));

  return `0px ${offsetY}px ${blur}px ${spread}px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

// ============================================================================
// TEMA OFICIAL DELIVERY CHANNEL (Padrão Único de Código)
// ============================================================================

export const DEFAULT_DELIVERY_CHANNEL_THEME: TenantTheme = {
  primaryColor: '#15803d',    // Esmeralda Oficial
  secondaryColor: '#166534',  // Esmeralda Profundo
  backgroundColor: '#f8fafc', // Slate 50
  cardColor: '#ffffff',       // Branco puro
  buttonColor: '#15803d',     // Esmeralda Botão
  textColor: '#0f172a',       // Slate 900
  borderRadius: '1rem',       // 16px
  fontFamily: 'Inter',
  storeName: '',
  tagline: 'Seu canal de compras direto e exclusivo.',
  logoUrl: '',
  bannerUrl: '',
};

export const DEFAULT_PALETTE: ThemePalette = {
  primary: '#15803d',
  secondary: '#166534',
  accent: '#22c55e',
  bgGeneral: '#f8fafc',
  bgHeader: '#ffffff',
  bgCard: '#ffffff',
  bgMenu: '#ffffff',
  categoryBg: '#f1f5f9',
  iconColor: '#64748b',
  textTitle: '#0f172a',
  textMain: '#334155',
  textSecondary: '#64748b',
  buttonBg: '#15803d',
  buttonText: '#ffffff',
  price: '#15803d',
  promoPrice: '#b91c1c',
  border: '#e2e8f0',
};

// ============================================================================
// CONVERSORES BI-DIRECIONAIS: THEME <-> TOKENS
// ============================================================================

export function createDefaultThemeTokens(base?: Partial<TenantTheme>): ThemeTokens {
  const primary = base?.primaryColor || DEFAULT_DELIVERY_CHANNEL_THEME.primaryColor;
  const secondary = base?.secondaryColor || DEFAULT_DELIVERY_CHANNEL_THEME.secondaryColor;
  const bgGeneral = base?.backgroundColor || DEFAULT_DELIVERY_CHANNEL_THEME.backgroundColor;
  const bgCard = base?.cardColor || DEFAULT_DELIVERY_CHANNEL_THEME.cardColor;
  const buttonBg = base?.buttonColor || primary;
  const textTitle = base?.textColor || DEFAULT_DELIVERY_CHANNEL_THEME.textColor;
  const borderRadius = base?.borderRadius || DEFAULT_DELIVERY_CHANNEL_THEME.borderRadius;
  const fontFamily = base?.fontFamily || DEFAULT_DELIVERY_CHANNEL_THEME.fontFamily || 'Inter';

  return {
    version: 1,
    palette: {
      primary,
      secondary,
      accent: '#22c55e',
      bgGeneral,
      bgHeader: '#ffffff',
      bgCard,
      bgMenu: '#ffffff',
      categoryBg: '#f1f5f9',
      iconColor: '#64748b',
      textTitle,
      textMain: '#334155',
      textSecondary: '#64748b',
      buttonBg,
      buttonText: '#ffffff',
      price: primary,
      promoPrice: '#b91c1c',
      border: '#e2e8f0',
    },
    backgrounds: {
      general: { type: 'solid', color: bgGeneral, gradientStops: 2, positionX: 50, positionY: 50, zoom: 100 },
      header: { type: 'solid', color: '#ffffff', gradientStops: 2, positionX: 50, positionY: 50, zoom: 100 },
      card: { type: 'solid', color: bgCard, gradientStops: 2, positionX: 50, positionY: 50, zoom: 100 },
    },
    typography: {
      fontFamily,
      titleWeight: 'bold',
      bodyWeight: 'normal',
      scale: 'standard',
      scalePercent: 100,
      titleUppercase: false,
      titleItalic: false,
      letterSpacing: 'normal',
      lineHeight: 'normal',
    },
    components: {
      borderRadius,
      cardRadius: borderRadius,
      buttonRadius: borderRadius,
      borderRadiusPx: 16,
      borderWidthPx: 1,
      cardShadow: 'sm',
      buttonShadow: 'sm',
      shadowIntensity: 8,
      shadowBlur: 12,
      shadowSpread: 0,
      shadowColor: '#000000',
      cardBorder: true,
      headerStyle: 'solid',
      categoryStyle: 'solid',
    },
  };
}

/** Only https (or same-origin relative) image URLs; strips characters that could escape CSS url(). */
export function safeImageUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!/^https:\/\/[^\s"'()\\<>]+$/i.test(v) && !/^\/[^\s"'()\\<>]*$/.test(v)) return null;
  return v;
}

export function themeToTokens(theme?: Partial<TenantTheme> | null): ThemeTokens {
  if (theme?.tokens && theme.tokens.version === 1 && theme.tokens.palette) {
    const mergedPalette: ThemePalette = {
      ...DEFAULT_PALETTE,
      ...theme.tokens.palette,
    };

    const rawBgs = theme.tokens.backgrounds;
    const generalRaw = rawBgs?.general;
    const headerRaw = rawBgs?.header;
    const cardRaw = rawBgs?.card;

    const generalBg: BackgroundStyleConfig = {
      ...generalRaw,
      type: generalRaw?.type || 'solid',
      gradientStops: generalRaw?.gradientStops ?? 2,
      positionX: generalRaw?.positionX ?? 50,
      positionY: generalRaw?.positionY ?? 50,
      zoom: generalRaw?.zoom ?? 100,
      color: mergedPalette.bgGeneral || generalRaw?.color || DEFAULT_PALETTE.bgGeneral,
    };
    const headerBg: BackgroundStyleConfig = {
      ...headerRaw,
      type: headerRaw?.type || 'solid',
      gradientStops: headerRaw?.gradientStops ?? 2,
      positionX: headerRaw?.positionX ?? 50,
      positionY: headerRaw?.positionY ?? 50,
      zoom: headerRaw?.zoom ?? 100,
      color: mergedPalette.bgHeader || headerRaw?.color || DEFAULT_PALETTE.bgHeader,
    };
    const cardBg: BackgroundStyleConfig = {
      ...cardRaw,
      type: cardRaw?.type || 'solid',
      gradientStops: cardRaw?.gradientStops ?? 2,
      positionX: cardRaw?.positionX ?? 50,
      positionY: cardRaw?.positionY ?? 50,
      zoom: cardRaw?.zoom ?? 100,
      color: mergedPalette.bgCard || cardRaw?.color || DEFAULT_PALETTE.bgCard,
    };

    const rawTypo = theme.tokens.typography;
    const rawComp = theme.tokens.components;

    return {
      ...theme.tokens,
      palette: mergedPalette,
      backgrounds: {
        general: generalBg,
        header: headerBg,
        card: cardBg,
      },
      typography: {
        ...rawTypo,
        fontFamily: rawTypo?.fontFamily || 'Inter',
        titleWeight: rawTypo?.titleWeight || 'bold',
        bodyWeight: rawTypo?.bodyWeight || 'normal',
        scale: rawTypo?.scale || 'standard',
        scalePercent: rawTypo?.scalePercent ?? 100,
        titleUppercase: rawTypo?.titleUppercase ?? false,
        titleItalic: rawTypo?.titleItalic ?? false,
        letterSpacing: rawTypo?.letterSpacing || 'normal',
        lineHeight: rawTypo?.lineHeight || 'normal',
      },
      components: {
        ...rawComp,
        borderRadius: rawComp?.borderRadius || '1rem',
        cardRadius: rawComp?.cardRadius || rawComp?.borderRadius || '1rem',
        buttonRadius: rawComp?.buttonRadius || rawComp?.borderRadius || '1rem',
        cardShadow: rawComp?.cardShadow || 'sm',
        buttonShadow: rawComp?.buttonShadow || 'sm',
        cardBorder: rawComp?.cardBorder ?? true,
        headerStyle: rawComp?.headerStyle || 'solid',
        categoryStyle: rawComp?.categoryStyle || 'solid',
      },
    };
  }
  return createDefaultThemeTokens(theme || undefined);
}

export function tokensToTheme(
  tokens: ThemeTokens,
  identity: {
    storeName: string;
    tagline?: string;
    logoUrl?: string;
    bannerUrl?: string;
  }
): TenantTheme {
  const p = tokens.palette;
  return {
    storeName: identity.storeName,
    tagline: identity.tagline || '',
    logoUrl: identity.logoUrl || '',
    bannerUrl: identity.bannerUrl || '',
    primaryColor: p.primary,
    secondaryColor: p.secondary,
    backgroundColor: p.bgGeneral,
    cardColor: p.bgCard,
    buttonColor: p.buttonBg,
    textColor: p.textTitle,
    borderRadius: resolveCardBorderRadius(tokens.components),
    fontFamily: tokens.typography.fontFamily || 'Inter',
    tokens,
  };
}

// ============================================================================
// GERAÇÃO DE CSS CUSTOM PROPERTIES
// ============================================================================

export function generateCssVariables(tokens: ThemeTokens): Record<string, string> {
  const p = tokens.palette;
  const c = tokens.components;
  const typo = computeTypographyStyles(tokens.typography);

  const bgGeneralConfig = tokens.backgrounds.general;
  const bgHeaderConfig = tokens.backgrounds.header;
  const bgCardConfig = tokens.backgrounds.card;

  const bgGeneralCss =
    bgGeneralConfig.type === 'solid'
      ? (p.bgGeneral || bgGeneralConfig.color || '#f8fafc')
      : formatCssBackground(bgGeneralConfig);
  const bgHeaderCss =
    bgHeaderConfig.type === 'solid'
      ? (p.bgHeader || bgHeaderConfig.color || '#ffffff')
      : formatCssBackground(bgHeaderConfig);
  const bgCardCss =
    bgCardConfig.type === 'solid'
      ? (p.bgCard || bgCardConfig.color || '#ffffff')
      : formatCssBackground(bgCardConfig);

  const cardRadius = resolveCardBorderRadius(c);
  const cardBorderWidth = resolveCardBorderWidth(c);
  const cardBoxShadow = computeCardBoxShadow(c);

  return {
    '--dc-primary': p.primary,
    '--dc-secondary': p.secondary,
    '--dc-accent': p.accent,
    '--dc-bg-general': bgGeneralCss,
    '--dc-bg-general-color': p.bgGeneral,
    '--dc-bg-header': bgHeaderCss,
    '--dc-bg-header-color': p.bgHeader,
    '--dc-bg-card': bgCardCss,
    '--dc-bg-card-color': p.bgCard,
    '--dc-bg-menu': p.bgMenu,
    '--dc-category-bg': p.categoryBg,
    '--dc-icon-color': p.iconColor,
    '--dc-text-title': p.textTitle,
    '--dc-text-main': p.textMain,
    '--dc-text-secondary': p.textSecondary,
    '--dc-button-bg': p.buttonBg,
    '--dc-button-text': p.buttonText,
    '--dc-price': p.price,
    '--dc-promo-price': p.promoPrice,
    '--dc-border': p.border,
    '--dc-radius': c.borderRadius,
    '--dc-card-radius': cardRadius,
    '--dc-button-radius': c.buttonRadius || cardRadius,
    '--dc-card-border-width': `${cardBorderWidth}px`,
    '--dc-card-shadow': cardBoxShadow,
    '--dc-font-family': typo.cssFont,
    '--dc-title-weight': String(typo.titleWeight),
    '--dc-body-weight': String(typo.bodyWeight),
    '--dc-font-scale': String(typo.scaleFactor),
    '--dc-title-transform': typo.titleTextTransform,
    '--dc-title-style': typo.titleFontStyle,
    '--dc-letter-spacing': typo.letterSpacing,
    '--dc-line-height': typo.lineHeight,
  };
}
