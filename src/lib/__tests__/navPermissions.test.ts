import { describe, it, expect } from 'vitest';
import { canAccessEstTab, EST_TAB_PERMISSION } from '../navPermissions';

const tabs = Object.keys(EST_TAB_PERMISSION);
const visible = (r: any) => tabs.filter(t => canAccessEstTab(r, t));

describe('menu por papel', () => {
  it('OWNER vê tudo', () => expect(visible('OWNER')).toEqual(tabs));
  it('CASHIER vê só dashboard e pedidos', () => expect(visible('CASHIER')).toEqual(['est-dashboard', 'est-orders']));
  it('OPERATOR vê dashboard, pedidos e estoque', () => expect(visible('OPERATOR')).toEqual(['est-dashboard', 'est-orders', 'est-inventory']));
  it('MANAGER não vê financeiro, equipe, tema nem configurações', () => {
    const v = visible('MANAGER');
    for (const t of ['est-finance', 'est-reports', 'est-team', 'est-theme', 'est-settings']) expect(v).not.toContain(t);
    expect(v).toContain('est-drivers');
  });
  it('aba desconhecida não é bloqueada', () => expect(canAccessEstTab('CASHIER', 'security-lab')).toBe(true));
});
