import type { OrderStatus } from '../../types';

/**
 * 19/10 (padrão KDS, aplicado em todo o painel do dono):
 * Novo = âmbar (sino) · Confirmado = âmbar claro · Em preparo = azul (chama) · Pronto = verde da marca (sacola)
 * Em rota = ciano (moto) · Entregue = cinza · Cancelado = vermelho suave (X) · Atrasado = vermelho forte (relógio).
 * Nunca só cor: todo selo tem ícone + texto.
 */
export type StatusIconKey = 'bell' | 'confirmed' | 'flame' | 'ready' | 'bike' | 'delivered' | 'cancelled' | 'late';
export interface StatusChip { label: string; className: string; icon: StatusIconKey }

const CHIP: Record<OrderStatus, StatusChip> = {
  PENDING: { label: 'NOVO', icon: 'bell', className: 'bg-amber-100 text-amber-900 border-amber-400' },
  CONFIRMED: { label: 'CONFIRMADO', icon: 'confirmed', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  PREPARING: { label: 'EM PREPARO', icon: 'flame', className: 'bg-blue-100 text-blue-900 border-blue-300' },
  READY: { label: 'PRONTO', icon: 'ready', className: 'bg-green-100 text-green-900 border-green-400' },
  WAITING_FOR_DRIVER: { label: 'PRONTO', icon: 'ready', className: 'bg-green-100 text-green-900 border-green-400' },
  OUT_FOR_DELIVERY: { label: 'EM ROTA', icon: 'bike', className: 'bg-cyan-100 text-cyan-900 border-cyan-300' },
  DELIVERED: { label: 'ENTREGUE', icon: 'delivered', className: 'bg-slate-100 text-slate-700 border-slate-300' },
  CANCELLED: { label: 'CANCELADO', icon: 'cancelled', className: 'bg-red-50 text-red-800 border-red-200' },
};
export const LATE_CHIP: StatusChip = { label: 'ATRASADO', icon: 'late', className: 'bg-red-600 text-white border-red-700' };

export function statusChip(status: OrderStatus, late = false): StatusChip {
  if (late) return LATE_CHIP;
  return CHIP[status] ?? CHIP.DELIVERED;
}

/** Cores dos filtros/contadores da faixa de alertas (mesmas dos selos). */
export const FILTER_CHIP_CLASS = {
  novos: CHIP.PENDING.className,
  emPreparo: CHIP.PREPARING.className,
  prontos: CHIP.READY.className,
  atrasados: LATE_CHIP.className,
  estoque: 'bg-orange-50 text-orange-800 border-orange-300',
} as const;
