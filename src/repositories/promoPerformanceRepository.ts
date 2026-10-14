/**
 * Leitura somente-leitura dos pedidos usados em Marketing → Desempenho & Vendas.
 * - Filtro explícito por tenant_id + RLS de orders/order_items (staff da loja).
 * - Sem fallback silencioso: erro do Supabase é propagado para a UI.
 * - Sem Supabase configurado (modo local), usa o armazenamento local e marca isDemo.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isValidUuid } from '../lib/uuid';
import { orderRepository } from './orderRepository';
import type { SecurityContext } from '../services/securityEngine';
import { mapPromoOrderRow, type PeriodRange, type PromoOrder } from '../utils/promoPerformance';

export { mapPromoOrderRow };

export const PROMO_ORDERS_LIMIT = 5000;

export interface PromoOrdersResult {
  orders: PromoOrder[];
  isDemo: boolean;
  /** false: a base não tem orders.offer_id (026/027 não aplicadas). null: indeterminado (sem pedidos). */
  hasAttributionColumn: boolean | null;
  /** true quando alguma janela atingiu o limite de linhas (números podem estar incompletos). */
  truncated: boolean;
}

type Row = Record<string, unknown>;

export const promoPerformanceRepository = {
  /** Busca pedidos da loja nas janelas informadas (uma consulta por janela; o cálculo deduplica por id). */
  async getOrders(context: SecurityContext, tenantId: string, windows: PeriodRange[]): Promise<PromoOrdersResult> {
    if (!isSupabaseConfigured) {
      const local = await orderRepository.getOrders(context, tenantId);
      return {
        orders: local.map(o => ({
          id: o.id, tenantId: o.tenantId, status: o.status, paymentStatus: o.paymentStatus,
          totalAmount: o.totalAmount, deliveryFee: o.deliveryFee, createdAt: o.createdAt,
          origin: o.origin, offerId: o.offerId, redemptionNumber: null, promoDiscount: o.discount || 0,
        })),
        isDemo: true, hasAttributionColumn: null, truncated: false,
      };
    }
    if (!isValidUuid(tenantId)) throw new Error('Estabelecimento inválido.');
    const results = await Promise.all(windows.map(w => supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('tenant_id', tenantId)
      .gte('created_at', w.start.toISOString())
      .lt('created_at', w.end.toISOString())
      .order('created_at', { ascending: false })
      .limit(PROMO_ORDERS_LIMIT)));
    const err = results.find(r => r.error)?.error;
    if (err) throw new Error(err.message || 'Falha ao carregar pedidos.');
    const rows = results.flatMap(r => (r.data || []) as Row[]);
    return {
      orders: rows.filter(r => r.tenant_id === tenantId).map(mapPromoOrderRow),
      isDemo: false,
      hasAttributionColumn: rows.length === 0 ? null : Object.prototype.hasOwnProperty.call(rows[0], 'offer_id'),
      truncated: results.some(r => (r.data?.length || 0) >= PROMO_ORDERS_LIMIT),
    };
  },
};
