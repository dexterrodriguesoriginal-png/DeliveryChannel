import React from 'react';
import type { OrderStatus } from '../../types';
import { ORDER_STATUS_THEME } from '../../utils/orderStatusTheme';
import { statusChip } from '../../lib/orders/statusChip';
import { StatusIconByKey } from './StatusIcon';

/** 19/10: cabeçalho da coluna do kanban no mesmo padrão KDS dos cards (ícone, título, contador e borda). */
export const KanbanColumnHeader: React.FC<{ status: OrderStatus; label: string; count: number }> = ({ status, label, count }) => {
  const t = ORDER_STATUS_THEME[status];
  return (
    <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b-2" style={{ borderColor: t.border }} data-testid={`kanban-col-${status}`}>
      <div className="flex items-center gap-1.5">
        <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: t.badgeBg, color: t.accent }}>
          <StatusIconByKey icon={statusChip(status).icon} className="w-3 h-3" />
        </span>
        <h3 className="font-extrabold text-[11px] uppercase" style={{ color: t.text }}>{label}</h3>
        <span className="text-[11px] font-black px-1.5 rounded-full tabular-nums border" style={{ backgroundColor: t.badgeBg, color: t.badgeText, borderColor: t.badgeBorder }}>{count}</span>
      </div>
    </div>
  );
};
