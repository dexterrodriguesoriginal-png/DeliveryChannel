/** Distância perceptual de cores (CIE L*a*b*, ΔE2000). Usado para garantir modelos realmente diferentes. */
export interface Lab { L: number; a: number; b: number }

export function hexToLab(hex: string): Lab {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE76(c1: string, c2: string): number {
  const p = hexToLab(c1), q = hexToLab(c2);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** CIEDE2000 (Sharma et al., 2005). */
export function deltaE2000(c1: string, c2: string): number {
  const { L: L1, a: a1, b: b1 } = hexToLab(c1);
  const { L: L2, a: a2, b: b2 } = hexToLab(c2);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (a: number, b: number) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hpm = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Limites do catálogo (ver teste templatesDistinct). */
export const MIN_PRIMARY_DE_SAME_SEGMENT = 12;
/** Dois modelos são "quase iguais" se a combinação primária + fundo é parecida (secundária não salva). */
export const NEAR_DUP = { primary: 10, bg: 4 };

export interface PaletteSig { id: string; segmentId: string; primary: string; secondary: string; bg: string }

export function isNearDuplicate(x: PaletteSig, y: PaletteSig): boolean {
  return deltaE2000(x.primary, y.primary) < NEAR_DUP.primary && deltaE2000(x.bg, y.bg) < NEAR_DUP.bg;
}

export function catalogViolations(sigs: PaletteSig[]) {
  const sameSegment: [string, string, number][] = [];
  const nearDuplicates: [string, string][] = [];
  for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
    const x = sigs[i], y = sigs[j];
    if (x.segmentId === y.segmentId) {
      const d = deltaE2000(x.primary, y.primary);
      if (d < MIN_PRIMARY_DE_SAME_SEGMENT) sameSegment.push([x.id, y.id, Math.round(d * 10) / 10]);
    }
    if (isNearDuplicate(x, y)) nearDuplicates.push([x.id, y.id]);
  }
  return { sameSegment, nearDuplicates };
}
