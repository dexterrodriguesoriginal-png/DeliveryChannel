/**
 * Unidade/contrato do frontend N1–N6 (sem rede). O JSON da vitrine N6 foi extraído do PostgreSQL LOCAL
 * de testes (get_public_store como anon, dados sintéticos) — formato real do servidor, não inventado.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// Sem rede: nenhum cliente real (Node 20 não tem WebSocket nativo para o realtime).
vi.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import fs from 'node:fs';
import path from 'node:path';
import { resolveBackendSchema, isN1N6Backend } from '../../lib/backendSchema';
import { tenantSettingsColumns } from '../../lib/dbColumns';
import { mapN6PublicStore } from '../publicStoreN6';
import { n4OfferColumns, mapRowToOffer } from '../offerRepository';
import { legacyOrigin } from '../orderRepository';
import { settingsToDb, maskPixKey } from '../tenantRepository';
import { previewToValidateResult } from '../promotionRepository';
import { validateStatusChange, toServerItems } from '../orderMappers';
import { cardToDb } from '../campaignRepository';

const setMode = (m?: string) => {
  if (m === undefined) delete process.env.VITE_BACKEND_SCHEMA;
  else process.env.VITE_BACKEND_SCHEMA = m;
};
afterEach(() => setMode(undefined));

describe('VITE_BACKEND_SCHEMA', () => {
  it('padrão efetivo é n1n6; valores inválidos ainda resolvem para legacy-020', () => {
    expect(resolveBackendSchema(undefined)).toBe('legacy-020');
    expect(resolveBackendSchema('')).toBe('legacy-020');
    expect(resolveBackendSchema('N1N6-beta')).toBe('legacy-020');
    expect(resolveBackendSchema(' n1n6 ')).toBe('n1n6');
    setMode(undefined);
    expect(isN1N6Backend()).toBe(true);
    setMode('');
    expect(isN1N6Backend()).toBe(true);
    setMode('legacy-020');
    expect(isN1N6Backend()).toBe(false);
    setMode('n1n6');
    expect(isN1N6Backend()).toBe(true);
  });
  it('tenant_settings: n1n6 nunca seleciona pix_key; legacy não seleciona coluna da N1', () => {
    expect(tenantSettingsColumns('n1n6')).not.toMatch(/pix_key/);
    expect(tenantSettingsColumns('n1n6')).toMatch(/default_prep_time_minutes/);
    expect(tenantSettingsColumns('legacy-020')).not.toMatch(/default_prep_time_minutes/);
  });
  it('settingsToDb: n1n6 não grava pix_key; legacy não grava default_prep_time_minutes', () => {
    const n = settingsToDb({ pixKey: 'x', defaultPrepTimeMinutes: 20 } as any, true);
    expect(n).not.toHaveProperty('pix_key');
    expect(n).toMatchObject({ default_prep_time_minutes: 20 });
    const l = settingsToDb({ pixKey: 'x', defaultPrepTimeMinutes: 20 } as any, false);
    expect(l).toMatchObject({ pix_key: 'x' });
    expect(l).not.toHaveProperty('default_prep_time_minutes');
  });
  it('maskPixKey não expõe a chave', () => {
    expect(maskPixKey('52998224725')).not.toContain('52998224725');
    expect(maskPixKey(null)).toBeUndefined();
  });
});

describe('ofertas N4', () => {
  it('legacy-020 não envia nenhuma coluna N4', () => {
    setMode('legacy-020');
    expect(n4OfferColumns({ hasPromoCheckout: true, promoPrice: 7, mediaAssetId: 'a' } as any, false)).toEqual({});
  });
  it('n1n6 envia somente colunas reais da N4 e nunca promo_times_used', () => {
    setMode('n1n6');
    const db = n4OfferColumns({
      hasPromoCheckout: true, promoPrice: 7, promoUsageLimit: 10, promoMaxQuantityPerCustomer: 3,
      promoFulfillmentTypes: ['PICKUP'], promoTimesUsed: 99, mediaAssetId: 'a1', autoOverlay: false, startAt: '2026-01-01T00:00:00Z',
    } as any, false);
    expect(db).toMatchObject({
      has_promo_checkout: true, promo_price: 7, promo_usage_limit: 10, promo_max_qty_per_order: 3,
      promo_fulfillment: 'PICKUP', media_asset_id: 'a1', auto_overlay: false, start_at: '2026-01-01T00:00:00Z',
    });
    const allowed = new Set(['media_asset_id', 'start_at', 'end_at', 'auto_overlay', 'has_promo_checkout', 'promo_price',
      'promo_usage_limit', 'promo_max_qty_per_order', 'promo_fulfillment']);
    for (const k of Object.keys(db)) expect(allowed.has(k)).toBe(true);
  });
  it('update parcial só envia o que mudou; desligar checkout limpa os campos promocionais', () => {
    setMode('n1n6');
    expect(n4OfferColumns({ title: 'x' } as any, true)).toEqual({});
    expect(n4OfferColumns({ hasPromoCheckout: false } as any, true)).toMatchObject({ has_promo_checkout: false, promo_price: null, promo_fulfillment: null });
  });
  it('mapRowToOffer lê promo_fulfillment/promo_max_qty_per_order da N4', () => {
    const o = mapRowToOffer({ id: 'o', tenant_id: 't', title: 'x', has_promo_checkout: true, promo_price: '7.00', promo_fulfillment: 'BOTH', promo_max_qty_per_order: 4 } as any);
    expect(o.promoFulfillmentTypes).toEqual(['DELIVERY', 'PICKUP']);
    expect(o.promoMaxQtyPerOrder).toBe(4);
    expect(o.promoPrice).toBe(7);
  });
});

describe('pedidos', () => {
  it('legacyOrigin respeita o CHECK de 001–020', () => {
    expect(legacyOrigin('storefront')).toBe('direct');
    expect(legacyOrigin('whatsapp')).toBe('whatsapp');
    expect(legacyOrigin(undefined)).toBe('direct');
  });
  it('validateStatusChange: cancelado é final; cancelar exige motivo', () => {
    expect(validateStatusChange('CANCELLED', 'PENDING').ok).toBe(false);
    expect(validateStatusChange('PENDING', 'CANCELLED', ' ').ok).toBe(false);
    expect(validateStatusChange('PENDING', 'CANCELLED', 'motivo').ok).toBe(true);
  });
  it('toServerItems nunca envia preço', () => {
    expect(JSON.stringify(toServerItems([{ productId: 'p', quantity: 2, price: 1 } as any]))).not.toMatch(/price/);
  });
  it('previewToValidateResult usa o desconto do servidor', () => {
    expect(previewToValidateResult({ valid: true, code: 'DEZ10', discount: 2 } as any)).toMatchObject({ isValid: true, discountAmount: 2 });
    expect(previewToValidateResult({ valid: false } as any).isValid).toBe(false);
  });
});

describe('campanhas N5', () => {
  it('cardToDb respeita o CHECK por modo e nunca envia contador', () => {
    expect(cardToDb({ commercialMode: 'PRODUCT', productId: 'p', offerId: 'o', cardPromotionalPrice: 8, customTimesUsed: 3 } as any))
      .toMatchObject({ commercial_mode: 'PRODUCT', product_id: 'p', offer_id: null, card_promotional_price: 8 });
    expect(cardToDb({ commercialMode: 'OFFER', offerId: 'o', customTimesUsed: 3 } as any)).not.toHaveProperty('custom_times_used');
  });
});

describe('contrato get_public_store N6 (JSON real do PostgreSQL local)', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/n6/get_public_store.adega-a.json'), 'utf8'));
  const resolve = (b: string, p: string) => `https://cdn.test/${b}/${p}`;
  it('mapeia loja, produtos, ofertas e cards de campanha sem chave PIX', () => {
    const s = mapN6PublicStore(raw, resolve as any, Date.now());
    expect(s.tenant.slug).toBe('adega-a');
    expect(s.products.length).toBeGreaterThan(0);
    expect(s.settings.pixKey).toBeUndefined();
    expect(JSON.stringify(raw)).not.toMatch(/pix_key|52998224725/);
    const promo = s.offers.find(o => o.hasPromoCheckout);
    expect(promo?.promoPrice).toBeGreaterThan(0);
    const card = s.offers.find(o => o.source === 'CAMPAIGN_CARD');
    expect(card?.campaignId).toBeTruthy();
    expect(card?.campaignCardId).toBeTruthy();
  });
  it('prep_time sem default 30 quando o servidor não informa', () => {
    const r = JSON.parse(JSON.stringify(raw));
    if (r.settings) { delete r.settings.prep_time_minutes; delete r.settings.prepTimeMinutes; delete r.settings.default_prep_time_minutes; }
    const s = mapN6PublicStore(r, resolve as any, Date.now());
    expect((s.settings as any).prepTimeMinutes ?? null).not.toBe(30);
  });
});
