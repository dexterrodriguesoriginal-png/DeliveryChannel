// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('../../../../repositories/presentationRepository', () => ({ presentationRepository: m }));
import { PresentationScreenCard } from '../tabs/PresentationScreenCard';
import { ThemeEditorContext } from '../ThemeEditorContext';
import { PRESENTATION_PREVIEW_EVENT } from '../../../../lib/theme/previewBridge';

const renderCard = () => render(
  <ThemeEditorContext.Provider value={{ activeTenant: { id: 't1', slug: 'loja', name: 'Loja' }, draftTheme: { storeName: 'Loja', backgroundColor: '#fafafa', textColor: '#111111' }, draftTokens: undefined } as any}><PresentationScreenCard /></ThemeEditorContext.Provider>,
);
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('Aparência → Tela inicial personalizada', () => {
  it('sem tela: padrão do tema; "Ver abertura" pede a prévia do tema', async () => {
    m.get.mockResolvedValue(null);
    const seen = vi.fn();
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, (e) => seen((e as CustomEvent).detail));
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/padrão do tema/));
    expect(ui.queryByTestId('presentation-clear')).toBeNull();
    fireEvent.click(ui.getByTestId('presentation-preview'));
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ presentation: null }));
    // Nenhuma prévia do celular visível (painel no celular): a abertura toca aqui mesmo, com a #dc-boot antes.
    expect(ui.getByTestId('store-presentation-boot')).toBeTruthy();
  });
  it('com prévia do celular visível atendendo, não abre a tela cheia no painel', async () => {
    m.get.mockResolvedValue({ assetId: 'a1', mediaType: 'VIDEO', imageSeconds: 2.5, oncePerDay: false, enabled: true, url: 'https://cdn/v.mp4' });
    const handler = (e: Event) => { (e as CustomEvent).detail.handled = true; };
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, handler);
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/Vídeo da loja/));
    fireEvent.click(ui.getByTestId('presentation-preview'));
    expect(ui.queryByTestId('store-presentation-boot')).toBeNull();
    window.removeEventListener(PRESENTATION_PREVIEW_EVENT, handler);
  });
  it('envia, ajusta o tempo e o 1×/dia, e remove', async () => {
    m.get.mockResolvedValue(null);
    m.upload.mockResolvedValue({ assetId: 'a1', mediaType: 'IMAGE', imageSeconds: 2.5, oncePerDay: false, enabled: true, url: 'https://cdn/a.png' });
    const ui = renderCard();
    await waitFor(() => ui.getByTestId('presentation-upload'));
    const f = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(ui.getByTestId('presentation-file'), { target: { files: [f] } });
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/Imagem da loja/));
    expect(m.upload).toHaveBeenCalledWith('t1', f, { imageSeconds: 2.5, oncePerDay: false });
    fireEvent.change(ui.getByTestId('presentation-seconds'), { target: { value: '4' } });
    fireEvent.click(ui.getByTestId('presentation-once-per-day'));
    m.save.mockResolvedValue({ assetId: 'a1', mediaType: 'IMAGE', imageSeconds: 4, oncePerDay: true, enabled: true, url: 'https://cdn/a.png' });
    fireEvent.click(ui.getByTestId('presentation-save'));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith('t1', 'a1', { imageSeconds: 4, oncePerDay: true }, 'https://cdn/a.png'));
    m.clear.mockResolvedValue(undefined);
    fireEvent.click(ui.getByTestId('presentation-clear'));
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/padrão do tema/));
  });
  it('mostra o erro do servidor (ex.: sem permissão)', async () => {
    m.get.mockResolvedValue(null);
    m.upload.mockRejectedValue(new Error('só o dono ou gerente da loja altera a tela inicial.'));
    const ui = renderCard();
    await waitFor(() => ui.getByTestId('presentation-upload'));
    fireEvent.change(ui.getByTestId('presentation-file'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    await waitFor(() => expect(ui.getByTestId('presentation-error').textContent).toMatch(/dono ou gerente/));
  });
});
