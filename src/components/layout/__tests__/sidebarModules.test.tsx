import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canAccessEstTab } from '../../../lib/navPermissions';
import { isTabModuleEnabled, ModuleKey } from '../../../lib/modules';

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ count: 0, error: null }),
        }),
      }),
    }),
  },
  isSupabaseConfigured: false,
}));

describe('Sidebar — isolamento de módulos e matriz de permissões', () => {
  it('oculta aba Tela da Cozinha (est-kitchen) quando módulo kds estiver desativado', () => {
    const modulesSemCozinha = new Set<ModuleKey>(['delivery', 'pickup', 'pos']);
    expect(isTabModuleEnabled(modulesSemCozinha, 'est-kitchen')).toBe(false);

    const modulesComCozinha = new Set<ModuleKey>(['delivery', 'pickup', 'pos', 'kds']);
    expect(isTabModuleEnabled(modulesComCozinha, 'est-kitchen')).toBe(true);
  });

  it('oculta aba Frota & Entregadores (est-drivers) quando módulo delivery estiver desativado', () => {
    const semDelivery = new Set<ModuleKey>(['pickup', 'pos']);
    expect(isTabModuleEnabled(semDelivery, 'est-drivers')).toBe(false);

    const comDelivery = new Set<ModuleKey>(['pickup', 'delivery', 'pos']);
    expect(isTabModuleEnabled(comDelivery, 'est-drivers')).toBe(true);
  });

  it('oculta Salão (est-salon) quando módulo dine_in estiver desativado', () => {
    const semSalao = new Set<ModuleKey>(['delivery', 'pos']);
    expect(isTabModuleEnabled(semSalao, 'est-salon')).toBe(false);

    const comSalao = new Set<ModuleKey>(['delivery', 'pos', 'dine_in']);
    expect(isTabModuleEnabled(comSalao, 'est-salon')).toBe(true);
  });

  it('Laboratório de Isolamento (security-lab) nunca é acessível por OWNER no painel', () => {
    expect(canAccessEstTab('OWNER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('MANAGER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('CASHIER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('WAITER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('KITCHEN', 'security-lab')).toBe(false);
    expect(canAccessEstTab('DRIVER', 'security-lab')).toBe(false);
    // Apenas CEO e SUPER_ADMIN
    expect(canAccessEstTab('CEO', 'security-lab')).toBe(true);
    expect(canAccessEstTab('SUPER_ADMIN', 'security-lab')).toBe(true);
  });

  it('filtra itens do menu por papel estritamente conforme a matriz', () => {
    // CASHIER: Dashboard, Pedidos, Salão, Clientes
    expect(canAccessEstTab('CASHIER', 'est-dashboard')).toBe(true);
    expect(canAccessEstTab('CASHIER', 'est-orders')).toBe(true);
    expect(canAccessEstTab('CASHIER', 'est-salon')).toBe(true);
    expect(canAccessEstTab('CASHIER', 'est-customers')).toBe(true);
    expect(canAccessEstTab('CASHIER', 'est-finance')).toBe(false);
    expect(canAccessEstTab('CASHIER', 'est-team')).toBe(false);

    // WAITER: Pedidos, Salão (sem Dashboard nem Configurações)
    expect(canAccessEstTab('WAITER', 'est-orders')).toBe(true);
    expect(canAccessEstTab('WAITER', 'est-salon')).toBe(true);
    expect(canAccessEstTab('WAITER', 'est-dashboard')).toBe(false);
    expect(canAccessEstTab('WAITER', 'est-finance')).toBe(false);

    // KITCHEN: só Pedidos e Cozinha
    expect(canAccessEstTab('KITCHEN', 'est-orders')).toBe(true);
    expect(canAccessEstTab('KITCHEN', 'est-kitchen')).toBe(true);
    expect(canAccessEstTab('KITCHEN', 'est-dashboard')).toBe(false);
    expect(canAccessEstTab('KITCHEN', 'est-customers')).toBe(false);

    // DRIVER: nenhuma aba de estabelecimento
    for (const tab of ['est-dashboard', 'est-orders', 'est-salon', 'est-customers', 'est-kitchen', 'est-settings']) {
      expect(canAccessEstTab('DRIVER', tab)).toBe(false);
    }
  });
});
