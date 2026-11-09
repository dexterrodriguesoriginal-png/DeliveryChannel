// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isInstalledDisplayMode,
  requestTotemFullscreenOnce,
  resetTotemFullscreenSession,
} from '../fullscreen';

function stubMatchMedia(matches: (query: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    }),
  });
}

describe('isInstalledDisplayMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as { standalone?: boolean }).standalone;
  });

  it('is true for display-mode fullscreen or standalone, or iOS navigator.standalone', () => {
    stubMatchMedia(q => q.includes('display-mode: standalone'));
    expect(isInstalledDisplayMode(window)).toBe(true);

    stubMatchMedia(q => q.includes('display-mode: fullscreen'));
    expect(isInstalledDisplayMode(window)).toBe(true);

    stubMatchMedia(() => false);
    expect(isInstalledDisplayMode(window)).toBe(false);

    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    expect(isInstalledDisplayMode(window)).toBe(true);
  });
});

describe('requestTotemFullscreenOnce', () => {
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetTotemFullscreenSession();
    request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null, writable: true });
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
    stubMatchMedia(() => false);
    delete (navigator as { standalone?: boolean }).standalone;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTotemFullscreenSession();
  });

  it('calls requestFullscreen only once in a browser tab, even if fullscreen was exited', async () => {
    await requestTotemFullscreenOnce();
    expect(request).toHaveBeenCalledTimes(1);

    await requestTotemFullscreenOnce();
    expect(request).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    await requestTotemFullscreenOnce();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not call requestFullscreen when running as an installed PWA', async () => {
    stubMatchMedia(q => q.includes('display-mode: standalone'));
    await requestTotemFullscreenOnce();
    expect(request).not.toHaveBeenCalled();

    resetTotemFullscreenSession();
    stubMatchMedia(q => q.includes('display-mode: fullscreen'));
    await requestTotemFullscreenOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not call requestFullscreen when iOS navigator.standalone is set', async () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    await requestTotemFullscreenOnce();
    expect(request).not.toHaveBeenCalled();
  });
});
