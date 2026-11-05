import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canManageMenuOutdoor, isMarketingTab, showPickupQrTab } from '../marketingTabs';

describe('Marketing pickup QR tab', () => {
  it('recognizes the supported Marketing sub-tabs', () => {
    expect(isMarketingTab('pickup-qr')).toBe(true);
    expect(isMarketingTab('campaigns')).toBe(true);
    expect(isMarketingTab('menu-outdoor')).toBe(true);
    expect(isMarketingTab('not-a-marketing-tab')).toBe(false);
  });

  it('shows only when pickup is enabled', () => {
    expect(showPickupQrTab(k => k === 'pickup')).toBe(true);
    expect(showPickupQrTab(() => false)).toBe(false);
  });
  it('card lives only inside the new tab, right after Materiais & QR Code', () => {
    const src = readFileSync(new URL('../../pages/establishment/MarketingPage.tsx', import.meta.url), 'utf8');
    expect(src.match(/<ArrivalQrMarketingCard/g)).toHaveLength(1);
    expect(src).toMatch(/activeTab === 'pickup-qr' && pickupQrTabVisible && activeTenant\?\.id && \(\s*<ArrivalQrMarketingCard/);
    expect(src.indexOf('QR Code de Retirada')).toBeGreaterThan(src.indexOf('Materiais & QR Code'));
  });
});


describe('Marketing outdoor tab', () => {
  it('reserva a gestão para dono e gerente vinculados', () => {
    expect(canManageMenuOutdoor('OWNER')).toBe(true);
    expect(canManageMenuOutdoor('MANAGER')).toBe(true);
    for (const role of ['CEO', 'SUPER_ADMIN', 'OPERATOR', 'WAITER', null, undefined]) {
      expect(canManageMenuOutdoor(role)).toBe(false);
    }
  });
  it('monta o painel separado somente na aba autorizada', () => {
    const src = readFileSync(new URL('../../pages/establishment/MarketingPage.tsx', import.meta.url), 'utf8');
    expect(src.match(/<MenuOutdoorPanel/g)).toHaveLength(1);
    expect(src).toMatch(/activeTab === 'menu-outdoor' && menuOutdoorTabVisible && \(\s*<MenuOutdoorPanel/);
    expect(src).toContain('Outdoor do cardápio');
  });
});
