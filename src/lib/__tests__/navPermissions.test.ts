import { describe, it, expect } from 'vitest';
import { canAccessEstTab, EST_TAB_PERMISSION, getDefaultAllowedTab, roleDestination } from '../navPermissions';
const tabs = Object.keys(EST_TAB_PERMISSION);
const visible = (role: any, permissions?: string[]) => tabs.filter(tab => canAccessEstTab(role, tab, permissions));

describe('áreas e menu por papel', () => {
  it('Dono vê todas as áreas da loja; laboratório só CEO', () => {
    expect(visible('OWNER')).toEqual(tabs);
    expect(canAccessEstTab('OWNER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('CEO', 'security-lab')).toBe(true);
    expect(canAccessEstTab('SUPER_ADMIN', 'security-lab')).toBe(true);
  });
  it('Caixa acessa pedidos/PDV, mesas e recebimentos', () => {
    expect(visible('CASHIER')).toEqual(['est-orders','est-salon','est-customers']);
    expect(getDefaultAllowedTab('CASHIER')).toBe('est-orders');
  });
  it('Cozinha acessa só KDS, sem a página geral de pedidos/clientes', () => {
    expect(visible('KITCHEN')).toEqual(['est-kitchen']);
    expect(canAccessEstTab('KITCHEN', 'est-orders', ['view_orders','manage_kitchen'])).toBe(false);
    expect(roleDestination('KITCHEN', 'loja')).toBe('/cozinha');
  });
  it('Garçom usa seu app e não pedidos gerais', () => {
    expect(visible('WAITER')).toEqual(['est-salon']);
    expect(roleDestination('WAITER', 'loja')).toBe('/garcom/loja');
  });
  it('Gerente tem equipe e relatórios sem financeiro sensível ou assinatura', () => {
    const manager = visible('MANAGER');
    expect(manager).toContain('est-team'); expect(manager).toContain('est-reports');
    for (const page of ['est-finance','est-settings','est-modules','est-theme','security-lab']) expect(canAccessEstTab('MANAGER', page)).toBe(false);
    expect(canAccessEstTab('MANAGER', 'est-finance', ['view_finances'])).toBe(false);
  });
  it('Estoque e coordenador vão direto à sua operação', () => {
    expect(getDefaultAllowedTab('OPERATOR')).toBe('est-inventory');
    expect(getDefaultAllowedTab('DELIVERY_MANAGER')).toBe('est-drivers');
    expect(roleDestination('DRIVER', 'loja')).toBe('/entregador');
    expect(visible('DRIVER')).toEqual([]); expect(visible('CUSTOMER')).toEqual([]);
  });
  it('permissões recebidas do servidor substituem defaults e alteram menu/rota', () => {
    expect(visible('MANAGER', ['manage_catalog'])).toContain('est-products');
    expect(visible('MANAGER', ['manage_catalog'])).not.toContain('est-team');
    expect(getDefaultAllowedTab('MANAGER', ['manage_catalog'])).toBe('est-products');
    expect(getDefaultAllowedTab('MANAGER', [])).toBe('access-denied');
    expect(canAccessEstTab('MANAGER', 'inventada', ['manage_catalog'])).toBe(false);
  });
});

