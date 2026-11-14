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

it.each([
  [375, 406, 860, 300, 500], // Cardápio: celular
  [760, 1040, 784, 600, 400], // Cardápio: tablet, limite do layout empilhado
  [375, 390, 844, 300, 500], // Totem
])('fits a stacked preview mounted below the viewport at %spx (device %sx%s)', (viewportWidth, width, height, columnWidth, columnHeight) => {
  vi.stubGlobal('innerWidth', viewportWidth);
  vi.stubGlobal('innerHeight', 720);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(columnWidth);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(columnHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 1200 } as DOMRect);

  const ui = render(<ScaledPreview width={width} height={height}><div>Device</div></ScaledPreview>);
  const scale = Number(ui.getByTestId('scaled-preview').dataset.scale);
  expect(scale).toBeCloseTo(Math.min(1, columnWidth / width, columnHeight / height));
  expect(width * scale).toBeLessThanOrEqual(columnWidth + 1e-9);
  expect(height * scale).toBeLessThanOrEqual(columnHeight + 1e-9);

  // Scrolling to the preview must not be needed to obtain the correct scale.
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ top: 100 } as DOMRect);
  act(() => window.dispatchEvent(new Event('scroll')));
  expect(Number(ui.getByTestId('scaled-preview').dataset.scale)).toBe(scale);
});

it('keeps the desktop device within the visible height and remeasures across the breakpoint', () => {
  vi.stubGlobal('innerWidth', 761);
  vi.stubGlobal('innerHeight', 720);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(350);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 400 } as DOMRect);
  const ui = render(<ScaledPreview width={406} height={860}><div>Device</div></ScaledPreview>);
  expect(Number(ui.getByTestId('scaled-preview').dataset.scale)).toBeCloseTo((720 - 400 - 16) / 860);

  vi.stubGlobal('innerWidth', 760);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(Number(ui.getByTestId('scaled-preview').dataset.scale)).toBeCloseTo(600 / 860);
});
