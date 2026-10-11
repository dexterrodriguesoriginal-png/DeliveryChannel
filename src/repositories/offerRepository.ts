import { supabase, isSupabaseConfigured, ensureValidSession } from '../lib/supabase';
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
  media_type?: string | null;
  auto_overlay?: boolean | null;
  destination_type?: string | null;
  media_url?: string | null;
  image_url?: string | null;
  duration_seconds?: number | string | null;
  video_duration?: number | string | null;
  detected_width?: number | string | null;
  detected_height?: number | string | null;
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
    cardFormat: 'HORIZONTAL',
    mediaType,
    displayMode: autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA',
    cardModel: 'HERO',
    autoOverlay,
    destinationType: normalizeDestination(row.destination_type, row.product_id),
    mediaUrl,
    imageUrl,
    durationSeconds: optNumber(row.duration_seconds) ?? 5,
    videoDuration: optNumber(row.video_duration),
    detectedWidth: optNumber(row.detected_width),
    detectedHeight: optNumber(row.detected_height),
    aspectRatio: '16:9',
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

export interface UploadMediaOptions {
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export interface UploadMediaResult {
  assetId?: string;
  path: string;
}

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
        image_url: mediaUrl,
        discount_percentage: positiveOrNull(data.discountPercentage),
        original_price: positiveOrNull(data.originalPrice),
        promotional_price: positiveOrNull(data.promotionalPrice),
        internal_link: data.internalLink || null,
        display_order: data.order ?? 0,
        start_date: startAt,
        end_date: endAt,
        background_color: data.backgroundColor || null,
        accent_color: data.accentColor || null,
        is_active: data.isActive !== undefined ? data.isActive : true,
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
    if (has('mediaUrl') || has('imageUrl')) {
      const url = (updates.mediaUrl || updates.imageUrl || '').trim() || null;
      db.image_url = url;
    }
    if (has('discountPercentage')) db.discount_percentage = positiveOrNull(updates.discountPercentage);
    if (has('originalPrice')) db.original_price = positiveOrNull(updates.originalPrice);
    if (has('promotionalPrice')) db.promotional_price = positiveOrNull(updates.promotionalPrice);
    if (has('internalLink')) db.internal_link = updates.internalLink || null;
    if (has('order') && updates.order !== undefined) db.display_order = updates.order;

    if (has('startAt') || has('startDate')) {
      const s = updates.startAt || updates.startDate || null;
      db.start_date = s;
    }
    if (updates.noEndDate === true) {
      db.end_date = null;
    } else if (has('endAt') || has('endDate')) {
      const e = updates.endAt || updates.endDate || null;
      db.end_date = e;
    }

    if (has('backgroundColor')) db.background_color = updates.backgroundColor || null;
    if (has('accentColor')) db.accent_color = updates.accentColor || null;
    if (has('isActive') && updates.isActive !== undefined) db.is_active = updates.isActive;

    if (has('productId')) {
      db.product_id = await this.validateProductBelongsToTenant(tenantId, updates.productId);
    }

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
   * Upload de mídia de marketing conforme a arquitetura oficial N3 (DESIGN_N1_N6_ARQUITETURA_v3):
   * 1. register_marketing_asset(p_tenant_id, p_kind, p_media_type, p_extension, p_declared_size)
   * 2. Upload do arquivo no bucket privado "marketing" no path gerado pelo banco.
   * 3. confirm_marketing_upload(p_asset_id, p_width, p_height, p_duration)
   *
   * Retorna objeto tipado contendo assetId e path gerados pelo banco para posterior fluxo de publicação.
   */
  async uploadMedia(
    tenantId: string,
    _cardId: string,
    file: File,
    options?: UploadMediaOptions
  ): Promise<UploadMediaResult> {
    if (isLocalMode(tenantId)) {
      // Modo demonstração/local explícito: mídia fica como Data URL no navegador.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Erro ao converter arquivo local.'));
        reader.readAsDataURL(file);
      });
      return { path: dataUrl };
    }

    if (!isValidUuid(tenantId)) {
      throw new Error('Tenant ID inválido para upload de mídia.');
    }

    // 2. p_kind deve ser CREATIVE.
    const kind = 'CREATIVE';

    // 3. p_media_type deve ser IMAGE ou VIDEO, nunca MIME type.
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
    const mediaType = isVideo ? 'VIDEO' : 'IMAGE';

    // 4. p_extension deve conter somente a extensão do arquivo, sem nome original e sem ponto inicial.
    const lastDotIndex = file.name.lastIndexOf('.');
    const rawExtension = lastDotIndex !== -1 ? file.name.slice(lastDotIndex + 1).toLowerCase().trim() : '';
    const extension = rawExtension || (isVideo ? 'mp4' : 'jpg');

    // 5. p_declared_size deve ser file.size.
    const declaredSize = file.size;

    // 1. Chamar register_marketing_asset usando a assinatura oficial
    const { data: regData, error: regError } = await supabase.rpc('register_marketing_asset', {
      p_tenant_id: tenantId,
      p_kind: kind,
      p_media_type: mediaType,
      p_extension: extension,
      p_declared_size: declaredSize,
    });

    if (regError || !regData) {
      throw new Error(`Falha ao registrar asset de marketing: ${regError?.message || "Resposta inválida"}`);
    }

    // 6. Usar exatamente o bucket e path retornados pelo RPC para fazer o upload privado
    const assetId = regData.asset_id;
    const bucket = regData.bucket;
    const path = regData.path;
    const maxBytes = regData.max_bytes ? Number(regData.max_bytes) : 0;

    if (!assetId || !bucket || !path) {
      throw new Error("register_marketing_asset não retornou asset_id, bucket ou path válidos.");
    }

    if (maxBytes > 0 && declaredSize > maxBytes) {
      throw new Error(`O arquivo excede o limite máximo permitido de ${Math.round(maxBytes / 1024 / 1024)}MB.`);
    }

    // Garante que a sessão Supabase esteja válida antes de enviar para o Storage
    await ensureValidSession();

    let uploadErrResult = (
      await supabase.storage
        .from(bucket)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
        })
    ).error;

    // Se o upload falhar com erro de token expirado (exp claim timestamp check failed),
    // força refresh da sessão e repete o upload exatamente uma única vez.
    if (uploadErrResult && /exp claim|jwt|expired|token/i.test(uploadErrResult.message || '')) {
      console.warn('[offerRepository] Token expirado no upload para Storage, renovando sessão e tentando novamente...');
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr) {
        uploadErrResult = (
          await supabase.storage
            .from(bucket)
            .upload(path, file, {
              cacheControl: "3600",
              upsert: true,
              contentType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
            })
        ).error;
      }
    }

    if (uploadErrResult) {
      throw new Error(`Falha no upload para o Storage privado (${bucket}): ${uploadErrResult.message}`);
    }

    // 7. Depois chamar confirm_marketing_upload com a assinatura oficial N3:
    // public.confirm_marketing_upload(p_asset_id UUID, p_width INT, p_height INT, p_duration NUMERIC)
    const pWidth = options?.width !== undefined && options?.width !== null ? Math.round(Number(options.width)) : null;
    const pHeight = options?.height !== undefined && options?.height !== null ? Math.round(Number(options.height)) : null;
    const pDuration = isVideo
      ? (options?.duration !== undefined && options?.duration !== null ? Number(options.duration) : null)
      : null;

    const { error: confirmErr } = await supabase.rpc("confirm_marketing_upload", {
      p_asset_id: assetId,
      p_width: pWidth,
      p_height: pHeight,
      p_duration: pDuration,
    });

    if (confirmErr) {
      throw new Error(`Falha ao confirmar upload do asset de marketing: ${confirmErr.message}`);
    }

    // 11. Retornar identificador/path necessários para o fluxo de publicação posterior
    return {
      assetId,
      path,
    };
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
