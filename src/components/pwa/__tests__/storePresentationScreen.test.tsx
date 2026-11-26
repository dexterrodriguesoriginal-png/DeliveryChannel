// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StorePresentationScreen } from '../StorePresentationScreen';
import { PRESENTATION_FADE_MS, PRESENTATION_START_TIMEOUT_MS } from '../../../lib/pwa/presentation';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('Abertura da loja — mídia e fallback', () => {
  it('imagem em tela cheia fica 3 s e faz fade para o catálogo', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'IMAGE', url: 'https://cdn.test/a.webp', durationMs: 3000 }} onDone={done} />);
    const screen = ui.getByTestId('store-presentation');
    expect(screen.style.position).toBe('fixed');
    expect(ui.queryByText(/Delivery Channel apresenta/)).toBeNull();
    expect(ui.queryByTestId('store-presentation-skip')).toBeNull();
    fireEvent.load(ui.getByTestId('store-presentation-image'));
    advance(2999); expect(done).not.toHaveBeenCalled();
    advance(1 + PRESENTATION_FADE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('erro ao carregar mídia libera loja sem impedir interação', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'IMAGE', url: 'https://cdn.test/broken.png', durationMs: 3000 }} onDone={done} />);
    fireEvent.error(ui.getByTestId('store-presentation-image'));
    advance(PRESENTATION_FADE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('imagem ou vídeo não carregado em 1,5s libera o catálogo', () => {
    const done = vi.fn();
    render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: 'https://cdn.test/v.mp4', maxMs: 10000 }} onDone={done} />);
    advance(PRESENTATION_START_TIMEOUT_MS - 1); expect(done).not.toHaveBeenCalled();
    advance(1 + PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('vídeo tenta começar COM som, sem Pular, e encerra no teto de 10s', () => {
    const done = vi.fn();
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const ui = render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: 'https://cdn.test/v.mp4', maxMs: 10000 }} onDone={done} />);
    const video = ui.getByTestId('store-presentation-video') as HTMLVideoElement;
    expect(video.muted).toBe(false);
    expect(video.hasAttribute('muted')).toBe(false);
    expect(play).toHaveBeenCalled();
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(ui.queryByTestId('store-presentation-skip')).toBeNull();
    fireEvent.playing(video);
    advance(9999); expect(done).not.toHaveBeenCalled();
    advance(1 + PRESENTATION_FADE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('autoplay com som rejeitado tenta novamente mudo, sem cancelar a abertura', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new DOMException('autoplay blocked', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: '/video.mp4', maxMs: 10000 }} onDone={done} />);
    const video = ui.getByTestId('store-presentation-video') as HTMLVideoElement;
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(true);
    expect(done).not.toHaveBeenCalled();
    fireEvent.playing(video);
    advance(10000 + PRESENTATION_FADE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('se o fallback mudo também falhar, libera a vitrine sem travar', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
      .mockRejectedValueOnce(new Error('media failed'));
    const done = vi.fn();
    render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: '/broken.mp4', maxMs: 10000 }} onDone={done} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    advance(PRESENTATION_FADE_MS);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it('movimento reduzido desliga a transição e nunca toca vídeo no modo STILL', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen
      plan={{ kind: 'STILL', url: 'https://cdn.test/v.mp4', durationMs: 1500 }}
      reducedMotion onDone={done} />);
    expect(ui.getByTestId('store-presentation').style.transition).toBe('none');
    expect(ui.queryByTestId('store-presentation-video')).toBeNull();
    expect((ui.getByTestId('store-presentation-still') as HTMLVideoElement).muted).toBe(true);
    expect(ui.queryByTestId('store-presentation-skip')).toBeNull();
    fireEvent.loadedData(ui.getByTestId('store-presentation-still'));
    advance(1500);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
