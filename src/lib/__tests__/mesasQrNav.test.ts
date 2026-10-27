import { describe, expect, it } from 'vitest';
import { canAccessEstTab } from '../navPermissions';
import { tabRequiredModule, isTabModuleEnabled } from '../modules';
import { readPanelRoute } from '../panelRoute';

describe('Mesas e QR Code — navegação', () => {
  it('só OWNER e MANAGER (e CEO) acessam a ferramenta; caixa, garçom e cozinha não', () => {
    for (const role of ['OWNER', 'MANAGER', 'CEO', 'SUPER_ADMIN'] as const) expect(canAccessEstTab(role, 'est-mesas-qr')).toBe(true);
    for (const role of ['CASHIER', 'WAITER', 'KITCHEN', 'DRIVER', 'CUSTOMER'] as const) expect(canAccessEstTab(role, 'est-mesas-qr')).toBe(false);
  });
  it('depende do módulo dine_in', () => {
    expect(tabRequiredModule('est-mesas-qr')).toBe('dine_in');
    expect(isTabModuleEnabled(new Set(['kds']) as never, 'est-mesas-qr')).toBe(false);
    expect(isTabModuleEnabled(new Set(['dine_in']) as never, 'est-mesas-qr')).toBe(true);
  });
  it('tem rota própria no painel', () => {
    expect(readPanelRoute('#/painel/est-mesas-qr')).toEqual({ page: 'est-mesas-qr' });
  });
});
