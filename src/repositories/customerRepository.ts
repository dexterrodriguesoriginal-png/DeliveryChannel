import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Customer, CustomerOrigin } from '../types';
import { SecurityContext } from '../services/securityEngine';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';

export type CustomerLifecycleStatus = 'NOVO' | 'RECORRENTE' | 'INATIVO';

export interface CustomerSummaryItem {
  id: string;
  tenantId: string;
  userId?: string;
  name: string;
  phone: string;
  email?: string;
  origin: CustomerOrigin;
  totalOrders: number;
  ltvAmount: number;
  averageTicket: number;
  firstOrderDate?: string;
  lastOrderDate?: string;
  hasLgpdConsent: boolean;
  status: CustomerLifecycleStatus;
  createdAt?: string;
}

export interface CustomersListResponse {
  totalCount: number;
  customers: CustomerSummaryItem[];
  limit: number;
  offset: number;
}

export interface CustomerOrderHistoryItem {
  id: string;
  orderNumber: number;
  createdAt: string;
  status: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: string;
  fulfillmentType: string;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string;
  origin: CustomerOrigin;
  consentLgpd: boolean;
}

function mapRowToCustomer(row: any): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id || undefined,
    name: row.name,
    phone: row.phone,
    email: row.email || undefined,
    origin: row.origin || 'direto',
    totalOrders: Number(row.total_orders ?? 0),
    ltvAmount: Number(row.ltv_amount ?? 0),
    firstOrderDate: row.first_order_date || new Date().toISOString().split('T')[0],
    lastOrderDate: row.last_order_date || new Date().toISOString().split('T')[0],
    consentLgpd: false,
    isDemo: false,
  };
}

export const customerRepository = {
  /**
   * Obtém os dados do cliente associado ao auth.uid() autenticado no tenant
   */
  async getCustomerByUserId(tenantId: string, userId: string): Promise<Customer | null> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId) || !isValidUuid(userId)) return null;
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        return mapRowToCustomer(data);
      }
    } catch (err) {
      console.warn('[customerRepository] Erro ao buscar cliente por user_id:', err);
    }
    return null;
  },

  /**
   * Lista simples de clientes para compatibilidade com Dashboard e telas legadas
   */
  async getCustomers(context: SecurityContext, tenantId: string): Promise<Customer[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('customers')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('name');

        if (error) {
          console.warn('[customerRepository] Erro ao listar clientes do Supabase:', error.message);
          return dataStore.getCustomers(context, tenantId);
        }

        return (data || []).map(mapRowToCustomer);
      } catch (err) {
        console.warn('[customerRepository] Falha ao consultar clientes no Supabase:', err);
        return dataStore.getCustomers(context, tenantId);
      }
    }
    return dataStore.getCustomers(context, tenantId);
  },

  /**
   * Lista avançada e segura para o CRM com métricas oficiais baseadas em pedidos válidos
   */
  async getCustomersSummary(
    context: SecurityContext,
    tenantId: string,
    params: {
      searchTerm?: string;
      origin?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<CustomersListResponse> {
    const { searchTerm, origin, limit = 20, offset = 0 } = params;

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        // 1. Tenta a RPC oficial de relatórios de clientes
        const { data, error } = await supabase.rpc('get_tenant_customers_summary', {
          p_tenant_id: tenantId,
          p_search_term: searchTerm || null,
          p_origin: origin === 'ALL' ? null : (origin || null),
          p_limit: limit,
          p_offset: offset,
        });

        if (!error && data) {
          return {
            totalCount: Number(data.totalCount || 0),
            customers: (data.customers || []).map((c: any) => ({
              id: c.id,
              tenantId: c.tenantId,
              userId: c.userId || undefined,
              name: c.name,
              phone: c.phone,
              email: c.email || undefined,
              origin: c.origin || 'direto',
              totalOrders: Number(c.totalOrders || 0),
              ltvAmount: Number(c.ltvAmount || 0),
              averageTicket: Number(c.averageTicket || 0),
              firstOrderDate: c.firstOrderDate || undefined,
              lastOrderDate: c.lastOrderDate || undefined,
              hasLgpdConsent: Boolean(c.hasLgpdConsent),
              status: c.status as CustomerLifecycleStatus,
              createdAt: c.createdAt,
            })),
            limit: Number(data.limit || limit),
            offset: Number(data.offset || offset),
          };
        }
      } catch (rpcErr) {
        console.warn('[customerRepository] RPC get_tenant_customers_summary falhou:', rpcErr);
      }
    }

    // Fallback gracioso para dataStore quando não for UUID ou quando Supabase falhar
    const rawCustomers = dataStore.getCustomers(context, tenantId);
    let filtered = rawCustomers;
    if (searchTerm && searchTerm.trim()) {
      const st = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(st) || 
        c.phone.toLowerCase().includes(st) || 
        (c.email && c.email.toLowerCase().includes(st))
      );
    }
    if (origin && origin !== 'ALL') {
      filtered = filtered.filter(c => c.origin === origin);
    }

    const paged = filtered.slice(offset, offset + limit);
    return {
      totalCount: filtered.length,
      customers: paged.map(c => ({
        id: c.id,
        tenantId: c.tenantId,
        userId: c.userId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        origin: c.origin,
        totalOrders: c.totalOrders,
        ltvAmount: c.ltvAmount,
        averageTicket: c.totalOrders > 0 ? Number((c.ltvAmount / c.totalOrders).toFixed(2)) : 0,
        firstOrderDate: c.firstOrderDate,
        lastOrderDate: c.lastOrderDate,
        hasLgpdConsent: c.consentLgpd,
        status: (c.totalOrders > 3 ? 'RECORRENTE' : 'NOVO') as CustomerLifecycleStatus,
        createdAt: c.firstOrderDate,
      })),
      limit,
      offset,
    };
  },

  /**
   * Consulta o histórico de compras de um cliente específico no tenant
   */
  async getCustomerOrderHistory(
    context: SecurityContext,
    tenantId: string,
    customerId: string
  ): Promise<CustomerOrderHistoryItem[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(customerId)) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_customer_orders_history', {
          p_tenant_id: tenantId,
          p_customer_id: customerId,
        });

        if (!rpcError && rpcData) {
          return (rpcData as any[]).map(row => ({
            id: row.id,
            orderNumber: Number(row.orderNumber),
            createdAt: row.createdAt,
            status: row.status,
            subtotal: Number(row.subtotal || 0),
            discount: Number(row.discount || 0),
            deliveryFee: Number(row.deliveryFee || 0),
            totalAmount: Number(row.totalAmount || 0),
            paymentMethod: row.paymentMethod,
            fulfillmentType: row.fulfillmentType,
          }));
        }

        // Contingência direta via select
        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, created_at, status, subtotal, discount, delivery_fee, total_amount, payment_method, fulfillment_type')
          .eq('tenant_id', tenantId)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(row => ({
            id: row.id,
            orderNumber: Number(row.order_number),
            createdAt: row.created_at,
            status: row.status,
            subtotal: Number(row.subtotal || 0),
            discount: Number(row.discount || 0),
            deliveryFee: Number(row.delivery_fee || 0),
            totalAmount: Number(row.total_amount || 0),
            paymentMethod: row.payment_method,
            fulfillmentType: row.fulfillment_type,
          }));
        }
      } catch (err) {
        console.warn('[customerRepository] Falha ao consultar histórico de pedidos:', err);
      }
    }

    const localOrders = dataStore.getOrders(context, tenantId).filter(o => o.customerId === customerId);
    return localOrders.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      deliveryFee: o.deliveryFee,
      totalAmount: o.totalAmount,
      paymentMethod: o.paymentMethod,
      fulfillmentType: o.fulfillmentType,
    }));
  },

  /**
   * Cadastro manual de um novo cliente pelo lojista
   */
  async createCustomerManual(
    context: SecurityContext,
    tenantId: string,
    input: CreateCustomerInput
  ): Promise<void> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase não configurado.');
    }

    const { error: rpcError } = await supabase.rpc('create_tenant_customer_manual', {
      p_tenant_id: tenantId,
      p_name: input.name,
      p_phone: input.phone,
      p_email: input.email || null,
      p_origin: input.origin,
      p_consent_lgpd: input.consentLgpd,
    });

    if (rpcError) {
      if (rpcError.message.includes('Já existe um cliente cadastrado com este telefone') || rpcError.message.includes('unique')) {
        throw new Error('Já existe um cliente com este telefone cadastrado neste estabelecimento.');
      }
      throw new Error(`Falha ao cadastrar cliente: ${rpcError.message}`);
    }
  },

  /**
   * Inscrição em tempo real para alterações de clientes ou pedidos
   */
  subscribeToCustomers(tenantId: string, callback: () => void): () => void {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) {
      return dataStore.subscribe(callback);
    }

    const channelName = `crm_customers_realtime_${tenantId}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers', filter: `tenant_id=eq.${tenantId}` },
        () => callback()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        () => callback()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
};
