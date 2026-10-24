import { describe, it, expect } from 'vitest';
import { canAccessEstTab, EST_TAB_PERMISSION, getDefaultAllowedTab } from '../navPermissions';

const tabs = Object.keys(EST_TAB_PERMISSION);
const visible = (r: any) => tabs.filter(t => canAccessEstTab(r, t));

describe('menu por papel (matriz de permissões)', () => {
  it('OWNER vê todas as abas do estabelecimento e não vê security-lab', () => {
    expect(visible('OWNER')).toEqual(tabs);
    expect(canAccessEstTab('OWNER', 'security-lab')).toBe(false);
  });

  it('CASHIER = Dashboard, Pedidos, Salão, Clientes', () => {
    expect(visible('CASHIER')).toEqual([
      'est-dashboard',
      'est-orders',
      'est-salon',
      'est-customers',
    ]);
  });

  it('WAITER = Pedidos, Salão', () => {
    expect(visible('WAITER')).toEqual([
      'est-orders',
      'est-salon',
    ]);
  });

  it('KITCHEN = só Pedidos/Cozinha', () => {
    expect(visible('KITCHEN')).toEqual([
      'est-orders',
      'est-kitchen',
    ]);
  });

  it('DRIVER nunca vê o painel do estabelecimento', () => {
    expect(visible('DRIVER')).toEqual([]);
    for (const t of tabs) {
      expect(canAccessEstTab('DRIVER', t)).toBe(false);
    }
  });

  it('CUSTOMER nunca vê o painel do estabelecimento', () => {
    expect(visible('CUSTOMER')).toEqual([]);
  });

  it('MANAGER não vê financeiro, equipe, tema nem configurações', () => {
    const v = visible('MANAGER');
    for (const t of ['est-finance', 'est-reports', 'est-team', 'est-theme', 'est-settings']) {
      expect(v).not.toContain(t);
    }
    expect(v).toContain('est-drivers');
    expect(v).toContain('est-modules');
    expect(canAccessEstTab('MANAGER', 'security-lab')).toBe(false);
  });

  it('security-lab fica visível e acessível exclusivamente para CEO e SUPER_ADMIN', () => {
    expect(canAccessEstTab('CEO', 'security-lab')).toBe(true);
    expect(canAccessEstTab('SUPER_ADMIN', 'security-lab')).toBe(true);
    expect(canAccessEstTab('OWNER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('MANAGER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('CASHIER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('WAITER', 'security-lab')).toBe(false);
    expect(canAccessEstTab('KITCHEN', 'security-lab')).toBe(false);
    expect(canAccessEstTab('DRIVER', 'security-lab')).toBe(false);
  });

  it('getDefaultAllowedTab retorna fallback adequado por papel', () => {
    expect(getDefaultAllowedTab('OWNER')).toBe('est-dashboard');
    expect(getDefaultAllowedTab('MANAGER')).toBe('est-dashboard');
    expect(getDefaultAllowedTab('CASHIER')).toBe('est-dashboard');
    expect(getDefaultAllowedTab('WAITER')).toBe('est-orders');
    expect(getDefaultAllowedTab('KITCHEN')).toBe('est-orders');
  });
});
