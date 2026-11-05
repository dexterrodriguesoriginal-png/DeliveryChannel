import { supabase } from '../lib/supabase';
import { requireBackend, toBackendError } from '../lib/backend';
import type { UpsellCartItem, UpsellChannel, UpsellResponse, UpsellSettings, UpsellStats } from '../types/upsell';

const object = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; };
const settings = (value: unknown): UpsellSettings => ({ enabled: object(value).enabled === true });
const pins = (value: unknown): string[] => {
  const rows = object(value).productIds;
  return [...new Set((Array.isArray(rows) ? rows : []).filter((id): id is string => typeof id === 'string'))];
};
async function call(name: string, params: Record<string, unknown>, message: string): Promise<unknown> {
  requireBackend('sugestões de produtos');
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw toBackendError(error, message);
  return data;
}

/** IDs and quantities only; the server owns ranking, identity, scope and prices. */
export function normalizeUpsellCart(items: UpsellCartItem[]): UpsellCartItem[] {
  const quantities = new Map<string, number>();
  for (const item of items.slice(0, 200)) {
    if (typeof item.productId !== 'string' || !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    quantities.set(item.productId, Math.min(99, (quantities.get(item.productId) || 0) + Math.floor(item.quantity)));
  }
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity })).filter(item => item.quantity > 0);
}

export const upsellRepository = {
  async recommend(slug: string, sourceProductId: string, cartItems: UpsellCartItem[], channel: UpsellChannel): Promise<UpsellResponse> {
    const raw = object(await call('recommend_upsell', {
      p_slug: slug, p_source_product_id: sourceProductId,
      p_cart_items: normalizeUpsellCart(cartItems), p_channel: channel,
    }, 'Não foi possível carregar as sugestões.'));
    const seen = new Set<string>();
    return {
      offerToken: typeof raw.offerToken === 'string' ? raw.offerToken : null,
      suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).flatMap(value => {
        const row = object(value);
        if (typeof row.productId !== 'string' || seen.has(row.productId)) return [];
        seen.add(row.productId);
        return [{ productId: row.productId, ...(typeof row.reason === 'string' ? { reason: row.reason.slice(0, 160) } : {}) }];
      }).slice(0, 3),
    };
  },
  async impression(offerToken: string): Promise<void> {
    const accepted = await call('record_upsell_impression', { p_offer_token: offerToken }, 'Não foi possível registrar a exibição.');
    if (accepted !== true) throw new Error('Esta sugestão expirou. Continue escolhendo no cardápio.');
  },
  async accept(offerToken: string, productId: string): Promise<void> {
    const accepted = await call('accept_upsell', { p_offer_token: offerToken, p_product_id: productId }, 'Esta sugestão não está disponível agora.');
    if (accepted !== true) throw new Error('Esta sugestão não está disponível agora.');
  },
  async recordConversion(offerToken: string, orderId: string): Promise<void> {
    await call('record_upsell_conversion', { p_offer_token: offerToken, p_order_id: orderId }, 'Não foi possível registrar o resultado da sugestão.');
  },
  async getSettings(tenantId: string): Promise<UpsellSettings> {
    return settings(await call('get_upsell_settings', { p_tenant: tenantId }, 'Não foi possível carregar as sugestões da loja.'));
  },
  async setEnabled(tenantId: string, enabled: boolean): Promise<UpsellSettings> {
    return settings(await call('set_upsell_enabled', { p_tenant: tenantId, p_enabled: enabled }, 'Não foi possível atualizar as sugestões da loja.'));
  },
  async getPins(tenantId: string, productId: string): Promise<string[]> {
    return pins(await call('get_upsell_pins', { p_tenant: tenantId, p_product_id: productId }, 'Não foi possível carregar os produtos sugeridos.'));
  },
  async setPins(tenantId: string, productId: string, productIds: string[]): Promise<string[]> {
    return pins(await call('set_upsell_pins', { p_tenant: tenantId, p_product_id: productId, p_suggested_ids: [...new Set(productIds)] }, 'Não foi possível salvar os produtos sugeridos.'));
  },
  async getStats(tenantId: string): Promise<UpsellStats> {
    const raw = object(await call('get_upsell_stats', { p_tenant: tenantId }, 'Não foi possível carregar os resultados das sugestões.'));
    return {
      itemsSold: number(raw.itemsSold), revenue: number(raw.revenue), impressions: number(raw.impressions),
      accepts: number(raw.accepts), acceptanceRate: Math.min(1, number(raw.acceptanceRate)),
      topPairs: (Array.isArray(raw.topPairs) ? raw.topPairs : []).flatMap(value => {
        const pair = object(value), suggestedId = pair.suggestedProductId ?? pair.productId;
        return typeof pair.sourceProductId === 'string' && typeof suggestedId === 'string' ? [{
          sourceProductId: pair.sourceProductId, suggestedProductId: suggestedId,
          itemsSold: number(pair.itemsSold), revenue: number(pair.revenue), accepts: number(pair.accepts),
        }] : [];
      }),
    };
  },
};
