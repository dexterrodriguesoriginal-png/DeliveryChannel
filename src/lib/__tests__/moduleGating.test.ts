import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  BUSINESS_PRESETS, LEGACY_ENABLED_MODULES, MODULES, isTabModuleEnabled, presetModuleKeys, tabRequiredModule, type ModuleKey,
} from '../modules';
import { visibleFulfillmentTabsFor } from '../orders/fulfillmentTabs';
import { ModuleDisabledScreen } from '../../components/establishment/ModuleDisabledScreen';

const set = (...keys: ModuleKey[]) => new Set<ModuleKey>(keys);
const barbearia = new Set(presetModuleKeys('SALAO_BARBEARIA'));

describe('module gating of panel tabs', () => {
  it('maps module-dependent tabs', () => {
    expect(tabRequiredModule('est-kitchen')).toBe('kds');
    expect(tabRequiredModule('est-drivers')).toBe('delivery');
    expect(tabRequiredModule('est-salon')).toBe('dine_in');
    expect(tabRequiredModule('est-products')).toBeUndefined();
  });

  it.each([
    ['est-kitchen', 'kds'],
    ['est-drivers', 'delivery'],
    ['est-salon', 'dine_in'],
  ] as const)('%s shows only when %s is on', (tab, key) => {
    expect(isTabModuleEnabled(set(key), tab)).toBe(true);
    expect(isTabModuleEnabled(set(), tab)).toBe(false);
  });

  it('barbearia preset hides kitchen, drivers and salon but keeps core tabs', () => {
    expect(barbearia.has('kds')).toBe(false);
    expect(barbearia.has('delivery')).toBe(false);
    for (const tab of ['est-kitchen', 'est-drivers', 'est-salon']) expect(isTabModuleEnabled(barbearia, tab)).toBe(false);
    for (const tab of ['est-orders', 'est-products', 'est-modules', 'est-settings']) expect(isTabModuleEnabled(barbearia, tab)).toBe(true);
  });

  it('legacy fallback does not include the kitchen', () => {
    expect(LEGACY_ENABLED_MODULES.has('kds')).toBe(false);
    expect(isTabModuleEnabled(null, 'est-kitchen')).toBe(false);
    expect(isTabModuleEnabled(null, 'est-drivers')).toBe(true);
  });

  it('kitchen module is implemented and labelled Tela da Cozinha; food presets enable it', () => {
    const kds = MODULES.find(m => m.key === 'kds');
    expect(kds?.implemented).toBe(true);
    expect(kds?.label).toBe('Tela da Cozinha');
    expect(Object.keys(BUSINESS_PRESETS.RESTAURANTE)).toContain('kds');
  });
});

describe('Orders fulfillment tabs by module', () => {
  it('delivery / pickup / dine_in tabs follow modules', () => {
    expect(visibleFulfillmentTabsFor(k => k === 'pickup', [])).toEqual(['PICKUP']);
    expect(visibleFulfillmentTabsFor(k => k !== 'dine_in', [])).toEqual(['DELIVERY', 'PICKUP']);
    expect(visibleFulfillmentTabsFor(k => barbearia.has(k), [])).toEqual([]);
  });
  it('a tab with existing orders never disappears', () => {
    expect(visibleFulfillmentTabsFor(() => false, [{ fulfillmentType: 'DELIVERY' } as never])).toEqual(['DELIVERY']);
  });
});

describe('ModuleDisabledScreen', () => {
  it('owner sees the Módulos button', () => {
    const html = renderToStaticMarkup(React.createElement(ModuleDisabledScreen, { moduleKey: 'kds', canManageModules: true, onOpenModules: () => {} }));
    expect(html).toContain('Módulo desligado — ative em Módulos');
    expect(html).toContain('Tela da Cozinha');
    expect(html).toContain('open-modules');
  });
  it('staff sees no button', () => {
    const html = renderToStaticMarkup(React.createElement(ModuleDisabledScreen, { moduleKey: 'delivery', canManageModules: false }));
    expect(html).not.toContain('open-modules');
    expect(html).toContain('Peça ao responsável');
  });
});
