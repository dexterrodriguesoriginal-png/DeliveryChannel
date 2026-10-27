// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SystemBarsCard } from '../tabs/SystemBarsCard';
import { ThemeEditorContext } from '../ThemeEditorContext';
import { useThemeDraft } from '../useThemeDraft';
import { useThemeControls } from '../useThemeControls';
import { PhonePreview } from '../../../../components/common/PhonePreview';
import { DEFAULT_DELIVERY_CHANNEL_THEME } from '../../../../lib/theme/themeEngine';
import { applySystemBarMeta } from '../../../../lib/pwa/applyStoreIdentity';
import { TEMPLATES } from '../../../../lib/theme/templates';

afterEach(cleanup);
function Harness() {
  const draft = useThemeDraft({ ...DEFAULT_DELIVERY_CHANNEL_THEME, storeName: 'Loja' } as any);
  const controls = useThemeControls(draft.draftTokens, draft.updateTokens);
  return (
    <ThemeEditorContext.Provider value={{ ...draft, ...controls, activeTenant: { id: 't', slug: 's' } as any }}>
      <SystemBarsCard />
      <PhonePreview storeSlug="s" theme={draft.draftTheme} />
      <button data-testid="apply" onClick={() => draft.applyTemplate(TEMPLATES[3])}>apply</button>
      <output data-testid="saved">{JSON.stringify(draft.draftTokens.meta?.systemBars ?? null)}</output>
    </ThemeEditorContext.Provider>
  );
}

describe('editor: cores das barras do celular', () => {
  it('atalho dourado muda a barra de status na prévia antes de salvar; nav é independente', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByTestId('bar-status-preset-dourado'));
    expect((ui.getByTestId('phone-status-bar') as HTMLElement).style.backgroundColor).toBe('#d4a017');
    fireEvent.click(ui.getByTestId('bar-nav-preset-preto'));
    expect((ui.getByTestId('phone-nav-bar') as HTMLElement).style.backgroundColor).toBe('#0b0b0f');
    expect(JSON.parse(ui.getByTestId('saved').textContent!)).toEqual({ statusBarColor: '#d4a017', navBarColor: '#0b0b0f' });
  });
  it('"Usar cor do cabeçalho" volta ao padrão e não deixa lixo no tema salvo', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByTestId('bar-status-preset-dourado'));
    fireEvent.click(ui.getByTestId('bar-status-auto'));
    expect(ui.getByTestId('saved').textContent).toBe('null');
  });
  it('trocar de modelo preserva as cores de barra escolhidas pela loja', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByTestId('bar-status-preset-dourado'));
    fireEvent.click(ui.getByTestId('apply'));
    expect(JSON.parse(ui.getByTestId('saved').textContent!).statusBarColor).toBe('#d4a017');
  });
  it('meta theme-color e color-scheme são atualizados em tempo de execução', () => {
    applySystemBarMeta('#d4a017', 'dark');
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#d4a017');
    expect(document.head.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark');
    applySystemBarMeta('#ffffff', 'light');
    expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
  });
});
