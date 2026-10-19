import { describe, it, expect } from 'vitest';
import { isOwnerPanelTab } from '../ownerPanel';

describe('isOwnerPanelTab', () => {
  it('abas do estabelecimento usam o fundo do painel do dono', () => {
    for (const t of ['est-dashboard', 'est-orders', 'est-products', 'est-settings']) {
      expect(isOwnerPanelTab(t)).toBe(true);
    }
  });
  it('CEO e Security Lab mantêm o fundo atual', () => {
    for (const t of ['ceo-dashboard', 'ceo-tenants', 'security-lab']) {
      expect(isOwnerPanelTab(t)).toBe(false);
    }
  });
});
