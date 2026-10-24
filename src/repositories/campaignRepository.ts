import { analyticsAllowed } from '../lib/legal/cookies';
/**
 * Campanhas e cards (N5) — somente OWNER/MANAGER (RLS; F2: sem CEO/SUPER_ADMIN).
 * Métricas por get_campaign_metrics: receita SEMPRE de orders válidos (nunca do navegador);
 * funil do navegador é apenas estimativa. frequency_rules: apenas preparado no servidor.
 * Contadores (custom_times_used) são do servidor e nunca enviados pelo navegador.
 */
import { supabase } from '../lib/supabase';
import { CampaignN5, CampaignCardN5, CampaignMetrics } from '../types';
import { requireBackend, toBackendError } from '../lib/backend';

import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../lib/backendSchema';
import { BackendError } from '../lib/backend';

/** N3/N5 só existem com VITE_BACKEND_SCHEMA=n1n6; em legacy-020 falha explicitamente (sem mock). */
function requireN1N6(feature: string): void {
  if (!isN1N6Backend()) throw new BackendError('N1N6_REQUIRED', `${feature}: ${N1N6_ONLY_MESSAGE}`);
}


function mapCampaign(r: any): CampaignN5 {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    publicTitle: r.public_title || undefined,
    internalNotes: r.internal_notes || undefined,
    status: r.status,
    startAt: r.start_at || undefined,
    endAt: r.end_at || undefined,
    timezone: r.timezone,
    channel: r.channel || undefined,
    shareSlug: r.share_slug || undefined,
    displayOrder: Number(r.display_order ?? 0),
    publishedAt: r.published_at || undefined,
    endedAt: r.ended_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function optNum(v: any): number | undefined {
  return v === null || v === undefined ? undefined : Number(v);
}

function mapCard(r: any): CampaignCardN5 {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    campaignId: r.campaign_id,
    commercialMode: r.commercial_mode,
    offerId: r.offer_id || undefined,
    productId: r.product_id || undefined,
    couponId: r.coupon_id || undefined,
    title: r.title,
    subtitle: r.subtitle || undefined,
    ctaLabel: r.cta_label || undefined,
    mediaAssetId: r.media_asset_id || undefined,
    autoOverlay: r.auto_overlay !== false,
    showCouponCode: Boolean(r.show_coupon_code),
    cardPromotionalPrice: optNum(r.card_promotional_price),
    customName: r.custom_name || undefined,
    customPrice: optNum(r.custom_price),
    customOriginalPrice: optNum(r.custom_original_price),
    customUsageLimit: optNum(r.custom_usage_limit),
    customUsageLimitPerCustomer: optNum(r.custom_usage_limit_per_customer),
    customTimesUsed: Number(r.custom_times_used ?? 0),
    customFulfillment: r.custom_fulfillment || undefined,
    customMaxQtyPerOrder: optNum(r.custom_max_qty_per_order),
    displayOrder: Number(r.display_order ?? 0),
    isActive: Boolean(r.is_active),
    startAt: r.start_at || undefined,
    endAt: r.end_at || undefined,
  };
}

export function campaignToDb(c: Partial<CampaignN5>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  if (c.name !== undefined) db.name = c.name.trim();
  if (c.publicTitle !== undefined) db.public_title = c.publicTitle || null;
  if (c.internalNotes !== undefined) db.internal_notes = c.internalNotes || null;
  if (c.status !== undefined) db.status = c.status;
  if (c.startAt !== undefined) db.start_at = c.startAt || null;
  if (c.endAt !== undefined) db.end_at = c.endAt || null;
  if (c.timezone !== undefined) db.timezone = c.timezone;
  if (c.channel !== undefined) db.channel = c.channel || null;
  if (c.shareSlug !== undefined) db.share_slug = c.shareSlug || null;
  if (c.displayOrder !== undefined) db.display_order = c.displayOrder;
  return db;
}

/** Colunas do card por modo comercial (respeita o CHECK campaign_cards_mode). Sem contador. */
export function cardToDb(c: Partial<CampaignCardN5>): Record<string, unknown> {
  const db: Record<string, unknown> = {};
  const mode = c.commercialMode;
  if (mode !== undefined) {
    db.commercial_mode = mode;
    db.offer_id = mode === 'OFFER' ? c.offerId || null : null;
    db.product_id = mode === 'PRODUCT' ? c.productId || null : null;
    db.card_promotional_price = mode === 'PRODUCT' ? c.cardPromotionalPrice ?? null : null;
    db.custom_name = mode === 'CUSTOM' ? c.customName || null : null;
    db.custom_price = mode === 'CUSTOM' ? c.customPrice ?? null : null;
    db.custom_original_price = mode === 'CUSTOM' ? c.customOriginalPrice ?? null : null;
  }
  if (c.couponId !== undefined) db.coupon_id = c.couponId || null;
  if (c.title !== undefined) db.title = c.title.trim();
  if (c.subtitle !== undefined) db.subtitle = c.subtitle || null;
  if (c.ctaLabel !== undefined) db.cta_label = c.ctaLabel || null;
  if (c.mediaAssetId !== undefined) db.media_asset_id = c.mediaAssetId || null;
  if (c.autoOverlay !== undefined) db.auto_overlay = c.autoOverlay;
  if (c.showCouponCode !== undefined) db.show_coupon_code = c.showCouponCode;
  if (c.customUsageLimit !== undefined) db.custom_usage_limit = c.customUsageLimit || null;
  if (c.customUsageLimitPerCustomer !== undefined) db.custom_usage_limit_per_customer = c.customUsageLimitPerCustomer || null;
  if (c.customFulfillment !== undefined) db.custom_fulfillment = c.customFulfillment || null;
  if (c.customMaxQtyPerOrder !== undefined) db.custom_max_qty_per_order = c.customMaxQtyPerOrder || null;
  if (c.displayOrder !== undefined) db.display_order = c.displayOrder;
  if (c.isActive !== undefined) db.is_active = c.isActive;
  if (c.startAt !== undefined) db.start_at = c.startAt || null;
  if (c.endAt !== undefined) db.end_at = c.endAt || null;
  return db;
}

export function mapMetrics(d: any): CampaignMetrics {
  return {
    campaignId: d.campaign_id,
    from: d.from,
    to: d.to,
    funnelEstimate: d.funnel_estimate || {},
    funnelIsEstimate: true,
    orders: {
      validOrders: Number(d.orders?.valid_orders ?? 0),
      revenue: Number(d.orders?.revenue ?? 0),
      paidRevenue: Number(d.orders?.paid_revenue ?? 0),
      invalidatedOrders: Number(d.orders?.invalidated_orders ?? 0),
    },
    revenueSource: 'orders',
  };
}

export const campaignRepository = {
  async listCampaigns(tenantId: string): Promise<CampaignN5[]> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { data, error } = await supabase.from('campaigns').select('*').eq('tenant_id', tenantId).order('display_order');
    if (error) throw toBackendError(error, 'Falha ao carregar campanhas.');
    return (data || []).map(mapCampaign);
  },

  async createCampaign(tenantId: string, c: Partial<CampaignN5>): Promise<CampaignN5> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { data, error } = await supabase
      .from('campaigns')
      .insert({ tenant_id: tenantId, ...campaignToDb({ status: 'DRAFT', ...c }) })
      .select('*')
      .single();
    if (error) throw toBackendError(error, 'Falha ao criar campanha.');
    return mapCampaign(data);
  },

  async updateCampaign(tenantId: string, id: string, c: Partial<CampaignN5>): Promise<CampaignN5> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { data, error } = await supabase
      .from('campaigns')
      .update(campaignToDb(c))
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw toBackendError(error, 'Falha ao atualizar campanha.');
    return mapCampaign(data);
  },

  async listCards(tenantId: string, campaignId: string): Promise<CampaignCardN5[]> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { data, error } = await supabase
      .from('campaign_cards')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('campaign_id', campaignId)
      .order('display_order');
    if (error) throw toBackendError(error, 'Falha ao carregar cards.');
    return (data || []).map(mapCard);
  },

  async createCard(tenantId: string, campaignId: string, c: Partial<CampaignCardN5>): Promise<CampaignCardN5> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { data, error } = await supabase
      .from('campaign_cards')
      .insert({ tenant_id: tenantId, campaign_id: campaignId, ...cardToDb(c) })
      .select('*')
      .single();
    if (error) throw toBackendError(error, 'Falha ao criar card.');
    return mapCard(data);
  },

  async updateCard(tenantId: string, id: string, c: Partial<CampaignCardN5>): Promise<CampaignCardN5> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { data, error } = await supabase
      .from('campaign_cards')
      .update(cardToDb(c))
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw toBackendError(error, 'Falha ao atualizar card.');
    return mapCard(data);
  },

  async deleteCard(tenantId: string, id: string): Promise<void> {
    requireBackend('campanhas');
    requireN1N6('campanhas');
    const { error } = await supabase.from('campaign_cards').delete().eq('tenant_id', tenantId).eq('id', id);
    if (error) throw toBackendError(error, 'Falha ao excluir card.');
  },

  async getMetrics(campaignId: string, from: Date, to: Date): Promise<CampaignMetrics> {
    requireBackend('analytics');
    requireN1N6('analytics');
    const { data, error } = await supabase.rpc('get_campaign_metrics', {
      p_campaign_id: campaignId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw toBackendError(error, 'Falha ao carregar métricas.');
    return mapMetrics(data);
  },

  /**
   * Evento de funil do navegador (N5 track_campaign_event). PURCHASE é só do servidor.
   * Best-effort: falha de telemetria nunca quebra a vitrine. Em legacy-020 não envia nada.
   */
  async trackEvent(input: {
    storeSlug: string;
    eventType: 'IMPRESSION' | 'CARD_VIEW' | 'CARD_CLICK' | 'VIDEO_PLAY' | 'COUPON_COPY' | 'CHECKOUT_START';
    sessionId: string;
    campaignId?: string;
    cardId?: string;
    offerId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<boolean> {
    if (!isN1N6Backend() || !analyticsAllowed()) return false;
    try {
      const { error } = await supabase.rpc('track_campaign_event', {
        p_store_slug: input.storeSlug,
        p_event_type: input.eventType,
        p_session_id: input.sessionId,
        p_campaign_id: input.campaignId ?? null,
        p_card_id: input.cardId ?? null,
        p_offer_id: input.offerId ?? null,
        p_metadata: input.metadata ?? {},
      });
      return !error;
    } catch {
      return false;
    }
  },
};
