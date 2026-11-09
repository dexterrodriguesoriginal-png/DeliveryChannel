// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutoFullscreen } from '../useAutoFullscreen';

afterEach(() => { vi.restoreAllMocks(); });

describe('useAutoFullscreen', () => {
  it('requests fullscreen on the first gesture and again if it was exited', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    let active: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active });
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });

    request.mockImplementation(async () => { active = document.documentElement; });
    const hook = renderHook(() => useAutoFullscreen(true));
    await document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // listeners are on window
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    active = null;
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);

    hook.unmount();
  });

  it('does nothing when the browser has no fullscreen API', () => {
    const hook = renderHook(() => useAutoFullscreen(true));
    expect(() => window.dispatchEvent(new Event('pointerdown'))).not.toThrow();
    hook.unmount();
  });
});
