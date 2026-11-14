import type { TenantTheme } from '../../types';
import type { ThemeTokens } from '../../types/theme';
import type { MenuTheme } from '../../types/menuTheme';
import { normalizeMenuTheme, menuThemeContrast, DEFAULT_MENU_THEME, MENU_FONTS } from './menuTheme';
import { themeToTokens } from './themeEngine';
import { normalizeTotemDesign, type TotemDesign } from '../menu/totemDesign';

/** Derive an accessible foreground from the owner's color, retaining its hue. */
export function channelText(color: string, backgrounds: string[]): string {
  if (backgrounds.every(bg => menuThemeContrast(color, bg) >= 4.5)) return color;
  const endpoints = ['#000000', '#ffffff'];
  const target = endpoints.sort((a, b) => Math.min(...backgrounds.map(bg => menuThemeContrast(b, bg))) - Math.min(...backgrounds.map(bg => menuThemeContrast(a, bg))))[0];
  for (let step = 1; step <= 100; step++) {
    const mixed = '#' + [1, 3, 5].map(i => Math.round(parseInt(color.slice(i, i + 2), 16) * (1 - step / 100) + parseInt(target.slice(i, i + 2), 16) * step / 100).toString(16).padStart(2, '0')).join('');
    if (backgrounds.every(bg => menuThemeContrast(mixed, bg) >= 4.5)) return mixed;
  }
  return target;
}

export function menuFromTokens(tokens: ThemeTokens): MenuTheme {
  const p = tokens.palette;
  // One text token serves both surfaces; harmonize only if no AA foreground exists.
  const background = p.bgGeneral;
  const surface = ['#000000', '#ffffff'].some(c => [background, p.bgCard].every(bg => menuThemeContrast(c, bg) >= 4.5)) ? p.bgCard : background;
  const accent = channelText(p.buttonBg, [background, surface]);
  return {
    background, surface, text: channelText(p.textMain, [background, surface]),
    accent, accentText: channelText(p.buttonText, [accent]), categoryActiveBg: accent,
    fontFamily: MENU_FONTS.includes(tokens.typography.fontFamily as typeof MENU_FONTS[number]) ? tokens.typography.fontFamily : DEFAULT_MENU_THEME.fontFamily,
    radius: Math.max(0, Math.min(32, tokens.components.borderRadiusPx ?? 20)),
    layout: tokens.layout?.density === 'compact' ? 'compact' : 'comfortable',
  };
}

export function totemFromTokens(tokens: ThemeTokens): TotemDesign {
  const m = menuFromTokens(tokens);
  return { preset: 'custom', fontFamily: m.fontFamily, bannerRadius: m.radius, colors: {
    pageBg: m.background, sidebarBg: m.background, sidebarCardBg: m.surface, sidebarCardText: m.text,
    sidebarCardActiveBg: m.accent, sidebarCardActiveText: m.accentText,
    productCardBg: m.surface, productCardText: m.text, productPrice: channelText(tokens.palette.price, [m.surface]),
    addButtonBg: m.accent, addButtonText: m.accentText, orderPanelBg: m.surface, orderPanelText: m.text,
    checkoutButtonBg: m.accent, checkoutButtonText: m.accentText,
  } };
}

export function resolveMenuTheme(raw: unknown, app: TenantTheme): MenuTheme {
  const saved = normalizeMenuTheme(raw);
  return saved.followApp ? { ...menuFromTokens(themeToTokens(app)), followApp: true, templateId: saved.templateId } : saved;
}
export function resolveTotemDesign(raw: unknown, app: TenantTheme): TotemDesign {
  const saved = normalizeTotemDesign(raw);
  return saved.followApp ? { ...totemFromTokens(themeToTokens(app)), followApp: true, templateId: saved.templateId } : saved;
}

export function menuFromTotem(design: TotemDesign): MenuTheme {
  const c = design.colors;
  return { background: c.pageBg, surface: c.productCardBg, text: c.productCardText,
    accent: c.addButtonBg, accentText: c.addButtonText, categoryActiveBg: c.sidebarCardActiveBg,
    fontFamily: design.fontFamily || DEFAULT_MENU_THEME.fontFamily, radius: Math.min(32, design.bannerRadius), layout: 'comfortable' };
}
