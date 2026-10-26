/**
 * Catálogo Oficial dos 150 Modelos de Vitrine DeliveryChannel
 * Composto deterministicamente através dos 4 eixos do Sistema de Design:
 * Paleta (150 paletas homologadas) × Layout (10 variações) × Tipografia (8 pares) × Estilo de Componentes (6 acabamentos).
 *
 * 100% dos modelos possuem conformidade estrita com WCAG AA, tokens version: 1
 * e tamanho serializado estritamente inferior a 16 KB.
 */

import { BackgroundStyleConfig, StoreTemplate, ThemeTokens } from '../../../types/theme';
import { SEGMENTS } from './segments';
import {
  SEGMENT_PALETTES,
  buildPalette,
  ColorFamily,
  NamedPalette,
  hexToRgb,
  rgbToHsl,
  hslToHex,
  getLuminance,
} from './palettes';
import { STORE_LAYOUTS } from './layouts';
import { TYPE_PAIRS } from './typePairs';
import { COMPONENT_STYLES } from './componentStyles';

// ============================================================================
// MAPA DE SEGMENTOS E COORDENAÇÃO DOS EIXOS
// ============================================================================

const SEGMENT_LABEL_MAP: Record<string, string> = Object.fromEntries(
  SEGMENTS.map((s) => [s.id, s.label])
);

const GRADIENT_ANGLES = [160, 135, 180, 120, 200, 145];

/**
 * Fundo geral: modelos de índice 2 e 5 de cada segmento usam gradiente linear suave
 * (mesma família do fundo, contraste preservado); os demais, cor sólida.
 */
export function generalBackground(bg: string, mode: 'light' | 'dark', variantIndex: number): BackgroundStyleConfig {
  const base: BackgroundStyleConfig = { type: 'solid', color: bg, gradientStops: 2, positionX: 50, positionY: 50, zoom: 100 };
  if (variantIndex % 3 !== 2) return base;
  const { r, g, b } = hexToRgb(bg);
  const { h, s, l } = rgbToHsl(r, g, b);
  let end = bg;
  for (const d of [0.04, 0.03, 0.02, 0.012]) {
    const c = hslToHex(h + 18, Math.min(1, s + 0.1), mode === 'dark' ? l + d : l - d);
    const lum = getLuminance(c);
    if (mode === 'dark' ? lum < 0.12 : lum > 0.78) { end = c; break; }
  }
  if (end === bg) return base;
  return { ...base, type: 'gradient-linear', gradientColors: [bg, end], angle: GRADIENT_ANGLES[(variantIndex + bg.charCodeAt(2)) % GRADIENT_ANGLES.length] };
}

/**
 * Monta os tokens completos de um modelo a partir dos 4 eixos
 */
export function assembleTemplateTokens(
  palette: NamedPalette,
  variantIndex: number
): ThemeTokens {
  const p = buildPalette(palette.base, palette.mode);

  // Seleciona o layout baseado no segmento e no índice do modelo (0 a 5)
  // Garante diversidade visual rica em cada segmento
  const layoutIdx = (variantIndex * 2 + (palette.mode === 'dark' ? 1 : 0)) % STORE_LAYOUTS.length;
  const layout = STORE_LAYOUTS[layoutIdx].config;

  // Seleciona o par tipográfico apropriado
  const typeIdx = (variantIndex + (palette.segmentId.charCodeAt(0) % 3)) % TYPE_PAIRS.length;
  const typo = TYPE_PAIRS[typeIdx].config;

  // Seleciona o estilo de componentes (raio de borda e sombra)
  const compIdx = variantIndex % COMPONENT_STYLES.length;
  const comp = COMPONENT_STYLES[compIdx].config;

  return {
    version: 1,
    palette: p,
    backgrounds: {
      general: generalBackground(p.bgGeneral, palette.mode, variantIndex),
      header: {
        type: 'solid',
        color: p.bgHeader,
        gradientStops: 2,
        positionX: 50,
        positionY: 50,
        zoom: 100,
      },
      card: {
        type: 'solid',
        color: p.bgCard,
        gradientStops: 2,
        positionX: 50,
        positionY: 50,
        zoom: 100,
      },
    },
    typography: typo,
    components: comp,
    layout,
    meta: {
      templateId: palette.id,
    },
  };
}

/**
 * Constrói os 150 modelos oficiais deterministicamente
 */
export function buildTemplateCatalog(): StoreTemplate[] {
  // Acompanhamento do índice por segmento para distribuir eixos uniformemente
  const segmentCounters: Record<string, number> = {};

  return SEGMENT_PALETTES.map((pal) => {
    const sId = pal.segmentId;
    const vIdx = segmentCounters[sId] || 0;
    segmentCounters[sId] = vIdx + 1;

    const tokens = assembleTemplateTokens(pal, vIdx);

    return {
      id: pal.id,
      name: pal.name,
      segmentId: pal.segmentId,
      segmentLabel: SEGMENT_LABEL_MAP[pal.segmentId] || pal.segmentId,
      style: pal.style,
      mode: pal.mode,
      colorFamily: pal.colorFamily,
      shade: pal.shade,
      tokens,
    };
  });
}

// Catálogo exportado pronto para consumo
export const TEMPLATES: StoreTemplate[] = buildTemplateCatalog();

// ============================================================================
// CORES CANÔNICAS PARA VARIANTES RECOLORIDAS
// ============================================================================

export const CANONICAL_FAMILY_BASES: Record<ColorFamily, { primary: string; secondary: string; accent: string }> = {
  azul: { primary: '#0369a1', secondary: '#0284c7', accent: '#ea580c' },
  verde: { primary: '#15803d', secondary: '#166534', accent: '#ca8a04' },
  amarelo: { primary: '#ca8a04', secondary: '#a16207', accent: '#dc2626' },
  vermelho: { primary: '#dc2626', secondary: '#b91c1c', accent: '#f59e0b' },
  roxo: { primary: '#7c3aed', secondary: '#6d28d9', accent: '#ca8a04' },
  rosa: { primary: '#db2777', secondary: '#be185d', accent: '#ca8a04' },
  laranja: { primary: '#ea580c', secondary: '#c2410c', accent: '#eab308' },
  marrom: { primary: '#6b482b', secondary: '#5c3e25', accent: '#ca8a04' },
  neutros: { primary: '#27272a', secondary: '#3f3f46', accent: '#0284c7' },
};

/**
 * Cria uma variante recolorida deterministicamente para combinações não existentes
 */
export function createRecoloredTemplate(
  segmentId: string,
  colorFamily: ColorFamily,
  mode: 'light' | 'dark' = 'light',
  style?: string
): StoreTemplate {
  const segmentLabel = SEGMENT_LABEL_MAP[segmentId] || segmentId;
  const canonical = CANONICAL_FAMILY_BASES[colorFamily] || CANONICAL_FAMILY_BASES.azul;
  const id = `${segmentId}-recolor-${colorFamily}-${mode}${style ? `-style-${style}` : ''}`;

  const syntheticPalette: NamedPalette = {
    id,
    name: `${segmentLabel} (${colorFamily.charAt(0).toUpperCase() + colorFamily.slice(1)})`,
    segmentId,
    colorFamily,
    shade: `${colorFamily}-personalizado`,
    style: [style || 'personalizado', mode === 'dark' ? 'escuro' : 'claro', 'harmonioso'],
    mode,
    base: {
      primary: canonical.primary,
      secondary: canonical.secondary,
      accent: canonical.accent,
    },
  };

  const tokens = assembleTemplateTokens(syntheticPalette, 0);
  // A recolored result must honor the style filter as well as segment and color.
  const reference = style && (TEMPLATES.find(t => t.segmentId === segmentId && t.mode === mode && t.style.includes(style))
    || TEMPLATES.find(t => t.mode === mode && t.style.includes(style)));
  if (reference) {
    tokens.layout = { ...reference.tokens.layout! };
    tokens.typography = { ...reference.tokens.typography };
    tokens.components = { ...reference.tokens.components };
  }

  return {
    id,
    name: syntheticPalette.name,
    segmentId,
    segmentLabel,
    style: syntheticPalette.style,
    mode,
    colorFamily,
    shade: syntheticPalette.shade,
    tokens,
  };
}

// ============================================================================
// MOTOR DE FILTRAGEM COM VARIANTES INTELIGENTES
// ============================================================================

export interface TemplateFilterOptions {
  segment?: string;
  colorFamily?: string;
  style?: string;
  mode?: 'light' | 'dark';
  q?: string;
  search?: string;
}

/**
 * Filtra templates por múltiplos critérios com geração automática de variante recolorida
 * para qualquer combinação segmento × colorFamily que não exista nativamente.
 */
export function filterTemplates(options: TemplateFilterOptions = {}): StoreTemplate[] {
  const { segment, colorFamily, style, mode, q, search } = options;

  const normalizedSegment =
    segment && segment !== 'all' && segment !== 'Todos'
      ? segment.toLowerCase().trim()
      : undefined;

  const normalizedColorFamily =
    colorFamily && colorFamily !== 'all' && colorFamily !== 'Todas'
      ? (colorFamily.toLowerCase().trim() as ColorFamily)
      : undefined;

  const normalizedStyle = style ? style.toLowerCase().trim() : undefined;
  const rawQ = q || search;
  const normalizedQ = rawQ ? rawQ.toLowerCase().trim() : undefined;

  // Filtragem inicial dos 150 modelos nativos
  let results = TEMPLATES.filter((tpl) => {
    // 1. Segmento
    if (normalizedSegment) {
      const matchSegment =
        tpl.segmentId.toLowerCase() === normalizedSegment ||
        tpl.segmentLabel.toLowerCase() === normalizedSegment;
      if (!matchSegment) return false;
    }

    // 2. Família de cor
    if (normalizedColorFamily) {
      if (tpl.colorFamily.toLowerCase() !== normalizedColorFamily) return false;
    }

    // 3. Modo claro/escuro
    if (mode && tpl.mode !== mode) {
      return false;
    }

    // 4. Estilo
    if (normalizedStyle) {
      const hasStyle = tpl.style.some((s) => s.toLowerCase().includes(normalizedStyle));
      if (!hasStyle) return false;
    }

    // 5. Busca textual livre
    if (normalizedQ) {
      const match =
        tpl.name.toLowerCase().includes(normalizedQ) ||
        tpl.segmentLabel.toLowerCase().includes(normalizedQ) ||
        tpl.shade.toLowerCase().includes(normalizedQ) ||
        tpl.style.some((s) => s.toLowerCase().includes(normalizedQ));
      if (!match) return false;
    }

    return true;
  });

  // Requisito especial: Se houver filtro conjunto por segmento e colorFamily
  // e nenhuma combinação nativa existir, gera a variante recolorida determinística.
  if (results.length === 0 && normalizedSegment && normalizedColorFamily) {
    const validSegment = SEGMENTS.find(
      (s) => s.id.toLowerCase() === normalizedSegment || s.label.toLowerCase() === normalizedSegment
    );
    if (validSegment) {
      const lightVariant = createRecoloredTemplate(validSegment.id, normalizedColorFamily, 'light', normalizedStyle);
      const darkVariant = createRecoloredTemplate(validSegment.id, normalizedColorFamily, 'dark', normalizedStyle);

      if (!mode) {
        results = [lightVariant, darkVariant];
      } else if (mode === 'light') {
        results = [lightVariant];
      } else {
        results = [darkVariant];
      }
    }
  }

  return results;
}

/**
 * Obtém um modelo de vitrine pelo seu ID único
 */
export function getTemplateById(id: string): StoreTemplate | undefined {
  const native = TEMPLATES.find((t) => t.id === id);
  if (native) return native;
  const match = /^([a-z]+)-recolor-([a-z]+)-(light|dark)(?:-style-([a-z]+))?$/.exec(id);
  if (!match || !SEGMENT_LABEL_MAP[match[1]] || !Object.hasOwn(CANONICAL_FAMILY_BASES, match[2])) return undefined;
  return createRecoloredTemplate(match[1], match[2] as ColorFamily, match[3] as 'light' | 'dark', match[4]);
}
