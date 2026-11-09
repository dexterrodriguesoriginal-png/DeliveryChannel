import { MENU_TEMPLATES } from '../theme/menuTheme';

export const TOTEM_COLOR_KEYS = [
  'pageBg', 'sidebarBg', 'sidebarCardBg', 'sidebarCardText',
  'sidebarCardActiveBg', 'sidebarCardActiveText', 'productCardBg', 'productCardText',
  'productPrice', 'addButtonBg', 'addButtonText', 'orderPanelBg', 'orderPanelText',
  'checkoutButtonBg', 'checkoutButtonText',
] as const;

export type TotemColorKey = (typeof TOTEM_COLOR_KEYS)[number];
export type TotemDesignColors = Record<TotemColorKey, string>;

export interface TotemDesign {
  preset: string;
  bannerRadius: number;
  colors: TotemDesignColors;
}

export const TOTEM_COLOR_LABELS: Record<TotemColorKey, string> = {
  pageBg: 'Fundo da página',
  sidebarBg: 'Fundo da lateral',
  sidebarCardBg: 'Cartão da lateral',
  sidebarCardText: 'Texto da lateral',
  sidebarCardActiveBg: 'Categoria ativa (fundo)',
  sidebarCardActiveText: 'Categoria ativa (texto)',
  productCardBg: 'Cartão do produto',
  productCardText: 'Texto do produto',
  productPrice: 'Preço',
  addButtonBg: 'Botão Adicionar (fundo)',
  addButtonText: 'Botão Adicionar (texto)',
  orderPanelBg: 'Painel do pedido',
  orderPanelText: 'Texto do pedido',
  checkoutButtonBg: 'Botão Finalizar (fundo)',
  checkoutButtonText: 'Botão Finalizar (texto)',
};

export const DEFAULT_TOTEM_DESIGN: Readonly<TotemDesign> = Object.freeze({
  preset: 'noturno',
  bannerRadius: 16,
  colors: Object.freeze({
    pageBg: '#0B0F14',
    sidebarBg: '#111827',
    sidebarCardBg: '#1F2937',
    sidebarCardText: '#E5E7EB',
    sidebarCardActiveBg: '#176444',
    sidebarCardActiveText: '#FFFFFF',
    productCardBg: '#111827',
    productCardText: '#F9FAFB',
    productPrice: '#6EE7B7',
    addButtonBg: '#176444',
    addButtonText: '#FFFFFF',
    orderPanelBg: '#111827',
    orderPanelText: '#F9FAFB',
    checkoutButtonBg: '#176444',
    checkoutButtonText: '#FFFFFF',
  }),
});

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);
export const isTotemHex = (raw: unknown): raw is string => typeof raw === 'string' && /^#[0-9A-Fa-f]{6}$/.test(raw);

function contrastText(bg: string): string {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#111827' : '#FFFFFF';
}

function fromMenuTemplate(id: string, name: string, description: string, background: string, surface: string, text: string, accent: string, accentText: string, radius: number): { id: string; name: string; description: string; design: TotemDesign } {
  const colors: TotemDesignColors = {
    pageBg: background,
    sidebarBg: background,
    sidebarCardBg: surface,
    sidebarCardText: text,
    sidebarCardActiveBg: accent,
    sidebarCardActiveText: accentText,
    productCardBg: surface,
    productCardText: text,
    productPrice: accent,
    addButtonBg: accent,
    addButtonText: accentText,
    orderPanelBg: surface,
    orderPanelText: text,
    checkoutButtonBg: accent,
    checkoutButtonText: accentText,
  };
  return { id, name, description, design: { preset: id, bannerRadius: Math.min(48, Math.max(0, radius)), colors } };
}

const baseFromMenu = MENU_TEMPLATES.map(t => fromMenuTemplate(
  t.id, t.name, t.description,
  t.theme.background, t.theme.surface, t.theme.text, t.theme.accent, t.theme.accentText, t.theme.radius,
));

/** Noturno do totem usa a paleta padrão salva no servidor (mais contraste no balcão). */
export const TOTEM_THEME_PRESETS: readonly { id: string; name: string; description: string; design: TotemDesign }[] = [
  { id: 'noturno', name: 'Noturno', description: 'Fundo escuro, verde do totem em destaque.', design: { ...DEFAULT_TOTEM_DESIGN, colors: { ...DEFAULT_TOTEM_DESIGN.colors } } },
  ...baseFromMenu.filter(t => t.id !== 'noturno'),
];

export function designFromPreset(id: string): TotemDesign {
  const found = TOTEM_THEME_PRESETS.find(t => t.id === id);
  const base = found ? found.design : DEFAULT_TOTEM_DESIGN;
  return { preset: base.preset, bannerRadius: base.bannerRadius, colors: { ...base.colors } };
}

export function normalizeTotemDesign(raw: unknown): TotemDesign {
  const source = isObject(raw) ? raw : {};
  const result = designFromPreset(typeof source.preset === 'string' ? source.preset : DEFAULT_TOTEM_DESIGN.preset);
  if (typeof source.preset === 'string' && /^[a-z0-9_-]{1,32}$/.test(source.preset)) result.preset = source.preset;
  if (typeof source.bannerRadius === 'number' && Number.isInteger(source.bannerRadius) && source.bannerRadius >= 0 && source.bannerRadius <= 48) {
    result.bannerRadius = source.bannerRadius;
  }
  const colors = (isObject(source.colors) ? source.colors : {}) as Record<string, unknown>;
  for (const key of TOTEM_COLOR_KEYS) {
    const value = colors[key];
    if (typeof value === 'string' && isTotemHex(value)) result.colors[key] = value;
  }
  return result;
}

export function isValidTotemDesign(raw: unknown): raw is TotemDesign {
  if (!isObject(raw)) return false;
  if (Object.keys(raw).some(key => !['preset', 'bannerRadius', 'colors'].includes(key))) return false;
  if (typeof raw.preset !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(raw.preset)) return false;
  if (typeof raw.bannerRadius !== 'number' || !Number.isInteger(raw.bannerRadius) || raw.bannerRadius < 0 || raw.bannerRadius > 48) return false;
  if (!isObject(raw.colors)) return false;
  const colorMap = raw.colors as Record<string, unknown>;
  const keys = Object.keys(colorMap);
  return keys.length === TOTEM_COLOR_KEYS.length && TOTEM_COLOR_KEYS.every(key => keys.includes(key) && isTotemHex(colorMap[key]));
}

export function totemDesignCssVars(design: TotemDesign): Record<string, string> {
  const c = design.colors;
  return {
    '--dc-kiosk-bg': c.pageBg,
    '--dc-kiosk-surface': c.productCardBg,
    '--dc-kiosk-text': c.productCardText,
    '--dc-kiosk-accent': c.addButtonBg,
    '--dc-kiosk-accent-text': c.addButtonText,
    '--dc-kiosk-category-active': c.sidebarCardActiveBg,
    '--dc-kiosk-radius': `${design.bannerRadius}px`,
    '--dc-totem-sidebar-bg': c.sidebarBg,
    '--dc-totem-sidebar-card-bg': c.sidebarCardBg,
    '--dc-totem-sidebar-card-text': c.sidebarCardText,
    '--dc-totem-sidebar-active-bg': c.sidebarCardActiveBg,
    '--dc-totem-sidebar-active-text': c.sidebarCardActiveText,
    '--dc-totem-price': c.productPrice,
    '--dc-totem-order-bg': c.orderPanelBg,
    '--dc-totem-order-text': c.orderPanelText,
    '--dc-totem-checkout-bg': c.checkoutButtonBg,
    '--dc-totem-checkout-text': c.checkoutButtonText,
  };
}

export function readableOn(bg: string): string {
  return isTotemHex(bg) ? contrastText(bg) : '#FFFFFF';
}
