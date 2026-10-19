import type { OrderStatus } from '../../types';

/**
 * 19/10 (painel do dono): selo de status com as MESMAS cores em todo o painel.
 * Novo = azul · Confirmado = índigo · Em preparo = âmbar · Pronto = verde · Em rota = violeta
 * Entregue/Cancelado = neutros · Atrasado = vermelho (sobrepõe o status).
 */
export interface StatusChip { label: string; className: string }

const CHIP: Record<OrderStatus, StatusChip> = {
  PENDING: { label: 'NOVO', className: 'bg-blue-50 text-blue-800 border-blue-300' },
  CONFIRMED: { label: 'CONFIRMADO', className: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  PREPARING: { label: 'EM PREPARO', className: 'bg-amber-50 text-amber-800 border-amber-300' },
  READY: { label: 'PRONTO', className: 'bg-green-50 text-green-800 border-green-300' },
  WAITING_FOR_DRIVER: { label: 'PRONTO', className: 'bg-green-50 text-green-800 border-green-300' },
  OUT_FOR_DELIVERY: { label: 'EM ROTA', className: 'bg-violet-50 text-violet-800 border-violet-200' },
  DELIVERED: { label: 'ENTREGUE', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  CANCELLED: { label: 'CANCELADO', className: 'bg-stone-100 text-stone-600 border-stone-200' },
};
export const LATE_CHIP: StatusChip = { label: 'ATRASADO', className: 'bg-red-50 text-red-700 border-red-300' };

export function statusChip(status: OrderStatus, late = false): StatusChip {
  if (late) return LATE_CHIP;
  return CHIP[status] ?? CHIP.DELIVERED;
}

/** Cores dos filtros/contadores do painel (chips "Novos", "Em preparo", "Prontos", "Atrasados"). */
export const FILTER_CHIP_CLASS = {
  novos: CHIP.PENDING.className,
  emPreparo: CHIP.PREPARING.className,
  prontos: CHIP.READY.className,
  atrasados: LATE_CHIP.className,
  neutro: 'bg-white text-slate-700 border-slate-300',
} as const;
