/**
 * Repositório de pedidos — compatível com os dois esquemas de backend (ver src/lib/backendSchema.ts).
 *
 * Com Supabase configurado NÃO existe fallback local (dataStore/localStorage/mock): erro do servidor
 * vira erro na tela. Sem Supabase, o modo demonstração (dataStore) só existe em DEV.
 *
 * n1n6 (VITE_BACKEND_SCHEMA=n1n6):
 *  - Status:      update_order_status (cancelado é final; nota obrigatória no cancelamento; estorno no servidor).
 *  - Pagamento:   update_order_payment_status.
 *  - PDV:         process_pos_sale_atomic (OWNER/MANAGER/CASHIER; preço/estoque/cupom no servidor).
 *  - Checkout:    process_checkout_atomic_v2 (auth obrigatória, idempotência, cupom atômico).
 *  - Promocional: process_promotional_checkout_atomic (N6, origem storefront_promo gravada pelo servidor).
 *  - PIX:         get_order_pix_payload (BR Code gerado no servidor).
 *  - Cupom:       validate_coupon / validate_coupon_pos (prévia; o consumo é atômico no checkout/PDV).
 *
 * legacy-020 (padrão, produção atual 001–020):
 *  - Checkout:    process_checkout_atomic (001–020, exige auth.uid(), preço no servidor).
 *  - Status:      UPDATE de orders sob RLS de staff + order_status_history (caminho atual do 001–020).
 *  - PDV:         INSERT direto sob RLS de staff (único caminho que existe no 001–020 — ver docs/n1-n6/ATIVACAO_FRONTEND.md).
 *  - Cupom, checkout promocional, PIX por pedido e pagamento por RPC: indisponíveis (N1N6_REQUIRED).
 *  - Motorista (ambos): update_driver_order_status / assign_order_to_driver / unassign_order_driver.
 */
import { countPendingRows } from '../lib/tenant/storeSwitcher';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Order, OrderStatus, PaymentStatus, OrderPixPayload, CouponPreview, CustomerOrigin } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';
import { isN1N6Backend, N1N6_ONLY_MESSAGE } from '../lib/backendSchema';
import {
  BackendError,
  isLocalDemoAllowed,
  newIdempotencyKey,
  requireBackend,
  requireBackendOrLocalDemo,
  toBackendError,
} from '../lib/backend';
import {
  mapCouponPreview,
  mapCustomerOrderRow,
  attachCustomerHistory,
  mapCustomerOrderRpc,
  mapPixPayload,
  mapStaffOrderRow,
  toServerItems,
  validateStatusChange,
} from './orderMappers';
import { posSaleNotes, isMissingRpcSignature } from './posSaleNotes';

const STAFF_ORDER_SELECT = '*, order_items(*), order_status_history(*)';

/** Origens aceitas pelo CHECK de orders.origin no 001–020. */
const LEGACY_ORIGINS: ReadonlySet<string> = new Set([
  'qr_code', 'whatsapp', 'instagram', 'direct', 'marketplace', 'google', 'indicacao', 'direto', 'outros',
]);
export function legacyOrigin(origin: string | undefined): CustomerOrigin {
  return (origin && LEGACY_ORIGINS.has(origin) ? origin : 'direct') as CustomerOrigin;
}

/**
 * Itens de carrossel ("Ofertas do Dia") no carrinho comum.
 *  - n1n6: o servidor (_price_items → _effective_product_price da N4) já aplica sozinho o preço do item de
 *    carrossel ativo ao produto, e a vitrine N6 exibe exatamente esse preço (effectivePrice). O item vai como
 *    linha comum {productId, quantity, notes} (toServerItems descarta a origem) — sem erro para o cliente.
 *  - legacy-020: não há preço de carrossel no servidor; recusa com código próprio para a vitrine converter a
 *    linha para o preço do catálogo e avisar o cliente.
 */
export const CAMPAIGN_SOURCE_UNAVAILABLE_MSG =
  'Este servidor não aplica o preço de oferta no carrinho. Ajustamos a sacola para o preço normal; confira e confirme novamente.';
export function assertCartCampaignLinesSupported(items: Array<{ source?: string }>, n1n6: boolean): void {
  if (n1n6) return;
  if (items.some(i => i.source === 'campaign')) {
    throw new BackendError('CAMPAIGN_SOURCE_UNAVAILABLE', CAMPAIGN_SOURCE_UNAVAILABLE_MSG);
  }
}

export function n1n6Required(feature: string): BackendError {
  return new BackendError('N1N6_REQUIRED', `${feature}: ${N1N6_ONLY_MESSAGE}`);
}

export interface CheckoutSummary {
  orderId: string;
  orderNumber: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  totalAmount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  couponCode?: string;
  prepTimeMinutes?: number;
  pixAvailable: boolean;
  replayed: boolean;
  promotion?: { campaignId?: string; cardId?: string; offerId?: string; itemKind?: string };
}

export function mapCheckoutSummary(data: any): CheckoutSummary {
  if (!data || typeof data !== 'object' || !data.order_id) {
    throw new BackendError('INVALID_SERVER_RESPONSE', 'O servidor não confirmou a criação do pedido.');
  }
  return {
    orderId: data.order_id,
    orderNumber: Number(data.order_number),
    subtotal: Number(data.subtotal),
    discount: Number(data.discount ?? 0),
    deliveryFee: Number(data.delivery_fee ?? 0),
    totalAmount: Number(data.total_amount),
    status: data.status,
    paymentStatus: data.payment_status,
    couponCode: data.coupon?.code || undefined,
    prepTimeMinutes:
      data.prep_time_minutes === null || data.prep_time_minutes === undefined ? undefined : Number(data.prep_time_minutes),
    pixAvailable: Boolean(data.payment?.pix_available),
    replayed: Boolean(data.replayed),
    promotion: data.promotion
      ? {
          campaignId: data.promotion.campaign_id || undefined,
          cardId: data.promotion.card_id || undefined,
          offerId: data.promotion.offer_id || undefined,
          itemKind: data.promotion.item_kind || undefined,
        }
      : undefined,
  };
}

export interface PublicOrderInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deliveryAddress?: string;
  addressDetails?: Order['addressDetails'];
  items: Array<{ productId: string; quantity: number; notes?: string; source?: 'catalog' | 'campaign'; campaignItemId?: string }>;
  paymentMethod: Order['paymentMethod'];
  fulfillmentType?: Order['fulfillmentType'];
  notes?: string;
  origin: Order['origin'];
  /** Mesma chave em reenvios da MESMA tentativa (evita pedido duplicado; só n1n6). */
  idempotencyKey?: string;
  couponCode?: string;
  cardId?: string;
}

export interface PromotionalOrderInput {
  offerId?: string;
  campaignId?: string;
  cardId?: string;
  quantity: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deliveryAddress?: string;
  addressDetails?: Order['addressDetails'];
  paymentMethod: Order['paymentMethod'];
  fulfillmentType?: Order['fulfillmentType'];
  notes?: string;
  couponCode?: string;
  idempotencyKey?: string;
}

export interface PosSaleInput {
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  items: Array<{ productId: string; quantity: number; notes?: string }>;
  paymentMethod: Order['paymentMethod'];
  notes?: string;
  couponCode?: string;
  idempotencyKey?: string;
}

async function loadCustomerOrder(orderId: string, tenantId: string, fallbackMsg: string): Promise<Order> {
  const { data, error } = await supabase.rpc('get_customer_order_by_id', { p_order_id: orderId });
  if (!error && data) return mapCustomerOrderRpc(data, (data as any).tenantId || tenantId);
  // Sem pedido "fictício": o pedido existe no servidor, mas a confirmação não pôde ser lida.
  throw new BackendError('ORDER_CONFIRMATION_UNAVAILABLE', fallbackMsg);
}

function unavailableMsg(summary: CheckoutSummary): string {
  return (
    `Pedido #${summary.orderNumber} registrado no servidor (total R$ ${summary.totalAmount.toFixed(2)}), ` +
    'mas não foi possível carregar a confirmação. Consulte "Meus pedidos".'
  );
}

export const orderRepository = {
  async getOrders(context: SecurityContext, tenantId: string): Promise<Order[]> {
    if (isSupabaseConfigured) {
      if (!isValidUuid(tenantId)) throw new BackendError('INVALID_TENANT', 'Loja inválida.');
      const { data, error } = await supabase
        .from('orders')
        .select(STAFF_ORDER_SELECT)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw toBackendError(error, 'Falha ao carregar pedidos.');
      return (data || []).map((row: any) => mapStaffOrderRow(row, row.order_items || [], row.order_status_history || []));
    }
    requireBackendOrLocalDemo('pedidos');
    return dataStore.getOrders(context, tenantId);
  },

  async getById(context: SecurityContext, tenantId: string, orderId: string): Promise<Order | undefined> {
    if (isSupabaseConfigured) {
      if (!isValidUuid(tenantId) || !isValidUuid(orderId)) return undefined;
      const { data, error } = await supabase
        .from('orders')
        .select(STAFF_ORDER_SELECT)
        .eq('tenant_id', tenantId)
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw toBackendError(error, 'Falha ao carregar o pedido.');
      return data ? mapStaffOrderRow(data, (data as any).order_items || [], (data as any).order_status_history || []) : undefined;
    }
    requireBackendOrLocalDemo('pedidos');
    return dataStore.getOrderById(context, tenantId, orderId);
  },

  /** Muda o status. Pedido cancelado não reabre e cancelamento exige motivo (validado também no servidor N1). */
  async updateStatus(
    context: SecurityContext,
    tenantId: string,
    orderId: string,
    newStatus: OrderStatus,
    note?: string,
    currentStatus?: OrderStatus
  ): Promise<Order> {
    // DRIVER usa o RPC próprio; o motivo obrigatório vale para staff que cancela.
    const check = validateStatusChange(currentStatus, newStatus, context.userRole === 'DRIVER' ? note || 'Entrega' : note);
    if (!check.ok) throw new BackendError(check.code, check.message);

    if (!isSupabaseConfigured) {
      requireBackendOrLocalDemo('status de pedido');
      return dataStore.updateOrderStatus(context, tenantId, orderId, newStatus, check.note || undefined);
    }
    if (!isValidUuid(tenantId) || !isValidUuid(orderId)) throw new BackendError('INVALID_ORDER', 'Pedido inválido.');

    if (context.userRole === 'DRIVER') {
      const { error } = await supabase.rpc('update_driver_order_status', {
        p_order_id: orderId,
        p_status: newStatus,
        p_note: note?.trim() || null,
      });
      if (error) throw toBackendError(error, 'Falha ao atualizar a entrega.');
    } else if (isN1N6Backend()) {
      const { error } = await supabase.rpc('update_order_status', {
        p_order_id: orderId,
        p_new_status: newStatus,
        p_note: check.note,
      });
      if (error) throw toBackendError(error, 'Falha ao atualizar o status do pedido.');
    } else {
      await legacyUpdateStatus(context, tenantId, orderId, newStatus, check.note);
    }
    const updated = await this.getById(context, tenantId, orderId);
    if (!updated) throw new BackendError('ORDER_NOT_FOUND', 'Pedido atualizado não encontrado.');
    return updated;
  },

  /** Status de pagamento (OWNER/MANAGER/CASHIER, validado no servidor). Só n1n6. */
  async updatePaymentStatus(
    context: SecurityContext,
    tenantId: string,
    orderId: string,
    newPaymentStatus: PaymentStatus,
    note?: string
  ): Promise<Order> {
    requireBackend('status de pagamento');
    if (!isN1N6Backend()) throw n1n6Required('Alterar pagamento');
    const { error } = await supabase.rpc('update_order_payment_status', {
      p_order_id: orderId,
      p_new_payment_status: newPaymentStatus,
      p_note: note && note.trim() ? note.trim() : null,
    });
    if (error) throw toBackendError(error, 'Falha ao atualizar o pagamento.');
    const updated = await this.getById(context, tenantId, orderId);
    if (!updated) throw new BackendError('ORDER_NOT_FOUND', 'Pedido não encontrado.');
    return updated;
  },

  /** Venda de balcão (PDV). */
  async createPosSale(context: SecurityContext, tenantId: string, input: PosSaleInput): Promise<Order> {
    requireBackend('PDV');
    if (!isValidUuid(tenantId)) throw new BackendError('INVALID_TENANT', 'Loja inválida.');
    if (!input.items.length) throw new BackendError('EMPTY_CART', 'Adicione ao menos um item.');
    if (!isN1N6Backend()) throw n1n6Required('PDV (venda de balcão)');
    const posArgs: Record<string, unknown> = {
      p_tenant_id: tenantId,
      p_items: toServerItems(input.items),
      p_payment_method: input.paymentMethod,
      p_customer_name: input.customerName?.trim() || null,
      p_customer_phone: input.customerPhone?.trim() || null,
      p_customer_id: input.customerId && isValidUuid(input.customerId) ? input.customerId : null,
      p_coupon_code: input.couponCode?.trim() || null,
      p_idempotency_key: input.idempotencyKey && isValidUuid(input.idempotencyKey) ? input.idempotencyKey : newIdempotencyKey(),
    };
    const posNotes = posSaleNotes(input.notes);
    let { data, error } = await supabase.rpc('process_pos_sale_atomic', posNotes ? { ...posArgs, p_notes: posNotes } : posArgs);
    // Banco ainda sem a 1400 (sem p_notes): repete sem a observação para não bloquear a venda.
    if (error && posNotes && isMissingRpcSignature(error)) {
      ({ data, error } = await supabase.rpc('process_pos_sale_atomic', posArgs));
    }
    if (error) throw toBackendError(error, 'Falha ao registrar a venda de balcão.');
    const summary = mapCheckoutSummary(data);
    const order = await this.getById(context, tenantId, summary.orderId);
    if (!order) throw new BackendError('ORDER_NOT_FOUND', `Venda #${summary.orderNumber} registrada, mas não foi possível carregá-la.`);
    return order;
  },

  /** Compatibilidade com chamadas existentes (OrdersPage). */
  async createDirectOrder(context: SecurityContext, tenantId: string, orderData: PosSaleInput & { customerName: string; customerPhone: string }): Promise<Order> {
    return this.createPosSale(context, tenantId, orderData);
  },

  /** Prévia de cupom no servidor (não consome). PDV usa validate_coupon_pos; vitrine usa validate_coupon. */
  async validateCoupon(
    target: { slug: string } | { tenantId: string; customerId?: string },
    code: string,
    items: Array<{ productId: string; quantity: number; notes?: string }>
  ): Promise<CouponPreview> {
    requireBackend('cupom');
    if (!isN1N6Backend()) throw n1n6Required('Cupom');
    const res =
      'slug' in target
        ? await supabase.rpc('validate_coupon', { p_tenant_slug: target.slug, p_code: code.trim(), p_items: toServerItems(items) })
        : await supabase.rpc('validate_coupon_pos', {
            p_tenant_id: target.tenantId,
            p_code: code.trim(),
            p_items: toServerItems(items),
            p_customer_id: target.customerId && isValidUuid(target.customerId) ? target.customerId : null,
          });
    if (res.error) throw toBackendError(res.error, 'Falha ao validar o cupom.');
    return mapCouponPreview(res.data);
  },

  /** Checkout do carrinho. Exige cliente autenticado (auth.uid() no servidor) nos dois modos. */
  async createPublicOrder(slug: string, orderData: PublicOrderInput): Promise<Order> {
    if (!isSupabaseConfigured) {
      requireBackendOrLocalDemo('checkout');
      return dataStore.createPublicOrder(slug, orderData as any);
    }
    assertCartCampaignLinesSupported(orderData.items, isN1N6Backend());
    if (!isN1N6Backend()) {
      if (orderData.couponCode && orderData.couponCode.trim()) throw n1n6Required('Cupom');
      const { data: orderId, error } = await supabase.rpc('process_checkout_atomic', {
        p_tenant_slug: slug,
        p_customer_name: orderData.customerName,
        p_customer_phone: orderData.customerPhone,
        p_customer_email: orderData.customerEmail || null,
        p_delivery_address: orderData.deliveryAddress || (orderData.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : ''),
        p_address_details: orderData.addressDetails || {},
        p_payment_method: orderData.paymentMethod,
        p_fulfillment_type: orderData.fulfillmentType || 'DELIVERY',
        p_notes: orderData.notes || '',
        p_origin: legacyOrigin(orderData.origin),
        p_items: toServerItems(orderData.items),
      });
      if (error) throw toBackendError(error, 'Falha ao processar checkout no servidor.');
      if (!orderId || typeof orderId !== 'string') throw new BackendError('INVALID_SERVER_RESPONSE', 'O servidor não confirmou o pedido.');
      return loadCustomerOrder(orderId, '', `Pedido #${orderId.slice(0, 8)} registrado, mas a confirmação não pôde ser carregada. Consulte "Meus pedidos".`);
    }
    const { data, error } = await supabase.rpc('process_checkout_atomic_v2', {
      p_tenant_slug: slug,
      p_customer_name: orderData.customerName,
      p_customer_phone: orderData.customerPhone,
      p_delivery_address: orderData.deliveryAddress || (orderData.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : ''),
      p_address_details: orderData.addressDetails || {},
      p_payment_method: orderData.paymentMethod,
      p_fulfillment_type: orderData.fulfillmentType || 'DELIVERY',
      p_notes: orderData.notes || null,
      p_items: toServerItems(orderData.items),
      p_coupon_code: orderData.couponCode?.trim() || null,
      p_idempotency_key: orderData.idempotencyKey && isValidUuid(orderData.idempotencyKey) ? orderData.idempotencyKey : newIdempotencyKey(),
      p_card_id: orderData.cardId && isValidUuid(orderData.cardId) ? orderData.cardId : null,
    });
    if (error) throw toBackendError(error, 'Falha ao processar o checkout.');
    const summary = mapCheckoutSummary(data);
    const order = await loadCustomerOrder(summary.orderId, '', unavailableMsg(summary));
    order.couponCode = summary.couponCode;
    order.origin = 'storefront';
    return order;
  },

  /** Checkout promocional (oferta / card de campanha). Só existe no N1–N6 (N6). */
  async createPromotionalOrder(
    slug: string,
    orderData: PromotionalOrderInput
  ): Promise<{ order: Order; summary: CheckoutSummary }> {
    if (!isSupabaseConfigured) requireBackend('checkout promocional');
    if (!isN1N6Backend()) throw n1n6Required('Checkout promocional');
    if (!orderData.offerId && !orderData.cardId) throw new BackendError('PROMO_UNAVAILABLE', 'Promoção inválida.');
    const { data, error } = await supabase.rpc('process_promotional_checkout_atomic', {
      p_store_slug: slug,
      p_campaign_id: orderData.campaignId && isValidUuid(orderData.campaignId) ? orderData.campaignId : null,
      p_card_id: orderData.cardId && isValidUuid(orderData.cardId) ? orderData.cardId : null,
      p_offer_id: orderData.offerId && isValidUuid(orderData.offerId) ? orderData.offerId : null,
      p_quantity: Math.trunc(Number(orderData.quantity)),
      p_customer_name: orderData.customerName,
      p_customer_phone: orderData.customerPhone,
      p_delivery_address: orderData.deliveryAddress || (orderData.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : ''),
      p_address_details: orderData.addressDetails || {},
      p_payment_method: orderData.paymentMethod,
      p_fulfillment_type: orderData.fulfillmentType || 'DELIVERY',
      p_notes: orderData.notes || null,
      p_coupon_code: orderData.couponCode?.trim() || null,
      p_idempotency_key: orderData.idempotencyKey && isValidUuid(orderData.idempotencyKey) ? orderData.idempotencyKey : newIdempotencyKey(),
    });
    if (error) throw toBackendError(error, 'Falha ao processar o checkout promocional.');
    const summary = mapCheckoutSummary(data);
    const order = await loadCustomerOrder(summary.orderId, '', unavailableMsg(summary));
    order.origin = 'storefront_promo';
    order.couponCode = summary.couponCode;
    order.campaignId = summary.promotion?.campaignId;
    order.cardId = summary.promotion?.cardId;
    order.offerId = summary.promotion?.offerId;
    return { order, summary };
  },

  /** BR Code PIX do pedido, gerado no servidor (só o cliente dono do pedido / staff da loja). Só n1n6. */
  async getOrderPixPayload(orderId: string): Promise<OrderPixPayload> {
    requireBackend('PIX');
    if (!isN1N6Backend()) throw n1n6Required('PIX do pedido');
    const { data, error } = await supabase.rpc('get_order_pix_payload', { p_order_id: orderId });
    if (error) throw toBackendError(error, 'PIX indisponível para este pedido.');
    return mapPixPayload(data);
  },

  /** Pedidos do cliente autenticado nesta loja (RLS do cliente; histórico interno não é lido). */
  async getCustomerOrders(tenantId: string, customerUserId: string): Promise<Order[]> {
    if (!isSupabaseConfigured) {
      if (isLocalDemoAllowed) return [];
      requireBackend('pedidos do cliente');
    }
    if (!isValidUuid(tenantId)) return [];
    const { data: customerRow, error: cErr } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', customerUserId)
      .maybeSingle();
    if (cErr) throw toBackendError(cErr, 'Falha ao consultar seus pedidos.');
    if (!customerRow) return [];
    const extra = isN1N6Backend() ? ', coupon_code' : '';
    const { data, error } = await supabase
      .from('orders')
      .select(
        'id, tenant_id, customer_id, order_number, customer_name, customer_phone, customer_email, delivery_address, address_details, subtotal, delivery_fee, discount, total_amount, payment_method, payment_status, fulfillment_type, status, notes, prep_time_minutes, origin, created_at, updated_at' +
          extra +
          ', order_items(product_id, product_name, quantity, unit_price, total_price, notes, unit)'
      )
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerRow.id)
      .order('created_at', { ascending: false });
    if (error) throw toBackendError(error, 'Falha ao consultar seus pedidos.');
    const orders = (data || []).map(mapCustomerOrderRow);
    // Linha do tempo do cliente: só status + horário do histórico (RLS order_status_history_customer_select).
    // Nunca note/changed_by. Falha aqui não derruba a lista: a linha do tempo cai para orders.status.
    const ids = orders.map(o => o.id).filter(isValidUuid).slice(0, 100);
    if (ids.length > 0) {
      try {
        const { data: hist, error: hErr } = await supabase
          .from('order_status_history')
          .select('order_id, status, created_at')
          .in('order_id', ids)
          .order('created_at', { ascending: true });
        if (!hErr && Array.isArray(hist)) return attachCustomerHistory(orders, hist);
        if (hErr) console.warn('[orderRepository] histórico do cliente indisponível:', hErr.message);
      } catch (e) {
        console.warn('[orderRepository] histórico do cliente indisponível:', e);
      }
    }
    return orders;
  },

  async assignDriver(_context: SecurityContext, _tenantId: string, orderId: string, driverUserId: string): Promise<void> {
    requireBackend('entregadores');
    const { error } = await supabase.rpc('assign_order_to_driver', { p_order_id: orderId, p_driver_user_id: driverUserId });
    if (error) throw toBackendError(error, 'Falha ao atribuir o entregador.');
  },

  async unassignDriver(_context: SecurityContext, _tenantId: string, orderId: string): Promise<void> {
    requireBackend('entregadores');
    const { error } = await supabase.rpc('unassign_order_driver', { p_order_id: orderId });
    if (error) throw toBackendError(error, 'Falha ao remover o entregador.');
  },

  /**
   * 19/10: pedidos novos (PENDING) por loja, para o seletor de loja do painel. Uma consulta só;
   * a RLS de equipe garante que só voltam lojas em que o usuário é staff (as outras ficam 0).
   */
  async countPendingByTenant(tenantIds: string[]): Promise<Record<string, number>> {
    const ids = Array.from(new Set(tenantIds.filter(isValidUuid))).slice(0, 50);
    if (!isSupabaseConfigured || ids.length === 0) return countPendingRows([], ids);
    const { data, error } = await supabase
      .from('orders')
      .select('tenant_id')
      .in('tenant_id', ids)
      .eq('status', 'PENDING')
      .limit(2000);
    if (error) throw toBackendError(error, 'Falha ao contar pedidos novos.');
    return countPendingRows((data || []) as { tenant_id: string }[], ids);
  },

  /**
   * 19/10: realtime do CLIENTE (aba Pedidos). Assina UPDATE/INSERT de public.orders da loja; o Supabase
   * Realtime aplica a RLS (orders_customer_select), então o cliente só recebe eventos dos próprios pedidos.
   * O payload não é usado: o evento só antecipa o recarregamento (o polling de 8 s continua como reserva).
   */
  subscribeToCustomerOrders(tenantId: string, onUpdate: () => void, onStatus?: (status: string) => void): () => void {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) return () => {};
    try {
      const channel = supabase
        .channel(`customer-orders-${tenantId}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => onUpdate())
        .subscribe(status => onStatus?.(String(status)));
      return () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.warn('[orderRepository] realtime do cliente indisponível (segue o polling):', err);
      return () => {};
    }
  },

  /** Realtime oficial do Supabase. Em modo demo local (DEV), assina o dataStore. */
  subscribeToOrders(tenantId: string, onUpdate: () => void): () => void {
    if (!isSupabaseConfigured) {
      if (isLocalDemoAllowed) return dataStore.subscribe(onUpdate);
      return () => {};
    }
    if (!isValidUuid(tenantId)) return () => {};
    try {
      const channel = supabase
        .channel(`tenant-orders-${tenantId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => onUpdate())
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.error('[orderRepository] Falha ao conectar ao Supabase Realtime:', err);
      return () => {};
    }
  },
};

/**
 * legacy-020: caminho atual do 001–020 (UPDATE sob RLS de staff). Mantido sem mudança de segurança;
 * o estorno de estoque continua no navegador porque o 001–020 não tem RPC de cancelamento.
 * No N1–N6 este caminho é bloqueado pelo banco (UPDATE revogado) e substituído por update_order_status.
 */
async function legacyUpdateStatus(
  context: SecurityContext,
  tenantId: string,
  orderId: string,
  newStatus: OrderStatus,
  note: string | null
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', orderId)
    .select('id')
    .single();
  if (error) throw toBackendError(error, 'Falha ao atualizar status do pedido no servidor.');

  const { error: historyError } = await supabase.from('order_status_history').insert({
    order_id: orderId,
    status: newStatus,
    note: note || `Status alterado para ${newStatus}`,
    changed_by: context.userName || 'Lojista',
  });
  if (historyError) console.warn('[orderRepository] Aviso ao gravar histórico de status:', historyError.message);

  if (newStatus === 'CANCELLED') {
    const { data: items } = await supabase.from('order_items').select('product_id, product_name, quantity').eq('order_id', orderId);
    for (const item of items || []) {
      if (!item.product_id) continue;
      const { data: prod } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).eq('tenant_id', tenantId).single();
      if (!prod) continue;
      const prevStock = Number(prod.stock_quantity ?? 0);
      const newStock = prevStock + Number(item.quantity);
      await supabase.from('products').update({ stock_quantity: newStock }).eq('id', item.product_id).eq('tenant_id', tenantId);
      await supabase.from('inventory_movements').insert({
        tenant_id: tenantId,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: Number(item.quantity),
        type: 'ESTORNO',
        reference_id: orderId,
        reason: `Estorno por cancelamento do pedido ${orderId}`,
        previous_stock: prevStock,
        new_stock: newStock,
        created_by_name: context.userName || 'Sistema',
      });
    }
  }
}

/*
 * legacy-020: NÃO há caminho de servidor para venda de balcão no 001–020 — a tabela orders não tem
 * política RLS de INSERT para staff (comprovado na integração local), e o INSERT direto do navegador
 * só "funcionava" porque o fallback do dataStore mascarava a falha. Por isso o PDV exige n1n6
 * (process_pos_sale_atomic). Ver docs/n1-n6/ATIVACAO_FRONTEND.md.
 */
