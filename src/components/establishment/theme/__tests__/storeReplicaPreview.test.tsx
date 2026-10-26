// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { LiveStorePreview } from '../LiveStorePreview';
import {
  PREVIEW_READY_MSG, PREVIEW_THEME_MSG, isEmbeddedPreview, parsePreviewThemeMessage, previewUrl,
} from '../../../../lib/theme/previewBridge';
import { replicaScale, PHONE_W } from '../StoreReplicaPreview';

afterEach(cleanup);
const base = { storeName: 'Adega Show', primaryColor: '#15803d' } as any;

describe('Prévia = réplica do app real do cliente', () => {
  it('embute /app/<slug>?preview=1 numa moldura de celular 390 px com toggle mantido', () => {
    const ui = render(<LiveStorePreview theme={base} storeSlug="adegashow" />);
    const frame = ui.getByTestId('store-replica-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/app/adegashow?preview=1');
    expect(frame.style.width).toBe(`${PHONE_W}px`);
    expect(ui.getByTestId('preview-mode-mobile')).toBeTruthy();
    expect(ui.getByTestId('preview-mode-desktop')).toBeTruthy();
    expect(ui.queryByTestId('preview-general-surface')).toBeNull();
  });

  it('mudar a cor no editor reflete na prévia sem salvar (postMessage do rascunho)', () => {
    const ui = render(<LiveStorePreview theme={base} storeSlug="adegashow" />);
    const frame = ui.getByTestId('store-replica-frame') as HTMLIFrameElement;
    const post = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: post }, configurable: true });
    ui.rerender(<LiveStorePreview theme={{ ...base, primaryColor: '#be123c' }} storeSlug="adegashow" />);
    const last = post.mock.calls.at(-1)!;
    expect(last[0].type).toBe(PREVIEW_THEME_MSG);
    expect(last[0].theme.primaryColor).toBe('#be123c');
    expect(last[1]).toBe(window.location.origin);
    // o app avisa que está pronto -> recebe o rascunho atual de novo e aparece
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: PREVIEW_READY_MSG }, origin: window.location.origin, source: frame.contentWindow as any })); });
    expect(post.mock.calls.at(-1)![0].theme.primaryColor).toBe('#be123c');
    expect(ui.queryByTestId('replica-loading')).toBeNull();
  });

  it('sem slug cai na prévia ilustrativa (miniaturas)', () => {
    const ui = render(<LiveStorePreview theme={base} />);
    expect(ui.queryByTestId('store-replica-frame')).toBeNull();
    expect(ui.getByTestId('preview-general-surface')).toBeTruthy();
  });

  it('escala o celular para caber na coluna', () => {
    expect(replicaScale(195, 390)).toBe(0.5);
    expect(replicaScale(800, 390)).toBe(1);
  });
});

describe('Ponte da prévia: segurança', () => {
  const parent = {} as Window;
  const w = { location: { origin: 'https://dc.app', search: '?preview=1' }, parent } as any;
  it('só aceita tema da janela pai e da mesma origem', () => {
    const theme = { primaryColor: '#123456' };
    expect(parsePreviewThemeMessage({ origin: 'https://dc.app', source: parent as any, data: { type: PREVIEW_THEME_MSG, theme } }, w)).toEqual(theme);
    expect(parsePreviewThemeMessage({ origin: 'https://evil.com', source: parent as any, data: { type: PREVIEW_THEME_MSG, theme } }, w)).toBeNull();
    expect(parsePreviewThemeMessage({ origin: 'https://dc.app', source: {} as any, data: { type: PREVIEW_THEME_MSG, theme } }, w)).toBeNull();
    expect(parsePreviewThemeMessage({ origin: 'https://dc.app', source: parent as any, data: { type: 'x', theme } }, w)).toBeNull();
    expect(parsePreviewThemeMessage({ origin: 'https://dc.app', source: parent as any, data: { type: PREVIEW_THEME_MSG, theme: [1] } }, w)).toBeNull();
  });
  it('modo prévia só quando embutido e com ?preview=1', () => {
    expect(isEmbeddedPreview(w)).toBe(true);
    expect(isEmbeddedPreview({ ...w, location: { ...w.location, search: '' } })).toBe(false);
    const top: any = { location: { origin: 'x', search: '?preview=1' } }; top.parent = top;
    expect(isEmbeddedPreview(top)).toBe(false);
    expect(previewUrl('minha loja')).toBe('/app/minha%20loja?preview=1');
  });
});
