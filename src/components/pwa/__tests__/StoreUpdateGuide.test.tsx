// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreUpdateGuide, UPDATE_GUIDE_STEP_1_CHROME, UPDATE_GUIDE_STEP_1_TAB, UPDATE_GUIDE_STEP_2 } from '../StoreUpdateGuide';
import { captureInstallEvents, clearDeferredPrompt } from '../../../lib/pwa/installState';
import { isVisualUpdateSession } from '../../../lib/pwa/installSession';

beforeEach(() => {
  clearDeferredPrompt();
  window.history.replaceState(null, '', '/app/loja~0123456789/?atualizar=1');
});
afterEach(() => { cleanup(); clearDeferredPrompt(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('guia opcional de atualização na loja', () => {
  it('não aparece fora da sessão ?atualizar=1', () => {
    expect(isVisualUpdateSession('?atualizar=1')).toBe(true);
    expect(isVisualUpdateSession('?instalar=1')).toBe(false);
    expect(isVisualUpdateSession('')).toBe(false);
    window.history.replaceState(null, '', '/app/loja~0123456789/');
    const ui = render(<StoreUpdateGuide slug="loja" currentIdentity="0123456789" />);
    expect(ui.queryByTestId('store-update-open-guide')).toBeNull();
  });
  it('permite comprar normalmente, abre e fecha modal por botão, Escape ou fundo', () => {
    const ui = render(<div><button type="button">Adicionar produto</button>
      <StoreUpdateGuide slug="loja" currentIdentity="0123456789" /></div>);
    expect(ui.getByRole('button', { name: 'Adicionar produto' })).toBeTruthy();
    expect(ui.queryByTestId('store-update-guide')).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(ui.getByRole('dialog', { name: 'Como atualizar o aplicativo' })).toBeTruthy();
    expect(ui.getByText(UPDATE_GUIDE_STEP_2)).toBeTruthy();
    expect(ui.getByText(/Criar atalho/)).toBeTruthy();
    expect(ui.getByText('Instalar', { selector: 'strong' })).toBeTruthy();
    const arrow = ui.getByTestId('store-update-arrow');
    expect(arrow.getAttribute('class')).toContain('motion-reduce:animate-none');
    expect(ui.queryByTestId('store-update-native-install')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ui.queryByTestId('store-update-guide')).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    fireEvent.mouseDown(ui.getByTestId('store-update-guide-backdrop'));
    expect(ui.queryByTestId('store-update-guide')).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    fireEvent.click(ui.getByRole('button', { name: 'Fechar guia' }));
    expect(ui.queryByTestId('store-update-guide')).toBeNull();
  });
  it('mostra orientação para barra herdada da Custom Tab', () => {
    const native = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)', media: query,
    }) as MediaQueryList);
    const ui = render(<StoreUpdateGuide slug="loja" currentIdentity="0123456789" />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(ui.getByText(UPDATE_GUIDE_STEP_1_TAB)).toBeTruthy();
    expect(ui.queryByText(UPDATE_GUIDE_STEP_1_CHROME)).toBeNull();
    expect(native).toBeTruthy();
  });
  it('iOS mostra Safari/Compartilhar, copia URL limpa e não mostra menu ⋮ ou seta', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
      platform: 'iPhone', maxTouchPoints: 5, clipboard,
    });
    const ui = render(<StoreUpdateGuide slug="loja" currentIdentity="0123456789" />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    const guide = ui.getByTestId('store-update-guide');
    expect(guide.textContent).toContain('Safari');
    expect(guide.textContent).toContain('Compartilhar');
    expect(guide.textContent).toContain('Adicionar à Tela de Início');
    expect(guide.textContent).not.toMatch(/⋮|Abrir no Chrome|Criar atalho/i);
    expect(ui.queryByTestId('store-update-arrow')).toBeNull();
    expect(ui.queryByTestId('store-update-native-install')).toBeNull();
    await act(async () => {
      fireEvent.click(ui.getByRole('button', { name: 'Copiar link' }));
      await Promise.resolve();
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(window.location.origin + '/app/loja~0123456789/');
    expect(ui.getByRole('button', { name: 'Link copiado' })).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Fechar guia' })).toBeTruthy();
  });
  it('iPadOS identificado como MacIntel com toque recebe instruções Safari', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel', maxTouchPoints: 5,
    });
    const ui = render(<StoreUpdateGuide slug="loja" currentIdentity="0123456789" />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(ui.getByTestId('store-update-guide').textContent).toContain('Adicionar à Tela de Início');
    expect(ui.queryByTestId('store-update-arrow')).toBeNull();
  });

  it('exibe Instalar somente quando o navegador entrega beforeinstallprompt', async () => {
    captureInstallEvents(window);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    const ui = render(<StoreUpdateGuide slug="loja" currentIdentity="0123456789" />);
    fireEvent.click(ui.getByRole('button', { name: 'Atualizar' }));
    expect(ui.queryByTestId('store-update-native-install')).toBeNull();
    await act(async () => { window.dispatchEvent(event); });
    const install = ui.getByTestId('store-update-native-install');
    await act(async () => { fireEvent.click(install); await Promise.resolve(); await Promise.resolve(); });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
