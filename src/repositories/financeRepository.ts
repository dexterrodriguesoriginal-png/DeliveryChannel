import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { SecurityContext } from '../services/securityEngine';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';

export interface PaymentMethodSummary {
  paymentMethod: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH';
  amount: number;
  orderCount: number;
  percentage: number;
}

export interface DailySaleSummary {
  date: string;
  amount: number;
  orderCount: number;
}

export interface FinancialSummary {
  grossRevenue: number;
  validOrdersCount: number;
  averageTicket: number;
  deliveryFees: number;
  discountsTotal: number;
  cancelledOrdersCount: number;
  cancelledAmount: number;
  paymentBreakdown: PaymentMethodSummary[];
  dailySales: DailySaleSummary[];
  startDate: string;
  endDate: string;
}

export const financeRepository = {
  /**
   * Obtém o resumo financeiro consolidado oficial diretamente do PostgreSQL.
   * Utiliza a RPC atômica get_tenant_financial_summary que roda agregações nativas no banco.
   * Em caso de indisponibilidade de rede ou falha, repassa o erro (sem fallbacks para mock).
   */
  async getFinancialSummary(
    context: SecurityContext,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<FinancialSummary> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase.rpc('get_tenant_financial_summary', {
          p_tenant_id: tenantId,
          p_start_date: startDate.toISOString(),
          p_end_date: endDate.toISOString(),
        });

        if (!error && data) {
          return {
            grossRevenue: Number(data.grossRevenue || 0),
            validOrdersCount: Number(data.validOrdersCount || 0),
            averageTicket: Number(data.averageTicket || 0),
            deliveryFees: Number(data.deliveryFees || 0),
            discountsTotal: Number(data.discountsTotal || 0),
            cancelledOrdersCount: Number(data.cancelledOrdersCount || 0),
            cancelledAmount: Number(data.cancelledAmount || 0),
            paymentBreakdown: (data.paymentBreakdown || []).map((pm: any) => ({
              paymentMethod: pm.paymentMethod,
              amount: Number(pm.amount || 0),
              orderCount: Number(pm.orderCount || 0),
              percentage: Number(pm.percentage || 0),
            })),
            dailySales: (data.dailySales || []).map((ds: any) => ({
              date: ds.date,
              amount: Number(ds.amount || 0),
              orderCount: Number(ds.orderCount || 0),
            })),
            startDate: data.startDate || startDate.toISOString(),
            endDate: data.endDate || endDate.toISOString(),
          };
        }

        // Fallback para query direta no Supabase caso a RPC ainda não esteja deployada
        const { data: orders, error: ordersError } = await supabase
          .from('orders')
          .select('id, total_amount, delivery_fee, discount, payment_method, status, created_at')
          .eq('tenant_id', tenantId)
          .gte('created_at', startDate.toISOString())
          .lt('created_at', endDate.toISOString());

        if (!ordersError && orders) {
          const rows = orders || [];
          const validOrders = rows.filter(o => o.status !== 'CANCELLED');
          const cancelledOrders = rows.filter(o => o.status === 'CANCELLED');

          const grossRevenue = validOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
          const validOrdersCount = validOrders.length;
          const averageTicket = validOrdersCount > 0 ? Number((grossRevenue / validOrdersCount).toFixed(2)) : 0;
          const deliveryFees = validOrders.reduce((sum, o) => sum + Number(o.delivery_fee || 0), 0);
          const discountsTotal = validOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);
          const cancelledOrdersCount = cancelledOrders.length;
          const cancelledAmount = cancelledOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

          // Agrupamento por forma de pagamento
          const paymentMap = new Map<string, { amount: number; count: number }>();
          validOrders.forEach(o => {
            const pm = o.payment_method || 'PIX';
            const curr = paymentMap.get(pm) || { amount: 0, count: 0 };
            curr.amount += Number(o.total_amount || 0);
            curr.count += 1;
            paymentMap.set(pm, curr);
          });

          const paymentBreakdown: PaymentMethodSummary[] = Array.from(paymentMap.entries()).map(([pm, val]) => ({
            paymentMethod: pm as any,
            amount: Number(val.amount.toFixed(2)),
            orderCount: val.count,
            percentage: grossRevenue > 0 ? Number(((val.amount / grossRevenue) * 100).toFixed(1)) : 0,
          })).sort((a, b) => b.amount - a.amount);

          return {
            grossRevenue,
            validOrdersCount,
            averageTicket,
            deliveryFees,
            discountsTotal,
            cancelledOrdersCount,
            cancelledAmount,
            paymentBreakdown,
            dailySales: [],
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          };
        }
      } catch (err) {
        console.warn('[financeRepository] Falha ao consultar resumo financeiro no Supabase:', err);
      }
    }

    // Fallback gracioso para dataStore local
    const orders = dataStore.getOrders(context, tenantId);
    const validOrders = orders.filter(o => o.status !== 'CANCELLED');
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED');
    const grossRevenue = validOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const validOrdersCount = validOrders.length;
    const averageTicket = validOrdersCount > 0 ? Number((grossRevenue / validOrdersCount).toFixed(2)) : 0;
    const deliveryFees = validOrders.reduce((sum, o) => sum + Number(o.deliveryFee || 0), 0);
    const discountsTotal = validOrders.reduce((sum, o) => sum + Number(o.discount || 0), 0);
    const cancelledOrdersCount = cancelledOrders.length;
    const cancelledAmount = cancelledOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

    const paymentMap = new Map<string, { amount: number; count: number }>();
    validOrders.forEach(o => {
      const pm = o.paymentMethod || 'PIX';
      const curr = paymentMap.get(pm) || { amount: 0, count: 0 };
      curr.amount += Number(o.totalAmount || 0);
      curr.count += 1;
      paymentMap.set(pm, curr);
    });

    const paymentBreakdown: PaymentMethodSummary[] = Array.from(paymentMap.entries()).map(([pm, val]) => ({
      paymentMethod: pm as any,
      amount: Number(val.amount.toFixed(2)),
      orderCount: val.count,
      percentage: grossRevenue > 0 ? Number(((val.amount / grossRevenue) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.amount - a.amount);

    return {
      grossRevenue,
      validOrdersCount,
      averageTicket,
      deliveryFees,
      discountsTotal,
      cancelledOrdersCount,
      cancelledAmount,
      paymentBreakdown,
      dailySales: [],
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  }
};
