import { describe, expect, it } from 'vitest';
import { MODULES, isModuleEnabled, presetModuleKeys, toolPlanBadge } from '../modules';

describe('Abertura da loja como ferramenta opcional', () => {
  const module = MODULES.find(m => m.key === 'store_presentation');
  it('vem desligada para novas lojas, lojas antigas e todos os presets', () => {
    expect(module?.implemented).toBe(true);
    expect(module?.category).toBe('Marketing');
    expect(isModuleEnabled(null, 'store_presentation')).toBe(false);
    expect(isModuleEnabled(new Set(['delivery', 'pickup']), 'store_presentation')).toBe(false);
    for (const type of ['RESTAURANTE','BAR','LANCHONETE_CAFE','PIZZARIA','MERCADO',
      'ADEGA','ROUPAS','PERFUMARIA','SALAO_BARBEARIA','CONSTRUCAO','AMBULANTE','OUTRO'] as const) {
      expect(presetModuleKeys(type)).not.toContain('store_presentation');
    }
  });
  it('reservou o mesmo esquema de plano e adicional sem criar cobrança', () => {
    expect(module?.plan).toBeNull();
    expect(module?.addonPriceCents).toBeNull();
    expect(toolPlanBadge(module!)).toBeNull();
  });
  it('ativação independente não interfere nos módulos de vendas', () => {
    const enabled = new Set(['delivery', 'pickup', 'store_presentation'] as const);
    expect(isModuleEnabled(enabled, 'store_presentation')).toBe(true);
    expect(isModuleEnabled(enabled, 'delivery')).toBe(true);
  });
});
