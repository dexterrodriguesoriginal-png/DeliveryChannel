export type HomeAction =
  | 'MENU'
  | 'TABLE'
  | 'PICKUP'
  | 'DELIVERY'
  | 'ACCOUNT'
  | 'WAITER'
  | 'BILL';

export interface StoreHomeDesign {
  version: 1;
  templateId: string;
  headerTitle: string;
  title: string;
  subtitle: string;
  tagline: string;
  footerTitle: string;
  backgroundMode: 'full' | 'sections';
  backgroundUrl: string;
  topBannerUrl: string;
  bottomBannerUrl: string;
  backgroundPositionY: number;
  overlayOpacity: number;
  backgroundBlur: number;
  logoSize: number;
  logoPosition: 'center' | 'left';
  showFooter: boolean;
  actions: HomeAction[];
}

export interface HomeTemplate {
  id: string;
  name: string;
  segment: string;
  topGradient: string;
  bottomGradient: string;
}

export const ALL_HOME_ACTIONS: HomeAction[] = [
  'MENU', 'TABLE', 'PICKUP', 'DELIVERY', 'ACCOUNT', 'WAITER', 'BILL',
];

/** Padrão adega escuro, próximo da referência ADEGASSHOW. */
export const DEFAULT_HOME_DESIGN: StoreHomeDesign = {
  version: 1,
  templateId: 'adega-noite',
  headerTitle: 'Bem-vindo(a)!',
  title: 'O que você deseja fazer hoje?',
  subtitle: '',
  tagline: '',
  footerTitle: 'OFERTAS ESPECIAIS',
  backgroundMode: 'full',
  backgroundUrl: '',
  topBannerUrl: '',
  bottomBannerUrl: '',
  backgroundPositionY: 40,
  overlayOpacity: 0.55,
  backgroundBlur: 2,
  logoSize: 96,
  logoPosition: 'center',
  showFooter: true,
  actions: ['MENU', 'TABLE', 'PICKUP', 'DELIVERY', 'ACCOUNT', 'WAITER'],
};

export const OFFICIAL_HOME_TEMPLATE: HomeTemplate = {
  id: 'dc-oficial',
  name: 'Padrão Delivery Channel',
  segment: 'TODOS',
  topGradient: 'linear-gradient(145deg, #072d22, #12553a)',
  bottomGradient: 'linear-gradient(130deg, #083322, #294e30)',
};

type TemplateRow = readonly [id: string, name: string, segment: string, top: string, highlight: string, bottom: string];

const TEMPLATE_ROWS: TemplateRow[] = [
  ['adega-noite', 'Adega Noite Premium', 'ADEGA', '#091c19', '#22513e', '#122921'],
  ['adega-jardim', 'Adega Jardim', 'ADEGA', '#173a25', '#4f7140', '#1a3322'],
  ['adega-vinho', 'Reserva de Vinhos', 'ADEGA', '#321323', '#733547', '#2b1522'],
  ['adega-gelo', 'Bar Gelado', 'ADEGA', '#102f43', '#25728d', '#092638'],
  ['adega-neon', 'Adega Neon', 'ADEGA', '#112b25', '#147a55', '#081d1d'],
  ['burger-fogo', 'Burger Fogo', 'HAMBURGUERIA', '#391711', '#a74f22', '#321a14'],
  ['burger-urbano', 'Burger Urbano', 'HAMBURGUERIA', '#16191e', '#51525a', '#292524'],
  ['burger-retro', 'Burger Retrô', 'HAMBURGUERIA', '#672f1d', '#b4763b', '#49291d'],
  ['burger-charcoal', 'Burger Charcoal', 'HAMBURGUERIA', '#141515', '#514033', '#29201b'],
  ['burger-dourado', 'Burger Dourado', 'HAMBURGUERIA', '#49321a', '#be872d', '#342619'],
  ['pizza-forno', 'Forno a Lenha', 'PIZZARIA', '#4a2118', '#a34c2a', '#38221a'],
  ['pizza-napoli', 'Napoli Premium', 'PIZZARIA', '#243322', '#637c4d', '#263a26'],
  ['pizza-italia', 'Tradição Italiana', 'PIZZARIA', '#24412c', '#9a3432', '#352b20'],
  ['pizza-familia', 'Pizza da Família', 'PIZZARIA', '#66301f', '#b46939', '#452419'],
  ['pizza-classica', 'Pizzaria Clássica', 'PIZZARIA', '#352720', '#806048', '#2b211d'],
  ['rest-bistro', 'Bistrô Elegante', 'RESTAURANTE', '#152a2b', '#426560', '#182628'],
  ['rest-fazenda', 'Sabores da Fazenda', 'RESTAURANTE', '#384026', '#817345', '#393321'],
  ['rest-luxo', 'Restaurante Luxo', 'RESTAURANTE', '#1d2028', '#5f604e', '#242327'],
  ['rest-brasa', 'Churrasco na Brasa', 'RESTAURANTE', '#3e211a', '#8f4225', '#281c19'],
  ['rest-moderno', 'Cozinha Moderna', 'RESTAURANTE', '#223b3d', '#3d7880', '#15292d'],
  ['merc-fresco', 'Mercado Fresco', 'MERCADO', '#25482c', '#6a9650', '#24402a'],
  ['merc-familia', 'Mercado da Família', 'MERCADO', '#2c4d5e', '#6697aa', '#253b4b'],
  ['merc-natural', 'Mercado Natural', 'MERCADO', '#39502a', '#8b9c4d', '#354126'],
  ['merc-moderno', 'Mercado Moderno', 'MERCADO', '#24354e', '#3f6da2', '#1e3046'],
  ['merc-popular', 'Mercado Popular', 'MERCADO', '#51431b', '#b2943d', '#37311a'],
  ['cafe-creme', 'Café Creme', 'CAFÉ E LANCHES', '#503728', '#a67b54', '#3f3028'],
  ['cafe-mocha', 'Mocha Premium', 'CAFÉ E LANCHES', '#30221e', '#78543d', '#291f1b'],
  ['lanche-pop', 'Lanchonete Pop', 'CAFÉ E LANCHES', '#423155', '#8b619d', '#35283e'],
  ['doceria-rosa', 'Doçura Rosa', 'CAFÉ E LANCHES', '#733a50', '#c47a92', '#563445'],
  ['acai-tropical', 'Açaí Tropical', 'CAFÉ E LANCHES', '#3d2258', '#8053a7', '#332042'],
];

export const HOME_TEMPLATES: HomeTemplate[] = TEMPLATE_ROWS.map(
  ([id, name, segment, top, highlight, bottom]) => ({
    id,
    name,
    segment,
    topGradient: `linear-gradient(145deg, ${top}, ${highlight})`,
    bottomGradient: `linear-gradient(135deg, ${bottom}, ${top})`,
  }),
);

/** Oficial + 30 segmentos — usado pelo editor. */
export const HOME_TEMPLATES_FOR_EDITOR: HomeTemplate[] = [
  OFFICIAL_HOME_TEMPLATE,
  ...HOME_TEMPLATES,
];

export function getHomeTemplate(id: string): HomeTemplate {
  return HOME_TEMPLATES.find(t => t.id === id) ?? OFFICIAL_HOME_TEMPLATE;
}

/** Aceita apenas https; rejeita javascript/data/http e URLs longas demais. */
export function safeHomeImageUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) return '';
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function boundedNumber(input: unknown, min: number, max: number, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  return Math.min(max, Math.max(min, input));
}

function boundedText(input: unknown, fallback: string, max: number): string {
  if (typeof input !== 'string') return fallback;
  return input.slice(0, max);
}

export function normalizeHomeDesign(input: unknown): StoreHomeDesign {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

  const actions = Array.isArray(raw.actions)
    ? raw.actions.filter((a): a is HomeAction => typeof a === 'string' && ALL_HOME_ACTIONS.includes(a as HomeAction))
    : DEFAULT_HOME_DESIGN.actions;

  const uniqueActions = [...new Set(actions)];
  if (!uniqueActions.includes('MENU')) uniqueActions.unshift('MENU');

  const templateId = boundedText(raw.templateId, DEFAULT_HOME_DESIGN.templateId, 100);

  return {
    version: 1,
    templateId: getHomeTemplate(templateId).id,
    headerTitle: boundedText(raw.headerTitle, DEFAULT_HOME_DESIGN.headerTitle, 80),
    title: boundedText(raw.title, DEFAULT_HOME_DESIGN.title, 100),
    subtitle: boundedText(raw.subtitle, DEFAULT_HOME_DESIGN.subtitle, 150),
    tagline: boundedText(raw.tagline, DEFAULT_HOME_DESIGN.tagline, 120),
    footerTitle: boundedText(raw.footerTitle, DEFAULT_HOME_DESIGN.footerTitle, 100),
    backgroundMode: raw.backgroundMode === 'sections' ? 'sections' : 'full',
    backgroundUrl: safeHomeImageUrl(raw.backgroundUrl),
    topBannerUrl: safeHomeImageUrl(raw.topBannerUrl),
    bottomBannerUrl: safeHomeImageUrl(raw.bottomBannerUrl),
    backgroundPositionY: boundedNumber(raw.backgroundPositionY, 0, 100, DEFAULT_HOME_DESIGN.backgroundPositionY),
    overlayOpacity: boundedNumber(raw.overlayOpacity, 0.2, 0.9, DEFAULT_HOME_DESIGN.overlayOpacity),
    backgroundBlur: boundedNumber(raw.backgroundBlur, 0, 20, DEFAULT_HOME_DESIGN.backgroundBlur),
    logoSize: boundedNumber(raw.logoSize, 56, 136, DEFAULT_HOME_DESIGN.logoSize),
    logoPosition: raw.logoPosition === 'left' ? 'left' : 'center',
    showFooter: raw.showFooter !== false,
    actions: uniqueActions,
  };
}
