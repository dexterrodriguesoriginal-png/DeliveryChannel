import type { AlertFilter } from './orderAlerts';

/**
 * 19/10 (padrão KDS): cor da faixa "Alertas de pedidos".
 * Com filtro selecionado: a cor daquele status. Sem filtro: o mais urgente presente —
 * Atrasados (vermelho) > Novos (âmbar) > Prontos (verde) > Em preparo (azul) > Estoque baixo
 * (faixa branca com acento laranja, diferente do âmbar dos Novos). Nada pendente: neutro.
 */
export type AlertTone = 'red' | 'amber' | 'green' | 'blue' | 'stock' | 'neutral';

const FILTER_TONE: Record<AlertFilter, AlertTone> = {
  atrasados: 'red', novos: 'amber', prontos: 'green', emPreparo: 'blue',
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
  return lowStockCount > 0 ? 'stock' : 'neutral';
}

/** Fundo claro, borda e acento esquerdo de 4px por tom (as linhas dos pedidos continuam brancas). */
export const ALERT_TONE_CLASS: Record<AlertTone, string> = {
  red: 'bg-red-100 border-red-300 border-l-red-600',
  amber: 'bg-amber-100 border-amber-300 border-l-amber-500',
  green: 'bg-green-100 border-green-300 border-l-[#15803d]',
  blue: 'bg-blue-100 border-blue-300 border-l-blue-600',
  stock: 'bg-white border-orange-300 border-l-orange-500',
  neutral: 'bg-white border-slate-200 border-l-slate-300',
};
