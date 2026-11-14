// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import { ScaledPreview } from '../ScaledPreview';
import { fitScale } from '../PhonePreview';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([[1366, 768], [1280, 720]])('fits phone, tablet and desktop at %sx%s', (w, h) => {
  for (const [width, height] of [[414, 868], [1040, 784], [1294, 814]]) {
    const scale = fitScale(w / 3, h - 350, width, height);
    expect(width * scale).toBeLessThanOrEqual(w / 3);
    expect(height * scale).toBeLessThanOrEqual(h - 350);
  }
});
it('remeasures the available height when the column changes', () => {
  let measure = () => {};
  let available = 400;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(350);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => available);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { measure = callback; } observe() {} disconnect() {} });
  const ui = render(<ScaledPreview width={406} height={860}><div>Device</div></ScaledPreview>);
  expect(Number(ui.getByTestId('scaled-preview').dataset.scale)).toBeCloseTo(400 / 860);
  available = 250;
  act(() => measure());
  expect(Number(ui.getByTestId('scaled-preview').dataset.scale)).toBeCloseTo(250 / 860);
});
