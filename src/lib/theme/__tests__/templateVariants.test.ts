import { describe, expect, it } from 'vitest';
import { filterTemplates, getTemplateById, findClosestTemplate } from '../templates';
describe('variações na galeria', () => {
  it('combina segmento, cor, estilo e modo sem perder o estilo ao recolorir', () => {
    const templates = filterTemplates({
      segment: 'adega',
      colorFamily: 'azul',
      style: 'artesanal',
      mode: 'dark',
    });
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      expect(template.segmentId).toBe('adega');
      expect(template.colorFamily).toBe('azul');
      expect(template.mode).toBe('dark');
      expect(template.style).toContain('artesanal');
      expect(getTemplateById(template.id)).toEqual(template);
      expect(findClosestTemplate(template.tokens).id).toBe(template.id);
    }
  });
});
