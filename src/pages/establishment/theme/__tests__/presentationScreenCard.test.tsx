// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ThemeEditorContext } from '../ThemeEditorContext';
import { PresentationScreenCard } from '../tabs/PresentationScreenCard';
import { PRESENTATION_PREVIEW_EVENT } from '../../../../lib/theme/previewBridge';

const mocks = vi.hoisted(() => ({ get: vi.fn(), upload: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('../../../../repositories/presentationRepository', () => ({ presentationRepository: mocks }));

const savedImage = {
  assetId: 'asset-1', mediaType: 'IMAGE' as const, imageSeconds: 3,
  oncePerDay: false, enabled: true, url: 'https://cdn.example/preview.webp',
};
const savedVideo = {
  assetId: 'asset-2', mediaType: 'VIDEO' as const, imageSeconds: 3,
  oncePerDay: false, enabled: true, url: 'https://cdn.example/preview.mp4',
};
const renderCard = () => render(
  <ThemeEditorContext.Provider value={{ activeTenant: { id: 'tenant-1', slug: 'loja', name: 'Loja' } } as any}>
    <PresentationScreenCard />
  </ThemeEditorContext.Provider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.clear.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Configuração da Abertura da loja', () => {
  it('sem mídia mostra card, selo neutro, dropzone e botão de envio, sem prévia', async () => {
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe('Nenhuma mídia'));
    expect(ui.getByTestId('presentation-screen-card').getAttribute('aria-label')).toBe('Abertura da loja');
    expect(ui.getByTestId('presentation-status').className).toContain('bg-gray-100');
    expect(ui.getByTestId('presentation-dropzone').className).toContain('border-dashed');
    expect(ui.getByText(/Clique para enviar/)).toBeTruthy();
    expect(ui.getByText(/JPG, PNG, WebP até 3 MB/)).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Enviar imagem ou vídeo' })).toBeTruthy();
    expect(ui.getByTestId('presentation-upload')).toBeTruthy();
    expect(ui.queryByTestId('presentation-preview')).toBeNull();
    expect(ui.queryByTestId('presentation-thumb')).toBeNull();
    expect(ui.getByTestId('presentation-file').getAttribute('accept')).toBe(
      'image/jpeg,image/png,image/webp,video/mp4,video/webm'
    );
  });

  it('envia uma imagem e dispara a prévia no PhonePreview', async () => {
    mocks.upload.mockResolvedValue(savedImage);
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-upload')).toBeTruthy());
    const picker = ui.getByTestId('presentation-file') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(['webp'], 'foto.webp', { type: 'image/webp' })] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe('Ativa'));
    expect(ui.getByText('Imagem salva')).toBeTruthy();
    expect(ui.getByTestId('presentation-thumb').querySelector('img')?.getAttribute('alt')).toBe('Prévia da imagem');

    const seen = vi.fn((ev: Event) => { (ev as CustomEvent).detail.handled = true; });
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, seen);
    try {
      fireEvent.click(ui.getByRole('button', { name: 'Ver abertura' }));
      expect(seen).toHaveBeenCalledTimes(1);
      expect(ui.queryByTestId('store-presentation')).toBeNull();
    } finally { window.removeEventListener(PRESENTATION_PREVIEW_EVENT, seen); }
  });

  it('salvar ajustes envia imageSeconds/oncePerDay e não chama clear', async () => {
    mocks.get.mockResolvedValue(savedImage);
    mocks.save.mockResolvedValue({ ...savedImage, imageSeconds: 4, oncePerDay: true });
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe('Ativa'));
    fireEvent.change(ui.getByTestId('presentation-seconds'), { target: { value: '4' } });
    fireEvent.click(ui.getByTestId('presentation-once-per-day'));
    fireEvent.click(ui.getByRole('button', { name: 'Salvar ajustes' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(
      'tenant-1', 'asset-1', { imageSeconds: 4, oncePerDay: true }, savedImage.url
    ));
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(ui.getByTestId('presentation-seconds').getAttribute('min')).toBe('1');
    expect(ui.getByTestId('presentation-seconds').getAttribute('max')).toBe('5');
    expect(ui.getByTestId('presentation-seconds').getAttribute('step')).toBe('0.5');
  });

  it('dropzone aceita drag-and-drop e chama o mesmo upload; botão abre o mesmo input', async () => {
    mocks.upload.mockResolvedValue(savedVideo);
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-dropzone')).toBeTruthy());
    const input = ui.getByTestId('presentation-file') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(ui.getByRole('button', { name: 'Enviar imagem ou vídeo' }));
    expect(click).toHaveBeenCalledTimes(1);
    const dropzone = ui.getByTestId('presentation-dropzone');
    fireEvent.dragOver(dropzone);
    expect(dropzone.className).toContain('border-emerald-500');
    const file = new File(['video'], 'abertura.webm', { type: 'video/webm' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(
      'tenant-1', file, { imageSeconds: 3, oncePerDay: false }
    ));
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe('Ativa'));
    expect(dropzone.className).not.toContain('border-emerald-500');
    expect(ui.getByTestId('presentation-thumb').querySelector('video')?.hasAttribute('autoplay')).toBe(true);
    expect(ui.getByTestId('presentation-thumb').querySelector('video')?.hasAttribute('loop')).toBe(true);
    expect(ui.queryByTestId('presentation-seconds')).toBeNull();
    expect(ui.getByRole('button', { name: 'Trocar mídia' })).toBeTruthy();
    fireEvent.click(ui.getByRole('button', { name: 'Trocar mídia' }));
    expect(click).toHaveBeenCalledTimes(2);
  });

  it.each([
    { value: null, text: 'Nenhuma mídia', color: 'bg-gray-100' },
    { value: savedImage, text: 'Ativa', color: 'bg-emerald-50' },
    { value: { ...savedImage, enabled: false }, text: 'Não publicada', color: 'bg-amber-50' },
    { value: { ...savedImage, url: undefined }, text: 'Não publicada', color: 'bg-amber-50' },
  ])('selo correto para status $text e estado %#', async ({ value, text, color }) => {
    mocks.get.mockResolvedValue(value);
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe(text));
    expect(ui.getByTestId('presentation-status').className).toContain(color);
    if (value && !value.enabled) {
      expect(ui.getByRole('button', { name: 'Publicar' })).toBeTruthy();
    }
  });

  it('remover pede confirmação; cancelar não chama clear e aceitar remove a apresentação', async () => {
    mocks.get.mockResolvedValue(savedImage);
    vi.stubGlobal('confirm', vi.fn(() => false));
    const confirm = vi.mocked(window.confirm);
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe('Ativa'));
    expect(ui.getByRole('button', { name: 'Trocar mídia' })).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Salvar ajustes' })).toBeTruthy();
    expect(ui.getByRole('button', { name: 'Ver abertura' })).toBeTruthy();
    fireEvent.click(ui.getByRole('button', { name: 'Remover' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Remover a mídia da abertura da loja?'));
    expect(mocks.clear).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(ui.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith('tenant-1'));
    await waitFor(() => expect(ui.getByTestId('presentation-status').textContent).toBe('Nenhuma mídia'));
    expect(ui.queryByRole('button', { name: 'Remover' })).toBeNull();
  });

  it('exibe skeleton antes do get resolver, sem texto Carregando', async () => {
    let resolveGet: (value: typeof savedImage | null) => void = () => {};
    mocks.get.mockReturnValue(new Promise<typeof savedImage | null>(resolve => { resolveGet = resolve; }));
    const ui = renderCard();
    expect(ui.getByTestId('presentation-skeleton').className).toContain('animate-pulse');
    expect(ui.queryByText('Carregando…')).toBeNull();
    resolveGet(savedImage);
    await waitFor(() => expect(ui.queryByTestId('presentation-skeleton')).toBeNull());
    expect(ui.getByTestId('presentation-thumb')).toBeTruthy();
  });

  it('mostra feedback de progresso estimado durante upload e erro inline se falhar', async () => {
    let rejectUpload: (reason: Error) => void = () => {};
    mocks.upload.mockReturnValue(new Promise((_, reject) => { rejectUpload = reject; }));
    const ui = renderCard();
    await waitFor(() => expect(ui.getByTestId('presentation-upload')).toBeTruthy());
    fireEvent.change(ui.getByTestId('presentation-file'), {
      target: { files: [new File(['file'], 'foto.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(ui.getByTestId('presentation-progress')).toBeTruthy());
    expect(ui.getByRole('progressbar', { name: 'Progresso estimado do envio' })).toBeTruthy();
    rejectUpload(new Error('Falha no upload'));
    await waitFor(() => expect(ui.getByRole('alert').textContent).toContain('Falha no upload'));
    expect(ui.getByTestId('presentation-error').className).toContain('bg-rose-50');
    expect(ui.queryByTestId('presentation-progress')).toBeNull();
  });
});
