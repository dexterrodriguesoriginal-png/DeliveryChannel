// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreVersionUpdatePrompt } from '../StoreVersionUpdatePrompt';
import { JUST_INSTALLED_TTL_MS, recordJustInstalled } from '../../../lib/pwa/appIdentity';
import { isSnoozed, readUpdateSnooze, shouldShowStoreUpdatePrompt, UPDATE_PROMPT_SNOOZE_MS, updatePromptKey } from '../../../lib/pwa/storeUpdatePrompt';

const props = {
  slug: 'loja', currentIdentity: 'bbbbbbbbbb', runningIdentity: 'aaaaaaaaaa',
  standalone: true, previewMode: false, search: '?source=pwa', reloadUnsafe: false, navTab: 'home',
};
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T12:00:00Z')); });
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });
describe('aviso de nova versão', () => {
  it('mostra no app antigo e legado, nunca no atual ou durante fluxos protegidos', () => {
    const base = { ...props, now: Date.now(), justInstalled: null, snoozeUntil: 0 };
    expect(shouldShowStoreUpdatePrompt(base)).toBe(true);
    expect(shouldShowStoreUpdatePrompt({ ...base, runningIdentity: null })).toBe(true);
    expect(shouldShowStoreUpdatePrompt({ ...base, runningIdentity: props.currentIdentity })).toBe(false);
    expect(shouldShowStoreUpdatePrompt({ ...base, standalone: false })).toBe(false);
    expect(shouldShowStoreUpdatePrompt({ ...base, previewMode: true })).toBe(false);
    expect(shouldShowStoreUpdatePrompt({ ...base, reloadUnsafe: true })).toBe(false);
    for (const navTab of ['cart', 'orders', 'profile', 'search', 'offers']) {
      expect(shouldShowStoreUpdatePrompt({ ...base, navTab })).toBe(false);
    }
    for (const search of ['?mesa=1', '?preview=1', '?atualizar=1', '?instalar=1', '?reinstall=1']) {
      expect(shouldShowStoreUpdatePrompt({ ...base, search })).toBe(false);
    }
  });
  it('aguarda TTL da instalação recente e reavalia sozinho', () => {
    recordJustInstalled(props.slug, props.runningIdentity, localStorage, Date.now());
    const ui = render(<StoreVersionUpdatePrompt {...props} />);
    expect(ui.queryByTestId('store-version-update-prompt')).toBeNull();
    act(() => { vi.advanceTimersByTime(JUST_INSTALLED_TTL_MS); });
    expect(ui.getByTestId('store-version-update-prompt')).toBeTruthy();
  });
  it('X persiste quatro minutos, inclusive após remontar; não interrompe checkout', () => {
    const navigate = vi.fn();
    const ui = render(<StoreVersionUpdatePrompt {...props} navigate={navigate} />);
    const banner = ui.getByTestId('store-version-update-prompt');
    expect(banner.className).toContain('z-[35]');
    expect(banner.getAttribute('style')).toContain('background-color: var(--dc-bg-card-color)');
    fireEvent.click(ui.getByRole('button', { name: 'Fechar aviso de atualização' }));
    const until = Date.now() + 240_000;
    expect(UPDATE_PROMPT_SNOOZE_MS).toBe(240_000);
    expect(localStorage.getItem(updatePromptKey(props.slug, props.currentIdentity))).toBe(String(until));
    expect(isSnoozed(readUpdateSnooze(localStorage, props.slug, props.currentIdentity), Date.now())).toBe(true);
    expect(readUpdateSnooze(localStorage, props.slug, 'cccccccccc')).toBe(0);
    expect(readUpdateSnooze(localStorage, 'outra', props.currentIdentity)).toBe(0);
    expect(ui.queryByTestId('store-version-update-prompt')).toBeNull();
    ui.unmount();
    const next = render(<StoreVersionUpdatePrompt {...props} navigate={navigate} />);
    act(() => { vi.advanceTimersByTime(239_999); });
    expect(next.queryByTestId('store-version-update-prompt')).toBeNull();
    next.rerender(<StoreVersionUpdatePrompt {...props} reloadUnsafe navigate={navigate} />);
    act(() => { vi.advanceTimersByTime(1); });
    expect(next.queryByTestId('store-version-update-prompt')).toBeNull();
    next.rerender(<StoreVersionUpdatePrompt {...props} navigate={navigate} />);
    expect(next.getByTestId('store-version-update-prompt')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(next.getByRole('button', { name: 'Baixar nova versão' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/app/loja~bbbbbbbbbb/?atualizar=1');
  });
});
