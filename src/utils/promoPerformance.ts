/**
 * Desempenho & Vendas dos Cards Promocionais — lógica pura (sem I/O, testável).
 *
 * REGRA DE ATRIBUIÇÃO (documentada):
 *  - Um pedido só é atribuído a um card quando o SERVIDOR gravou `orders.offer_id`
 *    (RPC process_promotional_checkout_atomic, 026 + correção 027). Sem atribuição
 *    por produto: vendas comuns do produto divulgado NÃO contam para o card.
 *  - O card precisa pertencer à loja ativa; pedidos de outra loja são ignorados.
 *  - Cada pedido conta no máximo uma vez (deduplicação por id).
 *  - CANCELLED ou pagamento REFUNDED: fora de pedidos, faturamento, resgates,
 *    desconto e ticket médio (contados à parte como cancelados/estornados).
 *  - Faturamento = total_amount − delivery_fee (itens já com desconto, sem frete).
 *  - Benefício resgatado = pedido válido atribuído que tem registro de resgate do
 *    servidor (campaign_metadata.redemption_number).
 *  - Desconto concedido = order_items.discount_amount dos itens do card + orders.discount.
 *  - Visualizações/cliques: sem rastreamento confiável → não exibidos.
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
  /** campaign_metadata.redemption_number gravado pelo servidor; null quando ausente. */
  redemptionNumber?: number | null;
  /** Desconto concedido no pedido (itens do card + desconto do pedido). */
  promoDiscount?: number;
}

type Row = Record<string, unknown>;

/** Converte uma linha de orders (+ order_items) do Supabase em PromoOrder. */

export function mapPromoOrderRow(r: Row): PromoOrder {
  const offerId = (r.offer_id as string) || undefined;
  const meta = (r.campaign_metadata && typeof r.campaign_metadata === 'object') ? r.campaign_metadata as Row : {};
  const rn = meta.redemption_number;
  const items = Array.isArray(r.order_items) ? (r.order_items as Row[]) : [];
  const itemDiscount = offerId
    ? items.filter(i => i.offer_id === offerId).reduce((s, i) => s + (Number(i.discount_amount) || 0), 0)
    : 0;
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
    redemptionNumber: rn != null && rn !== '' && Number.isFinite(Number(rn)) ? Number(rn) : null,
    promoDiscount: Math.round((itemDiscount + (Number(r.discount) || 0)) * 100) / 100,
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
  const d = card.destinationType as string | undefined;
  if (d === 'CUSTOM_OFFER' || d === 'PRODUCT' || d === 'BANNER_ONLY') return d;
  return card.hasPromoCheckout ? 'CUSTOM_OFFER' : card.productId ? 'PRODUCT' : 'BANNER_ONLY';
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
  /** origin=promotional_checkout sem offer_id válido da loja (não atribuído). */
  unattributedPromoOrders: number;
  rows: CardPerformanceRow[];
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

  for (const o of orders) {
    if (!o || seen.has(o.id)) continue;
    if (o.tenantId && o.tenantId !== tenantId) continue;
    if (!inRange(o, range)) continue;
    seen.add(o.id);
    if (!o.offerId || !cardIds.has(o.offerId)) {
      if (o.origin === 'promotional_checkout') unattributed++;
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
      if (o.redemptionNumber != null) { a.redemptions++; redemptions++; }
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
    cancelledOrRefunded, unattributedPromoOrders: unattributed, rows,
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
 * Cards de checkout promocional no ar há ≥ `days` dias sem nenhum pedido válido
 * atribuído nos últimos `days` dias. Precisa dos pedidos que cobrem [now−days, now].
 */
export function staleCheckoutCards(params: {
  tenantId: string; cards: Offer[]; orders: PromoOrder[]; now: Date; days?: number; isLive: (c: Offer) => boolean;
}): Offer[] {
  const { tenantId, cards, orders, now, days = 7, isLive } = params;
  const since = now.getTime() - days * DAY;
  const sold = new Set(orders.filter(o => (!o.tenantId || o.tenantId === tenantId) && o.offerId && isOrderFinanciallyValid(o)
    && new Date(o.createdAt).getTime() >= since && new Date(o.createdAt).getTime() <= now.getTime()).map(o => o.offerId!));
  return cards.filter(c => {
    if (c.tenantId && c.tenantId !== tenantId) return false;
    if (getPromoCardKind(c) !== 'CUSTOM_OFFER' || !isLive(c)) return false;
    const liveSince = new Date(c.startAt || c.startDate || c.createdAt || now.toISOString()).getTime();
    if (!(liveSince <= since)) return false; // ainda não completou o período
    return !sold.has(c.id);
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
  const header = ['Período', 'ID do card', 'Card', 'Tipo', 'Status', 'Pedidos válidos', 'Cancelados/estornados', 'Faturamento (R$)', 'Ticket médio (R$)', 'Benefícios resgatados', 'Desconto concedido (R$)', 'Desconto por R$ 1 vendido', 'Usos acumulados', 'Limite de usos'];
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
