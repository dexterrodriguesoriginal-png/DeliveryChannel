import { describe, expect, it } from 'vitest';
import { DEFAULT_MENU_THEME, MENU_TEMPLATES, isValidMenuTheme, menuThemeContrastIssues, normalizeMenuTheme } from '../menuTheme';
import { mapPublicStorePayload } from '../../../repositories/publicStoreMapper';
import { mapN6PublicStore } from '../../../repositories/publicStoreN6';

const payload = { tenant: { id: 'store-a', slug: 'loja', name: 'Loja' }, theme: { primary_color: '#123456', store_name: 'Minha marca' }, categories: [], products: [], offers: [], campaigns: [], promotionCarousels: [] };

describe('Design do Cardápio isolado e seguro', () => {
  it('oferece oito modelos com cores distintas e contraste AA', () => {
    expect(MENU_TEMPLATES).toHaveLength(8);
    expect(new Set(MENU_TEMPLATES.map(template => template.theme.accent)).size).toBe(8);
    for (const template of MENU_TEMPLATES) {
      expect(isValidMenuTheme(template.theme)).toBe(true);
      expect(menuThemeContrastIssues(template.theme)).toEqual([]);
    }
  });
  it.each([undefined, null, [], 'red'])('retorna padrão próprio para configuração ausente/inválida: %s', raw => {
    expect(normalizeMenuTheme(raw)).toEqual(DEFAULT_MENU_THEME);
    expect(normalizeMenuTheme(raw)).not.toBe(DEFAULT_MENU_THEME);
  });
  it('descarta chaves privadas e CSS/fontes arbitrários', () => {
    const projected = normalizeMenuTheme({ ...DEFAULT_MENU_THEME, accent: 'url(https://example.org)', fontFamily: 'Inter; background: red', radius: 100, email: 'cliente@example.org', apiKey: 'privado' });
    expect(projected).toEqual(DEFAULT_MENU_THEME);
    expect(projected).not.toHaveProperty('email');
    expect(projected).not.toHaveProperty('apiKey');
  });
  it.each([{ radius: -1 }, { radius: 2.5 }, { radius: 33 }, { layout: 'javascript' }, { accent: '#fff' }, { email: 'privado' }])('recusa escrita inválida: %j', patch => {
    expect(isValidMenuTheme({ ...DEFAULT_MENU_THEME, ...patch })).toBe(false);
  });
  it('avisa sobre contraste ruim antes de publicar', () => {
    expect(menuThemeContrastIssues({ ...DEFAULT_MENU_THEME, accentText: DEFAULT_MENU_THEME.accent })).toContain('Texto dos botões');
  });
  it.each(['legacy', 'n6'])('preserva o tema do app e demais campos no mapeador %s', mode => {
    const map = (raw: unknown) => mode === 'n6' ? mapN6PublicStore(raw, () => '', 0) : mapPublicStorePayload(raw, 0);
    const old = map(payload);
    const custom = MENU_TEMPLATES.find(template => template.id === 'noturno')!.theme;
    const next = map({ ...payload, menuTheme: custom });
    const { menuTheme: oldMenu, ...oldOther } = old;
    const { menuTheme: newMenu, ...newOther } = next;
    expect(oldOther).toEqual(newOther);
    expect(newMenu).toEqual(custom);
    expect(oldMenu).toEqual(DEFAULT_MENU_THEME);
    expect(newMenu?.accent).not.toBe(next.theme.primaryColor);
    expect(map({ ...payload, theme: { primary_color: '#ff0000' }, menuTheme: custom }).menuTheme).toEqual(custom);
  });
});
