import type { StoreTemplate, ThemeTokens } from '../../types/theme';
import { deltaE2000 } from './colorDistance';

/** Canonical visual identity: metadata, names and insertion order cannot hide aliases. */
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export function visualSignature(tokens: ThemeTokens): string {
  const { meta: _meta, ...visual } = tokens;
  return JSON.stringify(canonical(visual));
}

/** Full-palette ΔE plus major composition axes. A one-pixel border change cannot disguise a duplicate. */
export function isVisualNearDuplicate(a: StoreTemplate, b: StoreTemplate): boolean {
  if (a.mode !== b.mode) return false;
  const x = a.tokens, y = b.tokens;
  const distances = (Object.keys(x.palette) as (keyof typeof x.palette)[]).map(key => deltaE2000(x.palette[key], y.palette[key]));
  const backgroundsClose = (['general', 'header', 'card'] as const).every(surface => {
    const p = x.backgrounds[surface], q = y.backgrounds[surface];
    return p.type === q.type && p.imageUrl === q.imageUrl && Math.abs((p.angle || 0) - (q.angle || 0)) < 15
      && (p.gradientColors || []).length === (q.gradientColors || []).length
      && (p.gradientColors || []).every((color, index) => deltaE2000(color, q.gradientColors![index]) < 8);
  });
  const axes = [
    x.layout?.productLayout !== y.layout?.productLayout,
    x.layout?.headerStyle !== y.layout?.headerStyle,
    x.layout?.categoryStyle !== y.layout?.categoryStyle,
    x.layout?.density !== y.layout?.density,
    x.typography.fontFamily !== y.typography.fontFamily,
    x.typography.headingFontFamily !== y.typography.headingFontFamily,
    Math.abs((x.components.borderRadiusPx || 0) - (y.components.borderRadiusPx || 0)) >= 8,
    Math.abs((x.components.shadowLevel || 0) - (y.components.shadowLevel || 0)) >= 2,
  ].filter(Boolean).length;
  return backgroundsClose && Math.max(...distances) < 10 && distances.reduce((sum, d) => sum + d, 0) / distances.length < 5 && axes < 3;
}

export function visualCatalogViolations(templates: StoreTemplate[]) {
  const duplicateIds: string[] = [], duplicateNames: string[] = [];
  const identical: [string, string][] = [], near: [string, string][] = [];
  const ids = new Set<string>(), names = new Set<string>(), signatures = new Map<string, string>();
  for (const t of templates) {
    if (ids.has(t.id)) duplicateIds.push(t.id);
    if (names.has(t.name)) duplicateNames.push(t.name);
    ids.add(t.id); names.add(t.name);
    const sig = visualSignature(t.tokens), previous = signatures.get(sig);
    if (previous) identical.push([previous, t.id]);
    signatures.set(sig, t.id);
  }
  for (let i = 0; i < templates.length; i++) for (let j = i + 1; j < templates.length; j++) {
    if (isVisualNearDuplicate(templates[i], templates[j])) near.push([templates[i].id, templates[j].id]);
  }
  return { duplicateIds, duplicateNames, identical, near };
}
