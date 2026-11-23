// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { LogoConfirmation, LOGO_CHANGE_WARNING_TEXT } from '../tabs/LogoConfirmation';
import { ThemeEditorContext } from '../ThemeEditorContext';
import { useThemeDraft } from '../useThemeDraft';
import { useThemeControls } from '../useThemeControls';
import { DEFAULT_DELIVERY_CHANNEL_THEME } from '../../../../lib/theme/themeEngine';

const A = 'https://cdn/x/logo-a.png';
const B = 'https://cdn/x/logo-b.png';
let appIdentity: string | undefined;

beforeEach(() => {
  localStorage.clear();
  appIdentity = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => (appIdentity ? { version: 'v', appIdentity } : { version: 'v' }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness({ saved }: { saved: any }) {
  const draft = useThemeDraft(saved);
  const controls = useThemeControls(draft.draftTokens, draft.updateTokens);
  return (
    <ThemeEditorContext.Provider value={{ ...draft, ...controls, activeTenant: { id: 't1', slug: 'loja', theme: saved } as any }}>
      <LogoConfirmation />
      <button data-testid="set-b" onClick={() => draft.setDraftTheme((p) => ({ ...p, logoUrl: B }))}>b</button>
      <output data-testid="meta">{String(draft.draftTokens.meta?.logoConfirmedUrl ?? 'absent')}</output>
    </ThemeEditorContext.Provider>
  );
}
const base = { ...DEFAULT_DELIVERY_CHANNEL_THEME, storeName: 'Loja' };

describe('painel: confirmar logo definitiva', () => {
  it('sem logo: pede a logo definitiva', async () => {
    const ui = render(<Harness saved={{ ...base, logoUrl: '' }} />);
    expect(ui.getByTestId('logo-missing').textContent).toContain('Instalar app');
  });

  it('loja antiga com logo: já confirmada (lojas no ar não mudam)', () => {
    const ui = render(<Harness saved={{ ...base, logoUrl: A }} />);
    expect(ui.queryByTestId('logo-confirmed')).not.toBeNull();
    expect(ui.queryByTestId('logo-change-warning')).toBeNull();
  });

  it('trocou a logo: aviso uma vez + pede nova confirmação; confirmar grava no rascunho', async () => {
    appIdentity = 'abcdef0123';
    const ui = render(<Harness saved={{ ...base, logoUrl: A }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(ui.getByTestId('set-b'));
    const warn = ui.getByTestId('logo-change-warning');
    expect(warn.textContent!.trim()).toBe(`Você trocou a logo${LOGO_CHANGE_WARNING_TEXT}Entendi`);
    expect(LOGO_CHANGE_WARNING_TEXT).toBe('Sua nova logo já aparece dentro do app na hora e para todos os novos clientes. Clientes antigos verão um botão para atualizar o ícone da tela inicial.');
    expect(ui.queryByTestId('logo-unconfirmed')).not.toBeNull();
    fireEvent.click(ui.getByText('Entendi'));
    expect(ui.queryByTestId('logo-change-warning')).toBeNull();
    fireEvent.click(ui.getByTestId('logo-confirm'));
    expect(ui.getByTestId('meta').textContent).toBe(B);
    expect(ui.queryByTestId('logo-confirmed')).not.toBeNull();
    cleanup();
    // uma vez só para essa logo
    const again = render(<Harness saved={{ ...base, logoUrl: A }} />);
    fireEvent.click(again.getByTestId('set-b'));
    expect(again.queryByTestId('logo-change-warning')).toBeNull();
  });

  it('mesmo texto para lojas fora da lista de teste', async () => {
    const ui = render(<Harness saved={{ ...base, logoUrl: A }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(ui.getByTestId('set-b'));
    const warn = ui.getByTestId('logo-change-warning');
    expect(warn.textContent).toContain(LOGO_CHANGE_WARNING_TEXT);
  });
});
