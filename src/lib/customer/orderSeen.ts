/** Só IDs técnicos e status; sem nome, contato, endereço ou conteúdo do pedido. */
type KV = Pick<Storage, 'getItem' | 'setItem'>;
export function reconcileOrderSeen(storage: KV, scope: string, orders: { id: string; status: string }[], viewingOrders: boolean): boolean {
  let unread = false;
  for (const order of orders) {
    const key = `deliverychannel_order_seen_${scope}_${order.id}`;
    try {
      const seen = storage.getItem(key);
      // Primeira leitura estabelece a referência. Mudanças posteriores acendem o ponto.
      if (viewingOrders || seen === null) storage.setItem(key, order.status);
      else if (seen !== order.status) unread = true;
    } catch { /* armazenamento indisponível não impede usar a loja */ }
  }
  return unread;
}
