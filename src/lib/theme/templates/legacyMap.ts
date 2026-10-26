/**
 * Mapeamento de Compatibilidade Retroativa (Legacy Map)
 * Mapeia os 40 IDs de temas legados para os novos 150 modelos do catálogo,
 * além de oferecer busca do modelo mais próximo por distância cromática.
 */

import { StoreTemplate, ThemeTokens } from '../../../types/theme';
import { TEMPLATES, getTemplateById } from './catalog';
import { hexToRgb } from './palettes';

/**
 * Tabela exata de mapeamento dos 40 presets legados para os novos modelos
 */
export const LEGACY_PRESET_TO_TEMPLATE: Record<string, string> = {
  'delivery-channel': 'mercado-verde-branco',
  'vermelho-classico': 'churrascaria-brasa-grafite',
  'laranja-fome': 'lanchonete-laranja-branco',
  'verde-fresco': 'saudavel-verde-cru',
  'azul-confianca': 'mercado-azul-laranja',
  'roxo-noturno': 'acai-dark-selva',
  'rosa-doce': 'doceria-rosa-baunilha',
  'preto-premium': 'adega-dark-safra-real',
  'dourado-gourmet': 'churrascaria-dark-picanha',
  'cafe': 'cafeteria-cafe-leite',
  'pizzaria-italiana': 'pizzaria-tomate-manjericao',
  'hamburgueria': 'hamburgueria-carvao-mostarda',
  'acai': 'acai-roxo-creme',
  'sushi': 'japonesa-preto-vermelho',
  'padaria': 'padaria-trigo-creme',
  'adega-vinho': 'adega-bordo-creme',
  'mercado': 'mercado-verde-branco',
  'barbearia': 'barbearia-preto-aco',
  'salao-beleza': 'salao-blush-cobre',
  'saude-clinica': 'farmacia-azul-turquesa',
  'pet-shop': 'pet-celeste-patinha',
  'perfumaria-glam': 'perfumaria-rosa-ouro',
  'tabacaria-lounge': 'tabacaria-dark-lounge',
  'doceria-artesanal': 'doceria-framboesa-creme',
  'churrasco-espetinho': 'churrascaria-terracota-preto',
  'hot-dog-express': 'lanchonete-mostarda-ketchup',
  'saudavel-fit': 'saudavel-dark-fit',
  'dark-premium-black': 'barbearia-preto-aco',
  'minimal-clean': 'japonesa-grafite-bambu',
  'pizzaria-napolitana': 'pizzaria-terracota-creme',
  'padaria-artesanal': 'padaria-caramelo-cafe',
  'barbearia-vintage': 'barbearia-mogno-dourado',
  'salao-spa': 'salao-esmeralda-ouro',
  'mercado-hortifruti': 'mercado-verde-amarelo',
  'acai-tropical': 'acai-ameixa-lima',
  'hamburgueria-smash': 'hamburgueria-dark-smash',
  'japonesa-omakase': 'japonesa-dark-omakase',
  'adega-malbec': 'adega-dark-veludo',
  'farmacia-vida': 'farmacia-verde-branco',
  'veterinaria-care': 'pet-violeta-amarelo',
};

/**
 * Calcula distância euclidiana de cor RGB ponderada
 */
function colorDistance(c1: string, c2: string): number {
  const rgb1 = hexToRgb(c1);
  const rgb2 = hexToRgb(c2);
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
}

export interface ClosestTemplateInput {
  templateId?: string;
  presetId?: string;
  customColor?: string;
  meta?: {
    templateId?: string;
    legacyPresetId?: string;
  };
  palette?: {
    primary?: string;
    bgGeneral?: string;
  };
}

/**
 * Localiza o template correspondente mais próximo
 */
export function findClosestTemplate(
  tokens?: ClosestTemplateInput | Partial<ThemeTokens> | null
): StoreTemplate {
  if (!tokens) {
    return TEMPLATES[0];
  }

  const input = tokens as ClosestTemplateInput;

  // 1. Caso haja templateId direto ou no metadados
  const targetTemplateId = input.templateId || input.meta?.templateId;
  if (targetTemplateId) {
    const directMatch = getTemplateById(targetTemplateId);
    if (directMatch) return directMatch;
  }

  // 2. Caso haja preset legado direto ou no metadados
  const targetPresetId = input.presetId || input.meta?.legacyPresetId;
  if (targetPresetId) {
    const mappedId = LEGACY_PRESET_TO_TEMPLATE[targetPresetId];
    if (mappedId) {
      const match = TEMPLATES.find((t) => t.id === mappedId);
      if (match) return match;
    }
  }

  // 3. Proximidade cromática pela cor primária (ou customColor) e fundo
  const targetPrimary = input.customColor || input.palette?.primary || '#15803d';
  const targetBg = input.palette?.bgGeneral || '#f8fafc';

  let closest = TEMPLATES[0];
  let minDiff = Number.MAX_VALUE;

  for (const tpl of TEMPLATES) {
    const primaryDiff = colorDistance(targetPrimary, tpl.tokens.palette.primary);
    const bgDiff = colorDistance(targetBg, tpl.tokens.palette.bgGeneral);
    const totalDiff = primaryDiff * 1.5 + bgDiff;

    if (totalDiff < minDiff) {
      minDiff = totalDiff;
      closest = tpl;
    }
  }

  return closest;
}
