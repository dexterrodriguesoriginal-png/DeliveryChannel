// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StorePresentationScreen, StorePresentationSequence } from '../StorePresentationScreen';
import { PRESENTATION_FADE_MS, PRESENTATION_START_TIMEOUT_MS } from '../../../lib/pwa/presentation';
import { DC_PRESENTS_BACKGROUND, DC_PRESENTS_TEXT } from '../../../lib/pwa/bootScreen';

beforeEach(() => {
  vi.useFakeTimers();
  // Navegador de teste: play() fica pendente (como rede lenta); os eventos são disparados pelos testes.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise<void>(() => {}));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('StorePresentationScreen', () => {
  it('imagem fica o tempo configurado depois de carregar e vai para a vitrine', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'IMAGE', url: 'https://x/a.png', durationMs: 2500 }} onDone={done} />);
    fireEvent.load(ui.getByTestId('store-presentation-image'));
    advance(2400); expect(done).not.toHaveBeenCalled();
    advance(100 + PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('só "Pular" encerra; toque no resto da tela não pula', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'IMAGE', url: 'https://x/a.png', durationMs: 5000 }} onDone={done} />);
    fireEvent.load(ui.getByTestId('store-presentation-image'));
    fireEvent.click(ui.getByTestId('store-presentation'));
    fireEvent.click(ui.getByTestId('store-presentation-image'));
    advance(PRESENTATION_FADE_MS + 10); expect(done).not.toHaveBeenCalled();
    const skip = ui.getByRole('button', { name: /Pular/ });
    expect(skip.textContent).toBe('Pular');
    expect(skip.style.top).toContain('safe-area-inset-top');
    fireEvent.click(skip);
    advance(PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
    fireEvent.click(skip); advance(PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('erro de mídia vai direto para a vitrine', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'IMAGE', url: 'https://x/a.png', durationMs: 2500 }} onDone={done} />);
    fireEvent.error(ui.getByTestId('store-presentation-image'));
    advance(PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('mídia que não começa em 3 s → vitrine (sem tela preta)', () => {
    const done = vi.fn();
    render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: 'https://x/v.mp4', maxMs: 10000 }} onDone={done} />);
    advance(PRESENTATION_START_TIMEOUT_MS - 10); expect(done).not.toHaveBeenCalled();
    advance(10 + PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('autoplay bloqueado pelo navegador → vitrine', async () => {
    (HTMLMediaElement.prototype.play as any).mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    const done = vi.fn();
    render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: 'https://x/v.mp4', maxMs: 10000 }} onDone={done} />);
    await act(async () => { await Promise.resolve(); });
    advance(PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('vídeo mudo, sem controles, cortado em 10 s mesmo se o arquivo for maior', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: 'https://x/v.mp4', maxMs: 10000 }} onDone={done} />);
    const v = ui.getByTestId('store-presentation-video') as HTMLVideoElement;
    expect(v.muted).toBe(true); expect(v.hasAttribute('playsinline')).toBe(true); expect(v.hasAttribute('controls')).toBe(false);
    fireEvent.playing(v);
    advance(PRESENTATION_START_TIMEOUT_MS + 1000); expect(done).not.toHaveBeenCalled();
    Object.defineProperty(v, 'currentTime', { value: 10.02, configurable: true });
    fireEvent.timeUpdate(v);
    advance(PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('vídeo que trava depois de começar também termina em 10 s', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'VIDEO', url: 'https://x/v.mp4', maxMs: 10000 }} onDone={done} />);
    fireEvent.playing(ui.getByTestId('store-presentation-video'));
    advance(10000 + PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('padrão do tema: cores do tema, logo e nome; sem tema usa a cor padrão do Delivery Channel', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'THEME', durationMs: 1000 }} background="rgb(1, 2, 3)" textColor="rgb(4, 5, 6)" storeName="Adega" logoUrl="https://x/l.png" onDone={done} />);
    const root = ui.getByTestId('store-presentation');
    expect(root.style.background).toBe('rgb(1, 2, 3)'); expect(root.style.color).toBe('rgb(4, 5, 6)');
    expect(ui.getByText('Adega')).toBeTruthy();
    advance(1000 + PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
    cleanup();
    const fallback = render(<StorePresentationScreen plan={{ kind: 'THEME', durationMs: 1000 }} onDone={() => {}} />);
    const bg = fallback.getByTestId('store-presentation').style.background.replace(/\s/g, '');
    const hex = DC_PRESENTS_BACKGROUND.replace('#', '');
    const rgb = `rgb(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)})`;
    expect([DC_PRESENTS_BACKGROUND, rgb]).toContain(bg);
  });
  it('movimento reduzido: primeiro quadro parado, sem autoplay', () => {
    const done = vi.fn();
    const ui = render(<StorePresentationScreen plan={{ kind: 'STILL', url: 'https://x/v.mp4', durationMs: 1500 }} onDone={done} />);
    const v = ui.getByTestId('store-presentation-still') as HTMLVideoElement;
    expect(v.hasAttribute('autoplay')).toBe(false);
    fireEvent.loadedData(v);
    advance(1500 + PRESENTATION_FADE_MS); expect(done).toHaveBeenCalledTimes(1);
  });
  it('prévia do painel mostra "Delivery Channel apresenta" antes da tela da loja', () => {
    const ui = render(<StorePresentationSequence withBoot bootMs={900} plan={{ kind: 'THEME', durationMs: 1000 }} storeName="Adega" onDone={() => {}} />);
    expect(ui.getByTestId('store-presentation-boot').textContent).toContain(DC_PRESENTS_TEXT);
    expect(ui.queryByTestId('store-presentation')).toBeNull();
    advance(900);
    expect(ui.queryByTestId('store-presentation-boot')).toBeNull();
    expect(ui.getByTestId('store-presentation')).toBeTruthy();
  });
});
