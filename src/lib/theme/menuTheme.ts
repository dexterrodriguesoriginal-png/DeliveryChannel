import type { MenuTemplate, MenuTheme } from '../../types/menuTheme';

export const MENU_FONTS = ['Inter', 'Poppins', 'Montserrat', 'Roboto', 'Playfair Display', 'Outfit', 'Plus Jakarta Sans'] as const;
export const MENU_COLOR_KEYS = ['background', 'surface', 'text', 'accent', 'accentText', 'categoryActiveBg'] as const;
export type MenuColorKey = (typeof MENU_COLOR_KEYS)[number];
export const DEFAULT_MENU_THEME: Readonly<MenuTheme> = Object.freeze({
  background: '#FFF8F0', surface: '#FFFFFF', text: '#241B16', accent: '#C2410C',
  accentText: '#FFFFFF', categoryActiveBg: '#C2410C', fontFamily: 'Inter', radius: 20, layout: 'comfortable',
});

const preset = (id: string, name: string, description: string, patch: Partial<MenuTheme>): MenuTemplate => ({
  id, name, description, theme: { ...DEFAULT_MENU_THEME, ...patch },
});

/** Paletas diferentes entre si, com contraste AA nos textos da prévia. */
export const MENU_TEMPLATES: readonly MenuTemplate[] = [
  preset('brasa', 'Brasa', 'Acolhedor, com o sabor de casa.', {}),
  preset('oceano', 'Oceano', 'Azul intenso e um visual leve.', { background: '#EFF6FF', text: '#172554', accent: '#1D4ED8', categoryActiveBg: '#1D4ED8', fontFamily: 'Plus Jakarta Sans', radius: 16 }),
  preset('horta', 'Horta', 'Verde fresco, natural e convidativo.', { background: '#F0FDF4', text: '#14332A', accent: '#166534', categoryActiveBg: '#166534', fontFamily: 'Poppins', radius: 24 }),
  preset('amora', 'Amora', 'Roxo marcante para sair do comum.', { background: '#FAF5FF', text: '#3B0764', accent: '#7E22CE', categoryActiveBg: '#7E22CE', fontFamily: 'Outfit', radius: 20 }),
  preset('noturno', 'Noturno', 'Fundo escuro, amarelo em destaque.', { background: '#101113', surface: '#24252A', text: '#FAFAFA', accent: '#FACC15', accentText: '#18181B', categoryActiveBg: '#FACC15', fontFamily: 'Montserrat', radius: 12 }),
  preset('cereja', 'Cereja', 'Vermelho vibrante, presença imediata.', { background: '#FFF1F2', text: '#4C0519', accent: '#BE123C', categoryActiveBg: '#BE123C', fontFamily: 'Roboto', radius: 16 }),
  preset('cafe', 'Café', 'Elegância em tons de café e creme.', { background: '#F5F0E7', surface: '#FFFCF6', text: '#33251D', accent: '#69432B', categoryActiveBg: '#69432B', fontFamily: 'Playfair Display', radius: 8, layout: 'compact' }),
  preset('lagoa', 'Lagoa', 'Turquesa para um cardápio refrescante.', { background: '#F0FDFA', text: '#123D3B', accent: '#0F766E', categoryActiveBg: '#0F766E', fontFamily: 'Inter', radius: 28 }),
];

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);
export const isMenuColor = (raw: unknown): raw is string => typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw);
const isFont = (raw: unknown): raw is string => typeof raw === 'string' && MENU_FONTS.some(font => font === raw);
const isRadius = (raw: unknown): raw is number => typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 32;

/** Projeção pública explícita: descarta chaves desconhecidas e CSS arbitrário. */
export function normalizeMenuTheme(raw: unknown): MenuTheme {
  const source = isObject(raw) ? raw : {};
  const result: MenuTheme = { ...DEFAULT_MENU_THEME };
  for (const key of MENU_COLOR_KEYS) if (isMenuColor(source[key])) result[key] = source[key];
  if (isFont(source.fontFamily)) result.fontFamily = source.fontFamily;
  if (isRadius(source.radius)) result.radius = source.radius;
  if (source.layout === 'comfortable' || source.layout === 'compact') result.layout = source.layout;
  return result;
}

/** Escrita não transforma configurações inválidas em um sucesso aparente. */
export function isValidMenuTheme(raw: unknown): raw is MenuTheme {
  return isObject(raw) && Object.keys(raw).every(key => [...MENU_COLOR_KEYS, 'fontFamily', 'radius', 'layout'].includes(key))
    && MENU_COLOR_KEYS.every(key => isMenuColor(raw[key])) && isFont(raw.fontFamily) && isRadius(raw.radius)
    && (raw.layout === 'comfortable' || raw.layout === 'compact');
}

export function menuThemeContrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map(index => {
      const value = parseInt(color.slice(index, index + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  if (!isMenuColor(foreground) || !isMenuColor(background)) return 0;
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function menuThemeContrastIssues(theme: MenuTheme): string[] {
  return [
    [theme.text, theme.background, 'Texto sobre o fundo'],
    [theme.text, theme.surface, 'Texto nos cartões'],
    [theme.accentText, theme.accent, 'Texto dos botões'],
    [theme.accentText, theme.categoryActiveBg, 'Texto da categoria selecionada'],
  ].filter(([text, background]) => menuThemeContrast(text, background) < 4.5).map(([, , label]) => label);
}
