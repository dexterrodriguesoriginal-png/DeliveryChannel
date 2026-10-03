import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { SecurityContext } from '../services/securityEngine';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';

export interface TopProductSummary {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface CategorySalesSummary {
  categoryId: string;
  categoryName: string;
  quantitySold: number;
  revenue: number;
  percentage: number;
}

export interface DailyReportSale {
  date: string;
  orderCount: number;
  revenue: number;
}

export interface ReportsSummary {
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  activeCustomers: number;
  dailySales: DailyReportSale[];
  topProducts: TopProductSummary[];
  salesByCategory: CategorySalesSummary[];
  startDate: string;
  endDate: string;
}

export interface ExportOrderRow {
  orderNumber: number;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  totalAmount: number;
  status: string;
  paymentMethod: string;
}

export const reportsRepository = {
  /**
   * Obtém o resumo de relatórios do estabelecimento.
   * Utiliza a RPC atômica get_tenant_reports_summary no PostgreSQL.
   * Em caso de indisponibilidade da RPC, agrega diretamente via queries otimizadas no Supabase.
   */
  async getReportsSummary(
    context: SecurityContext,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ReportsSummary> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase.rpc('get_tenant_reports_summary', {
          p_tenant_id: tenantId,
          p_start_date: startDate.toISOString(),
          p_end_date: endDate.toISOString(),
        });

        if (!error && data) {
          return {
            totalOrders: Number(data.totalOrders || 0),
            totalRevenue: Number(data.totalRevenue || 0),
            averageTicket: Number(data.averageTicket || 0),
            activeCustomers: Number(data.activeCustomers || 0),
            dailySales: (data.dailySales || []).map((ds: any) => ({
              date: ds.date,
              orderCount: Number(ds.orderCount || 0),
              revenue: Number(ds.revenue || 0),
            })),
            topProducts: (data.topProducts || []).map((tp: any) => ({
              productId: tp.productId,
              productName: tp.productName || 'Produto',
              quantitySold: Number(tp.quantitySold || 0),
              revenue: Number(tp.revenue || 0),
            })),
            salesByCategory: (data.salesByCategory || []).map((sc: any) => ({
              categoryId: sc.categoryId,
              categoryName: sc.categoryName || 'Geral',
              quantitySold: Number(sc.quantitySold || 0),
              revenue: Number(sc.revenue || 0),
              percentage: Number(sc.percentage || 0),
            })),
            startDate: data.startDate || startDate.toISOString(),
            endDate: data.endDate || endDate.toISOString(),
          };
        }

        // Consulta de contingência direta no Supabase
        const { data: orders, error: ordersError } = await supabase
          .from('orders')
          .select('id, total_amount, status, created_at, customer_id, order_items(product_id, product_name, quantity, total_price)')
          .eq('tenant_id', tenantId)
          .gte('created_at', startDate.toISOString())
          .lt('created_at', endDate.toISOString());

        if (!ordersError && orders) {
          const validOrders = (orders || []).filter(o => o.status !== 'CANCELLED');
          const totalOrders = validOrders.length;
          const totalRevenue = validOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
          const averageTicket = totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
          
          const distinctCustomers = new Set<string>();
          validOrders.forEach(o => {
            if (o.customer_id) distinctCustomers.add(o.customer_id);
          });
          const activeCustomers = distinctCustomers.size;

          // Agrupamento de Top Produtos
          const prodMap = new Map<string, { name: string; qty: number; revenue: number }>();
          validOrders.forEach((o: any) => {
            (o.order_items || []).forEach((item: any) => {
              const current = prodMap.get(item.product_id) || { name: item.product_name, qty: 0, revenue: 0 };
              current.qty += Number(item.quantity || 0);
              current.revenue += Number(item.total_price || 0);
              prodMap.set(item.product_id, current);
            });
          });

          const topProducts: TopProductSummary[] = Array.from(prodMap.entries())
            .map(([id, val]) => ({
              productId: id,
              productName: val.name,
              quantitySold: val.qty,
              revenue: Number(val.revenue.toFixed(2)),
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

          // Agrupamento de Vendas Diárias
          const dayMap = new Map<string, { count: number; revenue: number }>();
          validOrders.forEach(o => {
            const day = o.created_at.split('T')[0];
            const current = dayMap.get(day) || { count: 0, revenue: 0 };
            current.count += 1;
            current.revenue += Number(o.total_amount || 0);
            dayMap.set(day, current);
          });

          const dailySales: DailyReportSale[] = Array.from(dayMap.entries())
            .map(([date, val]) => ({
              date,
              orderCount: val.count,
              revenue: Number(val.revenue.toFixed(2)),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

          return {
            totalOrders,
            totalRevenue,
            averageTicket,
            activeCustomers,
            dailySales,
            topProducts,
            salesByCategory: [],
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          };
        }
      } catch (err) {
        console.warn('[reportsRepository] Falha ao consultar relatórios no Supabase:', err);
      }
    }

    // Fallback gracioso para dataStore
    const orders = dataStore.getOrders(context, tenantId);
    const validOrders = orders.filter(o => o.status !== 'CANCELLED');
    const totalOrders = validOrders.length;
    const totalRevenue = validOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const averageTicket = totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
    const distinctCustomers = new Set<string>();
    validOrders.forEach(o => {
      if (o.customerId) distinctCustomers.add(o.customerId);
    });

    const prodMap = new Map<string, { name: string; qty: number; revenue: number }>();
    validOrders.forEach(o => {
      (o.items || []).forEach(item => {
        const current = prodMap.get(item.productId) || { name: item.productName, qty: 0, revenue: 0 };
        current.qty += Number(item.quantity || 0);
        current.revenue += Number(item.totalPrice || 0);
        prodMap.set(item.productId, current);
      });
    });

    const topProducts: TopProductSummary[] = Array.from(prodMap.entries())
      .map(([id, val]) => ({
        productId: id,
        productName: val.name,
        quantitySold: val.qty,
        revenue: Number(val.revenue.toFixed(2)),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      totalOrders,
      totalRevenue,
      averageTicket,
      activeCustomers: distinctCustomers.size,
      dailySales: [],
      topProducts,
      salesByCategory: [],
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  },

  /**
   * Consulta os dados reais e estruturados para gerar o arquivo CSV.
   * Não baixa campos desnecessários (como históricos de status) e filtra cancelados.
   */
  async getOrdersForExport(
    context: SecurityContext,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ExportOrderRow[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('order_number, created_at, customer_name, customer_phone, subtotal, discount, delivery_fee, total_amount, status, payment_method')
          .eq('tenant_id', tenantId)
          .neq('status', 'CANCELLED')
          .gte('created_at', startDate.toISOString())
          .lt('created_at', endDate.toISOString())
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((row: any) => ({
            orderNumber: row.order_number,
            createdAt: row.created_at,
            customerName: row.customer_name || 'Cliente',
            customerPhone: row.customer_phone || '-',
            subtotal: Number(row.subtotal || 0),
            discount: Number(row.discount || 0),
            deliveryFee: Number(row.delivery_fee || 0),
            totalAmount: Number(row.total_amount || 0),
            status: row.status,
            paymentMethod: row.payment_method,
          }));
        }
      } catch (err) {
        console.warn('[reportsRepository] Falha ao exportar pedidos no Supabase:', err);
      }
    }

    const orders = dataStore.getOrders(context, tenantId);
    return orders
      .filter(o => o.status !== 'CANCELLED')
      .map(o => ({
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        customerName: o.customerName || 'Cliente',
        customerPhone: o.customerPhone || '-',
        subtotal: o.subtotal,
        discount: o.discount,
        deliveryFee: o.deliveryFee,
        totalAmount: o.totalAmount,
        status: o.status,
        paymentMethod: o.paymentMethod,
      }));
  }
};
