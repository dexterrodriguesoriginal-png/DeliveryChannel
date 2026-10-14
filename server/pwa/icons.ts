/**
 * Geração de ícones PNG por loja (192/512/maskable-512) com @resvg/resvg-js
 * (binários pré-compilados para linux x64 — sem compilação nativa no deploy).
 * Logo da loja quando disponível; senão iniciais na cor da loja (fonte embarcada, não depende do sistema).
 */
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { storeInitials } from '../../src/lib/pwa/storeManifest';

export type IconVariant = 'icon-192' | 'icon-512' | 'maskable-512';
export const ICON_VARIANTS: Record<IconVariant, { size: number; maskable: boolean }> = {
  'icon-192': { size: 192, maskable: false },
  'icon-512': { size: 512, maskable: false },
  'maskable-512': { size: 512, maskable: true },
};

const FONT_FILE = path.resolve(process.cwd(), 'server/assets/Roboto-Bold.ttf');
const FONT_FAMILY = 'Roboto';

function render(svg: string, size: number): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false, fontFiles: fs.existsSync(FONT_FILE) ? [FONT_FILE] : [], defaultFontFamily: FONT_FAMILY },
  });
  return Buffer.from(r.render().asPng());
}

export function initialsSvg(name: string, color: string, size: number, maskable: boolean): string {
  const initials = storeInitials(name).replace(/[<>&"']/g, '');
  const r = maskable ? 0 : Math.round(size * 0.18);
  const fs_ = Math.round(size * (maskable ? 0.32 : 0.4));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${r}" fill="${color}"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="700" font-size="${fs_}" fill="#ffffff">${initials}</text></svg>`;
}

export function renderInitialsPng(name: string, color: string, variant: IconVariant): Buffer {
  const { size, maskable } = ICON_VARIANTS[variant];
  return render(initialsSvg(name, color, size, maskable), size);
}

/** Logo (PNG/JPEG/WebP/GIF/SVG) centralizado em fundo branco; maskable usa área segura de 80%. */
export function renderLogoPng(bytes: Buffer, contentType: string, variant: IconVariant): Buffer {
  const { size, maskable } = ICON_VARIANTS[variant];
  const box = maskable ? Math.round(size * 0.8) : size;
  const off = Math.round((size - box) / 2);
  const href = `data:${contentType};base64,${bytes.toString('base64')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/>` +
    `<image x="${off}" y="${off}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid slice" xlink:href="${href}"/></svg>`;
  return render(svg, size);
}

/** Lê largura/altura do cabeçalho IHDR de um PNG (para validação). */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
