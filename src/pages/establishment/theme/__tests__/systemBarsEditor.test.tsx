// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SystemBarsCard } from '../tabs/SystemBarsCard';
import { ThemeEditorContext } from '../ThemeEditorContext';
import { useThemeDraft } from '../useThemeDraft';
import { useThemeControls } from '../useThemeControls';
import { MobileNavigation } from '../../../../components/layout/MobileNavigation';
import { PhonePreview } from '../../../../components/common/PhonePreview';
import { DEFAULT_DELIVERY_CHANNEL_THEME, themeToTokens, tokensToTheme } from '../../../../lib/theme/themeEngine';
import { systemBarsFromTokens } from '../../../../lib/pwa/systemBars';
import { appTabBarColor } from '../../../../lib/theme/appTabBar';

const themeFromTemplate = (t: (typeof TEMPLATES)[number]) => tokensToTheme({ ...t.tokens, meta: { ...(t.tokens.meta || {}), appTabBarColor: t.tokens.meta?.appTabBarColor ?? null } } as any, { storeName: 'Loja' });
import { applySystemBarMeta } from '../../../../lib/pwa/applyStoreIdentity';
import { TEMPLATES } from '../../../../lib/theme/templates';

afterEach(cleanup);
function Harness() {
  const draft = useThemeDraft({ ...DEFAULT_DELIVERY_CHANNEL_THEME, storeName: 'Loja' } as any);
  const [barsEnabled, setBarsEnabled] = React.useState({ status: false, nav: false });
  const controls = useThemeControls(draft.draftTokens, draft.updateTokens);
  return (
    <ThemeEditorContext.Provider value={{ ...draft, ...controls, barsEnabled, setBarsEnabled, activeTenant: { id: 't', slug: 's' } as any }}>
      <SystemBarsCard />
      <MobileNavigation type="customer" activeTab="home" onTabChange={() => {}} theme={draft.draftTheme} />
      <PhonePreview storeSlug="s" theme={draft.draftTheme} />
      <button data-testid="apply" onClick={() => draft.applyTemplate(TEMPLATES[3], barsEnabled)}>apply</button>
      <output data-testid="saved">{JSON.stringify(draft.draftTokens.meta?.systemBars ?? null)}</output>
    </ThemeEditorContext.Provider>
  );
}

describe('editor: cores das barras do celular', () => {
  it('edita as duas barras independentemente ao vivo e permite herdar o cabeçalho', () => {
    const ui = render(<Harness />);
    const tabs = ui.getByTestId('customer-bottom-nav');
    const before = tabs.style.backgroundColor;
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de navegação' }));
    fireEvent.click(ui.getByTestId('bar-nav-preset-preto'));
    expect(tabs.style.backgroundColor).toBe(before);
    fireEvent.click(ui.getByTestId('bar-icons-preset-dourado'));
    expect(tabs.style.backgroundColor).toBe('#d4a017');
    expect(ui.getByTestId('phone-nav-bar').style.backgroundColor).toBe('#0b0b0f');
    fireEvent.click(ui.getByTestId('bar-icons-auto'));
    expect(tabs.style.backgroundColor).toBe(before);
    expect(ui.getByTestId('phone-nav-bar').style.backgroundColor).toBe('#0b0b0f');
  });
  it('mostra o aviso do app instalado junto da cor da barra de navegação (sem dizer que a barra de ícones segue)', () => {
    const ui = render(<Harness />);
    const hint = ui.getByTestId('installed-app-bars-hint');
    expect(hint.textContent).toContain('Baixar nova versão');
    expect(hint.textContent).toContain('continuam comprando normalmente');
    expect(hint.textContent).toContain('24 a 72 horas');
    expect(hint.textContent).toContain('sem garantia');
    expect(hint.textContent).toContain('no fluxo versionado, pode ser necessário baixar a nova versão');
    expect(ui.getByTestId('system-bars-card').textContent).toContain('Cardápio, preços, banners e promoções atualizam na hora após salvar');
    const neutralTip = ui.getByTestId('neutral-nav-bars-tip');
    expect(neutralTip.textContent).toContain('branco, preto ou cinza neutro');
    expect(neutralTip.textContent).toContain('Black Friday');
    expect(neutralTip.textContent).toContain('não muda em tempo real');
    expect(ui.getByTestId('bar-nav-field').contains(neutralTip)).toBe(true);
    expect(ui.getByTestId('bar-status-field').contains(neutralTip)).toBe(false);
    expect(ui.getByTestId('system-bars-card').textContent).not.toMatch(/até 1 dia|Chrome atualiza o app/);
    expect(ui.getByTestId('system-bars-card').textContent).toContain('fica gravada na instalação');
    expect(ui.getByTestId('bar-nav-field').contains(hint)).toBe(true);
    expect(ui.getByTestId('bar-icons-auto').textContent).toBe('Usar cor do cabeçalho');
    expect(ui.getByTestId('system-bars-card').textContent).not.toMatch(/segue a cor da barra de navegação/);
  });
  it('atalho dourado muda a barra de status na prévia antes de salvar; nav é independente', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de status' }));
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de navegação' }));
    fireEvent.click(ui.getByTestId('bar-status-preset-dourado'));
    expect((ui.getByTestId('phone-status-bar') as HTMLElement).style.backgroundColor).toBe('#d4a017');
    fireEvent.click(ui.getByTestId('bar-nav-preset-preto'));
    expect((ui.getByTestId('phone-nav-bar') as HTMLElement).style.backgroundColor).toBe('#0b0b0f');
    expect(JSON.parse(ui.getByTestId('saved').textContent!)).toEqual({ statusBarColor: '#d4a017', navBarColor: '#0b0b0f' });
  });
  it('"Usar cor do cabeçalho" volta ao padrão e não deixa lixo no tema salvo', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de status' }));
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de navegação' }));
    fireEvent.click(ui.getByTestId('bar-status-preset-dourado'));
    fireEvent.click(ui.getByTestId('bar-status-auto'));
    expect(ui.getByTestId('saved').textContent).toBe('null');
  });
  it('"Usar este tema" aplica as barras habilitadas e ícones do tema', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de status' }));
    fireEvent.click(ui.getByRole('switch', { name: 'Habilitar barra de navegação' }));
    fireEvent.click(ui.getByTestId('bar-status-preset-dourado'));
    fireEvent.click(ui.getByTestId('bar-nav-preset-preto'));
    fireEvent.click(ui.getByTestId('bar-icons-preset-vermelho'));
    fireEvent.click(ui.getByTestId('apply'));
    const template = TEMPLATES[3];
    const expected = systemBarsFromTokens(template.tokens as any);
    expect(JSON.parse(ui.getByTestId('saved').textContent!)).toEqual({ statusBarColor: expected.status, navBarColor: expected.nav });
    expect((ui.getByTestId('phone-status-bar') as HTMLElement).style.backgroundColor).toBe(expected.status);
    expect((ui.getByTestId('phone-nav-bar') as HTMLElement).style.backgroundColor).toBe(expected.nav);
    expect(ui.getByTestId('customer-bottom-nav').style.backgroundColor).toBe(appTabBarColor(themeToTokens(themeFromTemplate(template))));
    expect(ui.getByTestId('customer-bottom-nav').style.backgroundColor).not.toBe('#b91c1c');
  });
  it('inicia protegido e mantém as barras na prévia ao aplicar modelo', () => {
    const ui = render(<Harness />);
    const status = ui.getByTestId('phone-status-bar').style.backgroundColor;
    const nav = ui.getByTestId('phone-nav-bar').style.backgroundColor;
    expect((ui.getByRole('switch', { name: 'Habilitar barra de status' }) as HTMLInputElement).checked).toBe(false);
    expect((ui.getByTestId('bar-nav-preset-preto') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ui.getByTestId('apply'));
    expect(ui.getByTestId('phone-status-bar').style.backgroundColor).toBe(status);
    expect(ui.getByTestId('phone-nav-bar').style.backgroundColor).toBe(nav);
  });
  it('meta theme-color e color-scheme são atualizados em tempo de execução', () => {
    applySystemBarMeta('#d4a017', 'dark');
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#d4a017');
    expect(document.head.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe('dark');
    applySystemBarMeta('#ffffff', 'light');
    expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
  });
});
