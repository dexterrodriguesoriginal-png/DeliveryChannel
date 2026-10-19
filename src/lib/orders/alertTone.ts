import type { AlertFilter } from './orderAlerts';

/**
 * 19/10: cor da faixa "Alertas de pedidos" para o dono bater o olho e saber o que pede atenção.
 * Com filtro selecionado: a cor daquele status. Sem filtro: o mais urgente presente —
 * Atrasados (vermelho) > Novos (azul) > Prontos (verde) > Em preparo (âmbar) > Estoque baixo (laranja).
 * Nada pendente: neutro.
 */
export type AlertTone = 'red' | 'blue' | 'green' | 'amber' | 'orange' | 'neutral';

const FILTER_TONE: Record<AlertFilter, AlertTone> = {
  atrasados: 'red', novos: 'blue', prontos: 'green', emPreparo: 'amber',
};

export function alertTone(
  counts: Record<AlertFilter, number>,
  filter: AlertFilter | null,
  lowStockCount = 0,
): AlertTone {
  if (filter) return FILTER_TONE[filter];
  for (const k of ['atrasados', 'novos', 'prontos', 'emPreparo'] as AlertFilter[]) {
    if (counts[k] > 0) return FILTER_TONE[k];
  }
  return lowStockCount > 0 ? 'orange' : 'neutral';
}

/** Fundo claro, borda e acento esquerdo de 4px por tom (as linhas dos pedidos continuam brancas). */
export const ALERT_TONE_CLASS: Record<AlertTone, string> = {
  red: 'bg-red-100 border-red-300 border-l-red-600',
  blue: 'bg-blue-100 border-blue-300 border-l-blue-600',
  green: 'bg-green-100 border-green-300 border-l-[#15803d]',
  amber: 'bg-amber-100 border-amber-300 border-l-amber-600',
  orange: 'bg-orange-100 border-orange-300 border-l-orange-600',
  neutral: 'bg-white border-slate-200 border-l-slate-300',
};
