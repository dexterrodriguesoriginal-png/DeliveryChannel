import { describe, it, expect } from 'vitest';
import { PRESET_THEMES } from '../presetThemes';
import { TEMPLATES, getTemplateById } from '../templates/catalog';
import { LEGACY_PRESET_TO_TEMPLATE, findClosestTemplate } from '../templates/legacyMap';

describe('Mapeamento de Presets Legados — legacyMap.test.ts', () => {
  it('todos os 40 temas legados estão mapeados para um modelo equivalente no catálogo de 150', () => {
    expect(PRESET_THEMES.length).toBe(40);

    for (const legacy of PRESET_THEMES) {
      const mappedTemplateId = LEGACY_PRESET_TO_TEMPLATE[legacy.id];
      expect(
        mappedTemplateId,
        `Tema legado "${legacy.id}" não possui mapeamento em LEGACY_PRESET_TO_TEMPLATE`
      ).toBeDefined();

      const targetTemplate = getTemplateById(mappedTemplateId);
      expect(
        targetTemplate,
        `Tema legado "${legacy.id}" mapeou para "${mappedTemplateId}", que não existe em TEMPLATES`
      ).toBeDefined();
    }
  });

  it('findClosestTemplate() resolve identificadores legados para seus modelos mapeados', () => {
    const tmplAdega = findClosestTemplate({ presetId: 'adega-vinho' });
    expect(tmplAdega.id).toBe(LEGACY_PRESET_TO_TEMPLATE['adega-vinho']);

    const tmplRoxo = findClosestTemplate({ presetId: 'roxo-noturno' });
    expect(tmplRoxo.id).toBe(LEGACY_PRESET_TO_TEMPLATE['roxo-noturno']);
  });

  it('findClosestTemplate() resolve IDs diretos do catálogo de 150 modelos', () => {
    const tmpl = findClosestTemplate({ templateId: 'pizzaria-tomate-manjericao' });
    expect(tmpl.id).toBe('pizzaria-tomate-manjericao');
  });

  it('findClosestTemplate() encontra modelo mais próximo cromaticamente quando fornecida uma cor customizada', () => {
    // Tom de verde
    const closestVerde = findClosestTemplate({
      customColor: '#10b981',
    });
    expect(closestVerde).toBeDefined();
    expect(closestVerde.colorFamily).toBe('verde');

    // Tom de vermelho escuro
    const closestVermelho = findClosestTemplate({
      customColor: '#7f1d1d',
    });
    expect(closestVermelho).toBeDefined();
    expect(['vermelho', 'marrom']).toContain(closestVermelho.colorFamily);
  });

  it('findClosestTemplate() sempre retorna um modelo válido mesmo sem nenhum parâmetro', () => {
    const fallback = findClosestTemplate({});
    expect(fallback).toBeDefined();
    expect(fallback.tokens).toBeDefined();
    expect(fallback.tokens.version).toBe(1);
  });
});
