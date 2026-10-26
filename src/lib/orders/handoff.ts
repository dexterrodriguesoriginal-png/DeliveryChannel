/**
 * Regras de cliente para o despacho com códigos (migrations 1500–1700). Sem Supabase: testável.
 * - Código de retirada: só o entregador atribuído vê; a loja digita para validar.
 * - Código de entrega: só o cliente vê; o entregador digita no endereço.
 */
import type { Order } from '../../types';

/** Mantém só dígitos e limita a 4. */
export function normalizeHandoffCode(input: string): string {
  return String(input || '').replace(/\D/g, '').slice(0, 4);
}

export const isCompleteHandoffCode = (code: string) => /^\d{4}$/.test(code);

/** Ganho do entregador: driver_payout (1700); pedidos antigos usam a taxa de entrega. */
export function driverEarning(o: Pick<Order, 'driverPayout' | 'deliveryFee'>): number {
  const p = o.driverPayout;
  return p !== undefined && p !== null && Number.isFinite(Number(p)) ? Number(p) : Number(o.deliveryFee) || 0;
}

/** Pedido ativo do entregador: aceito aguardando retirada (WAITING_FOR_DRIVER) ou em rota. Em rota tem prioridade. */
export function pickDriverActiveOrder<T extends Pick<Order, 'status' | 'driverId'>>(orders: T[], driverId: string | undefined): T | undefined {
  if (!driverId) return undefined;
  const mine = orders.filter(o => o.driverId === driverId);
  return mine.find(o => o.status === 'OUT_FOR_DELIVERY') || mine.find(o => o.status === 'WAITING_FOR_DRIVER' || o.status === 'READY');
}

/** Mensagens pt-BR para os erros das RPCs de despacho/códigos. */
export function handoffErrorMessage(raw: unknown): string {
  const m = String((raw as any)?.message ?? raw ?? '');
  if (m.includes('CODE_LOCKED')) return 'Código bloqueado após 5 tentativas. Fale com a loja.';
  if (m.includes('CODE_INVALID')) return 'Código incorreto. Confira e tente de novo.';
  if (m.includes('RATE_LIMITED')) return 'Muitas tentativas. Aguarde um minuto.';
  if (m.includes('ORDER_NOT_AVAILABLE')) return 'Esta corrida já foi aceita por outro entregador.';
  if (m.includes('DRIVER_NOT_AVAILABLE')) return 'Fique disponível para aceitar corridas.';
  if (m.includes('PICKUP_CODE_REQUIRED')) return 'Peça o código ao entregador e confirme a retirada.';
  if (m.includes('DELIVERY_CODE_REQUIRED')) return 'Digite o código que o cliente vai informar.';
  if (m.includes('CODE_NOT_FOUND')) return 'Pedido sem código. Fale com a loja.';
  if (m.includes('INVALID_STATE')) return 'O pedido mudou de etapa. Atualize a tela.';
  if (m.includes('ORDER_NOT_FOUND')) return 'Pedido não encontrado.';
  return m.replace(/^[A-Z_]+:\s*/, '') || 'Não foi possível concluir. Tente novamente.';
}

/** Resultado de confirm_order_pickup / confirm_order_delivery → mensagem para código errado. */
export function wrongCodeMessage(attemptsLeft: number | undefined): string {
  if (attemptsLeft === undefined) return 'Código incorreto.';
  if (attemptsLeft <= 0) return 'Código incorreto. Código bloqueado: fale com a loja.';
  return `Código incorreto. ${attemptsLeft} tentativa${attemptsLeft === 1 ? '' : 's'} restante${attemptsLeft === 1 ? '' : 's'}.`;
}

/** Loja marcando DELIVERED em pedido de entrega precisa de motivo (sem código do cliente). */
export function storeDeliveredNeedsReason(o: Pick<Order, 'fulfillmentType'> | undefined, next: string): boolean {
  return next === 'DELIVERED' && (o?.fulfillmentType ?? 'DELIVERY') === 'DELIVERY';
}
