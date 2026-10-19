/**
 * Loja explícita nos pedidos do cliente (19/10).
 * A aba Pedidos de /app/:slug mostra só os pedidos daquela loja (getCustomerOrders filtra por tenant);
 * o título e cada cartão passam a dizer o nome da loja para o cliente não confundir lojas.
 */
export const CUSTOMER_ORDERS_SCOPE_HINT = 'Aqui aparecem só os pedidos feitos nesta loja.';

export function storeDisplayName(themeName?: string | null, tenantName?: string | null): string {
  const n = (themeName || '').trim() || (tenantName || '').trim();
  return n || 'esta loja';
}

export function customerOrdersTitle(storeName?: string | null): string {
  const n = (storeName || '').trim();
  return n && n !== 'esta loja' ? `Pedidos em ${n}` : 'Seus pedidos';
}
