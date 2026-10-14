import { Order, OrderStatus, InventoryMovement, InternalNotification } from '../types';
import { SecurityContext } from './securityEngine';
import { orderRepository, PublicOrderInput, PromotionalOrderInput, CheckoutSummary } from '../repositories/orderRepository';
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

  /** Mudança de status sempre pelo servidor (sem pedido fictício em caso de erro). */
  async updateStatus(context: SecurityContext, tenantId: string, orderId: string, newStatus: OrderStatus, note?: string, currentStatus?: OrderStatus): Promise<Order> {
    const updated = await orderRepository.updateStatus(context, tenantId, orderId, newStatus, note, currentStatus);
    const cached = ordersCache.get(tenantId) || [];
    const index = cached.findIndex(o => o.id === orderId);
    if (index >= 0) {
      cached[index] = updated;
      ordersCache.set(tenantId, [...cached]);
    }
    return updated;
  },

  async createPublic(slug: string, orderData: PublicOrderInput): Promise<Order> {
    return orderRepository.createPublicOrder(slug, orderData);
  },

  async createPromotional(slug: string, orderData: PromotionalOrderInput): Promise<{ order: Order; summary: CheckoutSummary }> {
    return orderRepository.createPromotionalOrder(slug, orderData);
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
