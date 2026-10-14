/**
 * Leitura do desempenho dos cards promocionais (Marketing → Desempenho & Vendas).
 * - Produção/staging: RPC get_promo_offer_performance (N5), agregada no servidor, só OWNER/MANAGER
 *   da loja (validação no banco). Nada é recalculado a partir de pedidos no navegador.
 * - Se a RPC ainda não existe (N1–N6 não ativado), devolve 'unavailable' para a UI mostrar o estado
 *   vazio explicativo — nunca números locais.
 * - Sem Supabase configurado (modo local de desenvolvimento): pedidos do armazenamento local, marcados como demo.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isValidUuid } from '../lib/uuid';
import { orderRepository } from './orderRepository';
import type { SecurityContext } from '../services/securityEngine';
import { friendlyPerformanceError, isMissingFunctionError, parseServerPerformance, type PeriodRange, type PromoOrder, type ServerOfferPerformanceRow } from '../utils/promoPerformance';

export type PromoPerformanceResult =
  | { kind: 'server'; current: ServerOfferPerformanceRow[]; previous: ServerOfferPerformanceRow[] }
  | { kind: 'unavailable' }
  | { kind: 'demo'; orders: PromoOrder[] };

export const promoPerformanceRepository = {
  async getPerformance(context: SecurityContext, tenantId: string, current: PeriodRange, previous: PeriodRange): Promise<PromoPerformanceResult> {
    if (!isSupabaseConfigured) {
      const local = await orderRepository.getOrders(context, tenantId);
      return {
        kind: 'demo',
        orders: local.map(o => ({
          id: o.id, tenantId: o.tenantId, status: o.status, paymentStatus: o.paymentStatus,
          totalAmount: o.totalAmount, deliveryFee: o.deliveryFee, createdAt: o.createdAt,
          origin: o.origin, offerId: o.offerId, redeemedUnits: o.offerId ? o.items.reduce((s, i) => s + i.quantity, 0) : 0,
          promoDiscount: o.discount || 0,
        })),
      };
    }
    if (!isValidUuid(tenantId)) throw new Error('Estabelecimento inválido.');
    const call = (r: PeriodRange) => supabase.rpc('get_promo_offer_performance', {
      p_tenant_id: tenantId, p_from: r.start.toISOString(), p_to: r.end.toISOString(),
    });
    const [cur, prev] = await Promise.all([call(current), call(previous)]);
    const err = cur.error || prev.error;
    if (err) {
      if (isMissingFunctionError(err)) return { kind: 'unavailable' };
      throw new Error(friendlyPerformanceError(err));
    }
    return { kind: 'server', current: parseServerPerformance(cur.data), previous: parseServerPerformance(prev.data) };
  },
};
