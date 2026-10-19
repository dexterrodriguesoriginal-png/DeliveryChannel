import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PRESETS,
  BUSINESS_TYPES,
  MODULE_DISABLE_CHECKS,
  ModuleKey,
  canDisableModule,
  isModuleEnabled,
  presetModuleKeys,
} from '../modules';

const expectedPresets: Record<string, Array<[ModuleKey, Record<string, unknown>]>> = {
  RESTAURANTE: [['delivery', {}], ['pickup', {}], ['addons', {}], ['kds', {}], ['dine_in', { mode: 'TABLE' }], ['service_fee', { percent: 10 }], ['pos', {}]],
  PIZZARIA: [['delivery', {}], ['pickup', {}], ['addons', {}], ['kds', {}], ['dine_in', { mode: 'TABLE' }], ['service_fee', { percent: 10 }], ['pos', {}], ['loyalty', {}]],
  BAR: [['addons', {}], ['kds', { mode: 'BAR' }], ['dine_in', { mode: 'INDIVIDUAL' }], ['counter', {}], ['service_fee', { percent: 10 }], ['pos', {}]],
  LANCHONETE_CAFE: [['delivery', {}], ['pickup', {}], ['addons', {}], ['kds', {}], ['counter', {}], ['pos', {}], ['loyalty', {}]],
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
    expect(presetModuleKeys('SALAO_BARBEARIA')).not.toContain('delivery');
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
