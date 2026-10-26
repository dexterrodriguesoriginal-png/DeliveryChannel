/**
 * Catálogo e Motor de Paletas Homologadas DeliveryChannel
 * Suporta 25 segmentos comerciais com derivação de paletas claras e escuras
 * 100% em conformidade com WCAG AA e integridade semântica de cores.
 */

import { ThemePalette } from '../../../types/theme';

export type ColorFamily =
  | 'azul'
  | 'verde'
  | 'amarelo'
  | 'vermelho'
  | 'roxo'
  | 'rosa'
  | 'laranja'
  | 'marrom'
  | 'neutros';

export interface PaletteBase {
  primary: string;
  secondary: string;
  accent: string;
  bg?: string;
  surface?: string;
  text?: string;
}

export interface NamedPalette {
  id: string;
  name: string;
  segmentId: string;
  colorFamily: ColorFamily;
  shade: string;
  style: string[];
  mode: 'light' | 'dark';
  base: PaletteBase;
}

// ============================================================================
// MATEMÁTICA DE COR, LUMINÂNCIA E CONTRASTE WCAG
// ============================================================================

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean.slice(0, 6), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (h >= 0 && h < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (h >= 60 && h < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (h >= 120 && h < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (h >= 180 && h < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (h >= 240 && h < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

export function getLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const sRGB = [r, g, b].map((val) => {
    const c = val / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

export function getContrast(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Ajusta levemente a cor para atingir a taxa mínima de contraste em relação ao fundo
 */
export function ensureContrast(
  color: string,
  background: string,
  minRatio: number,
  preferDirection: 'darker' | 'lighter' = 'darker'
): string {
  if (getContrast(color, background) >= minRatio) {
    return color;
  }

  const bgLum = getLuminance(background);
  const { r, g, b } = hexToRgb(color);
  let { h, s, l } = rgbToHsl(r, g, b);

  // Se o fundo for claro, escurece a cor; se o fundo for escuro, clareia
  const shouldDarken = bgLum > 0.5 || preferDirection === 'darker';

  for (let step = 0; step < 40; step++) {
    l = shouldDarken ? Math.max(0.02, l - 0.025) : Math.min(0.98, l + 0.025);
    const candidate = hslToHex(h, s, l);
    if (getContrast(candidate, background) >= minRatio) {
      return candidate;
    }
  }

  // Fallback seguro se não convergiu
  return bgLum > 0.5 ? '#0f172a' : '#f8fafc';
}

// ============================================================================
// CONSTRUTOR DE PALETAS COMPLETAS (17 CAMPOS) WCAG AA
// ============================================================================

export function buildPalette(base: PaletteBase, mode: 'light' | 'dark'): ThemePalette {
  const isDark = mode === 'dark';

  if (isDark) {
    // Modo Escuro: Fundo geral com luminância < 0.15 garantida
    const bgGeneral = base.bg && getLuminance(base.bg) < 0.15 ? base.bg : '#0f172a';
    const bgHeader = '#111827';
    const bgCard = base.surface && getLuminance(base.surface) < 0.15 ? base.surface : '#1e293b';
    const bgMenu = '#111827';
    const categoryBg = '#334155';
    const border = '#334155';

    // Textos de alto contraste sobre cards escuros
    const textTitle = ensureContrast(base.text || '#f8fafc', bgGeneral, 4.5, 'lighter');
    const textMain = ensureContrast('#e2e8f0', bgCard, 4.5, 'lighter');
    const textSecondary = ensureContrast('#94a3b8', bgCard, 4.5, 'lighter');

    // Botão de ação: escolhe buttonText (#ffffff ou #0f172a) com maior contraste >= 4.5
    let buttonBg = base.primary;
    let buttonText = '#ffffff';
    if (getContrast(buttonText, buttonBg) < 4.5) {
      if (getContrast('#0f172a', buttonBg) >= 4.5) {
        buttonText = '#0f172a';
      } else {
        buttonBg = ensureContrast(buttonBg, '#ffffff', 4.5, 'darker');
        buttonText = '#ffffff';
      }
    }

    // Preços com contraste garantido sobre bgCard
    const price = ensureContrast(base.primary, bgCard, 4.5, 'lighter');
    const promoPrice = ensureContrast('#f87171', bgCard, 4.5, 'lighter');

    // Ícone da barra inferior com contraste >= 3.0 sobre bgMenu
    const iconColor = ensureContrast('#94a3b8', bgMenu, 3.0, 'lighter');

    return {
      primary: base.primary,
      secondary: base.secondary,
      accent: base.accent,
      bgGeneral,
      bgHeader,
      bgCard,
      bgMenu,
      categoryBg,
      iconColor,
      textTitle,
      textMain,
      textSecondary,
      buttonBg,
      buttonText,
      price,
      promoPrice,
      border,
    };
  } else {
    // Modo Claro: Fundo geral com luminância > 0.80 garantida
    const bgGeneral = base.bg && getLuminance(base.bg) > 0.8 ? base.bg : '#f8fafc';
    const bgHeader = '#ffffff';
    const bgCard = base.surface && getLuminance(base.surface) > 0.8 ? base.surface : '#ffffff';
    const bgMenu = '#ffffff';
    const categoryBg = '#f1f5f9';
    const border = '#e2e8f0';

    // Textos de alto contraste sobre fundos claros
    const textTitle = ensureContrast(base.text || '#0f172a', bgGeneral, 4.5, 'darker');
    const textMain = ensureContrast('#334155', bgCard, 4.5, 'darker');
    const textSecondary = ensureContrast('#64748b', bgCard, 4.5, 'darker');

    // Botão de ação
    let buttonBg = base.primary;
    let buttonText = '#ffffff';
    if (getContrast(buttonText, buttonBg) < 4.5) {
      if (getContrast('#0f172a', buttonBg) >= 4.5) {
        buttonText = '#0f172a';
      } else {
        buttonBg = ensureContrast(buttonBg, '#ffffff', 4.5, 'darker');
        buttonText = '#ffffff';
      }
    }

    // Preço sobre bgCard
    const price = ensureContrast(base.primary, bgCard, 4.5, 'darker');
    const promoPrice = ensureContrast('#b91c1c', bgCard, 4.5, 'darker');

    // Ícone da barra inferior com contraste >= 3.0 sobre bgMenu
    const iconColor = ensureContrast('#64748b', bgMenu, 3.0, 'darker');

    return {
      primary: base.primary,
      secondary: base.secondary,
      accent: base.accent,
      bgGeneral,
      bgHeader,
      bgCard,
      bgMenu,
      categoryBg,
      iconColor,
      textTitle,
      textMain,
      textSecondary,
      buttonBg,
      buttonText,
      price,
      promoPrice,
      border,
    };
  }
}

// ============================================================================
// 150 PALETAS OFICIAIS CURADAS POR SEGMENTO (25 SEGMENTOS × 6 MODELOS)
// Cada segmento conta com 3 paletas claras e 3 paletas escuras
// ============================================================================

export const SEGMENT_PALETTES: NamedPalette[] = [
  // --- ADEGA (vinhos, espumantes, cervejas especiais) ---
  // 1. Bordô + Creme (#6d1a2a / #f5ecd7) - Vermelho/Bordô (Hue ~348°)
  {
    id: 'adega-bordo-creme',
    name: 'Bordô & Creme Tradicional',
    segmentId: 'adega',
    colorFamily: 'vermelho',
    shade: 'bordô',
    style: ['clássico', 'elegante', 'gastronômico'],
    mode: 'light',
    base: { primary: '#6d1a2a', secondary: '#991b1b', accent: '#b45309', bg: '#faf7f8', surface: '#ffffff', text: '#3f0d16' },
  },
  // 2. Verde-garrafa + Dourado (#1f3d2b / #c9a54a)
  {
    id: 'adega-verde-dourado',
    name: 'Verde Garrafa & Ouro',
    segmentId: 'adega',
    colorFamily: 'verde',
    shade: 'verde-garrafa',
    style: ['sofisticado', 'tradicional', 'nobre'],
    mode: 'light',
    base: { primary: '#1f3d2b', secondary: '#2e5a3f', accent: '#c9a54a', bg: '#f1f8f4', surface: '#ffffff' },
  },
  // 3. Grafite + Cobre (#2b2b2e / #b8733f)
  {
    id: 'adega-grafite-cobre',
    name: 'Grafite & Cobre Reserva',
    segmentId: 'adega',
    colorFamily: 'neutros',
    shade: 'grafite',
    style: ['moderno', 'premium', 'industrial'],
    mode: 'light',
    base: { primary: '#2b2b2e', secondary: '#404044', accent: '#b8733f', bg: '#efeff3', surface: '#ffffff' },
  },
  // 4. Dark Bordô Veludo
  {
    id: 'adega-dark-veludo',
    name: 'Adega Veludo Noturno',
    segmentId: 'adega',
    colorFamily: 'vermelho',
    shade: 'bordô-escuro',
    style: ['escuro', 'noturno', 'luxo'],
    mode: 'dark',
    base: { primary: '#cb1c36', secondary: '#940a31', accent: '#d97706', bg: '#1f080b', surface: '#161821' },
  },
  // 5. Dark Carvalho Barrica
  {
    id: 'adega-dark-carvalho',
    name: 'Adega Carvalho & Malte',
    segmentId: 'adega',
    colorFamily: 'marrom',
    shade: 'carvalho',
    style: ['escuro', 'rústico', 'artesanal'],
    mode: 'dark',
    base: { primary: '#805734', secondary: '#9e6c41', accent: '#f59e0b', bg: '#130c06', surface: '#1c1917' },
  },
  // 6. Dark Safra Real
  {
    id: 'adega-dark-safra-real',
    name: 'Adega Safra Negra',
    segmentId: 'adega',
    colorFamily: 'neutros',
    shade: 'ônix',
    style: ['escuro', 'minimalista', 'premium'],
    mode: 'dark',
    base: { primary: '#60606c', secondary: '#717179', accent: '#eab308', bg: '#0b0b0e', surface: '#18181b' },
  },

  // --- PADARIA (pães, doces de balcão, café da manhã) ---
  {
    id: 'padaria-trigo-creme',
    name: 'Trigo Dourado & Creme',
    segmentId: 'padaria',
    colorFamily: 'amarelo',
    shade: 'trigo',
    style: ['acolhedor', 'artesanal', 'tradicional'],
    mode: 'light',
    base: { primary: '#b88708', secondary: '#ca8a04', accent: '#f59e0b', bg: '#faf9f7', surface: '#ffffff' },
  },
  {
    id: 'padaria-caramelo-cafe',
    name: 'Caramelo & Grão de Café',
    segmentId: 'padaria',
    colorFamily: 'marrom',
    shade: 'caramelo',
    style: ['aconchegante', 'artesanal'],
    mode: 'light',
    base: { primary: '#6b482b', secondary: '#5c3e25', accent: '#ca8a04', bg: '#f8f4f1', surface: '#ffffff' },
  },
  {
    id: 'padaria-azul-bege',
    name: 'Azul Provençal & Bege Pão',
    segmentId: 'padaria',
    colorFamily: 'azul',
    shade: 'azul-pastel',
    style: ['francês', 'delicado', 'retrô'],
    mode: 'light',
    base: { primary: '#0369a1', secondary: '#0284c7', accent: '#d97706', bg: '#e9f3f9', surface: '#ffffff' },
  },
  {
    id: 'padaria-dark-forno',
    name: 'Forno a Lenha Noturno',
    segmentId: 'padaria',
    colorFamily: 'laranja',
    shade: 'âmbar-escuro',
    style: ['escuro', 'rústico', 'aconchegante'],
    mode: 'dark',
    base: { primary: '#c2410c', secondary: '#9a3412', accent: '#fbbf24', bg: '#1f0e08', surface: '#1c1917' },
  },
  {
    id: 'padaria-dark-confeitaria',
    name: 'Confeitaria Bistrô Dark',
    segmentId: 'padaria',
    colorFamily: 'marrom',
    shade: 'cacau',
    style: ['escuro', 'sofisticado', 'doce'],
    mode: 'dark',
    base: { primary: '#936c3b', secondary: '#b08248', accent: '#fde047', bg: '#342109', surface: '#1e1b18' },
  },
  {
    id: 'padaria-dark-espresso',
    name: 'Padaria Espresso Bar',
    segmentId: 'padaria',
    colorFamily: 'neutros',
    shade: 'café-torrado',
    style: ['escuro', 'urbano', 'moderno'],
    mode: 'dark',
    base: { primary: '#64646c', secondary: '#7c7c89', accent: '#ea580c', bg: '#161610', surface: '#18181b' },
  },

  // --- HAMBURGUERIA ---
  {
    id: 'hamburgueria-carvao-mostarda',
    name: 'Carvão Brasa & Mostarda',
    segmentId: 'hamburgueria',
    colorFamily: 'amarelo',
    shade: 'mostarda',
    style: ['urbano', 'artesanal', 'street'],
    mode: 'light',
    base: { primary: '#b18a04', secondary: '#896006', accent: '#dc2626', bg: '#f6f9e9', surface: '#ffffff' },
  },
  {
    id: 'hamburgueria-vermelho-creme',
    name: 'Vermelho Burger & Creme',
    segmentId: 'hamburgueria',
    colorFamily: 'vermelho',
    shade: 'vermelho-tomate',
    style: ['vibrante', 'diner', 'apetite'],
    mode: 'light',
    base: { primary: '#dc2626', secondary: '#b91c1c', accent: '#f59e0b', bg: '#f8f1f1', surface: '#ffffff' },
  },
  {
    id: 'hamburgueria-laranja-grafite',
    name: 'Laranja Cheddar & Grafite',
    segmentId: 'hamburgueria',
    colorFamily: 'laranja',
    shade: 'laranja-vibrante',
    style: ['moderno', 'jovem', 'dinâmico'],
    mode: 'light',
    base: { primary: '#ea580c', secondary: '#c2410c', accent: '#facc15', bg: '#f9efe9', surface: '#ffffff' },
  },
  {
    id: 'hamburgueria-dark-smash',
    name: 'Smash Burger House Dark',
    segmentId: 'hamburgueria',
    colorFamily: 'amarelo',
    shade: 'dourado-queijo',
    style: ['escuro', 'industrial', 'street'],
    mode: 'dark',
    base: { primary: '#eab308', secondary: '#ca8a04', accent: '#ef4444', bg: '#1f1908', surface: '#18181b' },
  },
  {
    id: 'hamburgueria-dark-bbq',
    name: 'Smokehouse BBQ Noturna',
    segmentId: 'hamburgueria',
    colorFamily: 'vermelho',
    shade: 'brasa-viva',
    style: ['escuro', 'fumê', 'potente'],
    mode: 'dark',
    base: { primary: '#f37373', secondary: '#df2929', accent: '#f97316', bg: '#201818', surface: '#1c1917' },
  },
  {
    id: 'hamburgueria-dark-chapa',
    name: 'Chapa Quente Street Dark',
    segmentId: 'hamburgueria',
    colorFamily: 'laranja',
    shade: 'laranja-fogo',
    style: ['escuro', 'street food', 'alta conversão'],
    mode: 'dark',
    base: { primary: '#fa9148', secondary: '#f05211', accent: '#eab308', bg: '#130c06', surface: '#161e2e' },
  },

  // --- PIZZARIA ---
  {
    id: 'pizzaria-tomate-manjericao',
    name: 'Tomate San Marzano & Manjericão',
    segmentId: 'pizzaria',
    colorFamily: 'vermelho',
    shade: 'vermelho-tomate',
    style: ['italiana', 'artesanal', 'tradicional'],
    mode: 'light',
    base: { primary: '#b91c1c', secondary: '#991b1b', accent: '#15803d', bg: '#fcebf2', surface: '#ffffff' },
  },
  {
    id: 'pizzaria-terracota-creme',
    name: 'Terracota Forno & Creme',
    segmentId: 'pizzaria',
    colorFamily: 'laranja',
    shade: 'terracota',
    style: ['rústico', 'acolhedor', 'napoletano'],
    mode: 'light',
    base: { primary: '#f05211', secondary: '#c84317', accent: '#b45309', bg: '#f7f8f1', surface: '#ffffff' },
  },
  {
    id: 'pizzaria-vinho-marfim',
    name: 'Vinho Chianti & Marfim',
    segmentId: 'pizzaria',
    colorFamily: 'vermelho',
    shade: 'vinho',
    style: ['clássico', 'sofisticado', 'cantina'],
    mode: 'light',
    base: { primary: '#72101e', secondary: '#340311', accent: '#ca8a04', bg: '#f9e9eb', surface: '#ffffff' },
  },
  {
    id: 'pizzaria-dark-lenha',
    name: 'Lenha & Brasa Noturna',
    segmentId: 'pizzaria',
    colorFamily: 'vermelho',
    shade: 'rubi-escuro',
    style: ['escuro', 'gourmet', 'quente'],
    mode: 'dark',
    base: { primary: '#e35252', secondary: '#c42323', accent: '#fbbf24', bg: '#340909', surface: '#1c1917' },
  },
  {
    id: 'pizzaria-dark-napoletana',
    name: 'Napoletana DOC Dark',
    segmentId: 'pizzaria',
    colorFamily: 'verde',
    shade: 'verde-oliva',
    style: ['escuro', 'autêntico', 'italiano'],
    mode: 'dark',
    base: { primary: '#15803d', secondary: '#166534', accent: '#ef4444', bg: '#18201b', surface: '#18181b' },
  },
  {
    id: 'pizzaria-dark-crosta',
    name: 'Crosta Dourada Dark',
    segmentId: 'pizzaria',
    colorFamily: 'amarelo',
    shade: 'dourado',
    style: ['escuro', 'apetitoso', 'moderno'],
    mode: 'dark',
    base: { primary: '#eab308', secondary: '#ca8a04', accent: '#f97316', bg: '#342a09', surface: '#1e293b' },
  },

  // --- AÇAÍ ---
  {
    id: 'acai-roxo-creme',
    name: 'Roxo Açaí Puro & Creme',
    segmentId: 'acai',
    colorFamily: 'roxo',
    shade: 'açaí-intenso',
    style: ['tropical', 'vibrante', 'saudável'],
    mode: 'light',
    base: { primary: '#6b21a8', secondary: '#581c87', accent: '#e11d48', bg: '#f9f7fa', surface: '#ffffff' },
  },
  {
    id: 'acai-ameixa-lima',
    name: 'Ameixa Selvagem & Verde Lima',
    segmentId: 'acai',
    colorFamily: 'roxo',
    shade: 'ameixa',
    style: ['refrescante', 'energético', 'tropical'],
    mode: 'light',
    base: { primary: '#9653d0', secondary: '#843cc0', accent: '#84cc16', bg: '#f5f1f8', surface: '#ffffff' },
  },
  {
    id: 'acai-violeta-rosa',
    name: 'Frutas Vermelhas & Violeta',
    segmentId: 'acai',
    colorFamily: 'rosa',
    shade: 'magenta-fruta',
    style: ['divertido', 'jovem', 'doce'],
    mode: 'light',
    base: { primary: '#be185d', secondary: '#9d174d', accent: '#8b5cf6', bg: '#f9e9f0', surface: '#ffffff' },
  },
  {
    id: 'acai-dark-selva',
    name: 'Açaí da Selva Noturno',
    segmentId: 'acai',
    colorFamily: 'roxo',
    shade: 'roxo-profundo',
    style: ['escuro', 'premium', 'tropical'],
    mode: 'dark',
    base: { primary: '#c48ff4', secondary: '#af6fe7', accent: '#a3e635', bg: '#14081f', surface: '#191124' },
  },
  {
    id: 'acai-dark-energia',
    name: 'Açaí Energy Turbo Dark',
    segmentId: 'acai',
    colorFamily: 'rosa',
    shade: 'framboesa-neon',
    style: ['escuro', 'vibrante', 'fitness'],
    mode: 'dark',
    base: { primary: '#ec4899', secondary: '#db2777', accent: '#38bdf8', bg: '#20181c', surface: '#161e2e' },
  },
  {
    id: 'acai-dark-guarana',
    name: 'Açaí com Guaraná Dark',
    segmentId: 'acai',
    colorFamily: 'verde',
    shade: 'guaraná-verde',
    style: ['escuro', 'artesanal', 'amazônico'],
    mode: 'dark',
    base: { primary: '#22c55e', secondary: '#16a34a', accent: '#c084fc', bg: '#06130b', surface: '#141d17' },
  },

  // --- MERCADO & HORTIFRÚTI ---
  {
    id: 'mercado-verde-branco',
    name: 'Verde Campo & Branco Fresco',
    segmentId: 'mercado',
    colorFamily: 'verde',
    shade: 'verde-folha',
    style: ['fresco', 'saudável', 'confiável'],
    mode: 'light',
    base: { primary: '#15803d', secondary: '#166534', accent: '#f59e0b', bg: '#f7faf8', surface: '#ffffff' },
  },
  {
    id: 'mercado-verde-amarelo',
    name: 'Hortifrúti Colheita & Sol',
    segmentId: 'mercado',
    colorFamily: 'amarelo',
    shade: 'ouro-solar',
    style: ['alegre', 'farto', 'popular'],
    mode: 'light',
    base: { primary: '#b18a04', secondary: '#896006', accent: '#15803d', bg: '#ebfafc', surface: '#ffffff' },
  },
  {
    id: 'mercado-azul-laranja',
    name: 'Hipermercado Azul & Ofertas',
    segmentId: 'mercado',
    colorFamily: 'azul',
    shade: 'azul-royal',
    style: ['varejo', 'ofertas', 'dinâmico'],
    mode: 'light',
    base: { primary: '#1d4ed8', secondary: '#1e40af', accent: '#ea580c', bg: '#e9edf9', surface: '#ffffff' },
  },
  {
    id: 'mercado-dark-organico',
    name: 'Empório Orgânico Dark',
    segmentId: 'mercado',
    colorFamily: 'verde',
    shade: 'verde-floresta',
    style: ['escuro', 'sustentável', 'gourmet'],
    mode: 'dark',
    base: { primary: '#22c55e', secondary: '#16a34a', accent: '#f59e0b', bg: '#081f10', surface: '#131e15' },
  },
  {
    id: 'mercado-dark-clube',
    name: 'Clube de Compras Noturno',
    segmentId: 'mercado',
    colorFamily: 'azul',
    shade: 'azul-petróleo',
    style: ['escuro', 'corporativo', 'atacado'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#f97316', bg: '#181e20', surface: '#161e2e' },
  },
  {
    id: 'mercado-dark-prateleira',
    name: 'Prateleira Black Express',
    segmentId: 'mercado',
    colorFamily: 'laranja',
    shade: 'laranja-segurança',
    style: ['escuro', 'ágil', 'prático'],
    mode: 'dark',
    base: { primary: '#f97316', secondary: '#ea580c', accent: '#4ade80', bg: '#341b09', surface: '#18181b' },
  },

  // --- DOCERIA ---
  {
    id: 'doceria-rosa-baunilha',
    name: 'Rosa Pastel & Flor de Baunilha',
    segmentId: 'doceria',
    colorFamily: 'rosa',
    shade: 'rosa-pastel',
    style: ['delicado', 'fofo', 'artesanal'],
    mode: 'light',
    base: { primary: '#db2777', secondary: '#be185d', accent: '#fbbf24', bg: '#faf7f8', surface: '#ffffff' },
  },
  {
    id: 'doceria-framboesa-creme',
    name: 'Framboesa Glacê & Creme',
    segmentId: 'doceria',
    colorFamily: 'vermelho',
    shade: 'framboesa',
    style: ['doce', 'confeitaria', 'sofisticado'],
    mode: 'light',
    base: { primary: '#ca1a2f', secondary: '#a71026', accent: '#f43f5e', bg: '#f9f4e9', surface: '#ffffff' },
  },
  {
    id: 'doceria-pistache-chocolate',
    name: 'Pistache & Chocolate Belga',
    segmentId: 'doceria',
    colorFamily: 'verde',
    shade: 'pistache',
    style: ['patisserie', 'gourmet', 'elegante'],
    mode: 'light',
    base: { primary: '#15803d', secondary: '#166534', accent: '#b45309', bg: '#e9f9ef', surface: '#ffffff' },
  },
  {
    id: 'doceria-dark-cacau',
    name: 'Chocolatier Dark 70%',
    segmentId: 'doceria',
    colorFamily: 'marrom',
    shade: 'cacau-nobre',
    style: ['escuro', 'luxo', 'artesanal'],
    mode: 'dark',
    base: { primary: '#805734', secondary: '#9e6c41', accent: '#f472b6', bg: '#1f0908', surface: '#1c1917' },
  },
  {
    id: 'doceria-dark-velvet',
    name: 'Red Velvet Noturno',
    segmentId: 'doceria',
    colorFamily: 'rosa',
    shade: 'cereja-negra',
    style: ['escuro', 'aveludado', 'festa'],
    mode: 'dark',
    base: { primary: '#ed7db2', secondary: '#ea7eae', accent: '#fde047', bg: '#34091d', surface: '#191114' },
  },
  {
    id: 'doceria-dark-caramelo',
    name: 'Caramelo Salgado Bistrô Dark',
    segmentId: 'doceria',
    colorFamily: 'amarelo',
    shade: 'caramelo-dourado',
    style: ['escuro', 'cremoso', 'boutique'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#fb7185', bg: '#13160c', surface: '#18181b' },
  },

  // --- PEIXARIA & FRUTOS DO MAR ---
  {
    id: 'peixaria-azul-areia',
    name: 'Azul Profundo & Areia Dourada',
    segmentId: 'peixaria',
    colorFamily: 'azul',
    shade: 'azul-marinho',
    style: ['oceânico', 'fresco', 'tradicional'],
    mode: 'light',
    base: { primary: '#0369a1', secondary: '#0284c7', accent: '#d97706', bg: '#f3f1f8', surface: '#ffffff' },
  },
  {
    id: 'peixaria-ciano-branco',
    name: 'Ciano Mar & Branco Puro',
    segmentId: 'peixaria',
    colorFamily: 'azul',
    shade: 'ciano',
    style: ['fresco', 'límpido', 'moderno'],
    mode: 'light',
    base: { primary: '#1399be', secondary: '#1d81a0', accent: '#0284c7', bg: '#f1f7f8', surface: '#ffffff' },
  },
  {
    id: 'peixaria-marinho-coral',
    name: 'Coral Vivo & Azul Oceano',
    segmentId: 'peixaria',
    colorFamily: 'laranja',
    shade: 'coral',
    style: ['marítimo', 'vibrante', 'gourmet'],
    mode: 'light',
    base: { primary: '#ea580c', secondary: '#c2410c', accent: '#0284c7', bg: '#e9f3f9', surface: '#ffffff' },
  },
  {
    id: 'peixaria-dark-abismo',
    name: 'Mar Profundo Abissal',
    segmentId: 'peixaria',
    colorFamily: 'azul',
    shade: 'marinho-noite',
    style: ['escuro', 'fresco', 'premium'],
    mode: 'dark',
    base: { primary: '#51c5f9', secondary: '#0295e0', accent: '#fb923c', bg: '#092734', surface: '#0f1d2e' },
  },
  {
    id: 'peixaria-dark-nordica',
    name: 'Bancada Nórdica de Pescados',
    segmentId: 'peixaria',
    colorFamily: 'neutros',
    shade: 'gelo-polar',
    style: ['escuro', 'limpo', 'frio'],
    mode: 'dark',
    base: { primary: '#717179', secondary: '#898995', accent: '#38bdf8', bg: '#191924', surface: '#18181b' },
  },
  {
    id: 'peixaria-dark-coral',
    name: 'Arrecife Noturno de Frutos do Mar',
    segmentId: 'peixaria',
    colorFamily: 'vermelho',
    shade: 'coral-escuro',
    style: ['escuro', 'alta gastronomia', 'costeiro'],
    mode: 'dark',
    base: { primary: '#f87171', secondary: '#ef4444', accent: '#38bdf8', bg: '#2d1616', surface: '#161e2e' },
  },

  // --- JAPONESA ---
  {
    id: 'japonesa-preto-vermelho',
    name: 'Preto Urushi & Vermelho Tori',
    segmentId: 'japonesa',
    colorFamily: 'vermelho',
    shade: 'vermelho-oriente',
    style: ['oriental', 'tradicional', 'forte'],
    mode: 'light',
    base: { primary: '#dc2626', secondary: '#b91c1c', accent: '#18181b', bg: '#f1f8f8', surface: '#ffffff' },
  },
  {
    id: 'japonesa-grafite-bambu',
    name: 'Grafite Zen & Bambu Verde',
    segmentId: 'japonesa',
    colorFamily: 'verde',
    shade: 'bambu',
    style: ['zen', 'minimalista', 'elegante'],
    mode: 'light',
    base: { primary: '#15803d', secondary: '#166534', accent: '#71717a', bg: '#f8f1f6', surface: '#ffffff' },
  },
  {
    id: 'japonesa-offwhite-indigo',
    name: 'Off-White & Índigo Japonês',
    segmentId: 'japonesa',
    colorFamily: 'azul',
    shade: 'índigo',
    style: ['artesanal', 'autêntico', 'limpo'],
    mode: 'light',
    base: { primary: '#1d4ed8', secondary: '#1e40af', accent: '#dc2626', bg: '#fbfbfc', surface: '#ffffff' },
  },
  {
    id: 'japonesa-dark-tokyo',
    name: 'Tokyo Lounge Noturno',
    segmentId: 'japonesa',
    colorFamily: 'vermelho',
    shade: 'vermelho-neon',
    style: ['escuro', 'moderno', 'lounge'],
    mode: 'dark',
    base: { primary: '#f37373', secondary: '#e35252', accent: '#f59e0b', bg: '#0e0b09', surface: '#18181b' },
  },
  {
    id: 'japonesa-dark-omakase',
    name: 'Omakase Minimalista Dark',
    segmentId: 'japonesa',
    colorFamily: 'neutros',
    shade: 'sumi-e',
    style: ['escuro', 'sofisticado', 'sushi bar'],
    mode: 'dark',
    base: { primary: '#71717a', secondary: '#52525b', accent: '#f43f5e', bg: '#191e24', surface: '#18181c' },
  },
  {
    id: 'japonesa-dark-matcha',
    name: 'Cerimônia do Chá & Wasabi Dark',
    segmentId: 'japonesa',
    colorFamily: 'verde',
    shade: 'matcha',
    style: ['escuro', 'zen', 'harmonioso'],
    mode: 'dark',
    base: { primary: '#4ade80', secondary: '#22c55e', accent: '#f87171', bg: '#093419', surface: '#141d14' },
  },

  // --- CAFETERIA ---
  {
    id: 'cafeteria-cafe-leite',
    name: 'Café Torrado & Leite Vaporizado',
    segmentId: 'cafeteria',
    colorFamily: 'marrom',
    shade: 'café',
    style: ['acolhedor', 'aromático', 'especial'],
    mode: 'light',
    base: { primary: '#6b482b', secondary: '#5c3e25', accent: '#ca8a04', bg: '#f9f7e9', surface: '#ffffff' },
  },
  {
    id: 'cafeteria-espresso-caramelo',
    name: 'Espresso Intenso & Caramelo',
    segmentId: 'cafeteria',
    colorFamily: 'amarelo',
    shade: 'caramelo',
    style: ['energia', 'clássico', 'urbano'],
    mode: 'light',
    base: { primary: '#876306', secondary: '#986803', accent: '#d97706', bg: '#f8f6f1', surface: '#ffffff' },
  },
  {
    id: 'cafeteria-mocha-salvia',
    name: 'Mocha Cremoso & Verde Sálvia',
    segmentId: 'cafeteria',
    colorFamily: 'verde',
    shade: 'sálvia',
    style: ['botânico', 'tranquilo', 'bistrô'],
    mode: 'light',
    base: { primary: '#15803d', secondary: '#166534', accent: '#854d0e', bg: '#ebedfc', surface: '#ffffff' },
  },
  {
    id: 'cafeteria-dark-bourbon',
    name: 'Bourbon Amarelo Roast Dark',
    segmentId: 'cafeteria',
    colorFamily: 'marrom',
    shade: 'torra-escura',
    style: ['escuro', 'especialista', 'aconchegante'],
    mode: 'dark',
    base: { primary: '#a2612c', secondary: '#c37636', accent: '#f59e0b', bg: '#1f1208', surface: '#1c1917' },
  },
  {
    id: 'cafeteria-dark-barista',
    name: 'Barista Lab Noturno',
    segmentId: 'cafeteria',
    colorFamily: 'amarelo',
    shade: 'crema-ouro',
    style: ['escuro', 'artesanal', 'industrial'],
    mode: 'dark',
    base: { primary: '#fbbf24', secondary: '#d97706', accent: '#fb923c', bg: '#1e210d', surface: '#18181b' },
  },
  {
    id: 'cafeteria-dark-coldbrew',
    name: 'Cold Brew & Nitro Dark',
    segmentId: 'cafeteria',
    colorFamily: 'neutros',
    shade: 'grafite-ambar',
    style: ['escuro', 'moderno', 'hip'],
    mode: 'dark',
    base: { primary: '#6f6f7c', secondary: '#838390', accent: '#f97316', bg: '#24191f', surface: '#161e2e' },
  },

  // --- CHURRASCARIA & ESPETARIA ---
  {
    id: 'churrascaria-brasa-grafite',
    name: 'Brasa Viva & Cinza Carvão',
    segmentId: 'churrascaria',
    colorFamily: 'vermelho',
    shade: 'brasa',
    style: ['fogo', 'rústico', 'carnes nobres'],
    mode: 'light',
    base: { primary: '#b91c1c', secondary: '#991b1b', accent: '#ea580c', bg: '#f1f9e9', surface: '#ffffff' },
  },
  {
    id: 'churrascaria-rubi-madeira',
    name: 'Madeira Nobre & Rubi Assado',
    segmentId: 'churrascaria',
    colorFamily: 'marrom',
    shade: 'madeira',
    style: ['tradicional', 'gaúcho', 'potente'],
    mode: 'light',
    base: { primary: '#6b482b', secondary: '#5c3e25', accent: '#dc2626', bg: '#fceceb', surface: '#ffffff' },
  },
  {
    id: 'churrascaria-terracota-preto',
    name: 'Terracota Rústico & Espeto de Ferro',
    segmentId: 'churrascaria',
    colorFamily: 'laranja',
    shade: 'terracota-fogo',
    style: ['artesanal', 'boteco de carne', 'quente'],
    mode: 'light',
    base: { primary: '#f05211', secondary: '#c84317', accent: '#b45309', bg: '#f9e9f2', surface: '#ffffff' },
  },
  {
    id: 'churrascaria-dark-pitmaster',
    name: 'Pitmaster Texas Smoker Dark',
    segmentId: 'churrascaria',
    colorFamily: 'vermelho',
    shade: 'fogo-noturno',
    style: ['escuro', 'defumado', 'bbq'],
    mode: 'dark',
    base: { primary: '#f15b5b', secondary: '#e03c3c', accent: '#f59e0b', bg: '#341b09', surface: '#1c1917' },
  },
  {
    id: 'churrascaria-dark-costela',
    name: 'Costelaria de Chão Dark',
    segmentId: 'churrascaria',
    colorFamily: 'laranja',
    shade: 'brasa-ouro',
    style: ['escuro', 'rústico raiz', 'fogão de lenha'],
    mode: 'dark',
    base: { primary: '#fa9148', secondary: '#f57634', accent: '#fde047', bg: '#2d1f16', surface: '#18181b' },
  },
  {
    id: 'churrascaria-dark-picanha',
    name: 'Picanha Prime Steakhouse Dark',
    segmentId: 'churrascaria',
    colorFamily: 'neutros',
    shade: 'ferro-fundido',
    style: ['escuro', 'luxo', 'boutique de carnes'],
    mode: 'dark',
    base: { primary: '#717179', secondary: '#898995', accent: '#ef4444', bg: '#19241f', surface: '#161922' },
  },

  // --- LANCHONETE & HOT DOG ---
  {
    id: 'lanchonete-mostarda-ketchup',
    name: 'Amarelo Mostarda & Vermelho Ketchup',
    segmentId: 'lanchonete',
    colorFamily: 'amarelo',
    shade: 'mostarda-diner',
    style: ['alegre', 'retrô', 'apetite'],
    mode: 'light',
    base: { primary: '#a38311', secondary: '#7e5c11', accent: '#dc2626', bg: '#e9edf9', surface: '#ffffff' },
  },
  {
    id: 'lanchonete-azul-creme',
    name: 'Azul Retrô 50s & Creme Lanche',
    segmentId: 'lanchonete',
    colorFamily: 'azul',
    shade: 'azul-retro',
    style: ['diner americano', 'nostálgico', 'divertido'],
    mode: 'light',
    base: { primary: '#0295e0', secondary: '#0379ba', accent: '#ea580c', bg: '#fef5f0', surface: '#ffffff' },
  },
  {
    id: 'lanchonete-laranja-branco',
    name: 'Laranja Salgado & Branco Limpo',
    segmentId: 'lanchonete',
    colorFamily: 'laranja',
    shade: 'laranja-lanche',
    style: ['rápido', 'sucos', 'balcão'],
    mode: 'light',
    base: { primary: '#ea580c', secondary: '#c2410c', accent: '#eab308', bg: '#ecf9e9', surface: '#ffffff' },
  },
  {
    id: 'lanchonete-dark-trailer',
    name: 'Hot Dog do Trailer Noturno',
    segmentId: 'lanchonete',
    colorFamily: 'amarelo',
    shade: 'mostarda-neon',
    style: ['escuro', 'madrugada', 'street food'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#ef4444', bg: '#2b3409', surface: '#18181b' },
  },
  {
    id: 'lanchonete-dark-chapa',
    name: 'Lanchonete 24 Horas Dark',
    segmentId: 'lanchonete',
    colorFamily: 'vermelho',
    shade: 'vermelho-diner',
    style: ['escuro', 'pop', 'movimentado'],
    mode: 'dark',
    base: { primary: '#ef4444', secondary: '#dc2626', accent: '#38bdf8', bg: '#2d1f16', surface: '#1c1917' },
  },
  {
    id: 'lanchonete-dark-batata',
    name: 'Batataria Crocante Dark',
    segmentId: 'lanchonete',
    colorFamily: 'laranja',
    shade: 'crocante-dourado',
    style: ['escuro', 'delivery ágil', 'jovem'],
    mode: 'dark',
    base: { primary: '#fb923c', secondary: '#f97316', accent: '#4ade80', bg: '#211f0d', surface: '#161e2e' },
  },

  // --- SORVETERIA ARTESANAL ---
  {
    id: 'sorveteria-menta-baunilha',
    name: 'Menta Refrescante & Baunilha',
    segmentId: 'sorveteria',
    colorFamily: 'verde',
    shade: 'verde-menta',
    style: ['refrescante', 'cremoso', 'artesanal'],
    mode: 'light',
    base: { primary: '#059669', secondary: '#047857', accent: '#0284c7', bg: '#f9fceb', surface: '#ffffff' },
  },
  {
    id: 'sorveteria-morango-azul',
    name: 'Morango Doce & Azul Bebê',
    segmentId: 'sorveteria',
    colorFamily: 'rosa',
    shade: 'morango-creme',
    style: ['infantil', 'divertido', 'alegre'],
    mode: 'light',
    base: { primary: '#db2777', secondary: '#be185d', accent: '#0284c7', bg: '#f1f8f5', surface: '#ffffff' },
  },
  {
    id: 'sorveteria-lavanda-limao',
    name: 'Limão Siciliano & Lavanda',
    segmentId: 'sorveteria',
    colorFamily: 'amarelo',
    shade: 'limão-siciliano',
    style: ['gelateria italiana', 'refinado', 'verão'],
    mode: 'light',
    base: { primary: '#a38311', secondary: '#7e5c11', accent: '#7c3aed', bg: '#f9e9ea', surface: '#ffffff' },
  },
  {
    id: 'sorveteria-dark-gelato',
    name: 'Gelateria Noturna di Roma',
    segmentId: 'sorveteria',
    colorFamily: 'verde',
    shade: 'pistache-italiano',
    style: ['escuro', 'luxo', 'italiano'],
    mode: 'dark',
    base: { primary: '#34d399', secondary: '#10b981', accent: '#f472b6', bg: '#0d2021', surface: '#131e18' },
  },
  {
    id: 'sorveteria-dark-amarena',
    name: 'Amarena Selvagem Dark Gelato',
    segmentId: 'sorveteria',
    colorFamily: 'rosa',
    shade: 'amarena',
    style: ['escuro', 'aveludado', 'doce'],
    mode: 'dark',
    base: { primary: '#ed7db2', secondary: '#ea7eae', accent: '#38bdf8', bg: '#2d1621', surface: '#191114' },
  },
  {
    id: 'sorveteria-dark-tutti',
    name: 'Tutti-Frutti Neon Paleteria',
    segmentId: 'sorveteria',
    colorFamily: 'azul',
    shade: 'azul-picolé',
    style: ['escuro', 'vibrante', 'festivo'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#f43f5e', bg: '#0c0e16', surface: '#161e2e' },
  },

  // --- MARMITARIA & COMIDA CASEIRA ---
  {
    id: 'marmitaria-horta-laranja',
    name: 'Verde Horta & Laranja Acolhedor',
    segmentId: 'marmitaria',
    colorFamily: 'verde',
    shade: 'verde-horta',
    style: ['caseiro', 'tempero de mãe', 'nutritivo'],
    mode: 'light',
    base: { primary: '#15803d', secondary: '#166534', accent: '#ea580c', bg: '#f7ebfc', surface: '#ffffff' },
  },
  {
    id: 'marmitaria-amarelo-marrom',
    name: 'Amarelo Sol & Marrom Feijão',
    segmentId: 'marmitaria',
    colorFamily: 'amarelo',
    shade: 'milho-caseiro',
    style: ['almoço executivo', 'farto', 'popular'],
    mode: 'light',
    base: { primary: '#876306', secondary: '#986803', accent: '#15803d', bg: '#f7f9e9', surface: '#ffffff' },
  },
  {
    id: 'marmitaria-vermelho-bege',
    name: 'Vermelho Molho da Casa & Bege Panela',
    segmentId: 'marmitaria',
    colorFamily: 'vermelho',
    shade: 'molho-caseiro',
    style: ['afetivo', 'quentinha', 'tradicional'],
    mode: 'light',
    base: { primary: '#a31919', secondary: '#831717', accent: '#b45309', bg: '#faf7f8', surface: '#ffffff' },
  },
  {
    id: 'marmitaria-dark-panela',
    name: 'Panela de Barro Fogão Dark',
    segmentId: 'marmitaria',
    colorFamily: 'marrom',
    shade: 'barro-cozido',
    style: ['escuro', 'tradição', 'raiz'],
    mode: 'dark',
    base: { primary: '#806249', secondary: '#735841', accent: '#22c55e', bg: '#1f1c08', surface: '#1c1917' },
  },
  {
    id: 'marmitaria-dark-almoço',
    name: 'Marmita Express Noturna',
    segmentId: 'marmitaria',
    colorFamily: 'verde',
    shade: 'tempero-verde',
    style: ['escuro', 'prático', 'econômico'],
    mode: 'dark',
    base: { primary: '#4ade80', secondary: '#22c55e', accent: '#fb923c', bg: '#09342b', surface: '#131e15' },
  },
  {
    id: 'marmitaria-dark-tempero',
    name: 'Cheiro Verde Gourmet Dark',
    segmentId: 'marmitaria',
    colorFamily: 'laranja',
    shade: 'abóbora-assada',
    style: ['escuro', 'conforto', 'saboroso'],
    mode: 'dark',
    base: { primary: '#fb923c', secondary: '#f97316', accent: '#fde047', bg: '#342e09', surface: '#18181b' },
  },

  // --- SAUDÁVEL & FIT ---
  {
    id: 'saudavel-verde-cru',
    name: 'Verde Folha Fresca & Cru Linho',
    segmentId: 'saudavel',
    colorFamily: 'verde',
    shade: 'verde-folha',
    style: ['orgânico', 'leve', 'vital'],
    mode: 'light',
    base: { primary: '#116a33', secondary: '#115029', accent: '#0284c7', bg: '#fcfaeb', surface: '#ffffff' },
  },
  {
    id: 'saudavel-oliva-areia',
    name: 'Verde Oliva Puro & Areia Suave',
    segmentId: 'saudavel',
    colorFamily: 'verde',
    shade: 'oliva',
    style: ['mediterrâneo', 'natural', 'equilibrado'],
    mode: 'light',
    base: { primary: '#5b9312', secondary: '#4d7816', accent: '#ca8a04', bg: '#f5f8f1', surface: '#ffffff' },
  },
  {
    id: 'saudavel-matcha-terracota',
    name: 'Terracota Leve & Verde Matcha',
    segmentId: 'saudavel',
    colorFamily: 'laranja',
    shade: 'argila-leve',
    style: ['zen', 'bem-estar', 'holístico'],
    mode: 'light',
    base: { primary: '#aa390b', secondary: '#832c0f', accent: '#4d7c0f', bg: '#f9f4e9', surface: '#ffffff' },
  },
  {
    id: 'saudavel-dark-fit',
    name: 'Performance Fit Pro Dark',
    segmentId: 'saudavel',
    colorFamily: 'verde',
    shade: 'verde-neon-fit',
    style: ['escuro', 'treino', 'energia'],
    mode: 'dark',
    base: { primary: '#22c55e', secondary: '#16a34a', accent: '#38bdf8', bg: '#0c1416', surface: '#131e15' },
  },
  {
    id: 'saudavel-dark-poke',
    name: 'Poke Bowl Salmão Fresh Dark',
    segmentId: 'saudavel',
    colorFamily: 'azul',
    shade: 'azul-havaiano',
    style: ['escuro', 'marítimo', 'fresco'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#4ade80', bg: '#091534', surface: '#161e2e' },
  },
  {
    id: 'saudavel-dark-detox',
    name: 'Detox Cleanse Noturno',
    segmentId: 'saudavel',
    colorFamily: 'amarelo',
    shade: 'gengibre-solar',
    style: ['escuro', 'nutrição', 'vitalidade'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#4ade80', bg: '#160f0c', surface: '#18181b' },
  },

  // --- MEXICANA ---
  {
    id: 'mexicana-terracota-milho',
    name: 'Terracota Adobe & Amarelo Milho',
    segmentId: 'mexicana',
    colorFamily: 'laranja',
    shade: 'terracota',
    style: ['caliente', 'festivo', 'artesanal'],
    mode: 'light',
    base: { primary: '#aa390b', secondary: '#832c0f', accent: '#ca8a04', bg: '#e9f4f9', surface: '#ffffff' },
  },
  {
    id: 'mexicana-cacto-pimenta',
    name: 'Verde Cacto & Pimenta Jalapeño',
    segmentId: 'mexicana',
    colorFamily: 'verde',
    shade: 'cacto',
    style: ['autêntico', 'picante', 'vibrante'],
    mode: 'light',
    base: { primary: '#0e5428', secondary: '#0d3b1e', accent: '#dc2626', bg: '#eaf9e9', surface: '#ffffff' },
  },
  {
    id: 'mexicana-turquesa-laranja',
    name: 'Turquesa Cancún & Laranja Sol',
    segmentId: 'mexicana',
    colorFamily: 'azul',
    shade: 'turquesa',
    style: ['praia', 'mariachi', 'colorido'],
    mode: 'light',
    base: { primary: '#0295e0', secondary: '#0379ba', accent: '#ea580c', bg: '#e9f9f1', surface: '#ffffff' },
  },
  {
    id: 'mexicana-dark-lucha',
    name: 'Lucha Libre Fiesta Dark',
    segmentId: 'mexicana',
    colorFamily: 'vermelho',
    shade: 'habanero-fogo',
    style: ['escuro', 'festa', 'tacos'],
    mode: 'dark',
    base: { primary: '#ef4444', secondary: '#dc2626', accent: '#facc15', bg: '#34091b', surface: '#1c1917' },
  },
  {
    id: 'mexicana-dark-agave',
    name: 'Tequila Bar & Agave Noturno',
    segmentId: 'mexicana',
    colorFamily: 'verde',
    shade: 'agave-azul',
    style: ['escuro', 'taqueria', 'lounge'],
    mode: 'dark',
    base: { primary: '#34d399', secondary: '#10b981', accent: '#fb923c', bg: '#093234', surface: '#131e18' },
  },
  {
    id: 'mexicana-dark-sombrero',
    name: 'Sombrero Dourado Dark',
    segmentId: 'mexicana',
    colorFamily: 'amarelo',
    shade: 'dourado-milho',
    style: ['escuro', 'animado', 'nachos'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#f87171', bg: '#341a09', surface: '#18181b' },
  },

  // --- CONVENIÊNCIA ---
  {
    id: 'conveniencia-eletrico-amarelo',
    name: 'Azul Elétrico & Amarelo Sinalização',
    segmentId: 'conveniencia',
    colorFamily: 'azul',
    shade: 'azul-elétrico',
    style: ['24h', 'visível', 'rápido'],
    mode: 'light',
    base: { primary: '#1d4ed8', secondary: '#1e40af', accent: '#ca8a04', bg: '#f2e9f9', surface: '#ffffff' },
  },
  {
    id: 'conveniencia-vermelho-branco',
    name: 'Vermelho Energia & Branco Limpo',
    segmentId: 'conveniencia',
    colorFamily: 'vermelho',
    shade: 'vermelho-energia',
    style: ['posto', 'urgência', 'dinâmico'],
    mode: 'light',
    base: { primary: '#e35252', secondary: '#df2929', accent: '#2563eb', bg: '#fcebf2', surface: '#ffffff' },
  },
  {
    id: 'conveniencia-ciano-cinza',
    name: 'Ciano Moderno & Cinza Urbano',
    segmentId: 'conveniencia',
    colorFamily: 'azul',
    shade: 'ciano-frio',
    style: ['loja express', 'prático', 'tecnológico'],
    mode: 'light',
    base: { primary: '#0273ae', secondary: '#035988', accent: '#ea580c', bg: '#f9efe9', surface: '#ffffff' },
  },
  {
    id: 'conveniencia-dark-neon24h',
    name: 'Neon Store 24 Horas Dark',
    segmentId: 'conveniencia',
    colorFamily: 'azul',
    shade: 'azul-neon',
    style: ['escuro', 'madrugada', 'express'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#facc15', bg: '#161c2d', surface: '#161e2e' },
  },
  {
    id: 'conveniencia-dark-pitstop',
    name: 'Pit Stop Rodovia Noturno',
    segmentId: 'conveniencia',
    colorFamily: 'amarelo',
    shade: 'amarelo-alerta',
    style: ['escuro', 'alto contraste', 'combustível'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#ef4444', bg: '#2d1e16', surface: '#18181b' },
  },
  {
    id: 'conveniencia-dark-gelada',
    name: 'Cerveja Trincando Freezer Dark',
    segmentId: 'conveniencia',
    colorFamily: 'laranja',
    shade: 'laranja-gelada',
    style: ['escuro', 'bebidas', 'festa'],
    mode: 'dark',
    base: { primary: '#fb923c', secondary: '#f97316', accent: '#38bdf8', bg: '#210d0d', surface: '#1c1917' },
  },

  // --- DISTRIBUIDORA (Água, Gás e Bebidas) ---
  {
    id: 'distribuidora-petroleo-laranja',
    name: 'Azul Petróleo & Laranja Segurança',
    segmentId: 'distribuidora',
    colorFamily: 'azul',
    shade: 'petróleo',
    style: ['logística', 'confiança', 'ágil'],
    mode: 'light',
    base: { primary: '#0369a1', secondary: '#075985', accent: '#ea580c', bg: '#e9f9f1', surface: '#ffffff' },
  },
  {
    id: 'distribuidora-grafite-ouro',
    name: 'Grafite Técnico & Amarelo Ouro',
    segmentId: 'distribuidora',
    colorFamily: 'amarelo',
    shade: 'amarelo-industrial',
    style: ['operacional', 'direto', 'robusto'],
    mode: 'light',
    base: { primary: '#7f6303', secondary: '#583e04', accent: '#18181b', bg: '#e9edf9', surface: '#ffffff' },
  },
  {
    id: 'distribuidora-royal-gelo',
    name: 'Azul Royal Galão & Branco Gelo',
    segmentId: 'distribuidora',
    colorFamily: 'azul',
    shade: 'azul-água',
    style: ['água mineral', 'puro', 'límpido'],
    mode: 'light',
    base: { primary: '#1d4ed8', secondary: '#1e40af', accent: '#0284c7', bg: '#f9f5e9', surface: '#ffffff' },
  },
  {
    id: 'distribuidora-dark-gas',
    name: 'Distribuidora P13 Chama Azul Dark',
    segmentId: 'distribuidora',
    colorFamily: 'azul',
    shade: 'chama-azul',
    style: ['escuro', 'força', 'segurança'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#fb923c', bg: '#0d211f', surface: '#161e2e' },
  },
  {
    id: 'distribuidora-dark-fardo',
    name: 'Fardo Fechado Depósito Dark',
    segmentId: 'distribuidora',
    colorFamily: 'laranja',
    shade: 'laranja-fardo',
    style: ['escuro', 'atacado', 'volume'],
    mode: 'dark',
    base: { primary: '#fb923c', secondary: '#f97316', accent: '#fde047', bg: '#340b09', surface: '#1c1917' },
  },
  {
    id: 'distribuidora-dark-caminhao',
    name: 'Frota Express Noturna Dark',
    segmentId: 'distribuidora',
    colorFamily: 'amarelo',
    shade: 'ouro-segurança',
    style: ['escuro', 'entrega rápida', 'confiável'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#38bdf8', bg: '#101f08', surface: '#18181b' },
  },

  // --- FARMÁCIA & DROGARIA ---
  {
    id: 'farmacia-azul-turquesa',
    name: 'Azul Saúde & Turquesa Suave',
    segmentId: 'farmacia',
    colorFamily: 'azul',
    shade: 'azul-hospitalar',
    style: ['cuidado', 'médico', 'confiabilidade'],
    mode: 'light',
    base: { primary: '#0273ae', secondary: '#035988', accent: '#14b8a6', bg: '#f6e9f9', surface: '#ffffff' },
  },
  {
    id: 'farmacia-verde-branco',
    name: 'Verde Cruz Farmácia & Branco Puro',
    segmentId: 'farmacia',
    colorFamily: 'verde',
    shade: 'verde-cruz',
    style: ['saúde', 'bem-estar', 'higiene'],
    mode: 'light',
    base: { primary: '#0e5428', secondary: '#0d3b1e', accent: '#0284c7', bg: '#faf7f9', surface: '#ffffff' },
  },
  {
    id: 'farmacia-azul-menta',
    name: 'Verde Menta & Azul Profundo',
    segmentId: 'farmacia',
    colorFamily: 'verde',
    shade: 'menta-suave',
    style: ['dermatologia', 'cosmético', 'fresco'],
    mode: 'light',
    base: { primary: '#13a175', secondary: '#108564', accent: '#1d4ed8', bg: '#e9f9f4', surface: '#ffffff' },
  },
  {
    id: 'farmacia-dark-plantao',
    name: 'Plantão Farmacêutico 24h Dark',
    segmentId: 'farmacia',
    colorFamily: 'verde',
    shade: 'verde-cura',
    style: ['escuro', 'plantão', 'sereno'],
    mode: 'dark',
    base: { primary: '#4ade80', secondary: '#22c55e', accent: '#38bdf8', bg: '#160c12', surface: '#131e17' },
  },
  {
    id: 'farmacia-dark-dermato',
    name: 'Dermocosméticos Clinic Dark',
    segmentId: 'farmacia',
    colorFamily: 'azul',
    shade: 'azul-ciano-clean',
    style: ['escuro', 'dermatologia', 'premium'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#a7f3d0', bg: '#09342f', surface: '#161e2e' },
  },
  {
    id: 'farmacia-dark-nutri',
    name: 'Suplementos & Vitaminas Dark',
    segmentId: 'farmacia',
    colorFamily: 'laranja',
    shade: 'laranja-vital',
    style: ['escuro', 'vitalidade', 'esporte'],
    mode: 'dark',
    base: { primary: '#fb923c', secondary: '#f97316', accent: '#4ade80', bg: '#13160c', surface: '#18181b' },
  },

  // --- PET SHOP & AGROPECUÁRIA ---
  {
    id: 'pet-celeste-patinha',
    name: 'Azul Celeste & Laranja Patinha',
    segmentId: 'pet',
    colorFamily: 'azul',
    shade: 'azul-pet',
    style: ['afetuoso', 'alegre', 'cuidadoso'],
    mode: 'light',
    base: { primary: '#138fcf', secondary: '#1275ac', accent: '#ea580c', bg: '#e9edf9', surface: '#ffffff' },
  },
  {
    id: 'pet-musgo-caramelo',
    name: 'Verde Musgo & Bege Caramelo Pelagem',
    segmentId: 'pet',
    colorFamily: 'verde',
    shade: 'musgo',
    style: ['agropecuária', 'natureza', 'campo'],
    mode: 'light',
    base: { primary: '#0e5428', secondary: '#0d3b1e', accent: '#b45309', bg: '#f9e9f3', surface: '#ffffff' },
  },
  {
    id: 'pet-violeta-amarelo',
    name: 'Violeta Companheiro & Amarelo Suave',
    segmentId: 'pet',
    colorFamily: 'roxo',
    shade: 'violeta-amigo',
    style: ['moderno', 'veterinário', 'amigável'],
    mode: 'light',
    base: { primary: '#7c3aed', secondary: '#6d28d9', accent: '#ca8a04', bg: '#f8ebfc', surface: '#ffffff' },
  },
  {
    id: 'pet-dark-banho',
    name: 'Banho & Tosa Spa Noturno',
    segmentId: 'pet',
    colorFamily: 'azul',
    shade: 'azul-espuma',
    style: ['escuro', 'spa canino', 'cuidado'],
    mode: 'dark',
    base: { primary: '#38bdf8', secondary: '#0284c7', accent: '#fb923c', bg: '#0b081f', surface: '#161e2e' },
  },
  {
    id: 'pet-dark-agro',
    name: 'Agropecuária da Fazenda Dark',
    segmentId: 'pet',
    colorFamily: 'verde',
    shade: 'pasto-escuro',
    style: ['escuro', 'rações', 'campo'],
    mode: 'dark',
    base: { primary: '#4ade80', secondary: '#22c55e', accent: '#fde047', bg: '#210d1a', surface: '#131e15' },
  },
  {
    id: 'pet-dark-bichano',
    name: 'Boutique Felina Black Cat',
    segmentId: 'pet',
    colorFamily: 'roxo',
    shade: 'ametista',
    style: ['escuro', 'misterioso', 'delicado'],
    mode: 'dark',
    base: { primary: '#c084fc', secondary: '#a855f7', accent: '#f472b6', bg: '#0d0613', surface: '#191124' },
  },

  // --- PERFUMARIA & COSMÉTICOS ---
  {
    id: 'perfumaria-rosa-ouro',
    name: 'Rosa Pó & Ouro Rosê',
    segmentId: 'perfumaria',
    colorFamily: 'rosa',
    shade: 'rosa-pó',
    style: ['luxo', 'feminino', 'delicado'],
    mode: 'light',
    base: { primary: '#db2777', secondary: '#be185d', accent: '#ca8a04', bg: '#f8f9e9', surface: '#ffffff' },
  },
  {
    id: 'perfumaria-nude-preto',
    name: 'Nude Sofisticado & Preto Acetinado',
    segmentId: 'perfumaria',
    colorFamily: 'marrom',
    shade: 'nude-bege',
    style: ['chique', 'maquiagem', 'editorial'],
    mode: 'light',
    base: { primary: '#7a5332', secondary: '#5c3e25', accent: '#18181b', bg: '#e9f2f9', surface: '#ffffff' },
  },
  {
    id: 'perfumaria-lavanda-prata',
    name: 'Lavanda Suave & Prata Brilhante',
    segmentId: 'perfumaria',
    colorFamily: 'roxo',
    shade: 'lavanda',
    style: ['floral', 'fresco', 'sereno'],
    mode: 'light',
    base: { primary: '#7c3aed', secondary: '#6d28d9', accent: '#0284c7', bg: '#f6f8f1', surface: '#ffffff' },
  },
  {
    id: 'perfumaria-dark-noir',
    name: 'Parfum Noir Alta Perfumaria Dark',
    segmentId: 'perfumaria',
    colorFamily: 'rosa',
    shade: 'magenta-noir',
    style: ['escuro', 'sedutor', 'alta perfumaria'],
    mode: 'dark',
    base: { primary: '#f472b6', secondary: '#ec4899', accent: '#fbbf24', bg: '#210d0f', surface: '#191114' },
  },
  {
    id: 'perfumaria-dark-dourado',
    name: 'Frasco de Ouro Noturno',
    segmentId: 'perfumaria',
    colorFamily: 'amarelo',
    shade: 'ouro-líquido',
    style: ['escuro', 'ostentação', 'brilho'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#f472b6', bg: '#193409', surface: '#18181b' },
  },
  {
    id: 'perfumaria-dark-acetinado',
    name: 'Veludo Acetinado Noturno',
    segmentId: 'perfumaria',
    colorFamily: 'roxo',
    shade: 'orquídea-escura',
    style: ['escuro', 'mágico', 'pele suave'],
    mode: 'dark',
    base: { primary: '#c084fc', secondary: '#a855f7', accent: '#38bdf8', bg: '#1f0934', surface: '#191124' },
  },

  // --- TABACARIA & HEADSHOP ---
  {
    id: 'tabacaria-tabaco-ambar',
    name: 'Tabaco Envelhecido & Âmbar Puro',
    segmentId: 'tabacaria',
    colorFamily: 'marrom',
    shade: 'tabaco',
    style: ['clássico', 'amadeirado', 'tradicional'],
    mode: 'light',
    base: { primary: '#6b482b', secondary: '#5c3e25', accent: '#d97706', bg: '#eaf9e9', surface: '#ffffff' },
  },
  {
    id: 'tabacaria-charuto-ouro',
    name: 'Charuto Havana & Ouro Velho',
    segmentId: 'tabacaria',
    colorFamily: 'amarelo',
    shade: 'ouro-envelhecido',
    style: ['nobre', 'cubano', 'elegante'],
    mode: 'light',
    base: { primary: '#876306', secondary: '#986803', accent: '#ca8a04', bg: '#f9e9eb', surface: '#ffffff' },
  },
  {
    id: 'tabacaria-couro-bronze',
    name: 'Couro Rústico & Bronze Polido',
    segmentId: 'tabacaria',
    colorFamily: 'laranja',
    shade: 'bronze',
    style: ['vintage', 'artesanal', 'exclusivo'],
    mode: 'light',
    base: { primary: '#aa490b', secondary: '#83380f', accent: '#78350f', bg: '#faf7f8', surface: '#ffffff' },
  },
  {
    id: 'tabacaria-dark-lounge',
    name: 'Cigar Lounge Club Dark',
    segmentId: 'tabacaria',
    colorFamily: 'marrom',
    shade: 'cedro-escuro',
    style: ['escuro', 'privativo', 'conhaque'],
    mode: 'dark',
    base: { primary: '#a2852c', secondary: '#c3a136', accent: '#fbbf24', bg: '#1f1908', surface: '#1c1917' },
  },
  {
    id: 'tabacaria-dark-fumace',
    name: 'Fumaça Noturna Headshop Dark',
    segmentId: 'tabacaria',
    colorFamily: 'verde',
    shade: 'folha-seca',
    style: ['escuro', 'alternativo', 'moderno'],
    mode: 'dark',
    base: { primary: '#4ade80', secondary: '#22c55e', accent: '#fb923c', bg: '#340924', surface: '#131e15' },
  },
  {
    id: 'tabacaria-dark-onix',
    name: 'Isqueiro de Ônix Preto Fosco',
    segmentId: 'tabacaria',
    colorFamily: 'neutros',
    shade: 'preto-fosco',
    style: ['escuro', 'minimalista', 'urbano'],
    mode: 'dark',
    base: { primary: '#717179', secondary: '#898995', accent: '#f97316', bg: '#241d19', surface: '#18181b' },
  },

  // --- FLORICULTURA & PLANTAS ---
  {
    id: 'floricultura-botanico-rosa',
    name: 'Verde Botânico & Rosa Chá Delicado',
    segmentId: 'floricultura',
    colorFamily: 'verde',
    shade: 'botânico',
    style: ['jardim', 'romântico', 'delicado'],
    mode: 'light',
    base: { primary: '#0e5428', secondary: '#0d3b1e', accent: '#db2777', bg: '#e9ebf9', surface: '#ffffff' },
  },
  {
    id: 'floricultura-terracota-musgo',
    name: 'Vaso Terracota & Verde Musgo',
    segmentId: 'floricultura',
    colorFamily: 'laranja',
    shade: 'vaso-argila',
    style: ['plantas', 'suculentas', 'terra'],
    mode: 'light',
    base: { primary: '#aa490b', secondary: '#83380f', accent: '#15803d', bg: '#f9e9ea', surface: '#ffffff' },
  },
  {
    id: 'floricultura-lilas-linho',
    name: 'Lilás Floral & Branco Linho',
    segmentId: 'floricultura',
    colorFamily: 'roxo',
    shade: 'orquídea-clara',
    style: ['flores nobres', 'presentes', 'afeto'],
    mode: 'light',
    base: { primary: '#7c3aed', secondary: '#6d28d9', accent: '#15803d', bg: '#f5e5e7', surface: '#ffffff' },
  },
  {
    id: 'floricultura-dark-estufa',
    name: 'Estufa Tropical Noturna',
    segmentId: 'floricultura',
    colorFamily: 'verde',
    shade: 'verde-selva',
    style: ['escuro', 'botânica exuberante', 'natural'],
    mode: 'dark',
    base: { primary: '#4ade80', secondary: '#22c55e', accent: '#f472b6', bg: '#1d3409', surface: '#131e15' },
  },
  {
    id: 'floricultura-dark-rosa-negra',
    name: 'Rosa Negra Bouquet Dark',
    segmentId: 'floricultura',
    colorFamily: 'rosa',
    shade: 'rosa-aveludada',
    style: ['escuro', 'mistério', 'exótico'],
    mode: 'dark',
    base: { primary: '#f472b6', secondary: '#ec4899', accent: '#a3e635', bg: '#0e090a', surface: '#191114' },
  },
  {
    id: 'floricultura-dark-orquidario',
    name: 'Orquidário da Meia-Noite',
    segmentId: 'floricultura',
    colorFamily: 'roxo',
    shade: 'violeta-floresta',
    style: ['escuro', 'sofisticado', 'especies raras'],
    mode: 'dark',
    base: { primary: '#c084fc', secondary: '#a855f7', accent: '#4ade80', bg: '#2b162d', surface: '#191124' },
  },

  // --- BARBEARIA CLÁSSICA ---
  {
    id: 'barbearia-preto-aco',
    name: 'Preto Fosco & Lâmina de Aço',
    segmentId: 'barbearia',
    colorFamily: 'neutros',
    shade: 'aço-escovado',
    style: ['navalha', 'masculino', 'moderno'],
    mode: 'light',
    base: { primary: '#54545f', secondary: '#64646c', accent: '#0284c7', bg: '#f8f8f9', surface: '#ffffff' },
  },
  {
    id: 'barbearia-mogno-dourado',
    name: 'Mogno Vintage & Dourado Clássico',
    segmentId: 'barbearia',
    colorFamily: 'marrom',
    shade: 'mogno',
    style: ['barbearia raiz', 'vintage', 'tradicional'],
    mode: 'light',
    base: { primary: '#6b482b', secondary: '#5c3e25', accent: '#ca8a04', bg: '#f8e9f9', surface: '#ffffff' },
  },
  {
    id: 'barbearia-marinho-conhaque',
    name: 'Azul Marinho Navalha & Couro Conhaque',
    segmentId: 'barbearia',
    colorFamily: 'azul',
    shade: 'azul-marinho-barber',
    style: ['cavalheiros', 'sofisticado', 'barba'],
    mode: 'light',
    base: { primary: '#02486f', secondary: '#043955', accent: '#b45309', bg: '#e9f3f9', surface: '#ffffff' },
  },
  {
    id: 'barbearia-dark-gentleman',
    name: 'Gentleman Club Barbershop Dark',
    segmentId: 'barbearia',
    colorFamily: 'amarelo',
    shade: 'conhaque-ouro',
    style: ['escuro', 'whisky', 'exclusivo'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#f97316', bg: '#0c0e16', surface: '#18181b' },
  },
  {
    id: 'barbearia-dark-poste',
    name: 'Barber Pole Red & Blue Dark',
    segmentId: 'barbearia',
    colorFamily: 'vermelho',
    shade: 'vermelho-barber',
    style: ['escuro', 'tradição mundial', 'estilo'],
    mode: 'dark',
    base: { primary: '#ef4444', secondary: '#dc2626', accent: '#38bdf8', bg: '#211e0d', surface: '#161e2e' },
  },
  {
    id: 'barbearia-dark-navalha',
    name: 'Lâmina Fina Noturna Dark',
    segmentId: 'barbearia',
    colorFamily: 'neutros',
    shade: 'grafite-navalha',
    style: ['escuro', 'corte perfeito', 'preciso'],
    mode: 'dark',
    base: { primary: '#898995', secondary: '#9e9ea8', accent: '#eab308', bg: '#0b0b0e', surface: '#161821' },
  },

  // --- SALÃO DE BELEZA & ESTÉTICA ---
  {
    id: 'salao-champanhe-preto',
    name: 'Champanhe Dourado & Preto Piano',
    segmentId: 'salao',
    colorFamily: 'amarelo',
    shade: 'champanhe',
    style: ['alta estética', 'glamour', 'luxo'],
    mode: 'light',
    base: { primary: '#876306', secondary: '#986803', accent: '#18181b', bg: '#e9f9ed', surface: '#ffffff' },
  },
  {
    id: 'salao-blush-cobre',
    name: 'Rosa Blush & Cobre Acetinado',
    segmentId: 'salao',
    colorFamily: 'rosa',
    shade: 'rosa-blush',
    style: ['spa', 'bem-estar', 'suavidade'],
    mode: 'light',
    base: { primary: '#db2777', secondary: '#be185d', accent: '#ea580c', bg: '#eae9f9', surface: '#ffffff' },
  },
  {
    id: 'salao-esmeralda-ouro',
    name: 'Esmeralda Joia & Ouro Suave',
    segmentId: 'salao',
    colorFamily: 'verde',
    shade: 'esmeralda',
    style: ['sofisticado', 'cabelos nobres', 'beleza'],
    mode: 'light',
    base: { primary: '#036546', secondary: '#024733', accent: '#ca8a04', bg: '#eaf3f0', surface: '#ffffff' },
  },
  {
    id: 'salao-dark-coiffeur',
    name: 'Haute Coiffure VIP Dark',
    segmentId: 'salao',
    colorFamily: 'rosa',
    shade: 'ouro-rosê-dark',
    style: ['escuro', 'celebridades', 'elegância'],
    mode: 'dark',
    base: { primary: '#f472b6', secondary: '#ec4899', accent: '#fde047', bg: '#34090e', surface: '#191114' },
  },
  {
    id: 'salao-dark-esmeralda',
    name: 'Esmeralda Noite Beauty Dark',
    segmentId: 'salao',
    colorFamily: 'verde',
    shade: 'esmeralda-profunda',
    style: ['escuro', 'alta classe', 'brilho'],
    mode: 'dark',
    base: { primary: '#34d399', secondary: '#10b981', accent: '#fbbf24', bg: '#08141f', surface: '#131e17' },
  },
  {
    id: 'salao-dark-espelho',
    name: 'Espelho Iluminado Camarim Dark',
    segmentId: 'salao',
    colorFamily: 'amarelo',
    shade: 'luz-camarim',
    style: ['escuro', 'produção de moda', 'impecável'],
    mode: 'dark',
    base: { primary: '#facc15', secondary: '#eab308', accent: '#f472b6', bg: '#080c1f', surface: '#18181b' },
  },
];
