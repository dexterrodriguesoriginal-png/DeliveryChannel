/**
 * Rótulos pt-BR para valores internos de pedido (enum do banco → texto mostrado ao usuário).
 * Nunca exibir o enum cru (CASH, CREDIT_CARD, DELIVERY…) para cliente, loja ou entregador.
 */

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
};

/** CASH → "Dinheiro", PIX → "PIX", CREDIT_CARD → "Cartão de crédito", DEBIT_CARD → "Cartão de débito". */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '—';
  return PAYMENT_METHOD_LABELS[String(method).trim().toUpperCase()] || 'Outro';
}

/** Versão curta para etiquetas pequenas: crédito e débito viram "Cartão". */
export function paymentMethodShortLabel(method: string | null | undefined): string {
  const key = String(method || '').trim().toUpperCase();
  if (key === 'CREDIT_CARD' || key === 'DEBIT_CARD') return 'Cartão';
  return paymentMethodLabel(method);
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  PAYMENT_ON_DELIVERY: 'Pagamento na entrega',
  REFUNDED: 'Estornado',
};

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return PAYMENT_STATUS_LABELS[String(status).trim().toUpperCase()] || 'Outro';
}

export function fulfillmentLabel(type: string | null | undefined): string {
  const key = String(type || '').trim().toUpperCase();
  if (key === 'PICKUP') return 'Retirada';
  if (key === 'DELIVERY') return 'Entrega';
  if (key === 'DINE_IN') return 'Salão';
  return '—';
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Recebido',
  CONFIRMED: 'Aceito pela loja',
  PREPARING: 'Em preparo',
  READY: 'Pronto',
  WAITING_FOR_DRIVER: 'Aguardando motoboy',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  DRIVER_ACCEPTED: 'Motoboy aceitou',
  DRIVER_ASSIGNED: 'Motoboy designado',
  DRIVER_RELEASED: 'Motoboy liberado',
};

export function orderStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return ORDER_STATUS_LABELS[String(status).trim().toUpperCase()] || String(status);
}

/** Rótulos do painel da loja (mesmos dos cards/kanban), em maiúsculas. */
const OWNER_ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'NOVO',
  CONFIRMED: 'CONFIRMADO',
  PREPARING: 'EM PREPARO',
  READY: 'PRONTO',
  WAITING_FOR_DRIVER: 'AGUARDANDO MOTOBOY',
  OUT_FOR_DELIVERY: 'SAIU PARA ENTREGA',
  DELIVERED: 'ENTREGUE',
  CANCELLED: 'CANCELADO',
  DRIVER_ACCEPTED: 'MOTOBOY ACEITOU',
  DRIVER_ASSIGNED: 'MOTOBOY DESIGNADO',
  DRIVER_RELEASED: 'MOTOBOY LIBERADO',
};

/** PREPARING → "EM PREPARO", OUT_FOR_DELIVERY → "SAIU PARA ENTREGA"… Nunca devolve o enum cru. */
export function ownerOrderStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return OWNER_ORDER_STATUS_LABELS[String(status).trim().toUpperCase()] || 'ATUALIZADO';
}

/** Mensagem do toast de sucesso do dono: 'Pedido #12 atualizado para "EM PREPARO".' */
export function ownerStatusToastMessage(status: string | null | undefined, orderNumber?: string | number | null): string {
  const ref = orderNumber !== undefined && orderNumber !== null && String(orderNumber).trim() !== '' ? ` #${orderNumber}` : '';
  return `Pedido${ref} atualizado para "${ownerOrderStatusLabel(status)}".`;
}
