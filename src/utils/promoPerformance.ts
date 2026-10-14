/**
 * Desempenho & Vendas dos Cards Promocionais — lógica pura (sem I/O, testável).
 *
 * FONTE OFICIAL (N1–N6): RPC get_promo_offer_performance (N5), agregada no servidor e restrita a
 * OWNER/MANAGER. A atribuição é orders.offer_id, gravada SÓ por process_promotional_checkout_atomic (N6)
 * com a cadeia tenant→campanha→card→oferta→produto validada no servidor e imutável (N1).
 *  - Um pedido tem no máximo um offer_id: conta uma única vez.
 *  - Vendas comuns do produto divulgado (sem offer_id) não contam para o card.
 *  - CANCELLED ou payment_status REFUNDED: fora de pedidos/faturamento/resgates/desconto
 *    (contadores e cupom já revertidos no servidor), contados à parte como invalidados.
 *  - Faturamento = total_amount − delivery_fee. Resgates = unidades dos itens OFFER de pedidos
 *    válidos (mesma unidade de offers.promo_times_used). Desconto = (preço original − cobrado) × qtd
 *    + cupom rateado no item.
 *  - Visualizações/cliques não são exibidos (sem rastreamento confiável nesta aba).
 * O cálculo local (computePromoPerformance) só é usado no modo de demonstração sem Supabase.
 */
import type { Offer } from '../types';

export type PeriodPreset = 'today' | '7d' | '30d' | 'custom';
export interface PeriodRange { start: Date; end: Date } // [start, end)
export type PromoCardKind = 'BANNER_ONLY' | 'PRODUCT' | 'CUSTOM_OFFER';

/** Pedido no formato mínimo usado pelo painel (montado pelo promoPerformanceRepository). */
export interface PromoOrder {
  id: string;
  tenantId: string;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  deliveryFee: number;
  createdAt: string;
  origin?: string;
  offerId?: string;
  /** Unidades promocionais (itens OFFER do card) do pedido; 0 quando não há registro de resgate. */
  redeemedUnits?: number;
  /** Desconto concedido no pedido (diferença de preço promocional + cupom rateado nos itens do card). */
  promoDiscount?: number;
}

type Row = Record<string, unknown>;

/** Linha devolvida por get_promo_offer_performance (N5). */
export interface ServerOfferPerformanceRow {
  offer_id: string;
  valid_orders: number;
  invalidated_orders: number;
  revenue: number;
  redeemed_units: number;
  discount: number;
  last_valid_order_at: string | null;
}

export function parseServerPerformance(payload: unknown): ServerOfferPerformanceRow[] {
  const rows = payload && typeof payload === 'object' ? (payload as Row).rows : null;
  if (!Array.isArray(rows)) throw new Error('Resposta inválida do servidor (desempenho).');
  return rows.map(r => {
    const x = r as Row;
    return {
      offer_id: String(x.offer_id),
      valid_orders: Number(x.valid_orders) || 0,
      invalidated_orders: Number(x.invalidated_orders) || 0,
      revenue: Number(x.revenue) || 0,
      redeemed_units: Number(x.redeemed_units) || 0,
      discount: Number(x.discount) || 0,
      last_valid_order_at: x.last_valid_order_at ? String(x.last_valid_order_at) : null,
    };
  });
}

/** Converte o agregado do servidor no mesmo formato do painel (sem recalcular nada no navegador). */
export function summarizeServerPerformance(params: { tenantId: string; cards: Offer[]; rows: ServerOfferPerformanceRow[] }): PromoPerformanceSummary {
  const { tenantId, cards, rows } = params;
  const tenantCards = cards.filter(c => !c.tenantId || c.tenantId === tenantId);
  const byId = new Map(rows.map(r => [r.offer_id, r]));
  let attributedOrders = 0, revenue = 0, cancelledOrRefunded = 0, redemptions = 0, discount = 0;
  const lastSale: Record<string, string> = {};
  const out: CardPerformanceRow[] = tenantCards.map(c => {
    const kind = getPromoCardKind(c);
    const r = byId.get(c.id);
    if (r?.last_valid_order_at) lastSale[c.id] = r.last_valid_order_at;
    if (!(kind === 'CUSTOM_OFFER' || r)) {
      return { cardId: c.id, kind, orders: null, revenue: null, cancelledOrders: null, redemptions: null, discount: null, discountRatio: null, averageTicket: null };
    }
    const v = r ?? { valid_orders: 0, invalidated_orders: 0, revenue: 0, redeemed_units: 0, discount: 0 };
    attributedOrders += v.valid_orders; revenue = round2(revenue + v.revenue); cancelledOrRefunded += v.invalidated_orders;
    redemptions += v.redeemed_units; discount = round2(discount + v.discount);
    return {
      cardId: c.id, kind, orders: v.valid_orders, revenue: round2(v.revenue), cancelledOrders: v.invalidated_orders,
      redemptions: v.redeemed_units, discount: round2(v.discount),
      discountRatio: v.revenue > 0 ? round2(v.discount / v.revenue) : null,
      averageTicket: v.valid_orders > 0 ? round2(v.revenue / v.valid_orders) : null,
    };
  });
  return {
    attributedOrders, revenue, redemptions, discount,
    averageTicket: attributedOrders > 0 ? round2(revenue / attributedOrders) : null,
    cancelledOrRefunded, unattributedPromoOrders: 0, rows: out, lastSaleByCard: lastSale,
  };
}

/** Erros de "função inexistente" do PostgREST/Postgres = N5 ainda não aplicada no banco. */
export function isMissingFunctionError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function|function .* does not exist/i.test(err.message || '');
}

export function friendlyPerformanceError(err: { code?: string; message?: string }): string {
  if (err.code === '42501' || /FORBIDDEN/.test(err.message || '')) return 'Somente proprietário ou gerente da loja pode ver o desempenho dos cards.';
  if (/INVALID_PERIOD/.test(err.message || '')) return 'Período inválido (máximo de 400 dias).';
  return err.message || 'Falha ao carregar o desempenho.';
}

/** Pedido local (modo demonstração) → PromoOrder. */
export function mapPromoOrderRow(r: Row): PromoOrder {
  const offerId = (r.offer_id as string) || undefined;
  const items = Array.isArray(r.order_items) ? (r.order_items as Row[]) : [];
  const mine = offerId ? items.filter(i => i.offer_id === offerId) : [];
  const units = mine.filter(i => i.item_kind === 'OFFER').reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const disc = mine.reduce((s, i) => {
    const unit = Number(i.unit_price) || 0;
    const orig = i.original_unit_price != null ? Number(i.original_unit_price) : unit;
    return s + Math.max(0, orig - unit) * (Number(i.quantity) || 0) + (Number(i.discount_amount) || 0);
  }, 0);
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    status: String(r.status),
    paymentStatus: String(r.payment_status),
    totalAmount: Number(r.total_amount ?? 0),
    deliveryFee: Number(r.delivery_fee ?? 0),
    createdAt: String(r.created_at),
    origin: (r.origin as string) || 'direct',
    offerId,
    redeemedUnits: units,
    promoDiscount: Math.round(disc * 100) / 100,
  };
}

const DAY = 864e5;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Datas customizadas yyyy-mm-dd (inclusivas, fuso local). */
export function resolvePeriod(preset: PeriodPreset, now: Date = new Date(), custom?: { from?: string; to?: string }): PeriodRange | null {
  const today = startOfLocalDay(now);
  const tomorrow = addDays(today, 1);
  if (preset === 'today') return { start: today, end: tomorrow };
  if (preset === '7d') return { start: addDays(today, -6), end: tomorrow };
  if (preset === '30d') return { start: addDays(today, -29), end: tomorrow };
  const parse = (s?: string) => {
    const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const from = parse(custom?.from), to = parse(custom?.to);
  if (!from || !to || to < from) return null;
  return { start: from, end: addDays(to, 1) };
}

/** Período imediatamente anterior com o mesmo número de dias. */
export function previousPeriod(range: PeriodRange): PeriodRange {
  const days = Math.round((startOfLocalDay(range.end).getTime() - startOfLocalDay(range.start).getTime()) / DAY);
  return { start: addDays(range.start, -days), end: new Date(range.start.getTime()) };
}

export function getPromoCardKind(card: Pick<Offer, 'destinationType' | 'hasPromoCheckout' | 'productId'>): PromoCardKind {
  // N4: o checkout promocional é a flag offers.has_promo_checkout (não existe destination_type);
  // por isso ela tem prioridade sobre o destino derivado no front.
  if (card.hasPromoCheckout) return 'CUSTOM_OFFER';
  const d = card.destinationType as string | undefined;
  if (d === 'CUSTOM_OFFER' || d === 'PRODUCT' || d === 'BANNER_ONLY') return d;
  return card.productId ? 'PRODUCT' : 'BANNER_ONLY';
}

export function isOrderFinanciallyValid(o: Pick<PromoOrder, 'status' | 'paymentStatus'>): boolean {
  return o.status !== 'CANCELLED' && o.paymentStatus !== 'REFUNDED';
}

export function orderPromoRevenue(o: Pick<PromoOrder, 'totalAmount' | 'deliveryFee'>): number {
  const v = (Number(o.totalAmount) || 0) - (Number(o.deliveryFee) || 0);
  return v > 0 ? round2(v) : 0;
}

export interface CardPerformanceRow {
  cardId: string;
  kind: PromoCardKind;
  /** null = não se aplica/não mensurável (card visual ou de produto sem rastreio). */
  orders: number | null;
  revenue: number | null;
  cancelledOrders: number | null;
  redemptions: number | null;
  discount: number | null;
  /** desconto ÷ faturamento; null quando não há faturamento. */
  discountRatio: number | null;
  averageTicket: number | null;
}

export interface PromoPerformanceSummary {
  attributedOrders: number;
  revenue: number;
  redemptions: number;
  discount: number;
  averageTicket: number | null;
  cancelledOrRefunded: number;
  /** Pedidos promocionais sem offer_id válido da loja (não atribuídos). */
  unattributedPromoOrders: number;
  rows: CardPerformanceRow[];
  /** Data (ISO) da última venda válida por card (servidor: independe do período). */
  lastSaleByCard: Record<string, string>;
}

const inRange = (o: PromoOrder, r: PeriodRange) => {
  const t = new Date(o.createdAt).getTime();
  return t >= r.start.getTime() && t < r.end.getTime();
};

export function computePromoPerformance(params: { tenantId: string; cards: Offer[]; orders: PromoOrder[]; range: PeriodRange }): PromoPerformanceSummary {
  const { tenantId, cards, orders, range } = params;
  const tenantCards = cards.filter(c => !c.tenantId || c.tenantId === tenantId);
  const cardIds = new Set(tenantCards.map(c => c.id));
  const seen = new Set<string>();
  const per = new Map<string, { orders: number; revenue: number; cancelled: number; redemptions: number; discount: number }>();
  let attributedOrders = 0, revenue = 0, cancelledOrRefunded = 0, unattributed = 0, redemptions = 0, discount = 0;
  const lastSale: Record<string, string> = {};

  for (const o of orders) {
    if (!o || seen.has(o.id)) continue;
    if (o.tenantId && o.tenantId !== tenantId) continue;
    if (!inRange(o, range)) continue;
    seen.add(o.id);
    if (!o.offerId || !cardIds.has(o.offerId)) {
      if (o.origin === 'storefront_promo' || o.origin === 'promotional_checkout') unattributed++;
      continue;
    }
    const a = per.get(o.offerId) ?? { orders: 0, revenue: 0, cancelled: 0, redemptions: 0, discount: 0 };
    if (!isOrderFinanciallyValid(o)) {
      a.cancelled++; cancelledOrRefunded++;
    } else {
      const r = orderPromoRevenue(o);
      const d = round2(Math.max(0, Number(o.promoDiscount) || 0));
      a.orders++; a.revenue = round2(a.revenue + r); a.discount = round2(a.discount + d);
      attributedOrders++; revenue = round2(revenue + r); discount = round2(discount + d);
      const u = Math.max(0, Number(o.redeemedUnits) || 0);
      a.redemptions += u; redemptions += u;
      if (!lastSale[o.offerId] || lastSale[o.offerId] < o.createdAt) lastSale[o.offerId] = o.createdAt;
    }
    per.set(o.offerId, a);
  }

  const rows: CardPerformanceRow[] = tenantCards.map(c => {
    const kind = getPromoCardKind(c);
    const a = per.get(c.id);
    if (!(kind === 'CUSTOM_OFFER' || a)) {
      return { cardId: c.id, kind, orders: null, revenue: null, cancelledOrders: null, redemptions: null, discount: null, discountRatio: null, averageTicket: null };
    }
    const x = a ?? { orders: 0, revenue: 0, cancelled: 0, redemptions: 0, discount: 0 };
    return {
      cardId: c.id, kind, orders: x.orders, revenue: x.revenue, cancelledOrders: x.cancelled,
      redemptions: x.redemptions, discount: x.discount,
      discountRatio: x.revenue > 0 ? round2(x.discount / x.revenue) : null,
      averageTicket: x.orders > 0 ? round2(x.revenue / x.orders) : null,
    };
  });

  return {
    attributedOrders, revenue, redemptions, discount,
    averageTicket: attributedOrders > 0 ? round2(revenue / attributedOrders) : null,
    cancelledOrRefunded, unattributedPromoOrders: unattributed, rows, lastSaleByCard: lastSale,
  };
}

// ---------- Ideia 1: comparação com o período anterior ----------
export interface MetricDelta { direction: 'up' | 'down' | 'flat' | 'none'; pct: number | null }
/** 'none' quando o período anterior é zero/inexistente (sem base de comparação). */
export function compareMetric(current: number | null, previous: number | null): MetricDelta {
  if (current == null || previous == null || previous === 0) return { direction: 'none', pct: null };
  const pct = round2(((current - previous) / previous) * 100);
  return { direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', pct };
}

// ---------- Ideia 2: top 3 + cards sem venda ----------
export function topCardsByRevenue(rows: CardPerformanceRow[], n = 3): CardPerformanceRow[] {
  return rows.filter(r => (r.revenue ?? 0) > 0)
    .sort((a, b) => (b.revenue! - a.revenue!) || ((b.orders ?? 0) - (a.orders ?? 0)))
    .slice(0, n);
}

/**
 * Cards de checkout promocional no ar há ≥ `days` dias sem nenhuma venda válida nos últimos `days`
 * dias. `lastSaleByCard` vem do servidor (última venda válida, sem filtro de período).
 */
export function staleCheckoutCards(params: {
  tenantId: string; cards: Offer[]; lastSaleByCard: Record<string, string>; now: Date; days?: number; isLive: (c: Offer) => boolean;
}): Offer[] {
  const { tenantId, cards, lastSaleByCard, now, days = 7, isLive } = params;
  const since = now.getTime() - days * DAY;
  return cards.filter(c => {
    if (c.tenantId && c.tenantId !== tenantId) return false;
    if (getPromoCardKind(c) !== 'CUSTOM_OFFER' || !isLive(c)) return false;
    const liveSince = new Date(c.startAt || c.startDate || c.createdAt || now.toISOString()).getTime();
    if (!(liveSince <= since)) return false; // ainda não completou o período
    const last = lastSaleByCard[c.id];
    return !last || new Date(last).getTime() < since;
  });
}

// ---------- Ideia 3: limite de usos ----------
export interface UsageAlert { card: Offer; used: number; limit: number; pct: number; exhausted: boolean }
export function usageLimitAlerts(cards: Offer[], threshold = 0.9): UsageAlert[] {
  return cards.flatMap(c => {
    const limit = Number(c.promoUsageLimit) || 0;
    if (getPromoCardKind(c) !== 'CUSTOM_OFFER' || limit <= 0) return [];
    const used = Math.max(0, Number(c.promoTimesUsed) || 0);
    const pct = used / limit;
    return pct >= threshold ? [{ card: c, used, limit, pct: round2(pct * 100), exhausted: used >= limit }] : [];
  }).sort((a, b) => b.pct - a.pct);
}

// ---------- Ideia 4: CSV ----------
const KIND_LABEL: Record<PromoCardKind, string> = { BANNER_ONLY: 'Apenas visual', PRODUCT: 'Produto do catálogo', CUSTOM_OFFER: 'Checkout promocional' };
const fmtDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const money = (n: number | null) => (n == null ? 'n/a' : n.toFixed(2).replace('.', ','));
const cell = (v: string | number) => {
  const s = String(v);
  return /[";\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
};

/** CSV (separador ';', decimal ',', BOM UTF-8) por card no período. */
export function buildPerformanceCsv(params: { cards: Offer[]; rows: CardPerformanceRow[]; range: PeriodRange; statusLabel: (c: Offer) => string }): string {
  const { cards, rows, range, statusLabel } = params;
  const byId = new Map(rows.map(r => [r.cardId, r]));
  const lastDay = new Date(range.end.getTime() - 1);
  const header = ['Período', 'ID do card', 'Card', 'Tipo', 'Status', 'Pedidos válidos', 'Cancelados/estornados', 'Faturamento (R$)', 'Ticket médio (R$)', 'Benefícios resgatados (unidades)', 'Desconto concedido (R$)', 'Desconto por R$ 1 vendido', 'Usos acumulados', 'Limite de usos'];
  const lines = [header.map(cell).join(';')];
  for (const c of cards) {
    const r = byId.get(c.id);
    if (!r) continue;
    const isCheckout = r.kind === 'CUSTOM_OFFER';
    lines.push([
      `${fmtDate(range.start)} a ${fmtDate(lastDay)}`, c.id, c.title || '', KIND_LABEL[r.kind], statusLabel(c),
      r.orders ?? 'n/a', r.cancelledOrders ?? 'n/a', money(r.revenue), money(r.averageTicket), r.redemptions ?? 'n/a',
      money(r.discount), r.discountRatio == null ? 'n/a' : r.discountRatio.toFixed(2).replace('.', ','),
      isCheckout ? Number(c.promoTimesUsed) || 0 : 'n/a', isCheckout ? (Number(c.promoUsageLimit) > 0 ? Number(c.promoUsageLimit) : 'Ilimitado') : 'n/a',
    ].map(cell).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
