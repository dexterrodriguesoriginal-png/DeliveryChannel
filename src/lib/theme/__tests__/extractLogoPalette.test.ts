// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  deltaE,
  extractLogoPalette,
  extractPaletteFromImageData,
  nearestColorFamily,
  rankTemplatesByLogo,
} from '../extractLogoPalette';
import { TEMPLATES } from '../templates';
function imageData(colors: number[][]) {
  return new ImageData(new Uint8ClampedArray(colors.flat()), colors.length, 1);
}
describe('cores da logo', () => {
  it('extrai cores dominantes de ImageData sintético e ignora transparência', () => {
    const image = imageData([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    ]);
    const palette = extractPaletteFromImageData(image);
    expect(palette).toHaveLength(4);
    expect(palette[0]).toBe('#ff0000');
    expect(palette).not.toContain('#000000');
  });
  it('agrupa tons próximos, limita a cinco e aceita imagens vazias', () => {
    expect(
      extractPaletteFromImageData(
        imageData([
          [250, 0, 0, 255],
          [255, 5, 5, 255],
        ])
      )
    ).toHaveLength(1);
    expect(extractPaletteFromImageData({ data: new Uint8ClampedArray() })).toEqual([]);
    expect(
      extractPaletteFromImageData(
        imageData([
          [255, 0, 0, 255],
          [0, 255, 0, 255],
          [0, 0, 255, 255],
          [255, 255, 0, 255],
          [0, 255, 255, 255],
          [255, 0, 255, 255],
        ])
      )
    ).toHaveLength(5);
  });
  it('mede proximidade, mapeia famílias e ordena sem alterar o catálogo', () => {
    expect(deltaE('#fff', '#ffffff')).toBe(0);
    expect(deltaE('#ff0000', '#fe0000')).toBeLessThan(deltaE('#ff0000', '#0000ff'));
    expect(nearestColorFamily('#0369a1')).toBe('azul');
    const originalIds = TEMPLATES.map((t) => t.id);
    const ranked = rankTemplatesByLogo(TEMPLATES, [TEMPLATES[20].tokens.palette.primary]);
    expect(deltaE(ranked[0].tokens.palette.primary, TEMPLATES[20].tokens.palette.primary)).toBe(0);
    expect(TEMPLATES.map((t) => t.id)).toEqual(originalIds);
  });
  it('falha silenciosamente quando a imagem não pode ser carregada', async () => {
    let crossOrigin: string | null = null;
    class FailingImage {
      onerror: null | (() => void) = null;
      onload = null;
      set crossOrigin(value: string) {
        crossOrigin = value;
      }
      set src(_: string) {
        this.onerror?.();
      }
    }
    vi.stubGlobal('Image', FailingImage);
    try {
      expect(await extractLogoPalette('https://example.com/cors.png')).toEqual([]);
      expect(crossOrigin).toBe('anonymous');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('não expõe erro quando o canvas é bloqueado por CORS', async () => {
  class LoadedImage {
    onerror = null;
    onload: null | (() => void) = null;
    crossOrigin = '';
    set src(_: string) {
      this.onload?.();
    }
  }
  vi.stubGlobal('Image', LoadedImage);
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => {},
    getImageData: () => {
      throw new DOMException('Tainted canvas', 'SecurityError');
    },
  } as unknown as CanvasRenderingContext2D);
  try {
    expect(await extractLogoPalette('https://example.com/blocked.png')).toEqual([]);
  } finally {
    canvas.mockRestore();
    vi.unstubAllGlobals();
  }
});
