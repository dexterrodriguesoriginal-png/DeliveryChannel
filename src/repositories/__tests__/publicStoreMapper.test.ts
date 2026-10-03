import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapPublicStorePayload, PublicStorePayloadError } from '../publicStoreMapper';
import { buildStorefrontCards } from '../../utils/storefrontCards';

/**
 * Fixture = saída REAL de `get_public_store('adega-a')` (migration 027) capturada do
 * PostgreSQL local após a suíte supabase/tests/promotional_cards_public_store.test.sql.
 */
const fixturePath = new URL('./fixtures/get_public_store.adega-a.json', import.meta.url);
const loadFixture = (): Record<string, unknown> & { tenant: { id: string }; serverTime: string; offers: Array<Record<string, unknown>>; campaigns: Array<Record<string, unknown> & { cards: Array<Record<string, unknown>> }> } =>
  JSON.parse(readFileSync(fixturePath, 'utf8'));

const OTHER_TENANT = '11111111-2222-4333-8444-555555555555';

describe('mapPublicStorePayload — formato real do get_public_store (027)', () => {
  it('mapeia tenant, tema (snake_case → camelCase) e configurações', () => {
    const raw = loadFixture();
    const data = mapPublicStorePayload(raw);
    expect(data.tenant.slug).toBe('adega-a');
    expect(data.tenant.id).toBe(raw.tenant.id);
    expect(data.theme.storeName).toBe('Adega A');
    expect(data.theme.primaryColor).toMatch(/^#/);
    expect(data.theme.cardColor).toBe('#ffffff');
    expect(data.settings.deliveryFee).toBe(5);
    expect(data.settings.isOpen).toBe(true);
    expect(data.settings.defaultPrepTimeMinutes).toBe(30);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.products.length).toBeGreaterThan(0);
  });

  it('mapeia todos os cards (offers) na ordem do servidor, com displayMode derivado de autoOverlay', () => {
    const raw = loadFixture();
    const data = mapPublicStorePayload(raw);
    expect(data.offers).toHaveLength(raw.offers.length);
    expect(data.offers.map(o => o.id)).toEqual(raw.offers.map(o => o.id));
    for (const offer of data.offers) {
      expect(offer.tenantId).toBe(raw.tenant.id);
      expect(offer.source).toBe('OFFER');
      expect(offer.displayMode).toBe(offer.autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA');
    }
    const video = data.offers.find(o => o.mediaType === 'VIDEO');
    expect(video).toBeDefined();
    expect(video?.videoDuration).toBe(12.4);
    expect(video?.autoOverlay).toBe(false);
    expect(video?.displayMode).toBe('FULL_MEDIA');
    // Card legado BANNER_ONLY + produto é normalizado para PRODUCT
    const legacy = data.offers.find(o => o.title === 'Legado com produto');
    expect(legacy?.destinationType).toBe('PRODUCT');
    expect(legacy?.productId).toBeTruthy();
  });

  it('mapeia campanhas publicadas com cards ordenados, produto e cupom', () => {
    const raw = loadFixture();
    const data = mapPublicStorePayload(raw);
    expect(data.campaigns).toHaveLength(raw.campaigns.length);
    const campaign = data.campaigns[0];
    expect(campaign.name).toBe('Campanha Fim de Semana A');
    expect(campaign.status).toBe('ACTIVE');
    expect(campaign.cards.map(c => c.displayOrder)).toEqual([1, 3]);
    const [imageCard, videoCard] = campaign.cards;
    expect(imageCard.mediaType).toBe('IMAGE');
    expect(imageCard.coupon?.code).toBeTruthy();
    expect(videoCard.mediaType).toBe('VIDEO');
    expect(videoCard.destinationType).toBe('PRODUCT');
    expect(videoCard.product?.id).toBeTruthy();
  });

  it('calcula o offset do relógio do servidor (serverTime − recebimento)', () => {
    const raw = loadFixture();
    const serverMs = new Date(raw.serverTime).getTime();
    const data = mapPublicStorePayload(raw, serverMs - 2000);
    expect(data.serverTimeOffsetMs).toBe(2000);
  });

  it('descarta qualquer item de OUTRO tenant (defesa em profundidade)', () => {
    const raw = loadFixture();
    raw.offers.push({ ...raw.offers[0], id: 'aaaaaaaa-0000-4000-8000-000000000001', tenantId: OTHER_TENANT });
    raw.campaigns.push({ ...raw.campaigns[0], id: 'aaaaaaaa-0000-4000-8000-000000000002', tenantId: OTHER_TENANT });
    raw.campaigns[0].cards.push({ ...raw.campaigns[0].cards[0], id: 'aaaaaaaa-0000-4000-8000-000000000003', tenantId: OTHER_TENANT });
    const data = mapPublicStorePayload(raw);
    expect(data.offers.some(o => o.tenantId === OTHER_TENANT)).toBe(false);
    expect(data.campaigns.some(c => c.tenantId === OTHER_TENANT)).toBe(false);
    expect(data.campaigns[0].cards.some(c => c.tenantId === OTHER_TENANT)).toBe(false);
  });

  it('payload da 026 (sem a chave campaigns) não quebra: campaigns = []', () => {
    const raw = loadFixture();
    delete (raw as Record<string, unknown>).campaigns;
    const data = mapPublicStorePayload(raw);
    expect(data.campaigns).toEqual([]);
  });

  it('payload inválido gera erro explícito (não vira loja vazia silenciosa)', () => {
    expect(() => mapPublicStorePayload(null)).toThrow(PublicStorePayloadError);
    expect(() => mapPublicStorePayload({ offers: [] })).toThrow(PublicStorePayloadError);
  });

  it('integração: fixture → buildStorefrontCards no instante do servidor = cards do painel + cards de campanha', () => {
    const raw = loadFixture();
    const data = mapPublicStorePayload(raw);
    const nowMs = new Date(raw.serverTime).getTime();
    const cards = buildStorefrontCards(data.offers, data.campaigns, nowMs, data.tenant.id);
    const campaignCardCount = data.campaigns.reduce((n, c) => n + c.cards.length, 0);
    expect(cards).toHaveLength(data.offers.length + campaignCardCount);
    expect(cards.slice(0, data.offers.length).every(c => c.source === 'OFFER')).toBe(true);
    expect(cards.slice(data.offers.length).every(c => c.source === 'CAMPAIGN_CARD')).toBe(true);
  });
});
