// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { parsePreviewPresentationMessage, PREVIEW_PRESENTATION_MSG, PRESENTATION_PREVIEW_EVENT, requestPresentationPreview, sendPreviewPresentation } from '../previewBridge';

const parent = {} as Window;
const w = { location: { origin: 'https://app.test', search: '?preview=1' }, parent } as any;
const ev = (data: unknown, origin = 'https://app.test', source: unknown = parent) => ({ data, origin, source }) as any;

describe('prévia da tela inicial (painel → app embutido)', () => {
  it('aceita só a janela pai da mesma origem e mídia com URL segura', () => {
    const p = { url: 'https://cdn/a.png', mediaType: 'IMAGE', imageSeconds: 9, oncePerDay: false };
    expect(parsePreviewPresentationMessage(ev({ type: PREVIEW_PRESENTATION_MSG, presentation: p }), w)).toEqual({ presentation: { ...p, imageSeconds: 5 } });
    expect(parsePreviewPresentationMessage(ev({ type: PREVIEW_PRESENTATION_MSG, presentation: null }), w)).toEqual({ presentation: null });
    expect(parsePreviewPresentationMessage(ev({ type: PREVIEW_PRESENTATION_MSG, presentation: p }, 'https://evil.test'), w)).toBeNull();
    expect(parsePreviewPresentationMessage(ev({ type: PREVIEW_PRESENTATION_MSG, presentation: p }, 'https://app.test', {}), w)).toBeNull();
    expect(parsePreviewPresentationMessage(ev({ type: PREVIEW_PRESENTATION_MSG, presentation: { ...p, url: 'javascript:alert(1)' } }), w)).toBeNull();
    expect(parsePreviewPresentationMessage(ev({ type: 'outro' }), w)).toBeNull();
  });
  it('"Ver abertura" vira evento local e mensagem só para a mesma origem', () => {
    const seen = vi.fn();
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, (e) => seen((e as CustomEvent).detail));
    expect(requestPresentationPreview(null)).toBe(false);
    expect(seen).toHaveBeenCalledWith({ presentation: null, handled: false });
    const handler = (e: Event) => { (e as CustomEvent).detail.handled = true; };
    window.addEventListener(PRESENTATION_PREVIEW_EVENT, handler);
    expect(requestPresentationPreview(null)).toBe(true);
    window.removeEventListener(PRESENTATION_PREVIEW_EVENT, handler);
    const frame = { postMessage: vi.fn() } as any;
    sendPreviewPresentation(frame, { url: 'https://cdn/v.mp4', mediaType: 'VIDEO', imageSeconds: 2.5, oncePerDay: false }, 'https://app.test');
    expect(frame.postMessage).toHaveBeenCalledWith({ type: PREVIEW_PRESENTATION_MSG, presentation: expect.objectContaining({ mediaType: 'VIDEO' }) }, 'https://app.test');
  });
});
