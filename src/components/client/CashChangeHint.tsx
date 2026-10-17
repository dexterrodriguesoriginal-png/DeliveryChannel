import React from 'react';
import { Banknote, AlertTriangle } from 'lucide-react';
import { CashChangeInfo, cashChangeLabel } from '../../lib/pricing/cashChange';
import { formatBRL } from '../../lib/pricing/money';

/** Linha de troco abaixo do campo "Precisa de troco para quanto?" e no resumo do checkout. */
export const CashChangeHint: React.FC<{ info: CashChangeInfo; className?: string }> = ({ info, className = '' }) => {
  if (info.status === 'none') return null;
  if (info.status === 'ok') {
    return (
      <div data-testid="cash-change-summary" className={`flex items-center gap-1.5 text-xs font-semibold text-emerald-800 ${className}`}>
        <Banknote className="w-3.5 h-3.5 shrink-0" />
        <span>{cashChangeLabel(info)}</span>
      </div>
    );
  }
  return (
    <div data-testid="cash-change-warning" role="alert" className={`flex items-start gap-1.5 text-xs font-semibold text-amber-800 ${className}`}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>
        {info.status === 'insufficient'
          ? `O valor para troco (${formatBRL(info.amount)}) é menor que o total do pedido (${formatBRL(info.total)}). Corrija ou deixe em branco.`
          : 'Informe um valor válido para o troco (ex.: 50,00) ou deixe em branco.'}
      </span>
    </div>
  );
};
