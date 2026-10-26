import React from 'react';
import { formatBRL } from '../../lib/pricing/money';
import { KANBAN_COLUMN_THEME, type KanbanColumn } from './ordersKanban';

export const KanbanColumnHeader: React.FC<{ column: KanbanColumn; count: number; total: number }> = ({ column, count, total }) => {
  const theme = KANBAN_COLUMN_THEME[column];
  return (
    <header className="orders-kanban-header" style={{ backgroundColor: theme.color }} data-testid={`kanban-col-${column}`}>
      <div className="flex items-center justify-center gap-2">
        <h3 className="text-[13px] font-bold tracking-wide">{theme.label}</h3>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold tabular-nums" aria-label={`${count} pedidos`}>{count}</span>
      </div>
      <p className="mt-1 text-center text-[11px] font-normal text-white/90 tabular-nums">Qtd: {count} · Total: {formatBRL(total)}</p>
    </header>
  );
};
