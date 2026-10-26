import { describe, it, expect } from 'vitest';
import { TEMPLATES, filterTemplates, getTemplateById } from '../templates/catalog';
import { SEGMENTS } from '../templates/segments';
import {
  VALID_PRODUCT_LAYOUTS,
  VALID_PHOTO_SIZES,
  VALID_PHOTO_RATIOS,
  VALID_HEADER_STYLES,
  VALID_CATEGORY_STYLES,
  VALID_DENSITIES,
} from '../themeEngine';

describe('Catálogo de 150 Modelos — templatesCatalog.test.ts', () => {
  it('contém exatamente 150 modelos gerados como dados', () => {
    expect(TEMPLATES.length).toBe(150);
  });

  it('todos os 150 modelos possuem IDs únicos', () => {
    const ids = TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(150);
  });

  it('cobre exatamente os 25 segmentos de negócio especificados', () => {
    expect(SEGMENTS.length).toBe(25);
    const segmentIdsInTemplates = new Set(TEMPLATES.map((t) => t.segmentId));
    expect(segmentIdsInTemplates.size).toBe(25);

    for (const segment of SEGMENTS) {
      expect(segmentIdsInTemplates.has(segment.id)).toBe(true);
      expect(segment.sampleProducts.length).toBe(4);
      expect(segment.label.length).toBeGreaterThan(0);
    }
  });

  it('cada segmento possui exatamente 6 modelos distintos (3 claros e 3 escuros)', () => {
    for (const segment of SEGMENTS) {
      const models = TEMPLATES.filter((t) => t.segmentId === segment.id);
      expect(models.length).toBe(6);

      const lightModels = models.filter((t) => t.mode === 'light');
      const darkModels = models.filter((t) => t.mode === 'dark');
      expect(lightModels.length).toBe(3);
      expect(darkModels.length).toBe(3);
    }
  });

  it('todos os modelos têm tokens serializados com tamanho estritamente < 16 KB', () => {
    for (const template of TEMPLATES) {
      const serialized = JSON.stringify(template.tokens);
      expect(serialized.length).toBeLessThan(16384);
      // Na prática nossos tokens têm ~2-3 KB
      expect(serialized.length).toBeGreaterThan(500);
    }
  });

  it('todos os modelos respeitam a versão 1 dos tokens e possuem estrutura completa', () => {
    for (const template of TEMPLATES) {
      expect(template.tokens.version).toBe(1);
      expect(template.tokens.meta?.templateId).toBe(template.id);
      expect(template.tokens.palette).toBeDefined();
      expect(template.tokens.backgrounds).toBeDefined();
      expect(template.tokens.typography).toBeDefined();
      expect(template.tokens.components).toBeDefined();
      expect(template.tokens.layout).toBeDefined();

      const layout = template.tokens.layout!;
      expect(VALID_PRODUCT_LAYOUTS.has(layout.productLayout)).toBe(true);
      expect(VALID_PHOTO_SIZES.has(layout.photoSize)).toBe(true);
      expect(VALID_PHOTO_RATIOS.has(layout.photoRatio)).toBe(true);
      expect(VALID_HEADER_STYLES.has(layout.headerStyle)).toBe(true);
      expect(VALID_CATEGORY_STYLES.has(layout.categoryStyle)).toBe(true);
      expect(VALID_DENSITIES.has(layout.density)).toBe(true);

      const comp = template.tokens.components;
      const radiusPx = comp.borderRadiusPx !== undefined ? comp.borderRadiusPx : parseInt(comp.cardRadius || '0', 10);
      expect(radiusPx).toBeGreaterThanOrEqual(0);
      expect(radiusPx).toBeLessThanOrEqual(28);

      const shadow = comp.shadowLevel ?? 0;
      expect(shadow).toBeGreaterThanOrEqual(0);
      expect(shadow).toBeLessThanOrEqual(5);
    }
  });

  describe('filterTemplates()', () => {
    it('filtra modelos por segmento', () => {
      const results = filterTemplates({ segment: 'adega' });
      expect(results.length).toBe(6);
      expect(results.every((t) => t.segmentId === 'adega')).toBe(true);
    });

    it('filtra modelos por modo light / dark', () => {
      const light = filterTemplates({ mode: 'light' });
      const dark = filterTemplates({ mode: 'dark' });
      expect(light.length).toBe(75);
      expect(dark.length).toBe(75);
    });

    it('filtra modelos por busca textual (nome ou segmento)', () => {
      const pizzarias = filterTemplates({ search: 'pizza' });
      expect(pizzarias.length).toBeGreaterThanOrEqual(6);
      expect(pizzarias.some((t) => t.segmentId === 'pizzaria')).toBe(true);
    });

    it('filtra por família de cor existente', () => {
      const verdes = filterTemplates({ colorFamily: 'verde' });
      expect(verdes.length).toBeGreaterThan(0);
      expect(verdes.every((t) => t.colorFamily === 'verde')).toBe(true);
    });

    it('gera variante recolorida determinística se segmento × colorFamily não estiver no catálogo nativo', () => {
      // Por exemplo, pedir adega com cor amarela (se não existir nativamente)
      const results = filterTemplates({ segment: 'adega', colorFamily: 'amarelo' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].colorFamily).toBe('amarelo');
      expect(results[0].segmentId).toBe('adega');
      expect(results[0].tokens.palette.primary).toBeDefined();
    });
  });

  describe('getTemplateById()', () => {
    it('recupera modelo por ID exato', () => {
      const tmpl = getTemplateById('adega-bordo-creme');
      expect(tmpl).toBeDefined();
      expect(tmpl?.name).toBe('Bordô & Creme Tradicional');
      expect(tmpl?.segmentLabel).toBe('Adega e Vinhos');
      expect(tmpl?.colorFamily).toBe('vermelho');
    });

    it('retorna undefined para ID inexistente', () => {
      const tmpl = getTemplateById('modelo-inexistente-12345');
      expect(tmpl).toBeUndefined();
    });
  });
});
