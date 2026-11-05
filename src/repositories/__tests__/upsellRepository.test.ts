import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => h.rpc(...args) } }));
vi.mock('../../lib/backend', () => ({ requireBackend: vi.fn(), toBackendError: (_error: unknown, message: string) => new Error(message) }));
import { normalizeUpsellCart, upsellRepository } from '../upsellRepository';
beforeEach(() => h.rpc.mockReset());
describe('upsell public and staff repositories', () => {
  it('sends IDs/quantities/context only and projects recommendations without customer data', async () => {
    h.rpc.mockResolvedValue({ data: { offerToken: 'offer', email: 'secret', suggestions: [{ productId: 'juice', reason: 'Complemento', customerName: 'private' }, { productId: 'juice' }, { productId: 'dessert' }] }, error: null });
    const reply = await upsellRepository.recommend('loja', 'burger', [{ productId: 'burger', quantity: 1 }, { productId: 'burger', quantity: 2 }], 'TOTEM');
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('recommend_upsell', { p_slug: 'loja', p_source_product_id: 'burger', p_cart_items: [{ productId: 'burger', quantity: 3 }], p_channel: 'TOTEM' });
    expect(reply).toEqual({ offerToken: 'offer', suggestions: [{ productId: 'juice', reason: 'Complemento' }, { productId: 'dessert' }] });
  });
  it('normalizes duplicate quantities and rejects malformed cart entries', () => {
    expect(normalizeUpsellCart([{ productId: 'a', quantity: 99 }, { productId: 'a', quantity: 5 }, { productId: 'b', quantity: 2.9 }, { productId: 'bad', quantity: NaN }, { productId: '', quantity: 1 }, { productId: 'no', quantity: 0 }])).toEqual([{ productId: 'a', quantity: 99 }, { productId: 'b', quantity: 2 }]);
  });
  it('limits suggestions to three unique public IDs and treats disabled response as empty', async () => {
    h.rpc.mockResolvedValueOnce({ data: { offerToken: null, suggestions: [] }, error: null });
    expect(await upsellRepository.recommend('loja', 'a', [], 'DELIVERY')).toEqual({ offerToken: null, suggestions: [] });
    h.rpc.mockResolvedValueOnce({ data: { offerToken: 'x', suggestions: ['a', 'b', 'c', 'd'].map(productId => ({ productId })) }, error: null });
    expect((await upsellRepository.recommend('loja', 'a', [], 'DELIVERY')).suggestions).toHaveLength(3);
  });
  it.each(['impression', 'accept'] as const)('does not pretend %s succeeded when server returns false', async operation => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    await expect(operation === 'impression' ? upsellRepository.impression('offer') : upsellRepository.accept('offer', 'product')).rejects.toThrow();
  });
  it('records opaque impression/accept tokens and order ID without prices or identity fields', async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });
    await upsellRepository.impression('offer'); await upsellRepository.accept('offer', 'product'); await upsellRepository.recordConversion('offer', 'order');
    expect(h.rpc.mock.calls).toEqual([
      ['record_upsell_impression', { p_offer_token: 'offer' }],
      ['accept_upsell', { p_offer_token: 'offer', p_product_id: 'product' }],
      ['record_upsell_conversion', { p_offer_token: 'offer', p_order_id: 'order' }],
    ]);
  });
  it('uses tenant-scoped management RPCs for settings and ordered pins', async () => {
    h.rpc.mockResolvedValueOnce({ data: { enabled: true }, error: null }).mockResolvedValueOnce({ data: { enabled: false }, error: null })
      .mockResolvedValueOnce({ data: { productIds: ['juice', 'juice', 'dessert'] }, error: null }).mockResolvedValueOnce({ data: { productIds: ['dessert', 'juice'] }, error: null });
    expect(await upsellRepository.getSettings('tenant')).toEqual({ enabled: true });
    expect(await upsellRepository.setEnabled('tenant', false)).toEqual({ enabled: false });
    expect(await upsellRepository.getPins('tenant', 'burger')).toEqual(['juice', 'dessert']);
    expect(await upsellRepository.setPins('tenant', 'burger', ['dessert', 'juice', 'juice'])).toEqual(['dessert', 'juice']);
    expect(h.rpc.mock.calls.map(call => call[1])).toEqual([{ p_tenant: 'tenant' }, { p_tenant: 'tenant', p_enabled: false }, { p_tenant: 'tenant', p_product_id: 'burger' }, { p_tenant: 'tenant', p_product_id: 'burger', p_suggested_ids: ['dessert', 'juice'] }]);
  });
  it('maps aggregate sales stats, ratio and safe top pair fields', async () => {
    h.rpc.mockResolvedValue({ data: { itemsSold: 4, revenue: 32.5, impressions: 10, accepts: 3, acceptanceRate: .3, topPairs: [{ sourceProductId: 'burger', productId: 'juice', itemsSold: 4, revenue: 32.5, accepts: 3, email: 'private' }] }, error: null });
    expect(await upsellRepository.getStats('tenant')).toEqual({ itemsSold: 4, revenue: 32.5, impressions: 10, accepts: 3, acceptanceRate: .3, topPairs: [{ sourceProductId: 'burger', suggestedProductId: 'juice', itemsSold: 4, revenue: 32.5, accepts: 3 }] });
  });
  it('propagates server authorization errors as actionable management errors', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'FORBIDDEN' } });
    await expect(upsellRepository.setEnabled('foreign-tenant', true)).rejects.toThrow('Não foi possível atualizar');
  });
});
