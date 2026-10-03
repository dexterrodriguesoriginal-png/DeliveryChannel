import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Order, OrderStatus } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';

function mapRowToOrder(row: any, items: any[] = [], history: any[] = []): Order {
  return {
    id: row.id,
    orderNumber: row.order_number,
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
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      totalPrice: Number(item.total_price),
      notes: item.notes || undefined,
      unit: item.unit || 'un',
    })),
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    discount: Number(row.discount ?? 0),
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    fulfillmentType: row.fulfillment_type || 'DELIVERY',
    notes: row.notes || undefined,
    prepTimeMinutes: row.prep_time_minutes !== undefined && row.prep_time_minutes !== null ? Number(row.prep_time_minutes) : 30,
    status: row.status as OrderStatus,
    statusHistory: history.map(h => ({
      status: h.status,
      timestamp: h.created_at,
      note: h.note || undefined,
      changedBy: h.changed_by || 'Sistema',
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    origin: row.origin || 'direct',
    isDemo: false,
  };
}

export const orderRepository = {
  async getOrders(context: SecurityContext, tenantId: string): Promise<Order[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data: orderRows, error } = await supabase
          .from('orders')
          .select('*, order_items(*), order_status_history(*)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('[orderRepository] Erro ao carregar pedidos do Supabase:', error.message);
          return dataStore.getOrders(context, tenantId);
        }

        return (orderRows || []).map(row => 
          mapRowToOrder(row, row.order_items || [], row.order_status_history || [])
        );
      } catch (err) {
        console.warn('[orderRepository] Falha ao consultar pedidos no Supabase:', err);
        return dataStore.getOrders(context, tenantId);
      }
    }
    return dataStore.getOrders(context, tenantId);
  },

  async getById(context: SecurityContext, tenantId: string, orderId: string): Promise<Order | undefined> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(orderId)) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*, order_items(*), order_status_history(*)')
          .eq('tenant_id', tenantId)
          .eq('id', orderId)
          .maybeSingle();

        if (error) {
          console.warn('[orderRepository] Erro ao buscar pedido por ID no Supabase:', error.message);
          return dataStore.getOrderById(context, tenantId, orderId);
        }

        if (data) {
          return mapRowToOrder(data, data.order_items || [], data.order_status_history || []);
        }
        return undefined;
      } catch (err) {
        console.warn('[orderRepository] Falha ao buscar pedido no Supabase:', err);
        return dataStore.getOrderById(context, tenantId, orderId);
      }
    }
    return dataStore.getOrderById(context, tenantId, orderId);
  },

  async updateStatus(
    context: SecurityContext,
    tenantId: string,
    orderId: string,
    newStatus: OrderStatus,
    note?: string
  ): Promise<Order> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(orderId)) {
      if (context.userRole === 'DRIVER') {
        const { error: driverRpcError } = await supabase.rpc('update_driver_order_status', {
          p_order_id: orderId,
          p_status: newStatus,
          p_note: note || null,
        });

        if (driverRpcError) {
          console.error('[orderRepository] update_driver_order_status falhou:', driverRpcError.message);
          throw new Error(driverRpcError.message);
        }

        const updated = await this.getById(context, tenantId, orderId);
        if (updated) return updated;
        throw new Error('Pedido atualizado não encontrado após execução do RPC.');
      }

      const now = new Date().toISOString();
      const { data: updated, error } = await supabase
        .from('orders')
        .update({ status: newStatus, updated_at: now })
        .eq('tenant_id', tenantId)
        .eq('id', orderId)
        .select()
        .single();

      if (error) {
        console.error('[orderRepository] Erro ao atualizar status no Supabase:', error.message);
        throw new Error(error.message || 'Falha ao atualizar status do pedido no servidor.');
      }

      // Grava histórico de status
      const { error: historyError } = await supabase
        .from('order_status_history')
        .insert({
          order_id: orderId,
          status: newStatus,
          note: note || `Status alterado para ${newStatus}`,
          changed_by: context.userName || 'Lojista',
        });

      if (historyError) {
        console.warn('[orderRepository] Aviso ao gravar histórico de status:', historyError.message);
      }

      // Se cancelado, estorna estoque no banco
      if (newStatus === 'CANCELLED') {
        const { data: items } = await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', orderId);

        if (items) {
          for (const item of items) {
            const { data: prod } = await supabase
              .from('products')
              .select('stock_quantity')
              .eq('id', item.product_id)
              .single();

            if (prod) {
              const prevStock = Number(prod.stock_quantity ?? 0);
              const newStock = prevStock + Number(item.quantity);
              await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', item.product_id);

              await supabase
                .from('inventory_movements')
                .insert({
                  tenant_id: tenantId,
                  product_id: item.product_id,
                  product_name: item.product_name,
                  quantity: Number(item.quantity),
                  type: 'ESTORNO',
                  reference_id: orderId,
                  reason: `Estorno por cancelamento do Pedido #${orderId}`,
                  previous_stock: prevStock,
                  new_stock: newStock,
                  created_by_name: context.userName || 'Sistema',
                });
            }
          }
        }
      }

      const finalOrder = await this.getById(context, tenantId, orderId);
      if (finalOrder) return finalOrder;

      return mapRowToOrder(updated, [], []);
    }

    return dataStore.updateOrderStatus(context, tenantId, orderId, newStatus, note);
  },

  /**
   * Criação direta de venda no balcão (PDV / Caixa)
   */
  async createDirectOrder(
    context: SecurityContext,
    tenantId: string,
    orderData: {
      customerName: string;
      customerPhone: string;
      items: Array<{ productId: string; quantity: number }>;
      paymentMethod: Order['paymentMethod'];
      notes?: string;
    }
  ): Promise<Order> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      // 1. Busca os dados dos produtos para somar valores e calcular estoque
      const productIds = orderData.items.map(i => i.productId);
      const { data: prods, error: pError } = await supabase
        .from('products')
        .select('*')
        .in('id', productIds);

      if (pError || !prods) {
        throw new Error('Falha ao obter produtos para o fechamento do caixa.');
      }

      const prodMap = new Map(prods.map(p => [p.id, p]));
      let subtotal = 0;
      const orderItemsToInsert: any[] = [];

      for (const it of orderData.items) {
        const p = prodMap.get(it.productId);
        if (!p) continue;
        const price = Number(p.promotional_price && Number(p.promotional_price) > 0 ? p.promotional_price : p.price);
        const itemTotal = price * it.quantity;
        subtotal += itemTotal;
        orderItemsToInsert.push({
          product_id: it.productId,
          product_name: p.name,
          quantity: it.quantity,
          unit_price: price,
          total_price: itemTotal,
          unit: p.unit || 'un',
        });
      }

      // 2. Busca próximo order_number
      const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      const nextNumber = (count ?? 0) + 1;

      // 3. Busca tempo de preparo padrão do estabelecimento
      const { data: sRow } = await supabase
        .from('tenant_settings')
        .select('default_prep_time_minutes')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      const currentPrepMinutes = sRow?.default_prep_time_minutes ? Number(sRow.default_prep_time_minutes) : 30;

      // 4. Insere o pedido diretamente como DELIVERED (Venda Concluída no Caixa)
      const { data: insertedOrder, error: oError } = await supabase
        .from('orders')
        .insert({
          tenant_id: tenantId,
          order_number: nextNumber,
          customer_name: orderData.customerName,
          customer_phone: orderData.customerPhone,
          delivery_address: 'Retirada no Balcão / Consumo Local',
          fulfillment_type: 'PICKUP',
          payment_method: orderData.paymentMethod,
          payment_status: 'PAID',
          status: 'DELIVERED',
          subtotal: subtotal,
          delivery_fee: 0,
          discount: 0,
          total_amount: subtotal,
          notes: orderData.notes || 'Venda presencial PDV Balcão',
          prep_time_minutes: currentPrepMinutes,
          origin: 'direct',
        })
        .select()
        .single();

      if (oError || !insertedOrder) {
        throw new Error(oError?.message || 'Falha ao registrar venda de balcão.');
      }

      // 4. Insere itens
      if (orderItemsToInsert.length > 0) {
        await supabase.from('order_items').insert(
          orderItemsToInsert.map(i => ({ ...i, order_id: insertedOrder.id }))
        );
      }

      // 5. Abate estoque físico
      for (const it of orderData.items) {
        const p = prodMap.get(it.productId);
        if (p) {
          const currentStock = Number(p.stock_quantity ?? 0);
          const newStock = Math.max(0, currentStock - it.quantity);
          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', it.productId);
        }
      }

      // 6. Insere histórico
      await supabase.from('order_status_history').insert({
        order_id: insertedOrder.id,
        status: 'DELIVERED',
        note: 'Venda de balcão finalizada pelo caixa',
        changed_by: context.userName || 'Caixa',
      });

      const finalOrder = await this.getById(context, tenantId, insertedOrder.id);
      if (finalOrder) return finalOrder;

      return mapRowToOrder(insertedOrder, orderItemsToInsert, []);
    }

    throw new Error('Supabase não configurado');
  },

  async createPublicOrder(
    slug: string,
    orderData: {
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      deliveryAddress?: string;
      addressDetails?: Order['addressDetails'];
      items: Array<{ productId: string; quantity: number; notes?: string }>;
      paymentMethod: Order['paymentMethod'];
      fulfillmentType?: Order['fulfillmentType'];
      notes?: string;
      origin: Order['origin'];
    }
  ): Promise<Order> {
    if (isSupabaseConfigured) {
      // 1. Chamada atômica RPC ao Supabase (validação de estoque FOR UPDATE, preço oficial e vínculo estrito ao auth.uid())
      const { data: orderId, error: rpcError } = await supabase.rpc('process_checkout_atomic', {
        p_tenant_slug: slug,
        p_customer_name: orderData.customerName,
        p_customer_phone: orderData.customerPhone,
        p_customer_email: orderData.customerEmail || null,
        p_delivery_address: orderData.deliveryAddress || (orderData.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : 'Endereço de entrega'),
        p_address_details: orderData.addressDetails || {},
        p_payment_method: orderData.paymentMethod,
        p_fulfillment_type: orderData.fulfillmentType || 'DELIVERY',
        p_notes: orderData.notes || '',
        p_origin: orderData.origin || 'direct',
        p_items: orderData.items.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          notes: i.notes || null,
        })),
      });

      if (rpcError) {
        console.error('[orderRepository] Erro no RPC process_checkout_atomic:', rpcError.message);
        throw new Error(rpcError.message || 'Falha ao processar checkout no servidor.');
      }

      if (orderId) {
        // 2. Recuperação oficial via RPC SECURITY DEFINER com isolamento estrito de auth.uid() e tenant
        const { data: orderDataFromDb, error: fetchError } = await supabase.rpc(
          'get_customer_order_by_id',
          { p_order_id: orderId }
        );

        if (fetchError || !orderDataFromDb) {
          console.warn('[orderRepository] Aviso na leitura via RPC, tentando leitura direta por orders:', fetchError?.message);
          
          // Tentativa de contingência de leitura direta autenticada
          const { data: createdRow } = await supabase
            .from('orders')
            .select('*, order_items(*), order_status_history(*)')
            .eq('id', orderId)
            .single();

          if (createdRow) {
            return mapRowToOrder(
              createdRow,
              createdRow.order_items || [],
              createdRow.order_status_history || []
            );
          }

          // Se nenhuma leitura obteve o pedido, lançamos erro real com o ID retornado.
          // PROIBIDO RETORNAR PEDIDO FAKE COM R$ 0,00!
          throw new Error(
            `Pedido #${orderId.slice(0, 8)} foi processado no servidor, mas ocorreu uma falha ao carregar os dados de confirmação. Por favor, acerte seu login ou consulte seus pedidos.`
          );
        }

        // Mapeia os dados oficiais retornados pela RPC do PostgreSQL
        const mappedOrder: Order = {
          id: orderDataFromDb.id,
          orderNumber: orderDataFromDb.orderNumber,
          tenantId: orderDataFromDb.tenantId,
          customerId: orderDataFromDb.customerId || undefined,
          customerName: orderDataFromDb.customerName,
          customerPhone: orderDataFromDb.customerPhone,
          customerEmail: orderDataFromDb.customerEmail || undefined,
          deliveryAddress: orderDataFromDb.deliveryAddress,
          addressDetails: orderDataFromDb.addressDetails || undefined,
          items: (orderDataFromDb.items || []).map((item: any) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.totalPrice),
            notes: item.notes || undefined,
            unit: item.unit || 'un',
          })),
          subtotal: Number(orderDataFromDb.subtotal),
          deliveryFee: Number(orderDataFromDb.deliveryFee),
          discount: Number(orderDataFromDb.discount ?? 0),
          totalAmount: Number(orderDataFromDb.totalAmount),
          paymentMethod: orderDataFromDb.paymentMethod,
          paymentStatus: orderDataFromDb.paymentStatus,
          fulfillmentType: orderDataFromDb.fulfillmentType || 'DELIVERY',
          notes: orderDataFromDb.notes || undefined,
          prepTimeMinutes: orderDataFromDb.prepTimeMinutes ? Number(orderDataFromDb.prepTimeMinutes) : (orderDataFromDb.prep_time_minutes ? Number(orderDataFromDb.prep_time_minutes) : 30),
          status: orderDataFromDb.status as OrderStatus,
          statusHistory: (orderDataFromDb.statusHistory || []).map((h: any) => ({
            status: h.status,
            timestamp: h.timestamp,
            note: h.note || undefined,
            changedBy: h.changedBy || 'Sistema',
          })),
          createdAt: orderDataFromDb.createdAt,
          updatedAt: orderDataFromDb.updatedAt,
          origin: orderDataFromDb.origin || 'direct',
          isDemo: false,
        };

        return mappedOrder;
      }

      throw new Error('Não foi possível confirmar o pedido no banco de dados.');
    }

    // Apenas se Supabase não estiver configurado (ambiente local de teste isolado)
    return dataStore.createPublicOrder(slug, orderData);
  },

  /**
   * Processamento atômico de Checkout Promocional Próprio (Modo 3)
   */
  async createPromotionalOrder(
    slug: string,
    orderData: {
      offerId: string;
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
    }
  ): Promise<{ order: Order; celebrationMessage?: string; redemptionNumber?: number; isExhausted?: boolean }> {
    if (isSupabaseConfigured) {
      try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('process_promotional_checkout_atomic', {
          p_tenant_slug: slug,
          p_offer_id: orderData.offerId,
          p_quantity: orderData.quantity,
          p_customer_name: orderData.customerName,
          p_customer_phone: orderData.customerPhone,
          p_customer_email: orderData.customerEmail || null,
          p_delivery_address: orderData.deliveryAddress || (orderData.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : 'Endereço de entrega'),
          p_address_details: orderData.addressDetails || {},
          p_payment_method: orderData.paymentMethod,
          p_fulfillment_type: orderData.fulfillmentType || 'DELIVERY',
          p_notes: orderData.notes || '',
          p_coupon_code: orderData.couponCode || null,
        });

        if (rpcError) {
          console.error('[orderRepository] Erro no RPC process_promotional_checkout_atomic:', rpcError.message);
          throw new Error(rpcError.message || 'Falha ao processar checkout promocional no servidor.');
        }

        if (rpcResult && rpcResult.order_id) {
          const { data: orderDataFromDb } = await supabase.rpc(
            'get_customer_order_by_id',
            { p_order_id: rpcResult.order_id }
          );

          if (orderDataFromDb) {
            const mappedOrder: Order = {
              id: orderDataFromDb.id,
              orderNumber: orderDataFromDb.orderNumber,
              tenantId: orderDataFromDb.tenantId,
              customerId: orderDataFromDb.customerId || undefined,
              customerName: orderDataFromDb.customerName,
              customerPhone: orderDataFromDb.customerPhone,
              customerEmail: orderDataFromDb.customerEmail || undefined,
              deliveryAddress: orderDataFromDb.deliveryAddress,
              addressDetails: orderDataFromDb.addressDetails || undefined,
              items: (orderDataFromDb.items || []).map((item: any) => ({
                productId: item.productId,
                productName: item.productName,
                quantity: Number(item.quantity),
                unitPrice: Number(item.unitPrice),
                totalPrice: Number(item.totalPrice),
                notes: item.notes || undefined,
                unit: item.unit || 'un',
              })),
              subtotal: Number(orderDataFromDb.subtotal),
              deliveryFee: Number(orderDataFromDb.deliveryFee),
              discount: Number(orderDataFromDb.discount ?? 0),
              totalAmount: Number(orderDataFromDb.totalAmount),
              paymentMethod: orderDataFromDb.paymentMethod,
              paymentStatus: orderDataFromDb.paymentStatus,
              fulfillmentType: orderDataFromDb.fulfillmentType || 'DELIVERY',
              notes: orderDataFromDb.notes || undefined,
              prepTimeMinutes: orderDataFromDb.prepTimeMinutes ? Number(orderDataFromDb.prepTimeMinutes) : 30,
              status: orderDataFromDb.status as OrderStatus,
              statusHistory: (orderDataFromDb.statusHistory || []).map((h: any) => ({
                status: h.status,
                timestamp: h.timestamp,
                note: h.note || undefined,
                changedBy: h.changedBy || 'Sistema',
              })),
              createdAt: orderDataFromDb.createdAt,
              updatedAt: orderDataFromDb.updatedAt,
              origin: 'promotional_checkout',
              isDemo: false,
            };

            return {
              order: mappedOrder,
              celebrationMessage: rpcResult.celebration_message || undefined,
              redemptionNumber: rpcResult.redemption_number || undefined,
              isExhausted: Boolean(rpcResult.is_exhausted),
            };
          }
        }
      } catch (err: any) {
        console.warn('[orderRepository] Falha ao processar checkout via RPC, caindo para dataStore:', err.message);
        return dataStore.processPromotionalCheckout(slug, orderData);
      }
    }

    return dataStore.processPromotionalCheckout(slug, orderData);
  },

  /**
   * Consulta os pedidos do cliente autenticado neste tenant
   */
  async getCustomerOrders(tenantId: string, customerUserId: string): Promise<Order[]> {
    if (isSupabaseConfigured) {
      try {
        const { data: customerRow } = await supabase
          .from('customers')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('user_id', customerUserId)
          .maybeSingle();

        if (customerRow) {
          const { data: orderRows, error } = await supabase
            .from('orders')
            .select('*, order_items(*), order_status_history(*)')
            .eq('tenant_id', tenantId)
            .eq('customer_id', customerRow.id)
            .order('created_at', { ascending: false });

          if (error) {
            console.warn('[orderRepository] Aviso ao buscar pedidos do cliente direto:', error.message);
          } else if (orderRows && orderRows.length > 0) {
            return orderRows.map(row => 
              mapRowToOrder(row, row.order_items || [], row.order_status_history || [])
            );
          }
        }

        // Fallback seguro via RPC get_customer_orders_safe
        const { data: rpcOrders, error: rpcError } = await supabase.rpc('get_customer_orders_safe', {
          p_tenant_id: tenantId,
          p_user_id: customerUserId,
        });

        if (!rpcError && rpcOrders && rpcOrders.length > 0) {
          const orderIds = rpcOrders.map((o: any) => o.id);
          const [itemsRes, histRes] = await Promise.all([
            supabase.from('order_items').select('*').in('order_id', orderIds),
            supabase.from('order_status_history').select('*').in('order_id', orderIds),
          ]);

          const itemsByOrder: Record<string, any[]> = {};
          (itemsRes.data || []).forEach((it: any) => {
            if (!itemsByOrder[it.order_id]) itemsByOrder[it.order_id] = [];
            itemsByOrder[it.order_id].push(it);
          });

          const histByOrder: Record<string, any[]> = {};
          (histRes.data || []).forEach((h: any) => {
            if (!histByOrder[h.order_id]) histByOrder[h.order_id] = [];
            histByOrder[h.order_id].push(h);
          });

          return rpcOrders.map((row: any) => 
            mapRowToOrder(row, itemsByOrder[row.id] || [], histByOrder[row.id] || [])
          );
        }
      } catch (err: any) {
        console.error('[orderRepository] Erro ao carregar pedidos do cliente:', err);
        throw err;
      }
    }
    return [];
  },

  /**
   * Atribui um motorista ao pedido via RPC assign_order_to_driver
   */
  async assignDriver(
    context: SecurityContext,
    tenantId: string,
    orderId: string,
    driverUserId: string
  ): Promise<void> {
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.rpc('assign_order_to_driver', {
          p_order_id: orderId,
          p_driver_user_id: driverUserId,
        });

        if (!error) return;
        console.warn('[orderRepository] assign_order_to_driver falhou via RPC:', error.message);
      } catch (err) {
        console.warn('[orderRepository] Erro ao chamar assign_order_to_driver:', err);
      }
    }
  },

  /**
   * Desatribui o motorista do pedido via RPC unassign_order_driver
   */
  async unassignDriver(
    context: SecurityContext,
    tenantId: string,
    orderId: string
  ): Promise<void> {
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.rpc('unassign_order_driver', {
          p_order_id: orderId,
        });

        if (!error) return;
        console.warn('[orderRepository] unassign_order_driver falhou via RPC:', error.message);
      } catch (err) {
        console.warn('[orderRepository] Erro ao chamar unassign_order_driver:', err);
      }
    }
  },

  // Inscrição em tempo real via Supabase Realtime oficial
  subscribeToOrders(tenantId: string, onUpdate: () => void): () => void {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) {
      return dataStore.subscribe(onUpdate);
    }

    try {
      const channel = supabase
        .channel(`tenant-orders-${tenantId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `tenant_id=eq.${tenantId}`,
          },
          (payload) => {
            console.log('[Supabase Realtime] Mudança em orders:', payload);
            onUpdate();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[Supabase Realtime] Conectado com sucesso ao canal tenant-orders-${tenantId}`);
          }
        });

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.error('[orderRepository] Falha ao conectar ao Supabase Realtime:', err);
      return () => {};
    }
  }
};
