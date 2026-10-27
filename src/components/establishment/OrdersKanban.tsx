import React, { useRef, useState } from 'react';
import { Package } from 'lucide-react';
import type { Order, OrderStatus } from '../../types';
import { KanbanColumnHeader } from './KanbanColumnHeader';
import { groupKanbanOrders, KANBAN_COLUMNS, KANBAN_COLUMN_THEME, type KanbanColumn } from './ordersKanban';
import './ordersKanban.css';

export function OrdersKanban({ orders, loading, renderOrder, onDrop, scale = 1 }: {
  orders: Order[]; loading?: boolean; /** Zoom de densidade (0.1–1.3): escala cards, fontes, paddings e largura das colunas. */ scale?: number; renderOrder: (order: Order) => React.ReactNode;
  onDrop: (id: string, status: OrderStatus) => void;
}) {
  const groups = groupKanbanOrders(orders);
  const [activeColumn, setActiveColumn] = useState<KanbanColumn>('waiting');
  const board = useRef<HTMLDivElement>(null);
  const selectColumn = (key: KanbanColumn) => {
    setActiveColumn(key);
    const lane = board.current?.querySelector<HTMLElement>(`[data-column="${key}"]`);
    if (lane && board.current) board.current.scrollTo({ left: lane.offsetLeft, behavior: 'smooth' });
  };
  return <div className="orders-kanban-layout" aria-busy={loading} data-testid="orders-kanban-layout" data-zoom={Math.round(scale * 100)} style={{ '--oz': scale } as React.CSSProperties}>
    <nav className="orders-kanban-tabs" aria-label="Colunas de pedidos">
      {KANBAN_COLUMNS.map(key => <button key={key} type="button" aria-pressed={activeColumn === key}
        onClick={() => selectColumn(key)} style={activeColumn === key ? { backgroundColor: KANBAN_COLUMN_THEME[key].color, color: '#ffffff' } : undefined}>
        {KANBAN_COLUMN_THEME[key].label} <span>{groups[key].count}</span>
      </button>)}
    </nav>
    <div ref={board} className="orders-kanban-board" data-testid="orders-kanban" onScroll={() => {
      if (!board.current) return;
      const lanes = Array.from(board.current.children) as HTMLElement[];
      const closest = lanes.reduce((a, b) => Math.abs(a.offsetLeft - board.current!.scrollLeft) < Math.abs(b.offsetLeft - board.current!.scrollLeft) ? a : b);
      if (closest) setActiveColumn(closest.dataset.column as KanbanColumn);
    }}>
      {KANBAN_COLUMNS.map(key => <section key={key} data-column={key} aria-label={KANBAN_COLUMN_THEME[key].label}
        className="orders-kanban-column" style={{ backgroundColor: KANBAN_COLUMN_THEME[key].tint }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={e => { e.preventDefault(); onDrop(e.dataTransfer.getData('text/plain'), KANBAN_COLUMN_THEME[key].dropStatus); }}>
        <KanbanColumnHeader column={key} count={groups[key].count} total={groups[key].total} />
        <div className="orders-kanban-scroll" tabIndex={0} aria-label={`Pedidos: ${KANBAN_COLUMN_THEME[key].label}`}>
          {loading ? Array.from({ length: 3 }, (_, i) => <div key={i} className="orders-kanban-skeleton" aria-label="Carregando pedido"><div /><div /><div /></div>)
            : groups[key].orders.length ? groups[key].orders.map(renderOrder)
            : <div className="orders-kanban-empty"><Package size={32} strokeWidth={1.4} /><p>NENHUM PEDIDO</p><span>Os pedidos desta etapa aparecem aqui.</span></div>}
        </div>
      </section>)}
    </div>
  </div>;
}
