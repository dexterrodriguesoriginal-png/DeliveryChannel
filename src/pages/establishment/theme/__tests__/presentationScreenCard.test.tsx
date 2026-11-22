// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThemeEditorContext } from '../ThemeEditorContext';
import { PresentationScreenCard } from '../tabs/PresentationScreenCard';
import { PRESENTATION_PREVIEW_EVENT } from '../../../../lib/theme/previewBridge';

const mocks = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('../../../../repositories/presentationRepository', () => ({ presentationRepository: mocks }));
const renderCard = () => render(
  <ThemeEditorContext.Provider value={{ activeTenant: { id: 'tenant-1', slug: 'loja', name: 'Loja' } } as any}>
    <PresentationScreenCard />
  </ThemeEditorContext.Provider>,
);

beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(null); });
afterEach(cleanup);

describe('Configuração da Abertura da loja', () => {
  it('sem mídia não mostra apresentação e permite upload só pelo card habilitado', async () => {
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/Nenhuma mídia ativa/));
    expect(ui.queryByTestId('presentation-preview')).toBeNull();
    expect(ui.getByTestId('presentation-upload')).toBeTruthy();
  });
  it('envia uma imagem e dispara a prévia no PhonePreview', async () => {
    const value = { assetId: 'asset-1', mediaType: 'IMAGE', imageSeconds: 3, oncePerDay: false,
      enabled: true, url: 'https://cdn.example/preview.webp' };
    mocks.upload.mockResolvedValue(value);
    const ui = renderCard();
    await waitFor(() => ui.getByTestId('presentation-upload'));
    fireEvent.change(ui.getByTestId('presentation-file'), {
      target: { files: [new File(['webp'], 'foto.webp', { type: 'image/webp' })] },
    });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/Imagem salva/));
    const seen = vi.fn((ev: Event) => { (ev as CustomEvent).detail.handled = true; });
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, seen);
    try {
      fireEvent.click(ui.getByTestId('presentation-preview'));
      expect(seen).toHaveBeenCalledTimes(1);
      expect(ui.queryByTestId('store-presentation')).toBeNull();
    } finally { window.removeEventListener(PRESENTATION_PREVIEW_EVENT, seen); }
  });
  it('ajustes mantêm mídia e opção de desligar não apaga configuração', async () => {
    const value = { assetId: 'asset-1', mediaType: 'IMAGE', imageSeconds: 3, oncePerDay: false,
      enabled: true, url: 'https://cdn.example/preview.webp' };
    mocks.get.mockResolvedValue(value);
    mocks.save.mockResolvedValue({ ...value, imageSeconds: 4 });
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toMatch(/Imagem salva/));
    fireEvent.change(ui.getByTestId('presentation-seconds'), { target: { value: '4' } });
    fireEvent.click(ui.getByTestId('presentation-once-per-day'));
    fireEvent.click(ui.getByTestId('presentation-save'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('tenant-1','asset-1',
      { imageSeconds: 4, oncePerDay: true }, value.url));
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
