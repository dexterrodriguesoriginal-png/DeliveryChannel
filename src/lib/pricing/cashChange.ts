/**
 * Troco do pagamento em dinheiro (vitrine). Apenas exibição/observação: o total oficial é do servidor.
 */
import { parseBRMoney } from './deliveryLabel';
import { formatBRL } from './money';

export type CashChangeInfo =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'insufficient'; amount: number; total: number }
  | { status: 'ok'; amount: number; total: number; change: number };

/** Interpreta "Precisa de troco para quanto?" (ex.: "50", "50,00", "R$ 100") contra o total do pedido. */
export function computeCashChange(input: string | null | undefined, total: number): CashChangeInfo {
  const raw = String(input ?? '').trim();
  if (!raw) return { status: 'none' };
  const amount = parseBRMoney(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { status: 'invalid' };
  const t = Math.round((Number(total) || 0) * 100) / 100;
  const a = Math.round(amount * 100) / 100;
  if (a < t) return { status: 'insufficient', amount: a, total: t };
  return { status: 'ok', amount: a, total: t, change: Math.round((a - t) * 100) / 100 };
}

/** Texto do troco para o resumo e para a observação do pedido (loja e entregador). */
export function cashChangeLabel(info: CashChangeInfo): string | null {
  if (info.status !== 'ok') return null;
  if (info.change <= 0) return `Troco: não precisa (paga ${formatBRL(info.amount)} exato)`;
  return `Troco para ${formatBRL(info.amount)} (devolver ${formatBRL(info.change)})`;
}
