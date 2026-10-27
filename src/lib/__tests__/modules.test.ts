import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PRESETS,
  BUSINESS_TYPES,
  MODULES,
  MODULE_DISABLE_CHECKS,
  ModuleKey,
  canDisableModule,
  isModuleEnabled,
  presetModuleKeys,
  TOOL_CATEGORIES,
  TOOL_SHORTCUTS,
  toolPlanBadge,
  visibleToolShortcuts,
} from '../modules';

const expectedPresets: Record<string, Array<[ModuleKey, Record<string, unknown>]>> = {
  RESTAURANTE: [['delivery', {}], ['pickup', {}], ['kds', {}], ['dine_in', { mode: 'TABLE' }], ['service_fee', { percent: 10 }], ['pos', {}]],
  PIZZARIA: [['delivery', {}], ['pickup', {}], ['kds', {}], ['dine_in', { mode: 'TABLE' }], ['service_fee', { percent: 10 }], ['pos', {}], ['loyalty', {}]],
  BAR: [['kds', { mode: 'BAR' }], ['dine_in', { mode: 'INDIVIDUAL' }], ['counter', {}], ['service_fee', { percent: 10 }], ['pos', {}]],
  LANCHONETE_CAFE: [['delivery', {}], ['pickup', {}], ['kds', {}], ['counter', {}], ['pos', {}], ['loyalty', {}]],
  MERCADO: [['delivery', {}], ['pickup', {}], ['weight', {}], ['barcode', {}], ['substitution', {}], ['pos', {}]],
  ADEGA: [['delivery', {}], ['pickup', {}], ['barcode', {}], ['pos', {}], ['loyalty', {}]],
  ROUPAS: [['delivery', {}], ['pickup', {}], ['barcode', {}], ['variants', {}], ['reserve_exchange', {}], ['pos', {}]],
  PERFUMARIA: [['delivery', {}], ['pickup', {}], ['barcode', {}], ['variants', {}], ['reserve_exchange', {}], ['pos', {}], ['loyalty', {}]],
  SALAO_BARBEARIA: [['scheduling', {}], ['pos', {}], ['loyalty', {}]],
  CONSTRUCAO: [['delivery', {}], ['pickup', {}], ['barcode', {}], ['quotes', {}], ['pos', {}]],
  AMBULANTE: [['pickup', {}], ['street_vendor', {}], ['pos', {}]],
  OUTRO: [['delivery', {}], ['pickup', {}]],
};

describe('business module presets', () => {
  it('defines exactly one preset for each of the 12 business types', () => {
    expect(BUSINESS_TYPES).toHaveLength(12);
    for (const { key } of BUSINESS_TYPES) {
      expect(Object.entries(BUSINESS_PRESETS[key]).sort()).toEqual(expectedPresets[key].sort());
    }
  });

  it('treats disabled modules as off and preserves legacy behavior when module data is unavailable', () => {
    expect(isModuleEnabled(new Set(['scheduling']), 'delivery')).toBe(false);
    expect(isModuleEnabled(new Set(['scheduling']), 'scheduling')).toBe(true);
    expect(isModuleEnabled(null, 'delivery')).toBe(true);
    expect(isModuleEnabled(null, 'addons')).toBe(false);
    expect(isModuleEnabled(null, 'dine_in')).toBe(false);
    expect(presetModuleKeys('SALAO_BARBEARIA')).not.toContain('delivery');
    expect(MODULES.find(module => module.key === 'dine_in')?.implemented).toBe(true);
  });

  it('supports a per-module disable check and returns blocking items to the caller', async () => {
    const original = MODULE_DISABLE_CHECKS.dine_in;
    MODULE_DISABLE_CHECKS.dine_in = async tenantId => ({
      allowed: false,
      message: `Feche as comandas abertas em ${tenantId}.`,
    });
    try {
      await expect(canDisableModule('dine_in', 'tenant-1')).resolves.toEqual({
        allowed: false,
        message: 'Feche as comandas abertas em tenant-1.',
      });
    } finally {
      if (original) MODULE_DISABLE_CHECKS.dine_in = original;
      else delete MODULE_DISABLE_CHECKS.dine_in;
    }
  });
});

describe('Ferramentas: categorias, selo de plano reservado e atalhos', () => {
  it('toda ferramenta tem categoria e ícone; plano e preço seguem nulos (nada é cobrado)', () => {
    for (const module of MODULES) {
      expect(TOOL_CATEGORIES).toContain(module.category);
      expect(module.icon).toBeTruthy();
      expect(module.plan).toBeNull();
      expect(module.addonPriceCents).toBeNull();
      expect(toolPlanBadge(module)).toBeNull();
    }
  });
  it('selo só aparece quando houver regra de plano ou preço', () => {
    expect(toolPlanBadge({ plan: 'pro', addonPriceCents: null })).toBe('Incluído no plano');
    expect(toolPlanBadge({ plan: null, addonPriceCents: 1990 })).toBe('Adicional');
    expect(toolPlanBadge({ plan: 'pro', addonPriceCents: 1990 })).toBe('Adicional');
    expect(toolPlanBadge({ plan: null, addonPriceCents: 0 })).toBeNull();
  });
  it('Garçom, Salão, Mesas e QR Code e Qualidade do Cardápio são cards; Mesa/Comanda liga os de salão', () => {
    expect(TOOL_SHORTCUTS.map(t => t.id)).toEqual(['garcom', 'salon', 'mesas-qr', 'menu-quality']);
    const on = new Set<ModuleKey>(['dine_in']);
    expect(visibleToolShortcuts(on, 'OWNER').map(t => t.id)).toEqual(['garcom', 'salon', 'mesas-qr', 'menu-quality']);
    expect(visibleToolShortcuts(new Set<ModuleKey>(), 'OWNER').map(t => t.id)).toEqual(['menu-quality']);
    expect(visibleToolShortcuts(on, 'WAITER').map(t => t.id)).toEqual(['salon']);
    expect(visibleToolShortcuts(on, null)).toEqual([]);
    expect(TOOL_SHORTCUTS.find(t => t.id === 'garcom')?.action).toEqual({ kind: 'path', path: '/garcom', cta: 'Acessar Garçom' });
  });
});
