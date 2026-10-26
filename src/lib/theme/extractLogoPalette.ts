import { CANONICAL_FAMILY_BASES, ColorFamily } from './templates';
import type { StoreTemplate } from '../../types/theme';

function lab(hex: string): [number, number, number] {
  const normalized =
    hex.length === 4
      ? hex
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(1);
  const rgb = [0, 2, 4]
    .map((i) => parseInt(normalized.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = rgb;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIE76 distance: sufficient for ordering suggestions, with no remote upload. */
export function deltaE(a: string, b: string): number {
  const left = lab(a),
    right = lab(b);
  return Math.hypot(...left.map((value, i) => value - right[i]));
}

/** Quantize into 4096 buckets, then merge perceptually similar buckets. */
export function extractPaletteFromImageData(
  image: Pick<ImageData, 'data'>,
  maxColors = 5
): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < image.data.length; i += 4) {
    const [r, g, b, a] = image.data.subarray(i, i + 4);
    if (a < 128) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors: string[] = [];
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const color = '#' + [bucket.r, bucket.g, bucket.b].map((v) => hex(v / bucket.count)).join('');
    if (colors.every((other) => deltaE(color, other) > 18)) colors.push(color);
    if (colors.length >= Math.max(1, Math.min(5, maxColors))) break;
  }
  return colors;
}

export function nearestColorFamily(color: string): ColorFamily {
  return (Object.keys(CANONICAL_FAMILY_BASES) as ColorFamily[]).sort(
    (a, b) =>
      deltaE(color, CANONICAL_FAMILY_BASES[a].primary) -
      deltaE(color, CANONICAL_FAMILY_BASES[b].primary)
  )[0];
}
export function rankTemplatesByLogo(templates: StoreTemplate[], colors: string[]): StoreTemplate[] {
  if (!colors.length) return templates;
  const score = (t: StoreTemplate) =>
    Math.min(...colors.map((c, i) => deltaE(c, t.tokens.palette.primary) + i * 2));
  return [...templates].sort((a, b) => score(a) - score(b));
}

export function extractLogoPalette(url: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timeout = window.setTimeout(() => finish([]), 8000);
    const finish = (colors: string[]) => {
      clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
      resolve(colors);
    };
    img.onerror = () => finish([]);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return finish([]);
        context.drawImage(img, 0, 0, 96, 96);
        finish(extractPaletteFromImageData(context.getImageData(0, 0, 96, 96)));
      } catch {
        finish([]);
      }
    };
    img.src = url;
  });
}
