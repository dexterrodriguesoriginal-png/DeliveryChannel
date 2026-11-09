import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { isNearlyFlatPng, pngSize, renderInitialsPng, renderLogoPng, renderStoreIconPng } from '../icons';

async function sampleCenter(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], width: info.width, height: info.height };
}

describe('ícones PWA da loja', () => {
  it('WebP do logo vira PNG 192/512 com o desenho (não um quadrado branco)', async () => {
    const mark = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#111111' },
    }).png().toBuffer();
    const webp = await sharp({
      create: { width: 160, height: 160, channels: 3, background: '#f3f3f3' },
    }).composite([{ input: mark, left: 40, top: 40 }]).webp().toBuffer();

    const broken = renderLogoPng(webp, 'image/webp', 'icon-192');
    expect(await isNearlyFlatPng(broken)).toBe(true);

    const icon = await renderStoreIconPng(webp, 'image/webp', 'icon-192');
    expect(pngSize(icon)).toEqual({ width: 192, height: 192 });
    expect(await isNearlyFlatPng(icon)).toBe(false);
    const c = await sampleCenter(icon);
    expect(c.r).toBeLessThan(40);
    expect(c.g).toBeLessThan(40);
    expect(c.b).toBeLessThan(40);
  });

  it('iniciais usam a cor viva do tema, nunca cinza ou branco', async () => {
    const png = renderInitialsPng('ADEGASSHOW', '#a7360f', 'icon-192');
    expect(pngSize(png)).toEqual({ width: 192, height: 192 });
    expect(await isNearlyFlatPng(png, 0.001)).toBe(false);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let foundTheme = false;
    for (let i = 0; i < info.width * info.height; i++) {
      const r = data[i * info.channels], g = data[i * info.channels + 1], b = data[i * info.channels + 2];
      if (Math.abs(r - 0xa7) < 20 && Math.abs(g - 0x36) < 20 && Math.abs(b - 0x0f) < 20) foundTheme = true;
    }
    expect(foundTheme).toBe(true);
  });
});
