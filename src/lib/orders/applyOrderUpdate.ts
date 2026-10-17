import type { Order } from '../../types';

/**
 * Atualização otimista da fila do dono: assim que a mutação de status volta com sucesso, troca o pedido
 * na lista local pelo retornado pelo servidor (sem esperar a próxima sincronização completa).
 * Devolve a mesma referência quando o pedido não está na lista.
 */
export function applyOrderUpdate(list: Order[] | null, updated: Order | null | undefined): Order[] | null {
  if (!list || !updated) return list;
  const idx = list.findIndex(o => o.id === updated.id);
  if (idx < 0) return list;
  const next = list.slice();
  next[idx] = { ...list[idx], ...updated };
  return next;
}
