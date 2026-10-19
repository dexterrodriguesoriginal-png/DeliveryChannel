/**
 * 19/10 (padrão KDS): semáforo de tempo por pedido.
 * Verde dentro do Tempo de Preparo da loja (padrão 25 min), âmbar a partir de 70% dele,
 * vermelho quando passou (é isso que "Atrasado" significa no painel).
 */
import type { OrderStatus } from '../../types';

export const DEFAULT_PREP_MINUTES = 25;
export const SLA_WARN_RATIO = 0.7;

export type SlaLevel = 'ok' | 'warn' | 'late' | 'neutral' | 'none';

export function prepLimitMinutes(prepMinutes?: number | null): number {
  const m = Number(prepMinutes);
  return Number.isFinite(m) && m > 0 ? m : DEFAULT_PREP_MINUTES;
}

const TIMED: ReadonlySet<string> = new Set(['PENDING', 'CONFIRMED', 'PREPARING']);
const AFTER: ReadonlySet<string> = new Set(['READY', 'WAITING_FOR_DRIVER', 'OUT_FOR_DELIVERY']);

/** Nível do semáforo. Pronto/em rota mostram o tempo sem semáforo (neutral); entregue/cancelado não mostram (none). */
export function slaLevel(status: OrderStatus | string, ageMs: number, prepMinutes?: number | null): SlaLevel {
  if (AFTER.has(String(status))) return 'neutral';
  if (!TIMED.has(String(status))) return 'none';
  const limitMs = prepLimitMinutes(prepMinutes) * 60000;
  if (ageMs > limitMs) return 'late';
  if (ageMs >= limitMs * SLA_WARN_RATIO) return 'warn';
  return 'ok';
}

export const SLA_CLASS: Record<Exclude<SlaLevel, 'none'>, string> = {
  ok: 'bg-green-50 text-green-800 border-green-300',
  warn: 'bg-amber-100 text-amber-900 border-amber-400',
  late: 'bg-red-600 text-white border-red-700',
  neutral: 'bg-slate-50 text-slate-600 border-slate-300',
};

export const SLA_TITLE: Record<Exclude<SlaLevel, 'none'>, string> = {
  ok: 'Dentro do tempo de preparo',
  warn: 'Perto do limite do tempo de preparo',
  late: 'Atrasado: passou do tempo de preparo',
  neutral: 'Tempo desde o pedido',
};
