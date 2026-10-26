/**
 * Mapeadores puros de pedidos (sem efeitos colaterais; cobertos por testes Vitest).
 *
 * Regras N1–N6 aplicadas aqui:
 * - prep_time_minutes NULL permanece undefined (decisão 34: sem default 30).
 * - Histórico do CLIENTE nunca carrega changedBy/note (PII interna — correção da 020).
 */
import { Order, OrderStatus, OrderPixPayload, CouponPreview } from '../types';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function optNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Linha de orders (+ order_items, order_status_history) lida pela equipe da loja (RLS de staff). */
export function mapStaffOrderRow(row: any, items: any[] = [], history: any[] = []): Order {
  return {
    id: row.id,
    orderNumber: num(row.order_number),
    tenantId: row.tenant_id,
    customerId: row.customer_id || undefined,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email || undefined,
    deliveryAddress: row.delivery_address,
    addressDetails: row.address_details || undefined,
    items: items.map(item => ({
      productId: item.product_id,
      productName: item.product_name,
      quantity: num(item.quantity),
      unitPrice: num(item.unit_price),
      totalPrice: num(item.total_price),
      notes: item.notes || undefined,
      unit: item.unit || 'un',
      options: (item.order_item_options || []).map((option: any) => ({
        groupId: option.group_id,
        optionId: option.option_id,
        groupName: option.group_name_snapshot,
        optionName: option.option_name_snapshot,
        qty: num(option.qty),
        unitPriceCents: num(option.unit_price_cents),
        fraction: optNum(option.fraction),
      })),
    })),
    subtotal: num(row.subtotal),
    deliveryFee: num(row.delivery_fee),
    discount: num(row.discount),
    totalAmount: num(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    fulfillmentType: row.fulfillment_type || 'DELIVERY',
    tabId: row.tab_id || undefined,
    tableLabel: row.table_label || undefined,
    roundNo: optNum(row.round_no),
    notes: row.notes || undefined,
    prepTimeMinutes: optNum(row.prep_time_minutes),
    status: row.status as OrderStatus,
    statusHistory: [...history]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(h => ({
        status: h.status,
        timestamp: h.created_at,
        note: h.note || undefined,
        changedBy: h.changed_by || 'Sistema',
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || undefined,
    archivedBy: row.archived_by || undefined,
    driverId: row.driver_id || undefined,
    driverAcceptedAt: row.driver_accepted_at || undefined,
    pickedUpAt: row.picked_up_at || undefined,
    driverPayout: optNum(row.driver_payout),
    storeDeliveryShare: optNum(row.store_delivery_share),
    origin: row.origin || 'direct',
    couponCode: row.coupon_code || undefined,
    campaignId: row.campaign_id || undefined,
    cardId: row.card_id || undefined,
    offerId: row.offer_id || undefined,
    isDemo: false,
  };
}

/**
 * Pedido do cliente devolvido por get_customer_order_by_id (N1). O histórico
 * público tem apenas status + horário; qualquer note/changedBy que apareça é
 * descartado também no cliente (defesa em profundidade).
 */
export function mapCustomerOrderRpc(data: any, tenantId: string): Order {
  return {
    id: data.id,
    orderNumber: num(data.orderNumber),
    tenantId,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail || undefined,
    deliveryAddress: data.deliveryAddress,
    addressDetails: data.addressDetails || undefined,
    items: (data.items || []).map((item: any) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: num(item.quantity),
      unitPrice: num(item.unitPrice),
      totalPrice: num(item.totalPrice),
      notes: item.notes || undefined,
      unit: item.unit || 'un',
      options: (item.options || item.order_item_options || []).map((option: any) => ({
        groupId: option.groupId || option.group_id,
        optionId: option.optionId || option.option_id,
        groupName: option.groupName || option.group_name_snapshot,
        optionName: option.optionName || option.option_name_snapshot,
        qty: num(option.qty),
        unitPriceCents: num(option.unitPriceCents ?? option.unit_price_cents),
        fraction: optNum(option.fraction),
      })),
    })),
    subtotal: num(data.subtotal),
    deliveryFee: num(data.deliveryFee),
    discount: num(data.discount),
    totalAmount: num(data.totalAmount),
    paymentMethod: data.paymentMethod,
    paymentStatus: data.paymentStatus,
    fulfillmentType: data.fulfillmentType || 'DELIVERY',
    notes: data.notes || undefined,
    prepTimeMinutes: optNum(data.prepTimeMinutes),
    status: data.status as OrderStatus,
    statusHistory: (data.statusHistory || []).map((h: any) => ({
      status: h.status,
      timestamp: h.timestamp,
      changedBy: '',
    })),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    origin: 'storefront',
    isDemo: false,
  };
}

/** Pedido do cliente lido direto de orders/order_items (RLS do cliente); sem histórico interno. */
export function mapCustomerOrderRow(row: any): Order {
  const o = mapStaffOrderRow(row, row.order_items || [], []);
  o.statusHistory = [];
  return o;
}

/**
 * Anexa o histórico PÚBLICO (só status + horário) aos pedidos do cliente. Descarta qualquer outra coluna
 * (note/changed_by) mesmo que venha na linha — defesa em profundidade.
 */
export function attachCustomerHistory(orders: Order[], rows: any[]): Order[] {
  const byOrder = new Map<string, { status: OrderStatus; timestamp: string; changedBy: string }[]>();
  for (const r of rows || []) {
    if (!r || !r.order_id || !r.status || !r.created_at) continue;
    const list = byOrder.get(r.order_id) || [];
    list.push({ status: String(r.status).toUpperCase() as OrderStatus, timestamp: String(r.created_at), changedBy: '' });
    byOrder.set(r.order_id, list);
  }
  return orders.map(o => {
    const h = byOrder.get(o.id);
    if (!h) return o;
    return { ...o, statusHistory: h.sort((a, b) => a.timestamp.localeCompare(b.timestamp)) };
  });
}

/** Valida o pedido de mudança de status antes de chamar update_order_status (F5 + nota obrigatória). */
export function validateStatusChange(
  current: OrderStatus | undefined,
  next: OrderStatus,
  note?: string
): { ok: true; note: string | null } | { ok: false; code: string; message: string } {
  if (current === 'CANCELLED') {
    return { ok: false, code: 'ORDER_CANCELLED_IS_FINAL', message: 'Pedido cancelado não pode ser reaberto.' };
  }
  if (current && current === next) {
    return { ok: false, code: 'STATUS_UNCHANGED', message: `O pedido já está em ${next}.` };
  }
  const clean = (note || '').trim();
  if (next === 'CANCELLED' && !clean) {
    return { ok: false, code: 'NOTE_REQUIRED', message: 'Informe o motivo do cancelamento.' };
  }
  if (clean.length > 500) {
    return { ok: false, code: 'INVALID_NOTE', message: 'A nota deve ter no máximo 500 caracteres.' };
  }
  return { ok: true, note: clean || null };
}

/** Itens enviados ao servidor: SOMENTE productId, quantity e notes (preço é sempre do servidor). */
export function toServerItems(items: Array<{ productId: string; quantity: number; notes?: string; options?: Array<{ groupId: string; optionId: string; qty: number; fraction?: number | null }> }>) {
  return items.map(i => ({
    productId: i.productId,
    quantity: Math.trunc(Number(i.quantity)),
    notes: i.notes && i.notes.trim() ? i.notes.trim() : null,
    ...(i.options?.length ? {
      options: i.options.map(option => ({
        group_id: option.groupId,
        option_id: option.optionId,
        qty: Math.trunc(Number(option.qty)),
        fraction: option.fraction ?? null,
      })),
    } : {}),
  }));
}

export function mapPixPayload(data: any): OrderPixPayload {
  return {
    orderId: data.order_id,
    orderNumber: num(data.order_number),
    amount: num(data.amount),
    merchantName: data.merchant_name || '',
    brcode: String(data.brcode || ''),
  };
}

export function mapCouponPreview(data: any): CouponPreview {
  return {
    valid: Boolean(data?.valid),
    reason: data?.reason ?? null,
    message: data?.message || (data?.valid ? 'Cupom aplicado.' : 'Cupom inválido.'),
    code: data?.code ?? null,
    discount: num(data?.discount),
    eligibleBase: num(data?.eligible_base),
  };
}
