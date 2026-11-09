/**
 * Geração de ícones PNG por loja (192/512/maskable-512) com @resvg/resvg-js
 * (binários pré-compilados para linux x64 — sem compilação nativa no deploy).
 * Logo da loja quando disponível (PNG/JPEG/WebP/GIF/SVG); senão iniciais na cor
 * viva do tema (nunca cinza). Raster é composto com sharp — o resvg não pinta
 * WebP em <image>, o que gerava um quadrado branco/círculo cinza no launcher.
 */
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
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

function parseCssColor(color: string): { r: number; g: number; b: number; alpha: number } {
  const c = (color || '#ffffff').trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return { r: 255, g: 255, b: 255, alpha: 1 };
  let h = m[1];
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha: 1 };
}

export function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

/** Logo (PNG/JPEG/WebP/GIF/SVG) centralizado (contain); maskable usa área segura de 80%. */
export function renderLogoPng(bytes: Buffer, contentType: string, variant: IconVariant, background = '#ffffff'): Buffer {
  const { size, maskable } = ICON_VARIANTS[variant];
  const box = maskable ? Math.round(size * 0.8) : size;
  const off = Math.round((size - box) / 2);
  const href = `data:${contentType};base64,${bytes.toString('base64')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${background}"/>` +
    `<image x="${off}" y="${off}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet" xlink:href="${href}"/></svg>`;
  return render(svg, size);
}

/** Composição confiável do logo (inclui WebP, que o resvg não embute). */
export async function renderStoreIconPng(
  bytes: Buffer,
  contentType: string,
  variant: IconVariant,
  background = '#ffffff',
): Promise<Buffer> {
  const { size, maskable } = ICON_VARIANTS[variant];
  const box = maskable ? Math.round(size * 0.8) : size;
  const pad = Math.round((size - box) / 2);
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'image/svg+xml' || looksLikeSvg(bytes)) {
    return renderLogoPng(bytes, ct || 'image/svg+xml', variant, background);
  }
  const logo = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize(box, box, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: parseCssColor(background) },
  })
    .composite([{ input: logo, left: pad, top: pad }])
    .png()
    .toBuffer();
}

function isBlankOrGreyPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luma > 230) return true;
  if (max - min < 28 && luma > 40) return true;
  return false;
}

/** True se o PNG é um campo branco/cinza (falha típica de WebP no resvg). Um logo monocolor vivo (ex. verde) NÃO é rejeitado. */
export async function isNearlyFlatPng(png: Buffer, threshold = 0.01): Promise<boolean> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  if (n === 0) return true;
  const ch = info.channels;
  let first: [number, number, number] | null = null;
  let different = 0;
  let opaque = 0;
  let blankish = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * ch];
    const g = data[i * ch + 1];
    const b = data[i * ch + 2];
    const a = ch > 3 ? data[i * ch + 3] : 255;
    if (a < 16) continue;
    opaque++;
    if (isBlankOrGreyPixel(r, g, b)) blankish++;
    if (!first) { first = [r, g, b]; continue; }
    if (Math.abs(r - first[0]) > 12 || Math.abs(g - first[1]) > 12 || Math.abs(b - first[2]) > 12) different++;
  }
  if (opaque === 0) return true;
  const uniform = different / n < threshold;
  const mostlyBlank = blankish / opaque > 0.97;
  return uniform && mostlyBlank;
}

/** Lê largura/altura do cabeçalho IHDR de um PNG (para validação). */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
