import React from 'react';
import { BellRing, Clock, UserCheck, Users } from 'lucide-react';
import { formatBRL } from '../../../lib/pricing/money';
import { TableStatusInfo, tableDisplayNumber } from '../../../lib/salon/tableStatus';
import './salon.css';

export interface TableCardProps {
  id: string;
  label: string;
  area: string | null;
  seats: number;
  info: TableStatusInfo;
  index?: number;
  onOpen: (id: string) => void;
}

const money = (cents: number) => formatBRL(cents / 100);

export function tableAriaLabel(label: string, info: TableStatusInfo, seats: number): string {
  const parts = [label, info.label];
  if (info.kind === 'FREE') parts.push(`${seats} lugares`);
  else {
    if (info.elapsedLabel) parts.push(`aberta há ${info.elapsedLabel}`);
    parts.push(`parcial ${money(info.totalCents)}`);
    if (info.paidPercent > 0) parts.push(`${info.paidPercent}% pago`);
  }
  if (info.hasActiveCall) parts.push('chamando o garçom');
  if (info.pendingRelease) parts.push('aguardando liberação');
  if (info.needsReview) parts.push('PIX para conferir');
  return parts.join(', ');
}

export const TableCard: React.FC<TableCardProps> = React.memo(({ id, label, area, seats, info, index = 0, onOpen }) => {
  const attention = info.hasActiveCall || info.pendingRelease;
  const occupied = info.kind !== 'FREE';
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className={`salon-card salon-card--${info.kind}${info.hasActiveCall ? ' salon-card--CALL' : ''}`}
      style={{ ['--i' as string]: Math.min(index, 30) } as React.CSSProperties}
      data-testid={`salon-table-${id}`}
      data-status={info.kind}
      aria-label={tableAriaLabel(label, info, seats)}
    >
      {attention && (
        <span className={`salon-bell${info.hasActiveCall ? '' : ' salon-bell--release'}`} data-testid={`salon-bell-${id}`} aria-hidden="true">
          {info.hasActiveCall ? <BellRing className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
        </span>
      )}
      <div className="flex items-start justify-between gap-2 pr-9">
        <span className="salon-chip"><i className="salon-dot" />{info.kind === 'LONG_STAY' ? 'Muito tempo' : info.label}</span>
      </div>
      <div className="min-w-0">
        <div className="salon-num" aria-hidden="true">{tableDisplayNumber(label)}</div>
        <div className="salon-name" title={label}>{label}{area ? ` · ${area}` : ''}</div>
      </div>
      {occupied ? (
        <div className="space-y-2">
          <div className="salon-meta">
            <span title="Total parcial da comanda" data-testid={`salon-total-${id}`}>{money(info.totalCents)}</span>
            <span className="salon-time" data-testid={`salon-elapsed-${id}`}><Clock className="h-3 w-3" aria-hidden="true" />{info.elapsedLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="salon-bar flex-1" role="progressbar" aria-label="Percentual pago" aria-valuemin={0} aria-valuemax={100} aria-valuenow={info.paidPercent}><i style={{ width: `${info.paidPercent}%` }} /></div>
            <span className="w-[58px] text-right text-[11px] font-extrabold tabular-nums">{info.paidPercent}% pago</span>
          </div>
        </div>
      ) : (
        <div className="salon-meta"><span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden="true" />{seats} lugares</span><span className="salon-avail">Disponível</span></div>
      )}
    </button>
  );
});
TableCard.displayName = 'TableCard';
