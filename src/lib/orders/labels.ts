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
};

export function orderStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return ORDER_STATUS_LABELS[String(status).trim().toUpperCase()] || String(status);
}
