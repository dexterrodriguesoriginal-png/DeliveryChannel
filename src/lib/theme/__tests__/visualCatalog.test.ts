import { describe, expect, it } from 'vitest';
import { TEMPLATES, filterTemplates, SEGMENTS } from '../templates';
import { isVisualNearDuplicate, visualCatalogViolations, visualSignature } from '../visualSignature';
import { themeContrastGuidance } from '../contrastGuidance';

describe('500 complete visual compositions', () => {
  it('rejects duplicate IDs, names, full tokens and near compositions', () => {
    expect(visualCatalogViolations(TEMPLATES)).toEqual({ duplicateIds: [], duplicateNames: [], identical: [], near: [] });
  });
  it('detects aliases, almost identical tokens and one-pixel disguise', () => {
    const a = TEMPLATES[0], b = structuredClone(a);
    b.id = 'alias'; b.name = 'Another name'; b.tokens.meta = { templateId: b.id };
    expect(visualSignature(a.tokens)).toBe(visualSignature(b.tokens));
    b.tokens.palette.primary = '#7f1c32';
    b.tokens.components.borderWidthPx = (a.tokens.components.borderWidthPx || 0) + 1;
    expect(isVisualNearDuplicate(a, b)).toBe(true);
    expect(visualCatalogViolations([a, { ...a }]).duplicateIds).toEqual([a.id]);
  });
  it('provides balanced modes, several families, all typography and layout axes per segment', () => {
    for (const segment of SEGMENTS) {
      const themes = TEMPLATES.filter(t => t.segmentId === segment.id);
      expect(themes).toHaveLength(20);
      expect(themes.filter(t => t.mode === 'light')).toHaveLength(10);
      expect(themes.filter(t => t.mode === 'dark')).toHaveLength(10);
      expect(new Set(themes.map(t => t.colorFamily)).size, segment.id).toBeGreaterThanOrEqual(5);
      expect(new Set(themes.map(t => t.tokens.typography.fontFamily)).size).toBeGreaterThanOrEqual(4);
      expect(new Set(themes.map(t => t.tokens.layout!.productLayout)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(themes.map(t => t.tokens.components.cardRadius)).size).toBeGreaterThanOrEqual(4);
    }
  });
  it('checks complete legibility including selected categories and promotional prices', () => {
    expect(TEMPLATES.flatMap(t => themeContrastGuidance(t.tokens).map(issue => `${t.id}: ${issue.label}`))).toEqual([]);
  });
  it('matches accent-insensitive name, family, shade and style without unrelated recolors', () => {
    expect(filterTemplates({ search: 'nao-existe-esta-busca', segment: 'adega', colorFamily: 'azul' })).toEqual([]);
    expect(filterTemplates({ search: 'ACAI', includeRecolored: false }).every(t => t.segmentId === 'acai')).toBe(true);
    const selected = TEMPLATES.find(t => t.id.includes('-colecao-'))!;
    const result = filterTemplates({ segment: selected.segmentId, colorFamily: selected.colorFamily, style: selected.style[0], mode: selected.mode, shade: selected.shade, search: selected.name, includeRecolored: false });
    expect(result.map(t => t.id)).toEqual([selected.id]);
  });
});

it('offers readable manual suggestions and preserves the owner palette', () => {
  const tokens = structuredClone(TEMPLATES[0].tokens);
  tokens.palette.textMain = tokens.palette.bgCard;
  const before = JSON.stringify(tokens);
  const issue = themeContrastGuidance(tokens).find(issue => issue.foreground === 'textMain')!;
  expect(issue.ratio).toBe(1);
  expect(issue.suggestion).not.toBe(tokens.palette.textMain);
  expect(JSON.stringify(tokens)).toBe(before);
});
