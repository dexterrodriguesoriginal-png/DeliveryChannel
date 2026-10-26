/**
 * Regera as cores de src/lib/theme/templates/palettes.ts para que nenhum par de modelos fique parecido.
 * Mantém id, nome, família e modo; ajusta primária/secundária (pequenos passos dentro da família)
 * e dá a cada modelo um fundo próprio (tons claros/escuros tingidos pela cor da marca).
 * Uso: npx tsx scripts/regen-palettes.ts  (determinístico)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SEGMENT_PALETTES, hexToRgb, rgbToHsl, hslToHex, getLuminance, getContrast, NamedPalette } from '../src/lib/theme/templates/palettes';
import { deltaE2000, MIN_PRIMARY_DE_SAME_SEGMENT, NEAR_DUP } from '../src/lib/theme/colorDistance';

const FILE = 'src/lib/theme/templates/palettes.ts';
let MARGIN = 1.5;
type Fam = NamedPalette['colorFamily'];
const hsl = (hex: string) => { const { r, g, b } = hexToRgb(hex); return rgbToHsl(r, g, b); };

function famOk(f: Fam, hex: string) {
  const { h, s, l } = hsl(hex);
  switch (f) {
    case 'azul': return h >= 192 && h <= 248;
    case 'roxo': return h >= 262 && h <= 298;
    case 'rosa': return h >= 302 && h <= 343;
    case 'vermelho': return h >= 347 || h <= 13;
    case 'laranja': return h >= 17 && h <= 38;
    case 'amarelo': return h >= 42 && h <= 63;
    case 'verde': return h >= 72 && h <= 168;
    case 'marrom': return h >= 22 && h <= 48 && l < 0.44 && s < 0.58;
    case 'neutros': return s < 0.14;
  }
}

// Estilos de fundo: claro (tinte leve, papel quente, tinte médio) / escuro (quase preto tingido, profundo).
const LIGHT_BG = [ [0.18, 0.975], [0.35, 0.96], [0.55, 0.945], [0.10, 0.985], [0.75, 0.955], [0.45, 0.93], [0.9, 0.97], [0.25, 0.935] ];
const DARK_BG = [ [0.30, 0.065], [0.45, 0.09], [0.20, 0.045], [0.60, 0.075], [0.15, 0.11], [0.50, 0.05], [0.7, 0.12], [0.35, 0.13] ];
const HUE_SHIFT = [0, 25, -25, 50, 180, -50, 90, -90, 140];

function bgFor(p: NamedPalette, primary: string, k: number) {
  const { h } = hsl(primary);
  const [s, l] = (p.mode === 'dark' ? DARK_BG : LIGHT_BG)[k % 8];
  const hue = h + HUE_SHIFT[Math.floor(k / 8) % 9];
  const hex = hslToHex(hue, p.colorFamily === 'neutros' ? s * 0.25 : s, l);
  const lum = getLuminance(hex);
  return (p.mode === 'dark' ? lum < 0.15 : lum > 0.8) ? hex : null;
}

function* primaryCandidates(p: NamedPalette) {
  const o = hsl(p.base.primary);
  const steps: [number, number, number][] = [[0, 0, 0]];
  for (const dl of [0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2, 0.25, -0.25, 0.3, 0.35, 0.4, 0.5, 0.6])
    for (const dh of [0, 6, -6, 12, -12, 18, -18])
      for (const ds of [0, -0.15, 0.15]) steps.push([dh, ds, dl]);
  steps.sort((a, b) => Math.abs(a[0]) / 6 + Math.abs(a[1]) * 5 + Math.abs(a[2]) * 10 - (Math.abs(b[0]) / 6 + Math.abs(b[1]) * 5 + Math.abs(b[2]) * 10));
  for (const [dh, ds, dl] of steps) {
    const s = Math.min(1, Math.max(0, o.s + ds)), l = Math.min(0.9, Math.max(0.12, o.l + dl));
    const hex = hslToHex(o.h + dh, s, l);
    if (!famOk(p.colorFamily, hex)) continue;
    const so = hsl(p.base.secondary);
    const sec = hslToHex(so.h + dh, Math.min(1, Math.max(0, so.s + ds)), Math.min(0.9, Math.max(0.1, so.l + dl)));
    yield { primary: hex, secondary: sec };
  }
}

type Placed = { id: string; seg: string; primary: string; secondary: string; bg: string };
const placed: Placed[] = [];
const out: Record<string, { primary: string; secondary: string; bg: string }> = {};
const segCount: Record<string, number> = {};
const relaxed: string[] = [];
for (const p of SEGMENT_PALETTES) {
  const k0 = (segCount[p.segmentId] = (segCount[p.segmentId] ?? -1) + 1);
  let done = false;
  for (const [minC, m] of [[3, 1.5], [2, 1.5], [1.8, 0.3]] as const) {
  if (done) break;
  MARGIN = m;
  if (minC < 3) relaxed.push(p.id);
  for (const c of primaryCandidates(p)) {
    if (placed.some((q) => q.seg === p.segmentId && deltaE2000(q.primary, c.primary) < MIN_PRIMARY_DE_SAME_SEGMENT + MARGIN)) continue;
    // botão precisa de contraste (o construtor ajusta, mas evitamos cores que ele teria que trocar)
    if (Math.max(getContrast('#ffffff', c.primary), getContrast('#0f172a', c.primary)) < 4.5) continue;
    for (let t = 0; t < 72 && !done; t++) {
      const bg = bgFor(p, c.primary, k0 + t);
      if (!bg) continue;
      // A cor da marca precisa aparecer sobre o fundo (componentes de interface, WCAG 1.4.11).
      if (getContrast(c.primary, bg) < minC) continue;
      const clash = placed.some((q) => deltaE2000(q.primary, c.primary) < NEAR_DUP.primary + MARGIN
        && deltaE2000(q.bg, bg) < NEAR_DUP.bg + MARGIN);
      if (clash) continue;
      placed.push({ id: p.id, seg: p.segmentId, ...c, bg });
      out[p.id] = { ...c, bg };
      done = true;
    }
    if (done) break;
  }
  }
  if (!done) throw new Error(`sem solução para ${p.id}`);
}

let src = readFileSync(FILE, 'utf8');
let changed = 0;
for (const [id, v] of Object.entries(out)) {
  const re = new RegExp(`(id: '${id}',[\\s\\S]*?base: \\{ )primary: '#[0-9a-fA-F]{6}', secondary: '#[0-9a-fA-F]{6}'(, accent: '#[0-9a-fA-F]{6}')(?:, bg: '#[0-9a-fA-F]{6}')?`);
  const before = src;
  src = src.replace(re, `$1primary: '${v.primary}', secondary: '${v.secondary}'$2, bg: '${v.bg}'`);
  if (src === before) throw new Error(`não achei ${id}`);
  changed++;
}
writeFileSync(FILE, src);
console.log(`ok: ${changed} paletas regeradas; contraste relaxado (marca x fundo >= 2): ${relaxed.join(', ') || 'nenhuma'}`);
