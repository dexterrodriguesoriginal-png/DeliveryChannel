// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useThemeDraft } from '../useThemeDraft';
import { TEMPLATES } from '../../../../lib/theme/templates';
import { DEFAULT_DELIVERY_CHANNEL_THEME } from '../../../../lib/theme/themeEngine';
afterEach(cleanup);
const legacy = {
  ...DEFAULT_DELIVERY_CHANNEL_THEME,
  storeName: 'Minha loja',
  tagline: 'Meu slogan',
  logoUrl: '/logo.png',
  bannerUrl: '/capa.png',
};
describe('rascunho do tema', () => {
  it('abre temas antigos sem alterações e aplica o catálogo preservando identidade', () => {
    const { result } = renderHook(() => useThemeDraft(legacy));
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.applyTemplate(TEMPLATES[12]));
    expect(result.current.isDirty).toBe(true);
    expect(result.current.draftTokens.meta?.templateId).toBe(TEMPLATES[12].id);
    for (const key of ['storeName', 'tagline', 'logoUrl', 'bannerUrl'] as const)
      expect(result.current.draftTheme[key]).toBe(legacy[key]);
    expect(result.current.draftTokens.layout).toEqual(TEMPLATES[12].tokens.layout);
    act(() => result.current.undo());
    expect(result.current.draftTheme).toEqual(legacy);
    expect(result.current.isDirty).toBe(false);
  });
  it('personalizar não modifica o catálogo; cancelar restaura o salvo', () => {
    const before = JSON.stringify(TEMPLATES[0]);
    const { result } = renderHook(() => useThemeDraft(legacy));
    act(() => result.current.applyTemplate(TEMPLATES[0]));
    act(() =>
      result.current.updateTokens((t) => ({ ...t, palette: { ...t.palette, primary: '#123456' } }))
    );
    expect(JSON.stringify(TEMPLATES[0])).toBe(before);
    act(() => result.current.cancel());
    expect(result.current.draftTheme).toEqual(legacy);
    expect(result.current.canUndo).toBe(false);
  });
  it('salvar atualiza a base usada para cancelar alterações posteriores', () => {
    const { result } = renderHook(() => useThemeDraft(legacy));
    act(() => result.current.applyTemplate(TEMPLATES[0]));
    const saved = result.current.draftTheme;
    act(() => result.current.markSaved(saved, saved));
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.applyTemplate(TEMPLATES[1]));
    act(() => result.current.cancel());
    expect(result.current.draftTheme).toEqual(saved);
  });
});
