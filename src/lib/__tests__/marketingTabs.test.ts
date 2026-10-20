import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { showPickupQrTab } from '../marketingTabs';

describe('Marketing pickup QR tab', () => {
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
