import { describe, it, expect } from 'vitest';
import { buildOfferList, discountPercent } from '../offers';
import { buildNotifications } from '../notifications';
import {
  KV, loadAddressBook, upsertAddress, removeAddress, selectAddress, toggleFavorite, loadFavorites,
  pushSearchHistory, loadSearchHistory, clearSearchHistory, shouldShowPushPrompt, markPushPromptShown, SavedAddress,
} from '../localStore';
import type { Product, PromotionCarousel, Order } from '../../../types';

const mkKV = (): KV => { const m = new Map<string, string>(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k) }; };
const T = 't1';
const prod = (id: string, price: number, extra: Partial<Product> = {}): Product => ({
  id, tenantId: T, categoryId: 'c', name: id, description: '', price, imageUrl: '', isAvailable: true, isActive: true, stockQuantity: 5, unit: 'un', ...extra,
});

describe('ofertas', () => {
  const now = new Date('2026-10-17T20:00:00-03:00');
  const carousel = (items: any[], extra: Partial<PromotionCarousel> = {}): PromotionCarousel => ({ id: 'car1', tenantId: T, name: 'Happy Hour', isActive: true, showInStore: true, displayOrder: 0, items, ...extra } as PromotionCarousel);
  const ci = (id: string, productId: string, promotionalPrice: number, extra = {}) => ({ id, carouselId: 'car1', productId, tenantId: T, promotionalPrice, isActive: true, ...extra });

  it('lista campanha válida + promoção do catálogo, maior desconto primeiro', () => {
    const list = buildOfferList({
      products: [prod('a', 10), prod('b', 20, { promotionalPrice: 15 }), prod('c', 8)],
      carousels: [carousel([ci('i1', 'a', 5)])],
      tenantId: T, now,
    });
    expect(list.map(o => [o.key, o.offerPrice, o.discountPercent])).toEqual([['c:i1', 5, 50], ['p:b', 15, 25]]);
    expect(list[0].origin).toEqual({ source: 'campaign', campaignItemId: 'i1', carouselId: 'car1' });
  });
  it('ignora campanha expirada/inativa, preço inválido e produto inativo; esgotado vai para o fim', () => {
    const list = buildOfferList({
      products: [prod('a', 10), prod('b', 10, { isActive: false, promotionalPrice: 5 }), prod('d', 10, { isAvailable: false, promotionalPrice: 1 }), prod('e', 10, { promotionalPrice: 9 })],
      carousels: [carousel([ci('x', 'a', 5, { endDate: '2026-10-17T10:00:00-03:00' }), ci('y', 'a', 12)]), carousel([ci('z', 'a', 4)], { id: 'car2', isActive: false })],
      tenantId: T, now,
    });
    expect(list.map(o => o.key)).toEqual(['p:e', 'p:d']);
  });
  it('percentual de desconto', () => {
    expect(discountPercent(10, 7.5)).toBe(25);
    expect(discountPercent(10, 10)).toBe(0);
    expect(discountPercent(0, 1)).toBe(0);
  });
});

describe('endereços salvos', () => {
  const addr = (id: string, street = 'Rua A'): SavedAddress => ({ id, label: 'Casa', street, number: '10', updatedAt: '2026-10-17T00:00:00Z', latitude: -23.5, longitude: -46.8 });
  it('salva, seleciona, edita e remove por usuário', () => {
    const kv = mkKV();
    upsertAddress(kv, 'u1', addr('a1'));
    let b = upsertAddress(kv, 'u1', addr('a2', 'Rua B'));
    expect(b.selectedId).toBe('a2');
    expect(b.items.map(a => a.id)).toEqual(['a2', 'a1']);
    b = selectAddress(kv, 'u1', 'a1');
    expect(b.selectedId).toBe('a1');
    b = upsertAddress(kv, 'u1', { ...addr('a1'), number: '99' });
    expect(b.items.find(a => a.id === 'a1')?.number).toBe('99');
    expect(b.items).toHaveLength(2);
    b = removeAddress(kv, 'u1', 'a1');
    expect(b.selectedId).toBe('a2');
    expect(loadAddressBook(kv, 'u2').items).toEqual([]);
    expect(loadAddressBook(kv, 'u1').items[0].latitude).toBe(-23.5);
  });
  it('favoritos, histórico de busca e convite de push', () => {
    const kv = mkKV();
    expect(toggleFavorite(kv, 'u1', T, 'p1')).toEqual(['p1']);
    expect(toggleFavorite(kv, 'u1', T, 'p1')).toEqual([]);
    expect(loadFavorites(kv, 'u1', 'outra')).toEqual([]);
    pushSearchHistory(kv, 'u1', 'cerveja'); pushSearchHistory(kv, 'u1', 'a'); pushSearchHistory(kv, 'u1', 'Cerveja');
    expect(loadSearchHistory(kv, 'u1')).toEqual(['Cerveja']);
    clearSearchHistory(kv, 'u1');
    expect(loadSearchHistory(kv, 'u1')).toEqual([]);
    const t0 = 1_000_000_000_000;
    expect(shouldShowPushPrompt(kv, 'default', t0)).toBe(true);
    markPushPromptShown(kv, t0);
    expect(shouldShowPushPrompt(kv, 'default', t0 + 864e5)).toBe(false);
    expect(shouldShowPushPrompt(kv, 'default', t0 + 8 * 864e5)).toBe(true);
    expect(shouldShowPushPrompt(kv, 'granted', t0 + 8 * 864e5)).toBe(false);
  });
});

describe('notificações', () => {
  it('uma notificação por status, mais recente primeiro, com não lidas', () => {
    const o = { id: 'o1', orderNumber: 12, fulfillmentType: 'DELIVERY', createdAt: '2026-10-17T18:00:00Z', status: 'OUT_FOR_DELIVERY',
      statusHistory: [
        { status: 'PENDING', timestamp: '2026-10-17T18:00:00Z', changedBy: '' },
        { status: 'PREPARING', timestamp: '2026-10-17T18:05:00Z', changedBy: '' },
        { status: 'OUT_FOR_DELIVERY', timestamp: '2026-10-17T18:30:00Z', changedBy: '' },
      ] } as unknown as Order;
    const list = buildNotifications([o], Date.parse('2026-10-17T18:10:00Z'));
    expect(list.map(n => [n.title, n.unread])).toEqual([['Saiu para entrega', true], ['Em preparo', false], ['Pedido recebido', false]]);
    expect(list[0].body).toContain('#12');
  });
});

import { parseNominatimReverse, parseGoogleGeocode, ufFrom } from '../geocode';
describe('geocodificação reversa', () => {
  it('Nominatim', () => {
    const r = parseNominatimReverse({ display_name: 'Av. Dante Carraro, 100, Carapicuíba', address: { road: 'Avenida Dante Carraro', house_number: '100', suburb: 'Jardim Ariston', city: 'Carapicuíba', state: 'São Paulo', postcode: '06340-000' } });
    expect(r).toMatchObject({ street: 'Avenida Dante Carraro', number: '100', neighborhood: 'Jardim Ariston', city: 'Carapicuíba', state: 'SP', postalCode: '06340-000' });
    expect(parseNominatimReverse({})).toBeNull();
  });
  it('Google', () => {
    const r = parseGoogleGeocode({ formatted_address: 'x', place_id: 'pid', address_components: [
      { long_name: '100', types: ['street_number'] }, { long_name: 'Avenida Dante Carraro', types: ['route'] },
      { long_name: 'Jardim Ariston', types: ['sublocality', 'sublocality_level_1'] }, { long_name: 'Carapicuíba', types: ['administrative_area_level_2'] },
      { long_name: 'São Paulo', short_name: 'SP', types: ['administrative_area_level_1'] }, { long_name: '06340-000', types: ['postal_code'] },
    ] });
    expect(r).toMatchObject({ street: 'Avenida Dante Carraro', number: '100', neighborhood: 'Jardim Ariston', city: 'Carapicuíba', state: 'SP', placeId: 'pid' });
  });
  it('UF', () => {
    expect(ufFrom('Rio de Janeiro')).toBe('RJ');
    expect(ufFrom(undefined, 'BR-MG')).toBe('MG');
  });
});
