/**
 * Fonte ÚNICA (front) das regras de modalidade de atendimento (Delivery / Retirada)
 * e do desconto para retirada. Espelhada no backend pela proposta SQL
 * supabase/proposals/20261013000100_fulfillment_mode_and_pickup_discount.sql
 * (função public._fulfillment_quote / _checkout_core). Qualquer mudança aqui
 * DEVE ser refletida lá — os testes em __tests__ documentam os casos.
 *
 * Ordem do cálculo (centavos, round half-up em 2 casas, igual ao round() do Postgres):
 *  1. Preço efetivo de cada item (preço promocional do produto / preço próprio da oferta já aplicado).
 *  2. Desconto de retirada (somente PICKUP, se habilitado): pct sobre os itens elegíveis.
 *     Calculado separadamente para itens promocionais e não promocionais (cada parte arredondada).
 *  3. Cupom (regra N2): base = itens NÃO promocionais, já líquidos do desconto de retirada.
 *  4. Taxa de entrega: somente DELIVERY; grátis se subtotal bruto >= freeDeliveryThreshold (regra 009/N2).
 *  5. Total = subtotal − retirada − cupom + taxa, nunca negativo.
 *
 * O navegador só usa isto para EXIBIR a estimativa; o servidor recalcula tudo.
 */

export type FulfillmentMode = 'DELIVERY' | 'PICKUP';

export const PICKUP_DISCOUNT_MIN = 0;
export const PICKUP_DISCOUNT_MAX = 50;

export interface FulfillmentSettings {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFee: number;
  freeDeliveryThreshold?: number | null;
  pickupDiscountEnabled: boolean;
  pickupDiscountPercent: number;
  /** Itens já em promoção (produto com preço promocional / oferta independente) ficam fora do desconto. */
  pickupDiscountExcludePromotional: boolean;
  pickupDiscountExcludedProductIds: string[];
  pickupDiscountExcludedOfferIds: string[];
  pickupInstructions?: string | null;
}

export const DEFAULT_FULFILLMENT_SETTINGS: FulfillmentSettings = {
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFee: 0,
  freeDeliveryThreshold: null,
  pickupDiscountEnabled: false,
  pickupDiscountPercent: 0,
  pickupDiscountExcludePromotional: false,
  pickupDiscountExcludedProductIds: [],
  pickupDiscountExcludedOfferIds: [],
  pickupInstructions: null,
};

export interface PricingLine {
  productId?: string | null;
  offerId?: string | null;
  quantity: number;
  /** Preço efetivo unitário (já com promoção do produto ou preço próprio da oferta). */
  unitPrice: number;
  /** true quando o item já está com preço promocional (produto em promoção ou oferta independente). */
  isPromotional: boolean;
}

export interface PricingCoupon {
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED' | string;
  discountValue: number;
  minOrderValue?: number | null;
  maxDiscountAmount?: number | null;
  /**
   * D1 — o cupom só ACUMULA com o desconto de retirada quando a regra do cupom autoriza.
   * false/ausente (padrão): o cupom não incide sobre itens que já receberam desconto de retirada
   * (sem duplicidade); se não sobrar item elegível, o cupom é recusado (COUPON_NOT_STACKABLE_WITH_PICKUP).
   */
  stackWithPickupDiscount?: boolean | null;
}

export type CouponRejectedReason =
  | 'COUPON_MIN_ORDER'
  | 'COUPON_NO_ELIGIBLE_ITEMS'
  | 'COUPON_NOT_STACKABLE_WITH_PICKUP'
  | 'COUPON_NOT_LINKED_TO_OFFER';

export const COUPON_REJECTED_TEXT: Record<CouponRejectedReason, string> = {
  COUPON_MIN_ORDER: 'Valor mínimo do cupom não atingido.',
  COUPON_NO_ELIGIBLE_ITEMS: 'Cupom não se aplica a itens que já estão em promoção ou oferta.',
  COUPON_NOT_STACKABLE_WITH_PICKUP: 'Este cupom não acumula com o desconto de retirada.',
  COUPON_NOT_LINKED_TO_OFFER: 'Nesta oferta só vale o cupom vinculado a ela.',
};

export interface PricingBreakdown {
  mode: FulfillmentMode;
  subtotal: number;
  pickupDiscountPercent: number;
  pickupEligibleBase: number;
  pickupDiscount: number;
  couponBase: number;
  couponDiscount: number;
  couponRejectedReason?: CouponRejectedReason;
  deliveryFee: number;
  isFreeDelivery: boolean;
  totalDiscount: number;
  total: number;
}

/** round half-up a 2 casas (igual ao round(numeric, 2) do PostgreSQL). */
export function roundMoney(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const sign = v < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(v) * 100 + 1e-9)) / 100;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function isValidPickupDiscountPercent(v: unknown): boolean {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) && n >= PICKUP_DISCOUNT_MIN && n <= PICKUP_DISCOUNT_MAX && roundMoney(n) === n;
}

/** Normaliza configurações vindas do banco (snake_case) ou do front (camelCase). Nunca aceita % fora de 0–50. */
export function normalizeFulfillmentSettings(raw: any): FulfillmentSettings {
  const r = raw || {};
  const pick = (camel: string, snake: string) => (r[camel] !== undefined ? r[camel] : r[snake]);
  const bool = (v: unknown, d: boolean) => (v === undefined || v === null ? d : Boolean(v));
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
  let pct = num(pick('pickupDiscountPercent', 'pickup_discount_percent'), 0);
  if (!isValidPickupDiscountPercent(pct)) pct = 0;
  const threshold = pick('freeDeliveryThreshold', 'free_delivery_threshold');
  return {
    deliveryEnabled: bool(pick('deliveryEnabled', 'delivery_enabled'), true),
    pickupEnabled: bool(pick('pickupEnabled', 'pickup_enabled'), true),
    deliveryFee: Math.max(0, num(pick('deliveryFee', 'delivery_fee'), 0)),
    freeDeliveryThreshold: threshold === undefined || threshold === null || threshold === '' ? null : num(threshold, 0),
    pickupDiscountEnabled: bool(pick('pickupDiscountEnabled', 'pickup_discount_enabled'), false),
    pickupDiscountPercent: pct,
    pickupDiscountExcludePromotional: bool(pick('pickupDiscountExcludePromotional', 'pickup_discount_exclude_promotional'), false),
    pickupDiscountExcludedProductIds: ids(pick('pickupDiscountExcludedProductIds', 'pickup_discount_excluded_product_ids')),
    pickupDiscountExcludedOfferIds: ids(pick('pickupDiscountExcludedOfferIds', 'pickup_discount_excluded_offer_ids')),
    pickupInstructions: (pick('pickupInstructions', 'pickup_instructions') as string) || null,
  };
}

export interface AvailableModes {
  modes: FulfillmentMode[];
  /** Motivo legível quando nenhuma modalidade está disponível. */
  blockedReason?: string;
}

/**
 * Modalidades oferecidas ao cliente = configuração da loja ∩ restrição antiga do card
 * (campo legado promoFulfillmentTypes; vazio/ausente = sem restrição).
 */
export function resolveAvailableModes(
  settings: Pick<FulfillmentSettings, 'deliveryEnabled' | 'pickupEnabled'>,
  legacyAllowed?: FulfillmentMode[] | null,
): AvailableModes {
  const store: FulfillmentMode[] = [];
  if (settings.deliveryEnabled) store.push('DELIVERY');
  if (settings.pickupEnabled) store.push('PICKUP');
  const restrict = legacyAllowed && legacyAllowed.length > 0 ? legacyAllowed : null;
  const modes = restrict ? store.filter((m) => restrict.includes(m)) : store;
  if (modes.length > 0) return { modes };
  if (store.length === 0) {
    return { modes, blockedReason: 'Este estabelecimento não está aceitando pedidos para entrega nem para retirada no momento.' };
  }
  return { modes, blockedReason: 'Esta oferta só aceita uma modalidade que o estabelecimento desativou no momento.' };
}

export function isLineEligibleForPickupDiscount(line: PricingLine, s: FulfillmentSettings): boolean {
  if (line.productId && s.pickupDiscountExcludedProductIds.includes(line.productId)) return false;
  if (line.offerId && s.pickupDiscountExcludedOfferIds.includes(line.offerId)) return false;
  if (s.pickupDiscountExcludePromotional && line.isPromotional) return false;
  return true;
}

export function computeCouponDiscount(coupon: PricingCoupon, base: number): number {
  if (base <= 0) return 0;
  let v: number;
  if (coupon.discountType === 'PERCENTAGE') {
    v = roundMoney((base * num(coupon.discountValue)) / 100);
    if (coupon.maxDiscountAmount !== undefined && coupon.maxDiscountAmount !== null) v = Math.min(v, num(coupon.maxDiscountAmount));
  } else {
    v = num(coupon.discountValue);
  }
  return roundMoney(Math.max(0, Math.min(v, base)));
}

export function computeFulfillmentPricing(input: {
  mode: FulfillmentMode;
  lines: PricingLine[];
  settings: FulfillmentSettings;
  coupon?: PricingCoupon | null;
  /**
   * NON_PROMOTIONAL (padrão, D2/N2): cupom genérico só sobre itens que NÃO estavam em promoção
   * (promoção própria do produto ou campanha) ANTES dos descontos do checkout. Retirada não torna item promocional.
   * LINKED_OFFER (D3): checkout promocional independente — só o cupom vinculado à oferta (linkedCouponCode),
   * validado pelas regras da oferta, sobre o preço da oferta. Cupom genérico é recusado.
   * 'ALL' = alias legado de LINKED_OFFER.
   */
  couponBase?: 'NON_PROMOTIONAL' | 'LINKED_OFFER' | 'ALL';
  /** D3: código do cupom vinculado à oferta (obrigatório para aceitar cupom em LINKED_OFFER). */
  linkedCouponCode?: string | null;
}): PricingBreakdown {
  const { mode, lines, settings, coupon } = input;
  const couponBaseMode = input.couponBase === 'ALL' ? 'LINKED_OFFER' : (input.couponBase || 'NON_PROMOTIONAL');
  const pct = mode === 'PICKUP' && settings.pickupEnabled && settings.pickupDiscountEnabled
    && isValidPickupDiscountPercent(settings.pickupDiscountPercent) ? settings.pickupDiscountPercent : 0;

  let subtotal = 0;            // D6: soma dos preços efetivos pela origem (antes de retirada/cupom)
  let nonPromoBase = 0;        // itens não promocionais (antes do checkout)
  let nonPromoNoPickup = 0;    // não promocionais que NÃO recebem desconto de retirada
  let eligPromo = 0;
  let eligNonPromo = 0;
  for (const l of lines) {
    const qty = Math.max(0, Math.floor(num(l.quantity)));
    const lineTotal = roundMoney(Math.max(0, num(l.unitPrice)) * qty);
    subtotal = roundMoney(subtotal + lineTotal);
    const getsPickup = pct > 0 && isLineEligibleForPickupDiscount(l, settings);
    if (!l.isPromotional) {
      nonPromoBase = roundMoney(nonPromoBase + lineTotal);
      if (!getsPickup) nonPromoNoPickup = roundMoney(nonPromoNoPickup + lineTotal);
    }
    if (isLineEligibleForPickupDiscount(l, settings)) {
      if (l.isPromotional) eligPromo = roundMoney(eligPromo + lineTotal);
      else eligNonPromo = roundMoney(eligNonPromo + lineTotal);
    }
  }

  // 1º desconto de retirada (D1), arredondado por grupo.
  const pickupOnNonPromo = pct > 0 ? roundMoney((eligNonPromo * pct) / 100) : 0;
  const pickupOnPromo = pct > 0 ? roundMoney((eligPromo * pct) / 100) : 0;
  const pickupDiscount = roundMoney(pickupOnNonPromo + pickupOnPromo);

  // 2º cupom, validado sobre o valor já líquido da retirada, sem duplicidade (D1/D2/D3).
  let couponBase = 0;
  let couponDiscount = 0;
  let couponRejectedReason: CouponRejectedReason | undefined;
  if (coupon) {
    const stack = Boolean(coupon.stackWithPickupDiscount);
    let minRef = 0;
    if (couponBaseMode === 'LINKED_OFFER') {
      const linked = (input.linkedCouponCode || '').trim().toUpperCase();
      if (!linked || linked !== String(coupon.code || '').trim().toUpperCase()) {
        couponRejectedReason = 'COUPON_NOT_LINKED_TO_OFFER';
      } else if (pickupDiscount > 0 && !stack) {
        couponRejectedReason = 'COUPON_NOT_STACKABLE_WITH_PICKUP';
      } else {
        couponBase = roundMoney(Math.max(0, subtotal - pickupDiscount));
        minRef = subtotal;
      }
    } else {
      couponBase = stack
        ? roundMoney(Math.max(0, nonPromoBase - pickupOnNonPromo))
        : nonPromoNoPickup;
      minRef = couponBase;
      if (couponBase <= 0) {
        couponRejectedReason = nonPromoBase > 0 && pickupOnNonPromo > 0 && !stack
          ? 'COUPON_NOT_STACKABLE_WITH_PICKUP'
          : 'COUPON_NO_ELIGIBLE_ITEMS';
      }
    }
    if (!couponRejectedReason) {
      if (couponBase <= 0) couponRejectedReason = 'COUPON_NO_ELIGIBLE_ITEMS';
      else if (coupon.minOrderValue && minRef < num(coupon.minOrderValue)) couponRejectedReason = 'COUPON_MIN_ORDER';
      else couponDiscount = computeCouponDiscount(coupon, couponBase);
    }
  } else {
    couponBase = couponBaseMode === 'LINKED_OFFER'
      ? roundMoney(Math.max(0, subtotal - pickupDiscount))
      : roundMoney(Math.max(0, nonPromoBase - pickupOnNonPromo));
  }

  // Taxa (D6): limite de frete grátis avaliado sobre o subtotal efetivo pela origem,
  // antes da retirada e do cupom; nunca sobre o preço de lista anterior à promoção.
  let deliveryFee = 0;
  let isFreeDelivery = false;
  if (mode === 'DELIVERY' && subtotal > 0) {
    const thr = settings.freeDeliveryThreshold;
    isFreeDelivery = thr !== null && thr !== undefined && thr > 0 && subtotal >= thr;
    deliveryFee = isFreeDelivery ? 0 : roundMoney(Math.max(0, settings.deliveryFee));
  }

  const totalDiscount = roundMoney(Math.min(subtotal, pickupDiscount + couponDiscount));
  const total = roundMoney(Math.max(0, subtotal - totalDiscount + deliveryFee));
  return {
    mode, subtotal, pickupDiscountPercent: pct, pickupEligibleBase: roundMoney(eligPromo + eligNonPromo),
    pickupDiscount, couponBase, couponDiscount, couponRejectedReason, deliveryFee, isFreeDelivery, totalDiscount, total,
  };
}

/** Linha de pricing a partir de um produto do catálogo (preço promocional válido conforme N2: 0 < promo <= preço). */
export function productToPricingLine(p: { id: string; price: number; promotionalPrice?: number | null }, quantity: number): PricingLine {
  const promo = p.promotionalPrice;
  const hasPromo = promo !== undefined && promo !== null && promo > 0 && promo <= p.price;
  return {
    productId: p.id,
    quantity,
    unitPrice: hasPromo ? (promo as number) : p.price,
    isPromotional: Boolean(hasPromo && (promo as number) < p.price),
  };
}

/** Campos de modalidade/desconto a partir de uma linha crua (snake_case do banco ou camelCase). */
export function fulfillmentFieldsFromRaw(raw: any) {
  const n = normalizeFulfillmentSettings(raw);
  return {
    deliveryEnabled: n.deliveryEnabled,
    pickupEnabled: n.pickupEnabled,
    pickupDiscountEnabled: n.pickupDiscountEnabled,
    pickupDiscountPercent: n.pickupDiscountPercent,
    pickupDiscountExcludePromotional: n.pickupDiscountExcludePromotional,
    pickupDiscountExcludedProductIds: n.pickupDiscountExcludedProductIds,
    pickupDiscountExcludedOfferIds: n.pickupDiscountExcludedOfferIds,
    pickupInstructions: n.pickupInstructions || undefined,
  };
}

/** Converte TenantSettings (camelCase) em FulfillmentSettings, com padrões seguros. */
export function fulfillmentSettingsFromTenant(settings: any): FulfillmentSettings {
  return normalizeFulfillmentSettings(settings || {});
}

/** Converte campos camelCase alterados em colunas snake_case da proposta (somente as presentes). */
export function fulfillmentFieldsToDb(u: Record<string, any>): Record<string, any> {
  const map: Record<string, string> = {
    deliveryEnabled: 'delivery_enabled',
    pickupEnabled: 'pickup_enabled',
    pickupDiscountEnabled: 'pickup_discount_enabled',
    pickupDiscountPercent: 'pickup_discount_percent',
    pickupDiscountExcludePromotional: 'pickup_discount_exclude_promotional',
    pickupDiscountExcludedProductIds: 'pickup_discount_excluded_product_ids',
    pickupDiscountExcludedOfferIds: 'pickup_discount_excluded_offer_ids',
    pickupInstructions: 'pickup_instructions',
  };
  const out: Record<string, any> = {};
  for (const [k, col] of Object.entries(map)) if (u[k] !== undefined) out[col] = u[k];
  return out;
}

export function validateFulfillmentSettingsUpdate(u: Record<string, any>): string | null {
  if (u.pickupDiscountPercent !== undefined && !isValidPickupDiscountPercent(u.pickupDiscountPercent)) {
    return 'O desconto para retirada deve estar entre 0% e 50% (até 2 casas decimais).';
  }
  if (u.pickupDiscountEnabled && u.pickupDiscountPercent !== undefined && Number(u.pickupDiscountPercent) <= 0) {
    return 'Informe um percentual maior que 0% para ativar o desconto de retirada.';
  }
  if (u.pickupInstructions !== undefined && String(u.pickupInstructions || '').length > 500) {
    return 'As instruções de retirada podem ter no máximo 500 caracteres.';
  }
  return null;
}

/** Linha de pricing de uma oferta promocional independente (preço próprio; sempre conta como "em promoção"). */
export function offerToPricingLine(o: { id: string; productId?: string | null }, unitPrice: number, quantity: number): PricingLine {
  return { offerId: o.id, productId: o.productId || null, quantity, unitPrice, isPromotional: true };
}
