import { Order, OrderStatus, InventoryMovement, InternalNotification } from '../types';
import { SecurityContext } from './securityEngine';
import { orderRepository } from '../repositories/orderRepository';
import { inventoryRepository } from '../repositories/inventoryRepository';

const ordersCache = new Map<string, Order[]>();
const inventoryMovementsCache = new Map<string, InventoryMovement[]>();
const notificationsCache = new Map<string, InternalNotification[]>();

export const orderService = {
  getOrders(context: SecurityContext, tenantId: string): Order[] {
    orderRepository.getOrders(context, tenantId)
      .then(data => {
        ordersCache.set(tenantId, data);
      })
      .catch(err => {
        console.warn('[orderService] Erro ao sincronizar pedidos do Supabase:', err);
      });

    return ordersCache.get(tenantId) || [];
  },

  getOrderById(context: SecurityContext, tenantId: string, orderId: string): Order | undefined {
    const list = ordersCache.get(tenantId);
    if (list) {
      return list.find(o => o.id === orderId);
    }
    return undefined;
  },

  updateStatus(context: SecurityContext, tenantId: string, orderId: string, newStatus: OrderStatus, note?: string): Order {
    orderRepository.updateStatus(context, tenantId, orderId, newStatus, note)
      .then(updated => {
        const cached = ordersCache.get(tenantId) || [];
        const index = cached.findIndex(o => o.id === orderId);
        if (index >= 0) {
          cached[index] = updated;
          ordersCache.set(tenantId, [...cached]);
        }
      })
      .catch(err => {
        console.warn('[orderService] Erro ao sincronizar status no Supabase:', err);
      });

    const cached = ordersCache.get(tenantId) || [];
    const existing = cached.find(o => o.id === orderId);
    if (existing) {
      existing.status = newStatus;
      return existing;
    }

    return {
      id: orderId,
      orderNumber: 0,
      tenantId,
      customerName: 'Cliente',
      customerPhone: '',
      deliveryAddress: '',
      items: [],
      subtotal: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 0,
      paymentMethod: 'PIX',
      paymentStatus: 'PENDING',
      fulfillmentType: 'DELIVERY',
      status: newStatus,
      statusHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin: 'direto',
      isDemo: false,
    };
  },

  async createPublic(slug: string, orderData: {
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
  }): Promise<Order> {
    return orderRepository.createPublicOrder(slug, orderData);
  },

  getCustomerOrders(_slug: string, _phone: string): Order[] {
    return [];
  },

  getPublicOrder(_slug: string, _orderId: string, _phone?: string): Order | undefined {
    return undefined;
  },

  getInventoryMovements(context: SecurityContext, tenantId: string): InventoryMovement[] {
    inventoryRepository.getMovements(context, tenantId)
      .then(data => inventoryMovementsCache.set(tenantId, data))
      .catch(() => {});
    return inventoryMovementsCache.get(tenantId) || [];
  },

  adjustProductStock(context: SecurityContext, tenantId: string, productId: string, delta: number, reason: string): void {
    inventoryRepository.adjustStock(
      context, 
      tenantId, 
      productId, 
      delta, 
      delta > 0 ? 'ENTRADA' : 'AJUSTE', 
      reason
    ).catch(err => {
      console.warn('[orderService] Erro ao ajustar estoque no Supabase:', err);
    });
  },

  getNotifications(tenantId: string): InternalNotification[] {
    return notificationsCache.get(tenantId) || [];
  },

  markNotificationAsRead(tenantId: string, id: string): void {
    const list = notificationsCache.get(tenantId) || [];
    const item = list.find(n => n.id === id);
    if (item) item.read = true;
  },

  markAllNotificationsAsRead(tenantId: string): void {
    const list = notificationsCache.get(tenantId) || [];
    list.forEach(n => { n.read = true; });
  },

  subscribeToRealtime(tenantId: string, onUpdate: () => void): () => void {
    return orderRepository.subscribeToOrders(tenantId, onUpdate);
  }
};
