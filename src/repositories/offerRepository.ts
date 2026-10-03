import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Offer, CardDestination, CardFormat, CardMediaType, PromoCardModel } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';
import { calculatePromoCardStatus } from '../utils/promoCardDateUtils';

/**
 * Linha da tabela public.offers (colunas reais das migrations 001–026).
 *
 * IMPORTANTE: NÃO existe coluna `display_mode`. O "modo de exibição" do card é
 * derivado de `auto_overlay` (true → EDITABLE_CARD, false → FULL_MEDIA), que é
 * exatamente o que o MarketingPage envia. Gravar `display_mode` fazia TODO insert/
 * update falhar no PostgREST (coluna inexistente) e o card caía em silêncio no
 * dataStore/localStorage — causa raiz do "card não aparece na vitrine".
 */
export interface OfferRow {
  id: string;
  tenant_id: string;
  product_id?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  badge?: string | null;
  card_format?: string | null;
  media_type?: string | null;
  card_model?: string | null;
  auto_overlay?: boolean | null;
  destination_type?: string | null;
  media_url?: string | null;
  image_url?: string | null;
  duration_seconds?: number | string | null;
  video_duration?: number | string | null;
  detected_width?: number | string | null;
  detected_height?: number | string | null;
  aspect_ratio?: string | null;
  discount_percentage?: number | string | null;
  original_price?: number | string | null;
  promotional_price?: number | string | null;
  internal_link?: string | null;
  display_order?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  background_color?: string | null;
  accent_color?: string | null;
  is_active?: boolean | null;
  has_promo_checkout?: boolean | null;
  promo_title?: string | null;
  promo_description?: string | null;
  promo_price?: number | string | null;
  promo_original_price?: number | string | null;
  promo_discount_percentage?: number | string | null;
  promo_unit?: string | null;
  promo_min_quantity?: number | null;
  promo_max_quantity_per_customer?: number | null;
  promo_notes?: string | null;
  promo_fulfillment_types?: string[] | null;
  promo_payment_methods?: string[] | null;
  promo_coupon_code?: string | null;
  promo_usage_limit?: number | null;
  promo_times_used?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_demo?: boolean | null;
}

const CARD_FORMATS: CardFormat[] = ['HORIZONTAL', 'SQUARE', 'QUADRADO', 'VERTICAL'];
const CARD_MODELS: PromoCardModel[] = ['HERO', 'HIGHLIGHT', 'ANIMATED'];
const DESTINATIONS: CardDestination[] = ['BANNER_ONLY', 'PRODUCT', 'CUSTOM_OFFER'];
const FULFILLMENT_TYPES = ['DELIVERY', 'PICKUP'] as const;
const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'] as const;

function optNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function pickEnum<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickEnumList<T extends string>(value: string[] | null | undefined, allowed: readonly T[]): T[] {
  const list = (value || []).filter((v): v is T => (allowed as readonly string[]).includes(v));
  return list.length > 0 ? list : [...allowed];
}

/** Normaliza o destino: cards legados BANNER_ONLY com produto vinculado abrem o produto (mesma regra do get_public_store). */
function normalizeDestination(destination: string | null | undefined, productId: string | null | undefined): CardDestination {
  const d = pickEnum(destination, DESTINATIONS, productId ? 'PRODUCT' : 'BANNER_ONLY');
  return d === 'BANNER_ONLY' && productId ? 'PRODUCT' : d;
}

export function mapRowToOffer(row: OfferRow): Offer {
  const mediaType: CardMediaType = row.media_type === 'VIDEO' ? 'VIDEO' : 'IMAGE';
  const mediaUrl = row.media_url || row.image_url || undefined;
  const imageUrl = row.image_url || row.media_url || undefined;
  const autoOverlay = row.auto_overlay === null || row.auto_overlay === undefined ? true : Boolean(row.auto_overlay);

  const isActive = Boolean(row.is_active);
  const startDate = row.start_at || row.start_date || undefined;
  const endDate = row.end_at || row.end_date || undefined;
  const computedStatus = calculatePromoCardStatus({ isActive, startDate, endDate });

  const promoUsageLimit = row.promo_usage_limit ? Number(row.promo_usage_limit) : undefined;
  const promoTimesUsed = Number(row.promo_times_used ?? 0);
  const isExhausted = Boolean(promoUsageLimit && promoTimesUsed >= promoUsageLimit);
  const remainingUses = promoUsageLimit ? Math.max(0, promoUsageLimit - promoTimesUsed) : null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id || undefined,
    title: row.title,
    subtitle: row.subtitle || undefined,
    description: row.description || '',
    badge: row.badge || undefined,
    cardFormat: pickEnum(row.card_format, CARD_FORMATS, 'HORIZONTAL'),
    mediaType,
    displayMode: autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    cardModel: pickEnum(row.card_model, CARD_MODELS, 'HERO'),
    autoOverlay,
    destinationType: normalizeDestination(row.destination_type, row.product_id),
    mediaUrl,
    imageUrl,
    durationSeconds: optNumber(row.duration_seconds) ?? 5,
    videoDuration: optNumber(row.video_duration),
    detectedWidth: optNumber(row.detected_width),
    detectedHeight: optNumber(row.detected_height),
    aspectRatio: row.aspect_ratio || '16:9',
    discountPercentage: optNumber(row.discount_percentage),
    originalPrice: optNumber(row.original_price),
    promotionalPrice: optNumber(row.promotional_price),
    internalLink: row.internal_link || undefined,
    order: Number(row.display_order ?? 0),
    startDate,
    endDate,
    startAt: startDate,
    endAt: endDate,
    noEndDate: !endDate,
    backgroundColor: row.background_color || '#15803d',
    accentColor: row.accent_color || '#ffffff',
    isActive,
    computedStatus,
    source: 'OFFER',

    // Checkout Promocional Próprio
    hasPromoCheckout: Boolean(row.has_promo_checkout),
    promoTitle: row.promo_title || undefined,
    promoDescription: row.promo_description || undefined,
    promoPrice: optNumber(row.promo_price),
    promoOriginalPrice: optNumber(row.promo_original_price),
    promoDiscountPercentage: optNumber(row.promo_discount_percentage),
    promoUnit: row.promo_unit || 'un',
    promoMinQuantity: row.promo_min_quantity ? Number(row.promo_min_quantity) : 1,
    promoMaxQuantityPerCustomer: row.promo_max_quantity_per_customer ? Number(row.promo_max_quantity_per_customer) : 10,
    promoNotes: row.promo_notes || undefined,
    promoFulfillmentTypes: pickEnumList(row.promo_fulfillment_types, FULFILLMENT_TYPES),
    promoPaymentMethods: pickEnumList(row.promo_payment_methods, PAYMENT_METHODS),
    promoCouponCode: row.promo_coupon_code || undefined,
    promoUsageLimit,
    promoTimesUsed,
    isExhausted,
    remainingUses,

    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
    isDemo: Boolean(row.is_demo),
  };
}

/**
 * Modo local/demonstração EXPLÍCITO: sem Supabase configurado, ou tenant de demonstração
 * (id não-UUID, existente apenas no dataStore). Somente nesses casos o dataStore é usado.
 * Com Supabase configurado e tenant real, qualquer falha de persistência é propagada
 * como erro — nunca mascarada por uma cópia no navegador.
 */
function isLocalMode(tenantId: string): boolean {
  return !isSupabaseConfigured || !isValidUuid(tenantId);
}

function dbError(action: string, message: string): Error {
  return new Error(`Não foi possível ${action} no banco de dados: ${message}`);
}

function hasKey<T extends object>(obj: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function positiveOrNull(value: number | undefined | null): number | null {
  return value !== undefined && value !== null && value > 0 ? value : null;
}

function trimOrNull(value: string | undefined | null): string | null {
  const t = (value ?? '').trim();
  return t ? t : null;
}

type OfferWrite = Omit<Offer, 'id' | 'tenantId' | 'createdAt'>;

export const offerRepository = {
  /**
   * Lista os cards do estabelecimento (painel). Com Supabase, um erro de leitura é
   * propagado (o painel mostra a falha) em vez de exibir cards locais que não existem no banco.
   */
  async getOffers(context: SecurityContext, tenantId: string): Promise<Offer[]> {
    if (isLocalMode(tenantId)) {
      return dataStore.getOffers(context, tenantId);
    }
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw dbError('carregar os cards promocionais', error.message);
    }
    return ((data || []) as OfferRow[]).map(mapRowToOffer);
  },

  /**
   * Cards públicos (vitrine) a partir do get_public_store.
   */
  async getPublicOffers(slug: string): Promise<Offer[]> {
    if (isSupabaseConfigured) {
      const store = await publicStoreRepository.getPublicStore(slug);
      return store ? store.offers : [];
    }
    return dataStore.getPublicOffers(slug);
  },

  /**
   * Garante que o produto vinculado é um UUID do próprio tenant.
   * Lança erro (em vez de silenciosamente desvincular) se o produto não pertencer ao tenant.
   */
  async validateProductBelongsToTenant(tenantId: string, productId?: string | null): Promise<string | null> {
    if (!productId || !productId.trim()) return null;
    const cleanId = productId.trim();

    if (!isValidUuid(cleanId)) {
      throw new Error('Produto vinculado inválido.');
    }

    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', cleanId)
      .maybeSingle();

    if (error) {
      throw dbError('validar o produto vinculado', error.message);
    }
    if (!data) {
      throw new Error('O produto selecionado não pertence a este estabelecimento.');
    }
    return cleanId;
  },

  /**
   * Cria um card promocional. Só retorna após o INSERT confirmado pelo banco.
   */
  async create(context: SecurityContext, tenantId: string, data: OfferWrite): Promise<Offer> {
    if (isLocalMode(tenantId)) {
      return dataStore.createOffer(context, tenantId, data);
    }

    const mediaUrl = (data.mediaUrl || data.imageUrl || '').trim() || null;
    const productId = data.destinationType === 'CUSTOM_OFFER'
      ? null
      : await this.validateProductBelongsToTenant(tenantId, data.productId);
    const destinationType: CardDestination = data.destinationType || (productId ? 'PRODUCT' : 'BANNER_ONLY');
    if (destinationType === 'PRODUCT' && !productId) {
      throw new Error('Selecione o produto do catálogo vinculado a este card.');
    }
    const startAt = data.startAt || data.startDate || null;
    const endAt = data.noEndDate ? null : (data.endAt || data.endDate || null);

    const { data: inserted, error } = await supabase
      .from('offers')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        title: data.title.trim(),
        subtitle: trimOrNull(data.subtitle),
        description: data.description ? data.description.trim() : '',
        badge: trimOrNull(data.badge),
        card_format: data.cardFormat || 'HORIZONTAL',
        media_type: data.mediaType || 'IMAGE',
        media_url: mediaUrl,
        image_url: mediaUrl,
        duration_seconds: Number(data.durationSeconds ?? 5),
        video_duration: data.mediaType === 'VIDEO' ? (data.videoDuration || null) : null,
        detected_width: data.detectedWidth || null,
        detected_height: data.detectedHeight || null,
        aspect_ratio: data.aspectRatio || '16:9',
        discount_percentage: positiveOrNull(data.discountPercentage),
        original_price: positiveOrNull(data.originalPrice),
        promotional_price: positiveOrNull(data.promotionalPrice),
        internal_link: data.internalLink || null,
        display_order: data.order ?? 0,
        start_date: startAt,
        end_date: endAt,
        start_at: startAt,
        end_at: endAt,
        background_color: data.backgroundColor || null,
        accent_color: data.accentColor || null,
        is_active: data.isActive !== undefined ? data.isActive : true,
        is_demo: data.isDemo ?? false,
        auto_overlay: data.autoOverlay !== undefined ? data.autoOverlay : data.displayMode !== 'FULL_MEDIA',
        card_model: data.cardModel || 'HERO',

        // Checkout Promocional Próprio
        destination_type: destinationType,
        has_promo_checkout: destinationType === 'CUSTOM_OFFER' ? true : Boolean(data.hasPromoCheckout),
        promo_title: trimOrNull(data.promoTitle),
        promo_description: trimOrNull(data.promoDescription),
        promo_price: positiveOrNull(data.promoPrice),
        promo_original_price: positiveOrNull(data.promoOriginalPrice),
        promo_discount_percentage: positiveOrNull(data.promoDiscountPercentage),
        promo_unit: data.promoUnit || 'un',
        promo_min_quantity: data.promoMinQuantity || 1,
        promo_max_quantity_per_customer: data.promoMaxQuantityPerCustomer || 10,
        promo_notes: trimOrNull(data.promoNotes),
        promo_fulfillment_types: data.promoFulfillmentTypes || ['DELIVERY', 'PICKUP'],
        promo_payment_methods: data.promoPaymentMethods || ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
        promo_coupon_code: data.promoCouponCode ? data.promoCouponCode.trim().toUpperCase() : null,
        promo_usage_limit: positiveOrNull(data.promoUsageLimit),
        promo_times_used: 0,
      })
      .select()
      .single();

    if (error || !inserted) {
      throw dbError('salvar o card promocional', error?.message || 'o banco não confirmou a gravação');
    }
    return mapRowToOffer(inserted as OfferRow);
  },

  /**
   * Atualiza um card. Só retorna após o UPDATE confirmado (1 linha) pelo banco.
   * Campos presentes no objeto com valor vazio/undefined são LIMPOS no banco
   * (ex.: "sem data de término", remover selo, remover produto).
   */
  async update(context: SecurityContext, tenantId: string, offerId: string, updates: Partial<Offer>): Promise<Offer> {
    if (isLocalMode(tenantId)) {
      return dataStore.updateOffer(context, tenantId, offerId, updates);
    }
    if (!isValidUuid(offerId)) {
      throw new Error('Card promocional inválido (id não reconhecido pelo banco).');
    }

    const has = (k: keyof Offer) => hasKey(updates, k);
    const db: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (has('title') && updates.title !== undefined) db.title = updates.title.trim();
    if (has('subtitle')) db.subtitle = trimOrNull(updates.subtitle);
    if (has('description')) db.description = (updates.description || '').trim();
    if (has('badge')) db.badge = trimOrNull(updates.badge);
    if (has('cardFormat') && updates.cardFormat) db.card_format = updates.cardFormat;
    if (has('mediaType') && updates.mediaType) {
      db.media_type = updates.mediaType;
      if (updates.mediaType !== 'VIDEO') db.video_duration = null;
    }
    if (has('mediaUrl') || has('imageUrl')) {
      const url = (updates.mediaUrl || updates.imageUrl || '').trim() || null;
      db.media_url = url;
      db.image_url = url;
    }
    if (has('durationSeconds') && updates.durationSeconds !== undefined) db.duration_seconds = updates.durationSeconds;
    if (has('videoDuration') && (updates.mediaType === undefined || updates.mediaType === 'VIDEO')) {
      db.video_duration = updates.videoDuration || null;
    }
    if (has('detectedWidth')) db.detected_width = updates.detectedWidth || null;
    if (has('detectedHeight')) db.detected_height = updates.detectedHeight || null;
    if (has('aspectRatio') && updates.aspectRatio) db.aspect_ratio = updates.aspectRatio;
    if (has('discountPercentage')) db.discount_percentage = positiveOrNull(updates.discountPercentage);
    if (has('originalPrice')) db.original_price = positiveOrNull(updates.originalPrice);
    if (has('promotionalPrice')) db.promotional_price = positiveOrNull(updates.promotionalPrice);
    if (has('internalLink')) db.internal_link = updates.internalLink || null;
    if (has('order') && updates.order !== undefined) db.display_order = updates.order;

    if (has('startAt') || has('startDate')) {
      const s = updates.startAt || updates.startDate || null;
      db.start_date = s;
      db.start_at = s;
    }
    if (updates.noEndDate === true) {
      db.end_date = null;
      db.end_at = null;
    } else if (has('endAt') || has('endDate')) {
      const e = updates.endAt || updates.endDate || null;
      db.end_date = e;
      db.end_at = e;
    }

    if (has('backgroundColor')) db.background_color = updates.backgroundColor || null;
    if (has('accentColor')) db.accent_color = updates.accentColor || null;
    if (has('isActive') && updates.isActive !== undefined) db.is_active = updates.isActive;
    if (has('autoOverlay') && updates.autoOverlay !== undefined) {
      db.auto_overlay = updates.autoOverlay;
    } else if (has('displayMode') && updates.displayMode) {
      // displayMode não é coluna: é derivado de auto_overlay.
      db.auto_overlay = updates.displayMode !== 'FULL_MEDIA';
    }
    if (has('cardModel') && updates.cardModel) db.card_model = updates.cardModel;

    if (has('destinationType') && updates.destinationType) {
      db.destination_type = updates.destinationType;
      if (updates.destinationType === 'CUSTOM_OFFER') {
        db.product_id = null;
        db.has_promo_checkout = true;
      }
    }
    if (has('productId') && updates.destinationType !== 'CUSTOM_OFFER') {
      db.product_id = await this.validateProductBelongsToTenant(tenantId, updates.productId);
      if (updates.destinationType === 'PRODUCT' && !db.product_id) {
        throw new Error('Selecione o produto do catálogo vinculado a este card.');
      }
    }
    if (has('hasPromoCheckout') && updates.destinationType !== 'CUSTOM_OFFER') {
      db.has_promo_checkout = Boolean(updates.hasPromoCheckout);
    }
    if (has('promoTitle')) db.promo_title = trimOrNull(updates.promoTitle);
    if (has('promoDescription')) db.promo_description = trimOrNull(updates.promoDescription);
    if (has('promoPrice')) db.promo_price = positiveOrNull(updates.promoPrice);
    if (has('promoOriginalPrice')) db.promo_original_price = positiveOrNull(updates.promoOriginalPrice);
    if (has('promoDiscountPercentage')) db.promo_discount_percentage = positiveOrNull(updates.promoDiscountPercentage);
    if (has('promoUnit') && updates.promoUnit) db.promo_unit = updates.promoUnit;
    if (has('promoMinQuantity') && updates.promoMinQuantity) db.promo_min_quantity = updates.promoMinQuantity;
    if (has('promoMaxQuantityPerCustomer') && updates.promoMaxQuantityPerCustomer) {
      db.promo_max_quantity_per_customer = updates.promoMaxQuantityPerCustomer;
    }
    if (has('promoNotes')) db.promo_notes = trimOrNull(updates.promoNotes);
    if (has('promoFulfillmentTypes') && updates.promoFulfillmentTypes) db.promo_fulfillment_types = updates.promoFulfillmentTypes;
    if (has('promoPaymentMethods') && updates.promoPaymentMethods) db.promo_payment_methods = updates.promoPaymentMethods;
    if (has('promoCouponCode')) db.promo_coupon_code = updates.promoCouponCode ? updates.promoCouponCode.trim().toUpperCase() : null;
    if (has('promoUsageLimit')) db.promo_usage_limit = positiveOrNull(updates.promoUsageLimit);
    // promo_times_used é controlado pelo backend (checkout atômico): não é sobrescrito pelo painel.

    const { data: updated, error } = await supabase
      .from('offers')
      .update(db)
      .eq('tenant_id', tenantId)
      .eq('id', offerId)
      .select()
      .maybeSingle();

    if (error) {
      throw dbError('atualizar o card promocional', error.message);
    }
    if (!updated) {
      throw new Error('O card não foi encontrado no banco ou você não tem permissão para alterá-lo.');
    }
    return mapRowToOffer(updated as OfferRow);
  },

  /**
   * Persiste a nova ordem dos cards. Lança erro se qualquer UPDATE falhar e
   * retorna a lista recarregada do banco (estado real).
   */
  async reorderOffers(context: SecurityContext, tenantId: string, offerIds: string[]): Promise<Offer[]> {
    if (isLocalMode(tenantId)) {
      return dataStore.reorderOffers(context, tenantId, offerIds);
    }
    for (let i = 0; i < offerIds.length; i++) {
      if (!isValidUuid(offerIds[i])) {
        throw new Error('Card promocional inválido na reordenação.');
      }
      const { data, error } = await supabase
        .from('offers')
        .update({ display_order: i + 1, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('id', offerIds[i])
        .select('id');
      if (error) {
        throw dbError('salvar a nova ordem dos cards', error.message);
      }
      if (!data || data.length !== 1) {
        throw new Error('Não foi possível salvar a nova ordem: card não encontrado ou sem permissão.');
      }
    }
    return this.getOffers(context, tenantId);
  },

  /**
   * Upload de mídia do card no bucket `marketing` (migration 023), caminho
   *   {tenant_id}/cards/{card_id}/{timestamp}.{ext}
   * O 1º segmento precisa ser o UUID do tenant: é o que a policy
   * can_manage_catalog_storage(name) exige. O caminho antigo
   * (catalog/marketing/{tenant}/...) era sempre negado e caía em base64.
   * Com Supabase configurado, falha de upload é erro real (sem base64 silencioso).
   */
  async uploadMedia(tenantId: string, cardId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() || (file.type.startsWith('video') ? 'mp4' : 'jpg');
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm'].includes(ext) ? ext : (file.type.startsWith('video') ? 'mp4' : 'jpg');

    if (isLocalMode(tenantId)) {
      // Modo demonstração/local explícito: mídia fica como Data URL no navegador.
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Erro ao converter arquivo local.'));
        reader.readAsDataURL(file);
      });
    }

    const cleanCardId = isValidUuid(cardId) ? cardId : crypto.randomUUID();
    const filePath = `${tenantId}/cards/${cleanCardId}/${Date.now()}.${safeExt}`;

    const { error: uploadErr } = await supabase.storage
      .from('marketing')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });

    if (uploadErr) {
      throw new Error(`Falha no upload da mídia para o Storage: ${uploadErr.message}`);
    }
    const { data } = supabase.storage.from('marketing').getPublicUrl(filePath);
    if (!data?.publicUrl) {
      throw new Error('Upload concluído, mas o Storage não retornou a URL pública da mídia.');
    }
    return data.publicUrl;
  },

  /**
   * Exclui um card. Confirma que exatamente 1 linha foi removida no banco.
   */
  async delete(context: SecurityContext, tenantId: string, offerId: string): Promise<void> {
    if (isLocalMode(tenantId)) {
      dataStore.deleteOffer(context, tenantId, offerId);
      return;
    }
    if (!isValidUuid(offerId)) {
      throw new Error('Card promocional inválido (id não reconhecido pelo banco).');
    }
    const { data, error } = await supabase
      .from('offers')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', offerId)
      .select('id');

    if (error) {
      throw dbError('excluir o card promocional', error.message);
    }
    if (!data || data.length === 0) {
      throw new Error('O card não foi encontrado no banco ou você não tem permissão para excluí-lo.');
    }
  },

  /**
   * Alterna ativo/pausado. Retorna o status confirmado pelo banco.
   */
  async toggleStatus(context: SecurityContext, tenantId: string, offerId: string): Promise<boolean> {
    const list = await this.getOffers(context, tenantId);
    const offer = list.find(o => o.id === offerId);
    if (!offer) throw new Error('Oferta não encontrada');
    const updated = await this.update(context, tenantId, offerId, { isActive: !offer.isActive });
    return updated.isActive;
  },

  /**
   * Duplica um card promocional existente.
   */
  async duplicate(context: SecurityContext, tenantId: string, offerId: string): Promise<Offer> {
    const list = await this.getOffers(context, tenantId);
    const source = list.find(o => o.id === offerId);
    if (!source) throw new Error('Card original não encontrado para duplicação.');

    const payload: Omit<Offer, 'id' | 'tenantId' | 'createdAt'> = {
      title: `${source.title} (Cópia)`,
      subtitle: source.subtitle,
      description: source.description,
      badge: source.badge,
      cardFormat: source.cardFormat,
      mediaType: source.mediaType,
      displayMode: source.displayMode,
      noEndDate: source.noEndDate,
      mediaUrl: source.mediaUrl,
      imageUrl: source.imageUrl,
      durationSeconds: source.durationSeconds,
      videoDuration: source.videoDuration,
      detectedWidth: source.detectedWidth,
      detectedHeight: source.detectedHeight,
      aspectRatio: source.aspectRatio,
      productId: source.productId,
      internalLink: source.internalLink,
      originalPrice: source.originalPrice,
      promotionalPrice: source.promotionalPrice,
      discountPercentage: source.discountPercentage,
      startDate: source.startDate,
      endDate: source.endDate,
      startAt: source.startAt,
      endAt: source.endAt,
      backgroundColor: source.backgroundColor,
      accentColor: source.accentColor,
      isActive: source.isActive,
      order: list.length + 1,

      // Configuração de Destino e Checkout Promocional Próprio
      destinationType: source.destinationType || 'BANNER_ONLY',
      cardModel: source.cardModel || 'HERO',
      autoOverlay: source.autoOverlay !== undefined ? source.autoOverlay : true,
      hasPromoCheckout: source.hasPromoCheckout,
      promoTitle: source.promoTitle,
      promoDescription: source.promoDescription,
      promoPrice: source.promoPrice,
      promoOriginalPrice: source.promoOriginalPrice,
      promoDiscountPercentage: source.promoDiscountPercentage,
      promoUnit: source.promoUnit || 'un',
      promoMinQuantity: source.promoMinQuantity || 1,
      promoMaxQuantityPerCustomer: source.promoMaxQuantityPerCustomer || 10,
      promoNotes: source.promoNotes,
      promoFulfillmentTypes: source.promoFulfillmentTypes,
      promoPaymentMethods: source.promoPaymentMethods,
      promoCouponCode: source.promoCouponCode,
      promoUsageLimit: source.promoUsageLimit,
      promoTimesUsed: 0, // Não copia contagem de uso conforme especificação
    };

    return this.create(context, tenantId, payload);
  },
};
