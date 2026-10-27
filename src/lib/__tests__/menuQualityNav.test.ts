import { describe, expect, it } from 'vitest';
import { canAccessEstTab } from '../navPermissions';
import { readPanelRoute } from '../panelRoute';

describe('rota Qualidade do Cardápio', () => {
  it('rota do painel existe', () => expect(readPanelRoute('#/painel/est-quality')).toEqual({ page: 'est-quality', tab: undefined }));
  it('mesma permissão de produtos: dono e gerente entram; caixa, garçom e cozinha não', () => {
    expect(canAccessEstTab('OWNER', 'est-quality')).toBe(true);
    expect(canAccessEstTab('MANAGER', 'est-quality')).toBe(canAccessEstTab('MANAGER', 'est-products'));
    for (const r of ['CASHIER', 'WAITER', 'KITCHEN', 'DRIVER', 'CUSTOMER'] as const) expect(canAccessEstTab(r, 'est-quality')).toBe(false);
  });
});
